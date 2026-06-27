/**
 * 权重策略与历史可信度跟踪
 * Phase 7.2 — 根据历史 Brier Score 动态调整信源权重
 */
import mlConfig from '../../config.js';

// 信源历史 Brier Score 跟踪
const sourceBrierHistory = {
  oddsApi: [],
  polymarket: [],
  model: [],
};

// 默认权重 (当无历史数据时)
const DEFAULT_WEIGHTS = mlConfig.oddsFusion.sourceWeights;

/**
 * 记录一场比赛后的 Brier Score
 */
export function recordBrier(source, brier) {
  if (!sourceBrierHistory[source]) return;
  sourceBrierHistory[source].push(brier);
  // 保留最近 30 场
  if (sourceBrierHistory[source].length > 30) {
    sourceBrierHistory[source].shift();
  }
}

/**
 * 获取信源平均 Brier Score
 */
export function getAverageBrier(source) {
  const hist = sourceBrierHistory[source];
  if (!hist || hist.length === 0) return null;
  return hist.reduce((a, b) => a + b, 0) / hist.length;
}

/**
 * 基于历史 Brier Score 计算权重
 * 较好的 Brier → 较高权重
 */
export function computeSourceWeights(availableSources) {
  if (!availableSources || availableSources.length === 0) {
    return { oddsApi: 0.5, polymarket: 0.25, model: 0.25 };
  }

  const missing = ['oddsApi', 'polymarket', 'model'].filter(s => !availableSources.includes(s));
  const weights = {};

  // 有历史数据的源: 权重 = 1 / (avgBrier + epsilon)
  let total = 0;
  for (const source of availableSources) {
    const avgBrier = getAverageBrier(source);
    if (avgBrier != null) {
      weights[source] = 1 / (avgBrier + 0.01);
    } else {
      weights[source] = DEFAULT_WEIGHTS[source] || 0.33;
    }
    total += weights[source];
  }

  // 归一化
  for (const source of availableSources) {
    weights[source] /= total;
  }

  // 缺失的源权重为 0
  for (const source of missing) {
    weights[source] = 0;
  }

  return weights;
}

/**
 * 计算 Jensen-Shannon Divergence (JSD)
 * 衡量两个概率分布之间的分歧
 */
export function jsDivergence(p, q) {
  const eps = 1e-15;
  const m = {
    homeWin: (p.homeWin + q.homeWin) / 2,
    draw: (p.draw + q.draw) / 2,
    awayWin: (p.awayWin + q.awayWin) / 2,
  };

  function kl(a, b) {
    let s = 0;
    for (const k of ['homeWin', 'draw', 'awayWin']) {
      const va = Math.max(a[k], eps);
      const vb = Math.max(b[k], eps);
      s += va * Math.log(va / vb);
    }
    return s;
  }

  return 0.5 * kl(p, m) + 0.5 * kl(q, m);
}

/**
 * 获取源列表
 */
export function getAvailableSources() {
  return Object.keys(sourceBrierHistory).filter(s => s);
}

export default { recordBrier, getAverageBrier, computeSourceWeights, jsDivergence };
