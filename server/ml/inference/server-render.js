/**
 * Phase 13 — 服务端渲染工具函数
 *
 * 为 match.ejs 结论 Tab 提供服务端预渲染数据。
 * 仅使用 Elo 引擎（最快、无外部依赖）。
 */

import { getScoreDistribution } from '../../services/predictionService.js';
import { computePoissonMatrix, computeTopScores, filterScoresByDirection } from './poisson.js';

/**
 * 从 Elo prediction 计算 Top N 比分（带方向门控）
 * @param {object} eloPred — predictMatch() 的返回值
 * @param {number} [n=3] — 返回的比分数量
 * @returns {Array<{home:number, away:number, prob:number}>}
 */
export function getServerTopScores(eloPred, n = 3) {
  if (!eloPred || !eloPred.expectedGoals) return [];

  const lambdaH = eloPred.expectedGoals.home;
  const lambdaA = eloPred.expectedGoals.away;

  const matrix = computePoissonMatrix(lambdaH, lambdaA);
  const rawTop = computeTopScores(matrix, 5);

  // 确定主方向
  const p = eloPred.prob || eloPred.probabilities || {};
  const winHome = p.winHome != null ? p.winHome : (p.homeWin != null ? p.homeWin * 100 : 50);
  const draw = p.draw != null ? p.draw : (p.drawWin != null ? p.drawWin * 100 : 25);
  const winAway = p.winAway != null ? p.winAway : (p.awayWin != null ? p.awayWin * 100 : 25);

  let mainDirection = 'away';
  if (winHome >= draw && winHome >= winAway) mainDirection = 'home';
  else if (draw >= winHome && draw >= winAway) mainDirection = 'draw';

  return filterScoresByDirection(rawTop, mainDirection, n);
}

/**
 * 简化版风险等级（纯 Elo 引擎）
 * @param {object} eloPred — predictMatch() 的返回值
 * @returns {string} 'low' | 'medium' | 'high'
 */
export function computeServerRisk(eloPred) {
  if (!eloPred) return 'medium';
  const p = eloPred.prob || eloPred.probabilities || {};
  const maxProb = Math.max(
    p.winHome != null ? p.winHome / 100 : (p.homeWin || 0),
    p.draw != null ? p.draw / 100 : (p.drawWin || 0),
    p.winAway != null ? p.winAway / 100 : (p.awayWin || 0),
  );
  if (maxProb >= 0.55) return 'low';
  if (maxProb >= 0.35) return 'medium';
  return 'high';
}
