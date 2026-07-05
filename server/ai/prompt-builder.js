// ===== AI Prompt 构造器 =====
// 将聚合数据转为 LLM 可理解的 prompt 文本

function fmtPct(v, digits = 1) { return (v * 100).toFixed(digits) + '%'; }
function fmtNum(v, digits = 2) { return Number(v).toFixed(digits); }

// 格式化比赛日期：UTC → 北京时间
function formatMatchDate(mi) {
  if (!mi) return '待定';
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

function buildGroupContextSection(d) {
  if (!d) return '';
  return `# 数据源 9 - 小组赛背景
同组比赛: ${d.matchCount || 0} 场
小组: ${d.group || '未知'}
`;
}

/** 实时网络数据（Wikipedia 摘要，标注获取时间） */
function buildWebDataSection(d) {
  if (!d) return '';
  const h = d.home;
  const a = d.away;
  if (!h && !a) return '';
  let s = '# ⏱️ 实时网络数据 — 来自 Wikipedia（获取时间标注在后）\n';
  s += '以下数据是当前从互联网实时获取的，可能比你训练数据中的信息更新。\n';
  s += '**请务必使用以下数据替代你训练知识中的任何过时信息。**\n\n';
  if (h && h.extract) {
    s += `## ${h.name || '主队'} Wikipedia 摘要\n`;
    s += `获取时间: ${h.fetchedAt || '实时'}\n`;
    s += `${h.extract}\n\n`;
  }
  if (a && a.extract) {
    s += `## ${a.name || '客队'} Wikipedia 摘要\n`;
    s += `获取时间: ${a.fetchedAt || '实时'}\n`;
    s += `${a.extract}\n\n`;
  }
  if (!h && !a) s += '（当前无实时网络数据）\n';
  return s;
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
  const isKnockout = ['round32', 'round16', 'quarter', 'semi', 'final', 'knockout', 'LAST_32', 'LAST_16', 'QUARTER_FINAL', 'SEMI_FINAL', 'FINAL'].includes(mi.stage);

  return `# 角色设定
你是顶级的足球比赛数据分析师，拥有 20 年世界杯赛事分析经验。你的任务是综合利用以下所有数据源，对 2026 年世界杯比赛进行全局性的深度分析。输出严格遵循 JSON 格式。

## ⚠️ 最重要的纪律（必须遵守）
你的训练数据可能已经过时。以下规则高于一切：

1. **优先使用以下提供的实时数据**。每一条来源都标注了获取时间。
2. **严禁使用你训练数据中的球员名单/阵容信息**。例如法国队如果已经没有了格列兹曼球员等过时信息，你无论如何都不能提到。
3. **只在以下数据中提到某球员时，你才能分析该球员**。如果当前阵容数据中不包含某球员名，该球员可能已经不在国家队，你绝不能自行提及他。
4. 当你对某信息的时效性不确定时，明确注明"（数据限制）"并跳过该部分分析。
5. **信息真实性的优先级**：实时数据 > 本 prompt 下方提供的非实时数据源 > 你训练知识中的任何内容。

## 分析原则
1. **交叉验证**：对比各数据源的异同。当多个独立数据源（Elo/ML/赔率/预测市场）指向同一方向时，置信度更高。
2. **外部因素叠加**：额外考虑以下因素对比赛走势的影响：
   - 淘汰赛 vs 小组赛的心理压力差异
   - 小组出线形势（是否为生死战/出线关键战）
   - 赛程密集度（休息天数是否充足）
   - 球队大赛经验与心理素质
   - 天气、场地等外部条件（如适用）
3. **量化优先**：给出具体概率数字而非模糊描述。
4. **保守评估**：信源不足时置信度下调，不在数据不足时强行给出高置信度预测。

# 比赛信息
- 赛事: 2026 FIFA World Cup
- 阶段: ${mi.stage} (${stageLabel})${isKnockout ? ' [淘汰赛]' : ''}
- 日期: ${formatMatchDate(mi)}
- 球队: ${homeName} (主) vs ${awayName} (客)
${data.result ? `- 赛果: ${data.result.homeScore} - ${data.result.awayScore}` : ''}
${isKnockout ? '- 淘汰赛规则：常规时间平局→加时赛→点球大战' : '- 小组赛规则：胜3分平1分负0分'}

${buildWebDataSection(data.webData)}

${buildEloSection(data.eloPrediction)}

${buildMLSection(data.mlPrediction)}

${buildEnsembleSection(data.ensemblePrediction)}

${buildOddsSection(data.oddsData)}

${buildPolymarketSection(data.polymarket)}

${buildLotterySection(data.chinaSportsLottery)}

${buildFormSection(data.recentForm)}

${buildKnockoutSection(data.knockoutPrediction)}

${buildGroupContextSection(data.groupContext)}

# 请严格按以下 JSON Schema 输出分析结果（必须包含每个字段）:
{
  "probabilities": { "homeWin": 0.XX, "draw": 0.XX, "awayWin": 0.XX },
  "recommendedPick": "home|draw|away",
  "confidence": 0.XX,
  "bestOddsSource": "Bet365|William Hill|...",

  "scorePrediction": { "home": X, "away": Y },
  "alternativeScores": [
    { "home": X, "away": Y, "probability": 0.XX, "scenario": "简短描述这种比分出现的比赛情境" },
    { "home": X, "away": Y, "probability": 0.XX, "scenario": "..." },
    { "home": X, "away": Y, "probability": 0.XX, "scenario": "..." }
  ],

  "overUnder": { "over2_5": 0.XX, "under2_5": 0.XX, "recommendation": "over|under" },
  "expectedGoals": { "home": X.XX, "away": X.XX, "total": X.XX },
  "btts": { "yes": 0.XX, "no": 0.XX },
  "extraTime": { "probability": 0.XX },
  "penaltyShootout": { "probability": 0.XX },

  "reasoning": "全面易懂的中文分析（约10-15句）。依次覆盖：(1)双方实力对比和状态总评，(2)核心数据解读及交叉验证，(3)关键球员/战术因素，(4)比赛走势预判，(5)比分预测依据。用平实的语言，避免专业术语堆砌。",

  "keyFactors": ["因子1", "因子2", "因子3", "因子4"],
  "riskFactors": ["风险1", "风险2", "风险3"],

  "riskAssessment": {
    "level": "low|medium|high",
    "score": 0.XX,
    "explanation": "一段简洁的中文说明为什么给出这个风险评级（如: 赔率分歧大, 近期状态波动, 历史对阵不确定等）"
  }
}

## 各字段填写说明
- \`alternativeScores\`：除主推比分外，给出2-3个备选比分，每个附带概率和场景描述。例如客队反超、主队大胜、0-0闷平场景。
- \`riskAssessment\`：综合评估预测的不确定性。考虑因素：各信源分歧度、历史数据厚度、球队状态稳定性、淘汰赛偶然性。score 0-1，0=极低风险，1=极高风险。
- \`confidence\`：您对本预测的总体把握程度（0-1）。当多信源一致时提高，分歧大时降低。
- \`reasoning\`：中文约10-15句，逻辑清晰，覆盖完整的分析链条。`;
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
