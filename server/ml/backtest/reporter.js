/**
 * 回测报告生成器
 * 输出 JSON / CSV / Markdown 三种格式
 *
 * Phase 17:
 *  T5: 场景分析（OverUnder/BTTS/比分）→ MD 第8章
 *  T6: 错误聚类 + 引擎优势分析 → MD 第6章
 *  T7: 报告章节增强（引擎对比/场景分析/结论建议）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeSceneAnalysis, computeErrorClustering, computeEngineAdvantage } from './metrics.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, '../../../data/backtest/reports');

export async function generateReport(result) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const report = {
    generatedAt: new Date().toISOString(),
    summary: result.summary,
    overall: {},
    yearly: {},
    stageBreakdown: {},
    errorAnalysis: {},
    calibration: {},
    engineComparison: {},
    sceneAnalysis: {},
    errorClustering: {},
    engineAdvantage: {},
    oddsBaseline: null,
    records: result.records,
    snapshotInfo: result.records[0]?.snapshotInfo || null,
  };

  // Phase 18: 记录 DC 修正状态
  try {
    const mlConfig = (await import('../config.js')).default;
    report.poissonDC = {
      dcEnabled: mlConfig.poisson?.dcEnabled ?? true,
      dcRho: mlConfig.poisson?.dcRho ?? -0.13,
    };
  } catch {}

  const engines = ['elo', 'ml', 'ensemble'].filter(e => result.overall?.[e]?.available);
  for (const eng of engines) {
    report.overall[eng] = result.overall[eng];
    report.yearly[eng] = result.yearly[eng] || {};
    report.stageBreakdown[eng] = result.stageBreakdown[eng] || {};
    report.errorAnalysis[eng] = result.errorAnalysis[eng] || {};
    report.calibration[eng] = result.overall[eng]?.calibration || { ece: null, bins: [] };

    // Phase 17 T5: 场景分析
    report.sceneAnalysis[eng] = result.sceneAnalysis?.[eng] || {};

    // Phase 17 T6: 错误聚类
    report.errorClustering[eng] = result.errorClustering?.[eng] || {};

    // Phase 17 T6: 引擎优势
    if (engines.includes('ml') && engines.includes('elo') && eng === 'all') {
      report.engineAdvantage = result.engineAdvantage || {};
    }
  }

  // 全局引擎对比
  if (engines.length >= 2) {
    report.engineComparison = buildEngineComparison(result.records, engines);
    report.engineAdvantage = result.engineAdvantage || {};
  }

  // Phase 17 T4: 赔率基线
  if (result.oddsBaseline) {
    report.oddsBaseline = result.oddsBaseline;
  }

  // Phase 17 T2: 数据泄露标注
  report.warnings = [];
  if (result.mlLeakageWarning) {
    report.warnings.push('⚠️ ML 模型可能存在数据泄露：训练集可能包含历史比赛结果，回测准确率可能虚高。');
  }

  // JSON
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const jsonPath = path.join(REPORTS_DIR, `backtest_${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

  // CSV
  const csvPath = path.join(REPORTS_DIR, `backtest_detail_${timestamp}.csv`);
  writeCSV(result.records, engines, csvPath);

  // MD
  const mdPath = path.join(REPORTS_DIR, `backtest_summary_${timestamp}.md`);
  const md = generateMarkdown(report);
  fs.writeFileSync(mdPath, md, 'utf-8');

  console.log(`[backtest/reporter] 报告已保存:\n  JSON: ${jsonPath}\n  CSV:  ${csvPath}\n  MD:   ${mdPath}`);
  return report;
}

function generateMarkdown(report) {
  const { summary } = report;
  const engines = Object.keys(report.overall).filter(e => report.overall[e]?.available);
  let md = `# 模型回测报告\n\n**生成时间**: ${report.generatedAt}\n\n## 1. 执行概要\n\n`;
  md += `- 回测范围: ${summary.total} 场比赛\n`;
  md += `- 覆盖届次: ${summary.byYear.map(y => `${y.year}年(${y.count}场)`).join('、')}\n`;
  if (report.snapshotInfo?.home) {
    md += `- Elo 快照来源: ${report.snapshotInfo.home === report.snapshotInfo.away ? report.snapshotInfo.home : `${report.snapshotInfo.home} / ${report.snapshotInfo.away}`}\n`;
  }
  if (report.poissonDC) {
    md += `- Dixon-Coles修正: ${report.poissonDC.dcEnabled ? '✅ 已启用' : '❌ 已禁用'} (ρ=${report.poissonDC.dcRho})\n`;
  }
  for (const w of (report.warnings || [])) {
    md += `- ⚠️ ${w}\n`;
  }
  md += `\n## 2. 综合指标\n\n`;
  md += `| 引擎 | 场次 | 准确率 | Brier | LogLoss | ECE | 预期ROI |\n|------|------|--------|-------|---------|-----|--------|\n`;
  for (const eng of engines) {
    const o = report.overall[eng];
    md += `| ${eng} | ${o.n || 0} | ${fmtPct(o.accuracy)} | ${o.brier || '-'} | ${o.logLoss || '-'} | ${o.calibration?.ece != null ? (o.calibration.ece * 100).toFixed(1) + '%' : '-'} | ${o.roi != null ? o.roi + '%' : '-'} |\n`;
  }
  // Phase 17 T4: 赔率基线
  if (report.oddsBaseline?.n > 0) {
    const ob = report.oddsBaseline;
    md += `| **赔率共识** | ${ob.n} | ${fmtPct(ob.accuracy)} | ${ob.brier} | ${ob.logLoss} | - | - |\n`;
  }
  md += `| **随机基线** | - | 33.3% | 0.667 | 1.099 | - | - |\n`;
  const first = report.overall[engines[0]];
  if (first?.alwaysHomeBaseline) md += `| **Always Home** | - | ${fmtPct(first.alwaysHomeBaseline.accuracy)} | ${first.alwaysHomeBaseline.brier} | - | - | - |\n\n`;

  // Phase 17 T5: 场景分析行
  if (engines.length > 0) {
    md += `### 场景指标\n\n| 引擎 | Over/Under 准确率 | BTTS 准确率 | xG MAE | 精确比分命中率 |\n|------|------------------|-------------|--------|---------------|\n`;
    for (const eng of engines) {
      const sc = report.sceneAnalysis?.[eng];
      if (!sc?.overUnder) continue;
      md += `| ${eng} | ${fmtPct(sc.overUnder.accuracy)} (n=${sc.overUnder.n}) | ${fmtPct(sc.btts.accuracy)} (n=${sc.btts.n}) | ${sc.score.xgMae || '-'} | ${fmtPct(sc.score.exactHitRate)} (top3: ${fmtPct(sc.score.top3HitRate)}) |\n`;
    }
    md += '\n';
  }

  md += `## 3. 按届次表现\n\n| 年份 | 场次 | `;
  for (const eng of engines) md += `${eng} 准确率 | ${eng} Brier | `;
  md += `\n|------|------|`;
  for (const eng of engines) md += `--------|----------|`;
  md += `\n`;
  for (const year of summary.byYear) {
    md += `| ${year.year} | ${year.count} | `;
    for (const eng of engines) {
      const yd = report.yearly[eng]?.[year.year];
      md += `${yd ? fmtPct(yd.accuracy) : '-'} | ${yd ? yd.brier : '-'} | `;
    }
    md += '\n';
  }

  md += `\n## 4. 校准分析\n\n`;
  for (const eng of engines) {
    const cal = report.calibration[eng];
    if (!cal) continue;
    md += `### ${eng}\n\n- ECE: ${cal.ece != null ? (cal.ece * 100).toFixed(2) + '%' : '-'} (${cal.eceLevel || '-'})\n\n| 置信区间 | 样本数 | 实际频率 | 平均置信 | 差距 |\n|----------|--------|----------|----------|------|\n`;
    for (const bin of cal.bins || []) md += `| ${bin.label} | ${bin.n} | ${(bin.actualFreq * 100).toFixed(1)}% | ${(bin.avgConfidence * 100).toFixed(1)}% | ${(bin.gap * 100).toFixed(1)}% |\n`;
    md += '\n';
  }

  md += `## 5. 错误分析\n\n`;
  for (const eng of engines) {
    const ea = report.errorAnalysis[eng];
    if (!ea) continue;
    md += `### ${eng}\n\n- 总错误: ${ea.totalErrors} / ${report.overall[eng]?.n || 0} (${(ea.errorRate * 100).toFixed(1)}%)\n`;
    md += `- 错误时平均置信度: ${ea.avgConfOnError != null ? (ea.avgConfOnError * 100).toFixed(1) + '%' : '-'}\n`;
    md += `- 模式: 爆冷误判 ${ea.patterns?.upset || 0}、平局漏判 ${ea.patterns?.drawMiss || 0}、胜负颠倒 ${ea.patterns?.homeAwayMiss || 0}\n\n`;
    if (ea.errorList?.length > 0) {
      md += `前 ${Math.min(ea.errorList.length, 10)} 个错误预测:\n\n| 比赛 | 日期 | 预测 | 实际 | 置信度 |\n|------|------|------|------|--------|\n`;
      for (const err of ea.errorList.slice(0, 10)) md += `| ${err.match} | ${err.date} | ${err.predicted} | ${err.actual} | ${(err.confidence * 100).toFixed(1)}% |\n`;
      md += '\n';
    }
  }

  // Phase 17 T7: 第6章 — 引擎对比
  md += `## 6. 引擎对比\n\n`;
  if (report.engineComparison?.length > 0) {
    md += `### 逐对对比\n\n| 对比组 | 总数 | A 胜出 | B 胜出 | 平局 | A 胜率 | B 胜率 |\n|--------|------|--------|--------|------|--------|--------|\n`;
    for (const p of report.engineComparison) {
      md += `| ${p.pair} | ${p.total} | ${p.e1Better} | ${p.e2Better} | ${p.tie} | ${fmtPct(p.e1WinRate)} | ${fmtPct(p.e2WinRate)} |\n`;
    }
    md += '\n';
  }

  // Phase 17 T7: 第6章 — 引擎优势场景分析
  if (report.engineAdvantage && Object.keys(report.engineAdvantage).length > 0) {
    md += `### 优势场景\n\n| 场景 | 总数 | Elo 胜 | ML 胜 | 平局 | ML 优势 |\n|------|------|--------|-------|------|--------|\n`;
    for (const [key, s] of Object.entries(report.engineAdvantage)) {
      md += `| ${s.label} | ${s.total} | ${s.eloBetter} | ${s.mlBetter} | ${s.tie} | ${s.mlAdvantage >= 0 ? '+' : ''}${s.mlAdvantage}% |\n`;
    }
    md += '\n';
  }

  // Phase 17 T7: 第7章 — 错误聚类
  md += `## 7. 错误聚类\n\n`;
  for (const eng of engines) {
    const ec = report.errorClustering?.[eng];
    if (!ec || Object.keys(ec).length === 0) continue;
    md += `### ${eng}\n\n| Elo 差范围 | 场次 | 错误 | 错误率 |\n|-----------|------|------|--------|\n`;
    for (const g of Object.values(ec)) {
      md += `| ${g.label} | ${g.total} | ${g.errors} | ${fmtPct(g.errorRate)} |\n`;
    }
    md += '\n';
  }

  // Phase 17 T7: 第8章 — 场景分析详情
  if (engines.some(e => report.sceneAnalysis?.[e]?.overUnder?.n > 0)) {
    md += `## 8. 场景分析\n\n`;
    for (const eng of engines) {
      const sc = report.sceneAnalysis?.[eng];
      if (!sc?.overUnder || sc.overUnder.n === 0) continue;
      md += `### ${eng}\n\n`;
      md += `**Over/Under 2.5**: 准确率 ${fmtPct(sc.overUnder.accuracy)}，Brier ${sc.overUnder.brier}，样本 ${sc.overUnder.n} (Over ${sc.overUnder.overCount} / Under ${sc.overUnder.underCount})\n\n`;
      md += `**BTTS**: 准确率 ${fmtPct(sc.btts.accuracy)}，Brier ${sc.btts.brier}，样本 ${sc.btts.n} (是 ${sc.btts.bttsYesCount} / 否 ${sc.btts.bttsNoCount})\n\n`;
      md += `**比分精度**: xG MAE ${sc.score.xgMae}，精确命中 ${fmtPct(sc.score.exactHitRate)}，Top3 ${fmtPct(sc.score.top3HitRate)}\n\n`;
    }
  }

  // Phase 17 T7: 第9章 — 结论与建议
  md += `## 9. 结论与建议\n\n`;
  for (const eng of engines) {
    const o = report.overall[eng];
    if (!o) continue;
    const acc = o.accuracy;
    const brier = o.brier;
    const ece = o.calibration?.ece;
    const randAcc = 1 / 3;
    const homeBaseline = first?.alwaysHomeBaseline?.accuracy || 0.435;
    md += `**${eng}**:\n`;
    md += `- 准确率 ${fmtPct(acc)}，${acc > homeBaseline ? `超过Always Home基线 (${fmtPct(homeBaseline)})` : `低于Always Home基线 (${fmtPct(homeBaseline)})`}`;
    if (acc > randAcc) md += `，超过随机基线 (33.3%)`;
    md += '\n';
    if (ece != null) {
      const eceLevel = ece < 0.05 ? '良好' : ece < 0.15 ? '中等' : '较差';
      md += `- 校准度 (ECE=${(ece * 100).toFixed(2)}%) 评价为**${eceLevel}**`;
      if (ece >= 0.15) md += '，建议进行概率校准（Platt scaling或温度缩放）';
      md += '\n';
    }
    md += `- Brier分数 ${brier}（完美=0，随机=0.667）\n\n`;
  }

  // 总体建议
  const bestEng = engines.sort((a, b) => (report.overall[b]?.accuracy || 0) - (report.overall[a]?.accuracy || 0))[0];
  const worstEng = engines.sort((a, b) => (report.overall[a]?.accuracy || 0) - (report.overall[b]?.accuracy || 0))[0];
  md += `**总体**: 表现最佳引擎为 \`${bestEng}\`，最差为 \`${worstEng}\`。`;
  if (bestEng === 'ensemble') md += ' 集成模型验证有效。';
  md += '\n';

  // 场景分析建议
  for (const eng of engines) {
    const scs = report.sceneAnalysis?.[eng];
    if (!scs?.overUnder || scs.overUnder.n === 0) continue;
    if (scs.overUnder.accuracy < 0.55) {
      md += `- ${eng}: Over/Under预测需改进（准确率${fmtPct(scs.overUnder.accuracy)}）\n`;
    }
    if (scs.btts.accuracy < 0.50) {
      md += `- ${eng}: BTTS预测需改进（准确率${fmtPct(scs.btts.accuracy)}）\n`;
    }
  }

  if (report.warnings?.length > 0) {
    md += `\n### 风险提示\n\n`;
    for (const w of report.warnings) md += `- ${w}\n`;
  }

  md += `\n---\n> 报告由回测系统自动生成 | Phase 17 增强版 | `;
  md += `[Elo快照,场景分析,错误聚类,引擎对比]`;
  md += '\n';
  return md;
}

function buildEngineComparison(records, engines) {
  const pairs = [];
  for (let i = 0; i < engines.length; i++) {
    for (let j = i + 1; j < engines.length; j++) {
      const e1 = engines[i], e2 = engines[j];
      let e1Better = 0, e2Better = 0, tie = 0;
      for (const r of records) {
        const p1 = r.predictions?.[e1]?.prob, p2 = r.predictions?.[e2]?.prob;
        if (!p1 || !p2) continue;
        const c1 = normalizeOutcome(getMaxKey(p1)) === normalizeOutcome(r.actualOutcome) ? 1 : 0;
        const c2 = normalizeOutcome(getMaxKey(p2)) === normalizeOutcome(r.actualOutcome) ? 1 : 0;
        if (c1 > c2) e1Better++; else if (c2 > c1) e2Better++; else tie++;
      }
      pairs.push({ pair: `${e1} vs ${e2}`, total: records.length, e1Better, e2Better, tie, e1WinRate: records.length > 0 ? round(e1Better / records.length, 4) : 0, e2WinRate: records.length > 0 ? round(e2Better / records.length, 4) : 0 });
    }
  }
  return pairs;
}

function writeCSV(records, engines, csvPath) {
  const header = ['matchId', 'date', 'year', 'stage', 'homeTeam', 'awayTeam', 'actualOutcome', 'homeScore', 'awayScore', 'eloDiff'];
  for (const eng of engines) header.push(`${eng}_homeWin`, `${eng}_draw`, `${eng}_awayWin`, `${eng}_xgHome`, `${eng}_xgAway`, `${eng}_confidence`, `${eng}_correct`);
  const lines = [header.join(',')];
  for (const r of records) {
    const eloDiff = (r.eloRating?.home || 1500) - (r.eloRating?.away || 1500);
    const row = [r.matchId, r.date, r.year, r.stage, r.homeTeamDisplay || r.homeTeam, r.awayTeamDisplay || r.awayTeam, r.actualOutcome, r.actualScore?.home, r.actualScore?.away, round(eloDiff, 0)];
    for (const eng of engines) {
      const pred = r.predictions?.[eng];
      if (pred?.prob) {
        const maxProb = Math.max(pred.prob.homeWin, pred.prob.draw, pred.prob.awayWin);
        const correctVal = normalizeOutcome(getMaxKey(pred.prob)) === normalizeOutcome(r.actualOutcome) ? 1 : 0;
        row.push(round(pred.prob.homeWin, 4), round(pred.prob.draw, 4), round(pred.prob.awayWin, 4), round(pred.xg?.home || 0, 2), round(pred.xg?.away || 0, 2), round(maxProb, 4), correctVal);
      } else row.push('', '', '', '', '', '', '');
    }
    lines.push(row.join(','));
  }
  fs.writeFileSync(csvPath, lines.join('\n'), 'utf-8');
}

function normalizeOutcome(o) { if (!o) return null; const u=String(o).toUpperCase(); if(u==="HOME"||u==="HOMEWIN") return "HOME"; if(u==="AWAY"||u==="AWAYWIN") return "AWAY"; if(u==="DRAW") return "DRAW"; return null; }
function fmtPct(v) { return v != null ? (v * 100).toFixed(1) + '%' : '-'; }
function getMaxKey(obj) { if (!obj) return 'UNKNOWN'; return Object.keys(obj).reduce((a, b) => obj[a] > obj[b] ? a : b); }
function round(v, d) { const f = Math.pow(10, d); return Math.round(v * f) / f; }
