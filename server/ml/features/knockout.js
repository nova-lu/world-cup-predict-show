/**
 * 淘汰赛压力因子特征
 * Phase 8.1 — 淘汰赛特有的压力调整参数
 */

// 各轮次压力系数（R32=基线 1.0，决赛=1.35）
export const STAGE_PRESSURE = {
  round32: 1.0,
  round16: 1.05,
  quarter: 1.15,
  semi: 1.25,
  final: 1.35,
};

// 加时赛攻防调整
// 加时赛球队更保守，进攻效率下降，防守提升
export const ET_BONUS = {
  attack: 0.85,   // 进攻预期进球 ×0.85
  defense: 1.10,  // 防守强度 ×1.10
};

// 点球大战历史基准
// 无明显主客场优势，近似 50/50
export const PENALTY = {
  baseRate: 0.5,
  // 基于 Elo 评分的点球优势（轻微倾向）
  eloWeight: 0.05,
};

// 淘汰赛常规时间平局率（历史统计 ~25-30%）
export const KNOCKOUT_DRAW_RATE = {
  round32: 0.22,
  round16: 0.24,
  quarter: 0.28,
  semi: 0.30,
  final: 0.32,
};

// K-因子调整（淘汰赛权重更高）
export const KNOCKOUT_K_FACTOR = {
  round32: 25,
  round16: 30,
  quarter: 35,
  semi: 35,
  final: 40,
};

/**
 * 根据轮次获取压力调整后的 Elo
 * 高压力下强队发挥可能打折，弱队可能超常
 */
export function applyPressure(ratingA, ratingB, stage) {
  const pressure = STAGE_PRESSURE[stage] || 1.0;
  // 压力系数 > 1 时，缩小强弱差距（弱队受益于压力）
  const diff = ratingA - ratingB;
  const adjustedDiff = diff / pressure;
  return {
    ratingA: (ratingA + ratingB) / 2 + adjustedDiff / 2,
    ratingB: (ratingB + ratingA) / 2 - adjustedDiff / 2,
    pressure,
  };
}

/**
 * 获取淘汰赛专用 K-因子
 */
export function getKnockoutKFactor(stage) {
  return KNOCKOUT_K_FACTOR[stage] || 20;
}

export default {
  STAGE_PRESSURE,
  ET_BONUS,
  PENALTY,
  KNOCKOUT_DRAW_RATE,
  KNOCKOUT_K_FACTOR,
  applyPressure,
  getKnockoutKFactor,
};
