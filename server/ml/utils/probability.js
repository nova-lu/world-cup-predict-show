/**
 * 概率协议统一工具
 * Phase 6.1 — 统一 1X2 概率输入/输出协议
 *
 * 统一协议: { homeWin: number (0~1), draw: number (0~1), awayWin: number (0~1) }
 * 约束: 非负, 和为 1, 精度 4 位
 */

/**
 * 标准化任意格式的概率输入为统一协议
 * 支持格式:
 *   - { homeWin, draw, awayWin } (0~1 小数)
 *   - { winHome, draw, winAway } (百分比数值如 62.3)
 *   - { winHome: "62.3", draw: "18.7", winAway: "19.2" } (百分比字符串)
 *   - ML 格式 { homeWin, draw, awayWin } (0~1)
 */
export function toProbabilities(input) {
  let home, draw, away;

  if (!input) {
    return { homeWin: 0.34, draw: 0.33, awayWin: 0.33 };
  }

  // 检测格式: 如果是 Elo 的 prob.winHome (百分比格式)
  if (input.winHome !== undefined) {
    home = parseFloat(input.winHome) / 100;
    draw = parseFloat(input.draw ?? input.draw) / 100;
    away = parseFloat(input.winAway) / 100;
  } else if (input.homeWin !== undefined) {
    // ML 格式: { homeWin, draw, awayWin }
    home = input.homeWin;
    draw = input.draw;
    away = input.awayWin;
  } else {
    return { homeWin: 0.34, draw: 0.33, awayWin: 0.33 };
  }

  // 约束: 非负
  home = Math.max(0, home ?? 0);
  draw = Math.max(0, draw ?? 0);
  away = Math.max(0, away ?? 0);

  // 约束: 和为 1
  const sum = home + draw + away;
  if (sum <= 0) return { homeWin: 0.34, draw: 0.33, awayWin: 0.33 };
  if (Math.abs(sum - 1) > 0.0001) {
    home /= sum;
    draw /= sum;
    away /= sum;
  }

  return {
    homeWin: Math.round(home * 10000) / 10000,
    draw: Math.round(draw * 10000) / 10000,
    awayWin: Math.round(away * 10000) / 10000,
  };
}

/**
 * 验证概率对象的合法性并返回校验信息
 */
export function validateProbabilities(probs) {
  const errors = [];
  if (!probs) errors.push('probs is null/undefined');
  if (probs.homeWin == null) errors.push('missing homeWin');
  if (probs.draw == null) errors.push('missing draw');
  if (probs.awayWin == null) errors.push('missing awayWin');
  if (probs.homeWin < 0 || probs.draw < 0 || probs.awayWin < 0) errors.push('negative probability');
  const sum = (probs.homeWin || 0) + (probs.draw || 0) + (probs.awayWin || 0);
  const sumError = Math.abs(sum - 1);
  if (sumError > 0.001) errors.push(`sum=${sum.toFixed(4)} != 1 (error=${sumError.toFixed(6)})`);

  return { valid: errors.length === 0, sumError, errors };
}

/**
 * 复制 ML 预测结果中的概率字段并标准化
 */
export function normalizePrediction(prediction, engine) {
  if (!prediction) return prediction;

  // 标准化概率到统一协议
  if (prediction.prob) {
    // Elo 格式 → 统一格式
    prediction.probabilities = toProbabilities(prediction.prob);
    // 保留向后兼容
  } else if (prediction.probabilities) {
    prediction.probabilities = toProbabilities(prediction.probabilities);
  }

  // 注入引擎标记
  prediction._engine = engine || 'unknown';

  return prediction;
}
