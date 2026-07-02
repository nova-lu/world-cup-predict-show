// ===== AI Prompt 构造器 =====
// 将聚合数据转为 LLM 可理解的 prompt 文本

function fmtPct(v, digits = 1) { return (v * 100).toFixed(digits) + '%'; }
function fmtNum(v, digits = 2) { return Number(v).toFixed(digits); }

// 格式化比赛日期：UTC → 北京时间
function formatMatchDate(mi) {
  if (!mi) return '待定';
  // 优先 utcDate（精确时间）
  if (mi.utcDate) {
    try {
      const d = new Date(mi.utcDate);
      if (!isNaN(d.getTime())) {
        const bjt = new Date(d.getTime() + 8 * 3600000);
        const mm = String(bjt.getMonth() + 1).padStart(2, '0');
        const dd = String(bjt.getDate()).padStart(2, '0');
        const hh = String(bjt.getHours()).padStart(2, '0');
        const miMin = String(bjt.getMinutes()).padStart(2, '0');
        return `${mm}-${dd} ${hh}:${miMin} (北京时间)`;
      }
    } catch (_) {}
  }
  // 次选 date + time
  if (mi.date && mi.time) return `${mi.date} ${mi.time}`;
  if (mi.date) return mi.date;
  return '待定';
}

function buildEloSection(d) {
  if (!d) return '# 数据源 1 - ELO 评分系统\nElo 数据不可用。\n';
  return `# 数据源 1 - ELO 评分系统
主队 ELO: ${d.homeRating}, 客队 ELO: ${d.awayRating}
主场加成: ${d.homeBonus}
Elo 预测概率: 主胜 ${fmtPct(d.probabilities.homeWin)}, 平局 ${fmtPct(d.probabilities.draw)}, 客胜 ${fmtPct(d.probabilities.awayWin)}
Elo 预期进球: 主队 ${fmtNum(d.expectedGoals.home)}, 客队 ${fmtNum(d.expectedGoals.away)}
`;
}

function buildMLSection(d) {
  if (!d || !d.available) return '# 数据源 2 - 机器学习模型\nML 数据暂无。\n';
  let s = `# 数据源 2 - 机器学习模型 (XGBoost + RF)
预测概率: 主胜 ${fmtPct(d.probabilities.homeWin)}, 平局 ${fmtPct(d.probabilities.draw)}, 客胜 ${fmtPct(d.probabilities.awayWin)}
预期进球: 主队 ${fmtNum(d.expectedGoals.home)}, 客队 ${fmtNum(d.expectedGoals.away)}
`;
  if (d.topScores) {
    s += 'Top 比分: ' + d.topScores.map(t => `${t.home}-${t.away}(${fmtPct(t.prob || t.probability, 1)})`).join(', ') + '\n';
  }
  if (d.overUnder) {
    s += `大小球: O2.5 ${fmtPct(d.overUnder.over2_5)}, U2.5 ${fmtPct(d.overUnder.under2_5)}, 预期总进球 ${fmtNum(d.overUnder.expectedTotal)}\n`;
  }
  if (d.btts) {
    s += `BTTS: 是 ${fmtPct(d.btts.yes)}, 否 ${fmtPct(d.btts.no)}\n`;
  }
  if (d.risk) {
    s += `风险: ${d.risk.level} (${d.risk.score})\n`;
  }
  return s;
}

function buildEnsembleSection(d) {
  if (!d || !d.available) return '# 数据源 3 - 集成学习\n集成数据暂无。\n';
  let s = `# 数据源 3 - 集成学习 (Elo + ML 动态加权)
预测概率: 主胜 ${fmtPct(d.probabilities.homeWin)}, 平局 ${fmtPct(d.probabilities.draw)}, 客胜 ${fmtPct(d.probabilities.awayWin)}
`;
  if (d.weights) {
    s += '权重: ' + JSON.stringify(d.weights) + '\n';
  }
  if (d.dynamicAdjusted) {
    s += '注: 权重经过动态调整\n';
  }
  return s;
}

function buildOddsSection(d) {
  if (!d || !d.available) return '# 数据源 4 - 市场赔率\n市场赔率数据暂无。\n';
  let s = `# 数据源 4 - 市场赔率 (多公司共识)
共识概率: 主胜 ${fmtPct(d.consensus.home)}, 平局 ${fmtPct(d.consensus.draw)}, 客胜 ${fmtPct(d.consensus.away)}
可用公司数: ${d.nBookmakers || 0}
`;
  if (d.divergence) {
    s += `市场分歧(标准差): ${fmtNum(d.divergence.stdDev)}\n`;
  }
  if (d.bookmakerDetails && d.bookmakerDetails.length > 0) {
    s += '各公司详情:\n';
    d.bookmakerDetails.slice(0, 3).forEach(b => {
      s += `  - ${b.name}: ` + JSON.stringify(b.odds) + '\n';
    });
  }
  return s;
}

function buildPolymarketSection(d) {
  if (!d || !d.available) return '# 数据源 5 - Polymarket 预测市场\nPolymarket 数据暂无。\n';
  return `# 数据源 5 - Polymarket 预测市场
预测概率: 主胜 ${fmtPct(d.probabilities.homeWin)}, 平局 ${fmtPct(d.probabilities.draw)}, 客胜 ${fmtPct(d.probabilities.awayWin)}
交易量: ${d.volume || 0}
`;
}

function buildLotterySection(d) {
  if (!d || !d.available) return '# 数据源 6 - 竞彩网赔率\n竞彩网数据暂无。\n';
  let s = '# 数据源 6 - 竞彩网赔率\n';
  if (d.probabilities) {
    s += `概率: 主胜 ${fmtPct(d.probabilities.homeWin)}, 平局 ${fmtPct(d.probabilities.draw)}, 客胜 ${fmtPct(d.probabilities.awayWin)}\n`;
  }
  if (d.returnRate) s += `返还率: ${(d.returnRate * 100).toFixed(1)}%\n`;
  return s;
}

function buildFormSection(d) {
  if (!d) return '# 数据源 7 - 近期状态\n近期状态数据暂无。\n';
  const h = d.home || {};
  const a = d.away || {};
  const homeCount = h.count || 0;
  const awayCount = a.count || 0;
  let s = '# 数据源 7 - 近期状态\n';
  s += `主队近况: ${h.form || 'N/A'}\n`;
  if (h.last5 && h.last5.length) {
    s += `主队近${homeCount}场:\n`;
    h.last5.forEach(m => {
      s += `  vs ${m.opponent}: ${m.result} (进${m.gf}失${m.ga})\n`;
    });
  } else {
    s += '主队近期无完赛记录。\n';
  }
  s += `客队近况: ${a.form || 'N/A'}\n`;
  if (a.last5 && a.last5.length) {
    s += `客队近${awayCount}场:\n`;
    a.last5.forEach(m => {
      s += `  vs ${m.opponent}: ${m.result} (进${m.gf}失${m.ga})\n`;
    });
  } else {
    s += '客队近期无完赛记录。\n';
  }
  return s;
}

function buildKnockoutSection(d) {
  if (!d || !d.available) return '';
  return `# 数据源 8 - 淘汰赛加时/点球分析
常规时间概率: ${fmtPct(d.regWin)}
加时赛概率: ${fmtPct(d.etWin)}
点球概率: ${fmtPct(d.pkWin)}
`;
}

/**
 * 构造发送给 LLM 的完整 prompt
 * @param {object} data - aggregateMatchData 的返回结果
 * @returns {string} - prompt 文本
 */
export function buildPrompt(data) {
  const mi = data.matchInfo;
  const homeName = mi.homeTeam.name;
  const awayName = mi.awayTeam.name;
  const stageLabel = mi.stage 
    ? ({ round32: '32强', round16: '16强', quarter: '1/4决赛', semi: '半决赛', final: '决赛', knockout: '淘汰赛', LAST_32: '32强', LAST_16: '16强', QUARTER_FINAL: '1/4决赛', SEMI_FINAL: '半决赛', FINAL: '决赛' }[mi.stage] || mi.stage)
    : '未知阶段';

  return `# 角色设定
你是顶级的足球比赛数据分析师。请基于以下所有数据源，对这场比赛进行综合分析。
输出严格遵循 JSON 格式，不包含任何其他文字。

# 比赛信息
- 赛事: 2026 FIFA World Cup
- 阶段: ${mi.stage} (${stageLabel})
- 日期: ${formatMatchDate(mi)}
- 球队: ${homeName} (主) vs ${awayName} (客)
${data.result ? `- 赛果: ${data.result.homeScore} - ${data.result.awayScore}` : ''}

${buildEloSection(data.eloPrediction)}

${buildMLSection(data.mlPrediction)}

${buildEnsembleSection(data.ensemblePrediction)}

${buildOddsSection(data.oddsData)}

${buildPolymarketSection(data.polymarket)}

${buildLotterySection(data.chinaSportsLottery)}

${buildFormSection(data.recentForm)}

${buildKnockoutSection(data.knockoutPrediction)}

# 请严格按以下 JSON Schema 输出分析结果:
{
  "probabilities": { "homeWin": 0.XX, "draw": 0.XX, "awayWin": 0.XX },
  "recommendedPick": "home|draw|away",
  "confidence": 0.XX,
  "bestOddsSource": "Bet365|William Hill|...",
  "scorePrediction": { "home": X, "away": Y },
  "overUnder": { "over2_5": 0.XX, "under2_5": 0.XX, "recommendation": "over|under" },
  "expectedGoals": { "home": X.XX, "away": X.XX, "total": X.XX },
  "btts": { "yes": 0.XX, "no": 0.XX },
  "extraTime": { "probability": 0.XX },
  "penaltyShootout": { "probability": 0.XX },
  "reasoning": "全面易懂的中文分析（约10句）覆盖各数据源，说明双方优劣势和比赛走势预判。用平实的语言，避免专业术语堆砌。",
  "keyFactors": ["因子1", "因子2", "因子3", "因子4"],
  "riskFactors": ["风险1", "风险2", "风险3"]
}`;
}

/**
 * 调试用：打印聚合数据的摘要
 */
export function summarizeData(data) {
  const sources = [];
  if (data.eloPrediction) sources.push('Elo');
  if (data.mlPrediction?.available) sources.push('ML');
  if (data.ensemblePrediction?.available) sources.push('Ensemble');
  if (data.oddsData?.available) sources.push('Odds');
  if (data.polymarket?.available) sources.push('Polymarket');
  if (data.chinaSportsLottery?.available) sources.push('竞彩');
  if (data.recentForm) sources.push('Form');
  if (data.knockoutPrediction?.available) sources.push('Knockout');
  return {
    match: `${data.matchInfo.homeTeam.name} vs ${data.matchInfo.awayTeam.name}`,
    sourcesAvailable: sources.length,
    sources,
    hasResult: !!data.result,
  };
}
