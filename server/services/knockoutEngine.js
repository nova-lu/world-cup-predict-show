/**
 * 淘汰赛预测引擎
 * Phase 8.1 — 加时赛 / 点球大战模拟
 * 
 * 淘汰赛不同于小组赛：
 * - 没有平局，90 分钟打平→加时→点球
 * - 加时赛球队更保守，进球率下降
 * - 点球大战约 50/50，略偏向 Elo 较高的球队
 */

import { expectedGoals, poissonSample, expectedScore, sampleMatch, matchProb as eloMatchProb } from './elo-model.mjs';
import { applyPressure, ET_BONUS, PENALTY, STAGE_PRESSURE, KNOCKOUT_DRAW_RATE } from '../ml/features/knockout.js';

/**
 * 模拟一场淘汰赛（含加时/点球）
 * 
 * @param {number} ratingA - 球队 A Elo 评分
 * @param {number} ratingB - 球队 B Elo 评分
 * @param {number} homeBonusA - 球队 A 主场加成
 * @param {string} stage - 轮次 (round32 / round16 / quarter / semi / final)
 * @param {function} rng - 随机数生成器
 * @returns {{ winner, loser, g1, g2, etGoals1, etGoals2, pkWinner, phase: 'regular'|'extra_time'|'penalty' }}
 */
export function simulateKnockoutMatch(ratingA, ratingB, homeBonusA = 0, stage = 'round32', rng = Math.random) {
  // 1. 应用压力因子调整
  const adjusted = applyPressure(ratingA, ratingB, stage);
  const adjA = adjusted.ratingA;
  const adjB = adjusted.ratingB;

  // 2. 常规时间抽样
  const eA = expectedGoals(adjA, adjB, homeBonusA);
  const eB = expectedGoals(adjB, adjA, -homeBonusA / 2);
  let g1 = poissonSample(eA, rng);
  let g2 = poissonSample(eB, rng);

  let phase = 'regular';
  let etGoals1 = 0, etGoals2 = 0;
  let pkWinner = null;

  // 3. 如果平局 → 加时赛
  if (g1 === g2) {
    phase = 'extra_time';
    // 加时赛：进攻压缩 85%，防守提升 110%
    const etEA = eA * ET_BONUS.attack * (1 / ET_BONUS.defense);
    const etEB = eB * ET_BONUS.attack * (1 / ET_BONUS.defense);
    etGoals1 = poissonSample(etEA, rng);
    etGoals2 = poissonSample(etEB, rng);
    g1 += etGoals1;
    g2 += etGoals2;

    // 4. 如果加时仍平局 → 点球大战
    if (etGoals1 === etGoals2) {
      phase = 'penalty';
      // 点球：~50/50，轻微倾向 Elo 高的球队
      const pkProb = 0.5 + (adjA - adjB) / 4000 * PENALTY.eloWeight;
      pkWinner = rng() < pkProb ? 'A' : 'B';
      if (pkWinner === 'A') g1 += 1; else g2 += 1;
    }
  }

  const winner = g1 > g2 ? 'A' : 'B';

  return {
    winner: winner === 'A' ? 'A' : 'B',
    loser: winner === 'A' ? 'B' : 'A',
    g1, g2,
    etGoals1, etGoals2,
    pkWinner,
    phase,
    // 原始用于概率计算的中间值
    regGoals1: g1 - (phase === 'regular' ? 0 : (phase === 'extra_time' ? etGoals1 : 0)),
    regGoals2: g2 - (phase === 'regular' ? 0 : (phase === 'extra_time' ? etGoals2 : 0)),
  };
}

/**
 * 计算淘汰赛概率分布（不含抽样）
 * 返回: { winA, winB, etWinA, etWinB, pkWinA, pkWinB, regWinA, regWinB, draw }
 * 其中 winA = regWinA + etWinA + pkWinA
 */
export function knockoutMatchProb(ratingA, ratingB, homeBonusA = 0, stage = 'round32') {
  const adjusted = applyPressure(ratingA, ratingB, stage);
  const adjA = adjusted.ratingA;
  const adjB = adjusted.ratingB;

  const eA = expectedGoals(adjA, adjB, homeBonusA);
  const eB = expectedGoals(adjB, adjA, -homeBonusA / 2);

  // Poisson 累积求和（0-8球）
  const MAX_GOALS = 8;
  const pA = []; // P(teamA scores k goals)
  const pB = []; // P(teamB scores k goals)
  for (let k = 0; k <= MAX_GOALS; k++) {
    pA.push(poissonPmfSimple(k, eA));
    pB.push(poissonPmfSimple(k, eB));
  }

  let regWinA = 0, regWinB = 0, draw = 0;
  for (let a = 0; a <= MAX_GOALS; a++) {
    for (let b = 0; b <= MAX_GOALS; b++) {
      const p = pA[a] * pB[b];
      if (a > b) regWinA += p;
      else if (a < b) regWinB += p;
      else draw += p;
    }
  }

  // 加时概率：draw * (Poisson 抽样模拟)
  // 加时赛进球率压缩
  const etEA = eA * ET_BONUS.attack * (1 / ET_BONUS.defense);
  const etEB = eB * ET_BONUS.attack * (1 / ET_BONUS.defense);

  // 用 Monte Carlo 近似加时结果（解析计算太复杂）
  const SAMPLES = 5000;
  let etWinA = 0, etWinB = 0, etDraw = 0;
  const localRng = createSeededRng(42);
  for (let i = 0; i < SAMPLES; i++) {
    const a = poissonSample(etEA, localRng);
    const b = poissonSample(etEB, localRng);
    if (a > b) etWinA++;
    else if (a < b) etWinB++;
    else etDraw++;
  }
  etWinA = (draw * etWinA) / SAMPLES;
  etWinB = (draw * etWinB) / SAMPLES;
  const etPend = (draw * etDraw) / SAMPLES; // 需要点球的比例

  // 点球：~50/50 + Elo 微调
  const pkProbA = 0.5 + (adjA - adjB) / 4000 * PENALTY.eloWeight;
  const pkWinA = etPend * pkProbA;
  const pkWinB = etPend * (1 - pkProbA);

  const totalWinA = regWinA + etWinA + pkWinA;
  const totalWinB = regWinB + etWinB + pkWinB;

  return {
    // 总概率
    winA: totalWinA,
    winB: totalWinB,
    // 常规时间
    regWinA, regWinB,
    regDraw: draw,
    // 加时
    etWinA, etWinB,
    etDraw: draw * etDraw / SAMPLES,
    // 点球
    pkWinA, pkWinB,
    // 预期进球
    expectedGoalsA: eA, expectedGoalsB: eB,
    // 压力系数
    pressure: adjusted.pressure,
    // 阶段
    stage,
  };
}

function poissonPmfSimple(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function createSeededRng(seed) {
  let s = seed;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export default { simulateKnockoutMatch, knockoutMatchProb };
