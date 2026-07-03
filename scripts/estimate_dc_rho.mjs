#!/usr/bin/env node
/**
 * ρ (Dixon-Coles 相关性参数) 最大似然估计工具
 *
 * 从历史比赛数据中，通过 MLE 估计最优 ρ 值。
 * 输出结果到 server/ml/data/dc_rho_estimate.json
 *
 * 用法: node scripts/estimate_dc_rho.mjs [--csv path] [--steps 101]
 *
 * 算法: 在 [-0.5, 0.5] 范围内网格搜索负对数似然最小值，
 *       然后在最优值附近做二次抛物线插值求精。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'server', 'ml', 'data');

// 默认 CSV 路径
const DEFAULT_CSV = path.join(ROOT, 'world-cup-data', 'matches_1930_2022.csv');

// ===== 泊松 PMF =====
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  const logP = -lambda + k * Math.log(lambda) - logFactorial(k);
  return Math.exp(logP);
}

const logFactorialCache = [0];
function logFactorial(n) {
  for (let i = logFactorialCache.length; i <= n; i++) {
    logFactorialCache[i] = logFactorialCache[i - 1] + Math.log(i);
  }
  return logFactorialCache[n];
}

// ===== Dixon-Coles =====
function dcTau(a, b, lambda, mu, rho) {
  if (a === 0 && b === 0) return 1 - lambda * mu * rho;
  if (a === 0 && b === 1) return 1 + lambda * rho;
  if (a === 1 && b === 0) return 1 + mu * rho;
  if (a === 1 && b === 1) return 1 - rho;
  return 1;
}

function scoreProbability(hg, ag, lambda, mu, rho, maxGoals = 8) {
  let total = 0;
  let cell = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPMF(h, lambda) * poissonPMF(a, mu) * dcTau(h, a, lambda, mu, rho);
      if (h === hg && a === ag) cell = p;
      total += p;
    }
  }
  return total > 0 ? cell / total : 0;
}

// ===== 简单 Elo 预期进球估计 =====
function estimateExpectedGoals(homeRating, awayRating, homeBonus = 100) {
  const diff = (homeRating + homeBonus) - awayRating;
  const baseTotal = 2.5;
  const homeShare = 1 / (1 + Math.exp(-diff / 400));
  const homeXg = baseTotal * homeShare;
  const awayXg = baseTotal * (1 - homeShare);
  return { homeXg, awayXg };
}

// ===== CSV 读取 =====
function parseCSVLine(line) {
  const cols = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  cols.push(current.trim());
  return cols;
}

async function readMatches(csvPath) {
  const matches = [];
  const stream = fs.createReadStream(csvPath, 'utf-8');
  const rl = createInterface({ input: stream });

  let header = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = parseCSVLine(line);
    if (!header) { header = cols; continue; }

    const m = {};
    header.forEach((h, i) => m[h.trim()] = cols[i]?.trim() || '');

    const homeGoals = parseInt(m.home_goals ?? m.hg ?? m.home_score);
    const awayGoals = parseInt(m.away_goals ?? m.ag ?? m.away_score);

    if (isNaN(homeGoals) || isNaN(awayGoals)) continue;

    const homeRating = parseFloat(m.home_elo ?? m.elo_home ?? m.home_rating) || 1500;
    const awayRating = parseFloat(m.away_elo ?? m.elo_away ?? m.away_rating) || 1500;

    matches.push({ homeGoals, awayGoals, homeRating, awayRating });
  }
  return matches;
}

// ===== MLE 网格搜索 =====
function computeNLL(matches, rho) {
  let nll = 0;
  let validCount = 0;
  for (const m of matches) {
    const { homeXg, awayXg } = estimateExpectedGoals(m.homeRating, m.awayRating);
    // 跳过极低 λ 的比赛（数据噪声大）
    if (homeXg < 0.1 || awayXg < 0.1) continue;
    const prob = scoreProbability(m.homeGoals, m.awayGoals, homeXg, awayXg, rho);
    if (prob > 1e-15) {
      nll -= Math.log(prob);
      validCount++;
    }
  }
  return { nll, validCount };
}

// ===== 二次插值求精 =====
function quadraticRefine(x0, x1, x2, y0, y1, y2) {
  // 三点拟合二次函数，求顶点
  const denom = (x0 - x1) * (x0 - x2) * (x1 - x2);
  if (Math.abs(denom) < 1e-15) return x1;
  const A = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / denom;
  const B = (x2*x2 * (y0 - y1) + x1*x1 * (y2 - y0) + x0*x0 * (y1 - y2)) / denom;
  if (Math.abs(A) < 1e-15) return x1;
  return -B / (2 * A);
}

// ===== 主流程 =====
async function main() {
  const args = process.argv.slice(2);
  const csvPath = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : DEFAULT_CSV;
  const nSteps = parseInt(args.includes('--steps') ? args[args.indexOf('--steps') + 1] : '101');
  const parallelCount = parseInt(process.env.MLE_PARALLEL || '4');

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV 文件不存在: ${csvPath}`);
    process.exit(1);
  }

  console.log('📊 Dixon-Coles ρ 最大似然估计');
  console.log(`   CSV: ${csvPath}`);
  console.log(`   网格: ${nSteps} 步 (rho ∈ [-0.5, 0.5])`);
  console.log('');

  // 1. 读取比赛数据
  console.log('正在读取比赛数据...');
  const allMatches = await readMatches(csvPath);
  console.log(`   ✅ 读取 ${allMatches.length} 场比赛`);

  // 2. 过滤：只保留双方 Elo ≥ 1000 的比赛
  const matches = allMatches.filter(m => m.homeRating >= 1000 && m.awayRating >= 1000);
  console.log(`   ✅ 过滤后 ${matches.length} 场（Elo ≥ 1000）`);

  // 3. 网格搜索
  console.log('\n正在进行网格搜索...');
  const gridResults = [];
  let bestRho = 0, bestNLL = Infinity;

  for (let i = 0; i < nSteps; i++) {
    const rho = -0.5 + (i / (nSteps - 1)) * 1.0;
    const { nll, validCount } = computeNLL(matches, rho);
    gridResults.push({ rho, nll, validCount });
    if (nll < bestNLL) {
      bestNLL = nll;
      bestRho = rho;
    }
  }

  // 4. 二次求精
  const idx = gridResults.findIndex(r => r.rho === bestRho);
  const refinePoints = [-1, 0, 1].map(d => gridResults[Math.max(0, Math.min(nSteps - 1, idx + d))]);
  if (refinePoints.length === 3) {
    const refined = quadraticRefine(
      refinePoints[0].rho, refinePoints[1].rho, refinePoints[2].rho,
      refinePoints[0].nll, refinePoints[1].nll, refinePoints[2].nll
    );
    // 夹紧到 [-0.5, 0.5]
    const clampedRho = Math.max(-0.5, Math.min(0.5, refined));
    const { nll: refinedNll } = computeNLL(matches, clampedRho);
    if (refinedNll < bestNLL && clampedRho !== bestRho) {
      console.log(`   二次求精: ${bestRho.toFixed(4)} → ${clampedRho.toFixed(4)} (NLL: ${bestNLL.toFixed(2)} → ${refinedNll.toFixed(2)})`);
      bestRho = clampedRho;
      bestNLL = refinedNll;
    }
  }

  // 5. 基线对比 (rho=0 即独立泊松)
  const { nll: baselineNll, validCount: baseValid } = computeNLL(matches, 0);
  const { nll: defaultNll } = computeNLL(matches, -0.13);
  const logLikelihoodRatio = baselineNll - bestNLL;
  const pctImprovement = baselineNll > 0 ? ((baselineNll - bestNLL) / baselineNll * 100) : 0;

  // 6. 输出结果
  const result = {
    optimalRho: Math.round(bestRho * 10000) / 10000,
    negativeLogLikelihood: Math.round(bestNLL * 100) / 100,
    validMatches: matches.find(m => {
      const { homeXg, awayXg } = estimateExpectedGoals(m.homeRating, m.awayRating);
      return homeXg >= 0.1 && awayXg >= 0.1;
    }) ? matches.length : 0,
    baseline: {
      rho: 0,
      nll: Math.round(baselineNll * 100) / 100,
    },
    defaultRho: {
      rho: -0.13,
      nll: Math.round(defaultNll * 100) / 100,
    },
    improvement: {
      logLikelihoodReduction: Math.round(logLikelihoodRatio * 100) / 100,
      percentReduction: Math.round(pctImprovement * 100) / 100,
    },
    config: {
      csvPath,
      nSteps,
      rhoRange: [-0.5, 0.5],
    },
    timestamp: new Date().toISOString(),
    summary: `最优 ρ = ${Math.round(bestRho * 10000) / 10000}，比独立泊松 (ρ=0) ${pctImprovement > 0 ? '改善' : '劣于'} ${Math.abs(pctImprovement).toFixed(1)}%`,
  };

  // 7. 输出表格
  console.log('\n📈 结果:');
  console.log(`   最优 ρ:           ${result.optimalRho}`);
  console.log(`   负对数似然:       ${result.negativeLogLikelihood}`);
  console.log(`   基线 (ρ=0):       ${result.baseline.nll}`);
  console.log(`   默认 (ρ=-0.13):   ${result.defaultRho.nll}`);
  console.log(`   似然降低:         ${result.improvement.logLikelihoodReduction}`);
  console.log(`   相对改善:         ${result.improvement.percentReduction}%`);

  // 8. 保存
  const outDir = path.join(ROOT, 'server', 'ml', 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'dc_rho_estimate.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\n💾 结果已保存: ${outPath}`);

  // 9. 建议
  const recommended = Math.round(bestRho * 10000) / 10000;
  if (recommended >= -0.2 && recommended <= -0.05) {
    console.log(`\n✅ ρ=${recommended} 在合理区间 [-0.2, -0.05] 内，建议更新 config.js 的 dcRho 值。`);
  } else if (recommended < -0.2) {
    console.log(`\n⚠️  ρ=${recommended} 低于典型范围，建议检查数据质量。` +
                `临时可继续使用默认值 -0.13。`);
  } else {
    console.log(`\n⚠️  ρ=${recommended} 高于典型范围，可能数据集包含大量非世界杯比赛。` +
                `建议使用 subset 参数限制数据集。`);
  }
}

main().catch(e => {
  console.error('❌ 执行失败:', e.message);
  process.exit(1);
});
