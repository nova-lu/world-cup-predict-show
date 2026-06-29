/**
 * 周期性 ELO 回缩脚本
 *
 * 将所有队伍 rating 向 1500 靠拢，防止长期漂移。
 * newRating = 1500 + (oldRating - 1500) * (1 - rate)
 *
 * CLI: node scripts/shrink_elo.mjs [--rate 0.015]
 * 默认 rate = 0.015（即 1.5% 回缩）
 *
 * cron 建议: 0 6 * * 1 cd /path/to/project && node scripts/shrink_elo.mjs >> logs/shrink_elo.log 2>&1
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

const ELO_CALIBRATED_PATH = resolve(PROJECT_ROOT, 'data/elo-calibrated.json');
const MANIFESTS_DIR = resolve(PROJECT_ROOT, 'data/elo-manifests');
const DEFAULT_SHRINK_RATE = 0.015;
const BASELINE = 1500;

function main() {
  const args = process.argv.slice(2);
  let rate = DEFAULT_SHRINK_RATE;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rate' && args[i + 1]) {
      rate = parseFloat(args[i + 1]);
      if (isNaN(rate) || rate < 0 || rate > 1) {
        console.error(`无效 rate: ${args[i + 1]}，应在 0~1 之间`);
        process.exit(1);
      }
      i++;
    }
    if (args[i] === '--help' || args[i] === '-h') {
      console.log('用法: node scripts/shrink_elo.mjs [--rate <0~1>]');
      console.log('  默认 rate = 0.015 (1.5% 回缩)');
      process.exit(0);
    }
  }

  if (!existsSync(ELO_CALIBRATED_PATH)) {
    console.error(`❌ ELO 文件不存在: ${ELO_CALIBRATED_PATH}`);
    process.exit(1);
  }

  const raw = readFileSync(ELO_CALIBRATED_PATH, 'utf-8');
  const data = JSON.parse(raw);
  const ratings = data.ratings;

  if (!ratings || Object.keys(ratings).length === 0) {
    console.error('❌ 无 ELO ratings 数据');
    process.exit(1);
  }

  // 记录回缩前状态
  const before = { ...ratings };
  const topMovers = [];

  // 应用回缩
  let maxAbsDelta = 0;
  let totalDelta = 0;
  for (const [slug, rating] of Object.entries(ratings)) {
    const diff = rating - BASELINE;
    const newRating = Math.round((BASELINE + diff * (1 - rate)) * 10) / 10;
    const delta = Math.round((newRating - rating) * 10) / 10;
    ratings[slug] = newRating;
    totalDelta += Math.abs(delta);
    if (Math.abs(delta) > Math.abs(maxAbsDelta)) {
      maxAbsDelta = delta;
    }
    topMovers.push({ team: slug, delta });
  }

  // 排序 top movers
  topMovers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // 写入
  data.generatedAt = new Date().toISOString();
  data.method = `shrink-${(rate * 100).toFixed(1)}%-${new Date().toISOString().slice(0, 10)}`;
  writeFileSync(ELO_CALIBRATED_PATH, JSON.stringify(data, null, 2), 'utf-8');

  // 生成回缩 manifest
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;

  if (!existsSync(MANIFESTS_DIR)) {
    mkdirSync(MANIFESTS_DIR, { recursive: true });
  }

  const shrinkManifest = {
    manifestId: `elo_shrink_${ts}`,
    generatedAt: new Date().toISOString(),
    shrinkRate: rate,
    teamsApplied: Object.keys(ratings).length,
    ratingsBefore: before,
    ratingsAfter: { ...ratings },
    topMovers: topMovers.slice(0, 10),
    method: `shrink-${(rate * 100).toFixed(1)}%`,
    generatedBy: 'shrink_elo.mjs v1',
  };

  const manifestPath = resolve(MANIFESTS_DIR, `elo_shrink_${ts}.json`);
  writeFileSync(manifestPath, JSON.stringify(shrinkManifest, null, 2), 'utf-8');

  console.log(`[shrink] ✅ ELO 回缩完成`);
  console.log(`[shrink]   回缩率: ${(rate * 100).toFixed(1)}%`);
  console.log(`[shrink]   队伍数: ${Object.keys(ratings).length}`);
  console.log(`[shrink]   最大变动: ${topMovers[0]?.team || '-'} ${topMovers[0]?.delta > 0 ? '+' : ''}${topMovers[0]?.delta.toFixed(1)}`);
  console.log(`[shrink]   总变动量: ${totalDelta.toFixed(1)}`);
  console.log(`[shrink]   Manifest: elo_shrink_${ts}.json`);

  // 测试验证
  const sampleSlug = topMovers[0]?.team;
  if (sampleSlug) {
    const expected = Math.round((BASELINE + (before[sampleSlug] - BASELINE) * (1 - rate)) * 10) / 10;
    const actual = ratings[sampleSlug];
    if (expected !== actual) {
      console.warn(`[shrink] ⚠️ 验证失败: ${sampleSlug} 期望 ${expected} 实际 ${actual}`);
    } else {
      console.log(`[shrink] ✅ 验证通过: ${sampleSlug} ${before[sampleSlug]} → ${actual}（${(actual - before[sampleSlug]).toFixed(1)}）`);
    }
  }
}

main();
