/**
 * 回测报告生成器
 * 输出 JSON / CSV / Markdown 三种格式
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, '../../../data/backtest/reports');

export function generateReport(result) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const report = { generatedAt: new Date().toISOString(), summary: result.summary, overall: {}, yearly: {}, stageBreakdown: {}, errorAnalysis: {}, calibration: {}, engineComparison: {}, records: result.records };

  const engines = ['elo', 'ml', 'ensemble'].filter(e => result.overall?.[e]?.available);
  for (const eng of engines) {
    report.overall[eng] = result.overall[eng];
    report.yearly[eng] = result.yearly[eng] || {};
    report.stageBreakdown[eng] = result.stageBreakdown[eng] || {};
    report.errorAnalysis[eng] = result.errorAnalysis[eng] || {};
    report.calibration[eng] = result.overall[eng]?.calibration || { ece: null, bins: [] };
  }
  if (engines.length >= 2) report.engineComparison = buildEngineComparison(result.records, engines);

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
  md += `- 引擎: ${engines.join(', ')}\n\n## 2. 总体指标对比\n\n`;
  md += `| 引擎 | 场次 | 准确率 | Brier | LogLoss | ECE | 预期ROI |\n|------|------|--------|-------|---------|-----|--------|\n`;
  for (const eng of engines) {
    const o = report.overall[eng];
    md += `| ${eng} | ${o.n || 0} | ${fmtPct(o.accuracy)} | ${o.brier || '-'} | ${o.logLoss || '-'} | ${o.calibration?.ece != null ? (o.calibration.ece * 100).toFixed(1) + '%' : '-'} | ${o.roi != null ? o.roi + '%' : '-'} |\n`;
  }
  md += `| **随机基线** | - | 33.3% | 0.667 | 1.099 | - | - |\n`;
  const first = report.overall[engines[0]];
  if (first?.alwaysHomeBaseline) md += `| **Always Home** | - | ${fmtPct(first.alwaysHomeBaseline.accuracy)} | ${first.alwaysHomeBaseline.brier} | - | - | - |\n\n`;

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
    md += `\n`;
  }

  md += `\n## 4. 校准分析\n\n`;
  for (const eng of engines) {
    const cal = report.calibration[eng];
    if (!cal) continue;
    md += `### ${eng}\n\n- ECE: ${cal.ece != null ? (cal.ece * 100).toFixed(2) + '%' : '-'} (${cal.eceLevel || '-'})\n\n| 置信区间 | 样本数 | 实际频率 | 平均置信 | 差距 |\n|----------|--------|----------|----------|------|\n`;
    for (const bin of cal.bins || []) md += `| ${bin.label} | ${bin.n} | ${(bin.actualFreq * 100).toFixed(1)}% | ${(bin.avgConfidence * 100).toFixed(1)}% | ${(bin.gap * 100).toFixed(1)}% |\n`;
    md += `\n`;
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
      md += `\n`;
    }
  }
  md += `---\n> 报告由回测系统自动生成\n`;
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
  const header = ['matchId', 'date', 'year', 'stage', 'homeTeam', 'awayTeam', 'actualOutcome', 'homeScore', 'awayScore'];
  for (const eng of engines) header.push(`${eng}_homeWin`, `${eng}_draw`, `${eng}_awayWin`, `${eng}_xgHome`, `${eng}_xgAway`, `${eng}_confidence`, `${eng}_correct`);
  const lines = [header.join(',')];
  for (const r of records) {
    const row = [r.matchId, r.date, r.year, r.stage, r.homeTeamDisplay || r.homeTeam, r.awayTeamDisplay || r.awayTeam, r.actualOutcome, r.actualScore?.home, r.actualScore?.away];
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
