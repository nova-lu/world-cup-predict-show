// 预测服务 —— 将模型 (elo-model.mjs) 包装为 HTTP 可调用的服务
import { matchProb, poissonPmf, dcTau, getDcRho } from './elo-model.mjs';
import { getRatings, getTeamInfo } from './dataService.js';
import { get, set } from '../middleware/cache.js';

const HOME_BONUS = 75;

function getRating(slug) {
  const ratings = getRatings();
  return ratings[slug] ?? 1500;
}

function computeHomeBonus(homeSlug, awaySlug, homeOverride) {
  if (homeOverride === homeSlug) return HOME_BONUS;
  if (homeOverride === awaySlug) return -HOME_BONUS;
  const hosts = new Set(['mexico', 'usa', 'canada']);
  if (hosts.has(homeSlug)) return HOME_BONUS / 2;
  return 0;
}

// 单场比赛完整预测
export function predictMatch(homeSlug, awaySlug, homeOverride = null) {
  const cacheKey = `pred:${homeSlug}:${awaySlug}:${homeOverride || ''}`;
  const cached = get(cacheKey);
  if (cached) return cached;

  const rHome = getRating(homeSlug);
  const rAway = getRating(awaySlug);
  const hb = computeHomeBonus(homeSlug, awaySlug, homeOverride);
  const result = matchProb(rHome, rAway, hb);

  const prediction = {
    home: { slug: homeSlug, ...getTeamInfo(homeSlug), elo: rHome },
    away: { slug: awaySlug, ...getTeamInfo(awaySlug), elo: rAway },
    homeBonus: hb,
    prob: {
      winHome: +(result.winA * 100).toFixed(1),
      draw: +(result.draw * 100).toFixed(1),
      winAway: +(result.winB * 100).toFixed(1),
    },
    expectedGoals: {
      home: +result.expectedGoalsA.toFixed(2),
      away: +result.expectedGoalsB.toFixed(2),
    },
  };

  set(cacheKey, prediction, 60_000);
  return prediction;
}

// 批量预测未开赛比赛
export function predictUpcoming(matches) {
  return matches
    .filter(m => !m.g1 && !m.g2 && m.status !== 'FT')
    .map(m => ({
      match: m,
      prediction: predictMatch(m.t1, m.t2),
    }));
}

// 两队对比
export function compareTeams(slugA, slugB) {
  const rA = getRating(slugA);
  const rB = getRating(slugB);
  return {
    teamA: { ...getTeamInfo(slugA), elo: rA },
    teamB: { ...getTeamInfo(slugB), elo: rB },
    eloDiff: rA - rB,
    neutral: matchProb(rA, rB, 0),
    homeA: matchProb(rA, rB, HOME_BONUS),
    homeB: matchProb(rB, rA, HOME_BONUS),
  };
}

// Top N 最可能比分分布
export function getScoreDistribution(homeSlug, awaySlug, homeOverride = null, topN = 10) {
  const cacheKey = `scores:${homeSlug}:${awaySlug}:${homeOverride || ''}:${topN}`;
  const cached = get(cacheKey);
  if (cached) return cached;

  const rHome = getRating(homeSlug);
  const rAway = getRating(awaySlug);
  const hb = computeHomeBonus(homeSlug, awaySlug, homeOverride);
  const { expectedGoalsA: lambda, expectedGoalsB: mu } = matchProb(rHome, rAway, hb);

  const scores = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = 0; b <= 6; b++) {
      const pA = poissonPmf(a, lambda);
      const pB = poissonPmf(b, mu);
      const tau = dcTau(a, b, lambda, mu, getDcRho());
      const prob = pA * pB * tau;
      if (prob > 0.002) {
        scores.push({ home: a, away: b, prob: +(prob * 100).toFixed(2) });
      }
    }
  }
  scores.sort((a, b) => b.prob - a.prob);

  const result = scores.slice(0, topN);
  set(cacheKey, result, 60_000);
  return result;
}
