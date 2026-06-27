/**
 * 融合后概率校准
 * Phase 7.2 — 对融合输出做温和校准
 *
 * 使用 Platt-scaling 风格的简单逻辑校准
 * 避免融合后概率过度自信或不足
 */
import mlConfig from '../../config.js';

// 历史校准参数 (通过离线回测获得)
let calibrationParams = {
  alpha: 0.0,    // Platt α (intercept)
  beta: 1.0,     // Platt β (slope)
  enabled: false, // 默认关闭，直到有足够的评估数据
};

/**
 * 设置校准参数
 */
export function setCalibration(alpha, beta) {
  calibrationParams.alpha = alpha;
  calibrationParams.beta = beta;
  calibrationParams.enabled = true;
}

/**
 * Platt 校准变换
 */
function plattScale(probs) {
  const { alpha, beta } = calibrationParams;
  if (!calibrationParams.enabled) return probs;

  const raw = { ...probs };
  for (const k of ['homeWin', 'draw', 'awayWin']) {
    // logit → 线性变换 → sigmoid
    const p = Math.max(Math.min(raw[k], 1 - 1e-10), 1e-10);
    const logit = Math.log(p / (1 - p));
    const scaled = 1 / (1 + Math.exp(-(beta * logit + alpha)));
    raw[k] = Math.max(0, Math.min(1, scaled));
  }

  // 重新归一化
  const sum = (raw.homeWin || 0) + (raw.draw || 0) + (raw.awayWin || 0);
  if (sum <= 0) return probs;
  return {
    homeWin: Math.round((raw.homeWin / sum) * 10000) / 10000,
    draw: Math.round((raw.draw / sum) * 10000) / 10000,
    awayWin: Math.round((raw.awayWin / sum) * 10000) / 10000,
  };
}

/**
 * 温和校准（默认使用）
 * 将极端概率向均匀分布拉回
 */
export function gentleCalibrate(probs, confidence, strength = 0.05) {
  if (!probs) return probs;

  // 根据置信度调整校准强度
  const effectiveStrength = confidence != null && confidence < 0.5
    ? strength * (1 + (0.5 - confidence))
    : strength;

  const uniform = { homeWin: 1 / 3, draw: 1 / 3, awayWin: 1 / 3 };
  const result = {};
  for (const k of ['homeWin', 'draw', 'awayWin']) {
    result[k] = probs[k] * (1 - effectiveStrength) + uniform[k] * effectiveStrength;
  }

  const sum = (result.homeWin || 0) + (result.draw || 0) + (result.awayWin || 0);
  if (sum <= 0) return probs;

  return {
    homeWin: Math.round((result.homeWin / sum) * 10000) / 10000,
    draw: Math.round((result.draw / sum) * 10000) / 10000,
    awayWin: Math.round((result.awayWin / sum) * 10000) / 10000,
  };
}

export function calibrate(probs, confidence) {
  // 先 Pratt 再温和校准
  const platt = plattScale(probs);
  return gentleCalibrate(platt, confidence);
}

export default { setCalibration, calibrate, gentleCalibrate };
