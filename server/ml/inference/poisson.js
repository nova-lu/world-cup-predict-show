/**
 * 泊松比分矩阵计算
 * 将预期进球 λ_home, λ_away 转化为 9×9 比分概率矩阵
 */
export function computePoissonMatrix(lambdaHome, lambdaAway, maxGoals = 8) {
  const matrix = [];
  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      matrix[h][a] = poissonPMF(h, lambdaHome) * poissonPMF(a, lambdaAway);
    }
  }
  return matrix;
}

/**
 * 泊松概率质量函数 P(X=k) = e^(-λ) * λ^k / k!
 */
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // 用对数方式计算避免溢出
  const logP = -lambda + k * Math.log(lambda) - logFactorial(k);
  return Math.exp(logP);
}

// 预计算阶乘的对数
const logFactorialCache = [0];
function logFactorial(n) {
  for (let i = logFactorialCache.length; i <= n; i++) {
    logFactorialCache[i] = logFactorialCache[i - 1] + Math.log(i);
  }
  return logFactorialCache[n];
}

/**
 * 从比分矩阵计算 1X2 概率
 */
export function computeProbabilities(matrix) {
  let homeWin = 0, draw = 0, awayWin = 0;
  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h].length; a++) {
      const p = matrix[h][a];
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
    }
  }
  const total = homeWin + draw + awayWin;
  return {
    homeWin: total > 0 ? homeWin / total : 0.333,
    draw: total > 0 ? draw / total : 0.334,
    awayWin: total > 0 ? awayWin / total : 0.333,
  };
}

/**
 * 从比分矩阵计算 TOP N 最可能比分
 */
export function computeTopScores(matrix, n = 5) {
  const scores = [];
  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h].length; a++) {
      scores.push({ home: h, away: a, probability: matrix[h][a] });
    }
  }
  scores.sort((a, b) => b.probability - a.probability);
  return scores.slice(0, n);
}

/**
 * 大小球概率
 */
export function computeOverUnder(matrix) {
  const total = matrix.reduce((sum, row) => sum + row.reduce((s, p) => s + p, 0), 0);
  if (total === 0) return { over2_5: 0.5, under2_5: 0.5, over3_5: 0.25, under3_5: 0.75, expectedTotal: 2.5 };

  let over25 = 0, over35 = 0, expectedTotal = 0;
  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h].length; a++) {
      const p = matrix[h][a];
      const sum = h + a;
      if (sum > 2.5) over25 += p;
      if (sum > 3.5) over35 += p;
      expectedTotal += sum * p;
    }
  }

  return {
    over2_5: over25 / total,
    under2_5: 1 - over25 / total,
    over3_5: over35 / total,
    under3_5: 1 - over35 / total,
    expectedTotal: Math.round(expectedTotal * 100) / 100,
  };
}

/**
 * BTTS 概率
 */
export function computeBTTS(matrix) {
  let yes = 0, no = 0;
  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h].length; a++) {
      const p = matrix[h][a];
      if (h > 0 && a > 0) yes += p;
      else no += p;
    }
  }
  const total = yes + no;
  return {
    yes: total > 0 ? yes / total : 0.5,
    no: total > 0 ? no / total : 0.5,
  };
}

/**
 * 风险评估
 */
export function computeRisk(probabilities, classifierConfidence = 0.5) {
  // 根据最大概率和模型置信度计算风险评分
  const maxProb = Math.max(probabilities.homeWin, probabilities.draw, probabilities.awayWin);
  const margin = maxProb - (1 - maxProb) / 2; // 与均匀分布的距离
  const score = Math.min(1, Math.max(0, (margin * 0.6 + classifierConfidence * 0.4)));

  let level, description;
  if (score >= 0.55) {
    level = 'low';
    description = '预测置信度较高，建议关注';
  } else if (score >= 0.35) {
    level = 'medium';
    description = '存在不确定性，建议结合更多信息判断';
  } else {
    level = 'high';
    description = '预测波动较大，谨慎参考';
  }

  return { level, score: Math.round(score * 100) / 100, description };
}

/**
 * 方向门控过滤 Top N 比分
 *
 * 确保 TopN 推荐比分与主方向一致：
 * - home: 保留 home > away 的比分
 * - draw: 保留 home === away 的比分
 * - away: 保留 home < away 的比分
 *
 * @param {Array} topScores - [{ home, away, probability }]
 * @param {string} mainDirection - 'home' | 'draw' | 'away'
 * @param {number} n - 需要返回的条数（默认 3）
 * @returns {Array} 方向一致的最多 n 条 + 补齐的近邻
 */
export function filterScoresByDirection(topScores, mainDirection, n = 3) {
  if (!topScores || topScores.length === 0) return [];

  // 按方向筛选
  function passes(s) {
    if (mainDirection === 'home') return s.home > s.away;
    if (mainDirection === 'draw') return s.home === s.away;
    if (mainDirection === 'away') return s.home < s.away;
    return true;
  }

  const matched = topScores.filter(passes);
  if (matched.length >= n) return matched.slice(0, n);

  // 不足 n 条，从剩余比分中按"偏差最小"补齐
  // home 方向: |(home-away)| 最小且 home > away
  // draw 方向: |(home-away)| 最小且 home === away 已全取，从"总进球数与最可能平局比分最接近"补齐
  // away 方向: |(home-away)| 最小且 home < away
  const unmatched = topScores.filter(s => !passes(s));
  if (unmatched.length === 0) return matched.slice(0, n);

  // 计算偏差分数（越小越接近主方向）
  const scored = unmatched.map(s => {
    let dist;
    if (mainDirection === 'home') {
      // 希望 home > away，偏差 = away - home（正数时偏离方向）
      dist = Math.max(0, s.away - s.home);
    } else if (mainDirection === 'away') {
      dist = Math.max(0, s.home - s.away);
    } else {
      // draw: 偏差 = |home - away|（平局时接近 0）
      dist = Math.abs(s.home - s.away);
    }
    return { ...s, _dist: dist };
  });

  scored.sort((a, b) => a._dist - b._dist);
  const fillers = scored.slice(0, n - matched.length);
  const result = [...matched, ...fillers];

  // 保持 probability 降序
  result.sort((a, b) => b.probability - a.probability);
  return result.slice(0, n);
}

/**
 * 覆盖度
 */
export function computeCoverage(matrix, topN = 3) {
  const topScores = computeTopScores(matrix, topN);
  const topScoreCoverage = topScores.reduce((sum, s) => sum + s.probability, 0);

  const probs = computeProbabilities(matrix);
  const predProbCoverage = Math.max(probs.homeWin, probs.draw, probs.awayWin);

  return {
    percent: Math.round(predProbCoverage * 10000) / 100,
    top3ScoreCoverage: Math.round(topScoreCoverage * 10000) / 100,
    topN,
  };
}
