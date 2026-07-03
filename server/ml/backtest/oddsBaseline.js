/**
 * 赔率基线计算
 * Phase 17 T4: Odds Baseline
 *
 * 对每场比赛计算赔率隐含概率（如果有赔率数据）或3引擎共识基线，
 * 然后评估该基线的准确率、Brier分数和LogLoss。
 */

function normalizeOutcome(outcome) {
  if (!outcome) return null;
  const u = String(outcome).toUpperCase();
  if (u === 'HOME' || u === 'HOMEWIN') return 'HOME';
  if (u === 'AWAY' || u === 'AWAYWIN') return 'AWAY';
  if (u === 'DRAW') return 'DRAW';
  return null;
}

function maxKeyObj(obj) {
  if (!obj) return null;
  return Object.keys(obj).reduce((a, b) => obj[a] > obj[b] ? a : b);
}

function round(v, d) {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

/**
 * 提取记录的赔率隐含概率
 * 优先使用 r.odds 字段（已归一化的赔率隐含概率），
 * 其次尝试 r.dataSource === 'wc2026' 中的 overUnder 域（如果有赔率结构），
 * 如果都没有则返回 null。
 */
function extractOddsProb(record) {
  // 优先级1: 显式赔率概率字段
  if (record.odds?.homeWin != null && record.odds?.draw != null && record.odds?.awayWin != null) {
    return { homeWin: record.odds.homeWin, draw: record.odds.draw, awayWin: record.odds.awayWin };
  }
  // 优先级2: overUnder 域可能包含赔率（有些数据源在此存放）
  if (record.overUnder?.homeWin != null && record.overUnder?.draw != null && record.overUnder?.awayWin != null) {
    return { homeWin: record.overUnder.homeWin, draw: record.overUnder.draw, awayWin: record.overUnder.awayWin };
  }
  return null;
}

/**
 * 从现有预测引擎构建共识基线
 * 对每场比赛，将可用引擎的胜/平/负概率取平均
 */
function buildConsensusProb(record) {
  const preds = record.predictions;
  if (!preds) return null;

  const engines = ['elo', 'ml', 'ensemble'];
  const available = [];

  for (const eng of engines) {
    const p = preds[eng]?.prob;
    if (p?.homeWin != null && p?.draw != null && p?.awayWin != null) {
      available.push(p);
    }
  }

  if (available.length === 0) return null;

  // 平均所有可用引擎的概率
  const n = available.length;
  return {
    homeWin: available.reduce((s, p) => s + p.homeWin, 0) / n,
    draw: available.reduce((s, p) => s + p.draw, 0) / n,
    awayWin: available.reduce((s, p) => s + p.awayWin, 0) / n,
  };
}

/**
 * 计算赔率基线（Odds Baseline）
 *
 * 对每场比赛:
 *   1. 如果有赔率数据（r.odds），使用赔率隐含概率
 *   2. 否则使用3引擎共识基线（Elo/ML/Ensemble 的平均值）
 *
 * 然后计算:
 *   - accuracy: 预测最高概率的结果 = 实际结果
 *   - brier: (p_h - o_h)^2 + (p_d - o_d)^2 + (p_a - o_a)^2
 *   - logLoss: -ln(prob_of_actual_outcome)
 *
 * @param {Array} records - 比赛记录数组（含 predictions）
 * @returns {{ n: number, accuracy: number, brier: number, logLoss: number }}
 */
function computeOddsBaseline(records) {
  const valid = [];
  const eps = 1e-10;

  for (const r of records) {
    // 1. 获取概率（先赔率，后共识）
    let prob = extractOddsProb(r);
    if (!prob) {
      prob = buildConsensusProb(r);
    }
    if (!prob) continue;

    // 2. 归一化概率（确保和为1）
    const sum = prob.homeWin + prob.draw + prob.awayWin;
    if (sum <= 0) continue;
    const p = {
      homeWin: prob.homeWin / sum,
      draw: prob.draw / sum,
      awayWin: prob.awayWin / sum,
    };

    // 3. 实际结果
    const actualOutcome = normalizeOutcome(r.actualOutcome || r.outcome);
    if (!actualOutcome) continue;

    const o = {
      homeWin: actualOutcome === 'HOME' ? 1 : 0,
      draw: actualOutcome === 'DRAW' ? 1 : 0,
      awayWin: actualOutcome === 'AWAY' ? 1 : 0,
    };

    // 4. 预测结果
    const predictedKey = maxKeyObj(p);
    const predictedNorm = normalizeOutcome(predictedKey);
    const correct = predictedNorm === actualOutcome;

    // 5. Brier分数
    const brier = (p.homeWin - o.homeWin) ** 2 +
                  (p.draw - o.draw) ** 2 +
                  (p.awayWin - o.awayWin) ** 2;

    // 6. LogLoss
    const actualProb = o.homeWin ? p.homeWin : o.draw ? p.draw : p.awayWin;
    const logLoss = -Math.log(Math.max(eps, Math.min(1 - eps, actualProb)));

    valid.push({ correct, brier, logLoss });
  }

  const n = valid.length;
  if (n === 0) {
    return { n: 0, accuracy: 0, brier: 0, logLoss: 0 };
  }

  const correctCount = valid.filter(x => x.correct).length;

  return {
    n,
    accuracy: round(correctCount / n, 4),
    brier: round(valid.reduce((s, x) => s + x.brier, 0) / n, 4),
    logLoss: round(valid.reduce((s, x) => s + x.logLoss, 0) / n, 4),
  };
}

/**
 * 获取赔率基线显示标签
 * @returns {string} 中文标签 '赔率共识'
 */
function getOddsBaselineLabel() {
  return '赔率共识';
}

export { computeOddsBaseline, getOddsBaselineLabel };
