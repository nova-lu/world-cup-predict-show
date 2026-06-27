/**
 * 赔率融合引擎核心
 * Phase 7.2 — 三源概率融合引擎
 *
 * 融合策略（可配置切换）:
 *   A: log-odds-weighted — 对数赔率加权平均（默认）
 *   B: bayesian — 贝叶斯融合（ML 先验 × 市场似然）
 *
 * 输出:
 *   - fused: 融合后概率
 *   - divergence: 三源分歧指标 (JSD)
 *   - weights: 实际使用的权重
 *   - confidence: 融合置信度
 */
import mlConfig from '../../config.js';
import { computeSourceWeights, jsDivergence, recordBrier } from './weights.js';
import { calibrate } from './calibrator.js';

/**
 * 融合多个信源的概率
 *
 * @param {Array} sources - [{source, probabilities:{homeWin,draw,awayWin}, metadata}]
 * @param {Object} modelSource - 模型概率源 {probabilities, metadata}
 * @returns {Object} {fused, divergence, weights, confidence, strategy, nSources}
 */
export function fuse(sources, modelSource) {
  if (modelSource) sources.push(modelSource);

  // 过滤无效源
  const valid = sources.filter(s => s && s.probabilities);
  const nSources = valid.length;

  // 不足最小信源数 → 返回第一个有效源或均匀分布
  if (nSources < mlConfig.oddsFusion.minSources) {
    const fallback = valid[0]?.probabilities || { homeWin: 1 / 3, draw: 1 / 3, awayWin: 1 / 3 };
    return {
      fused: fallback,
      divergence: null,
      weights: {},
      confidence: 0.33,
      strategy: 'fallback-uniform',
      nSources,
    };
  }

  // 单源直接返回
  if (nSources === 1) {
    return {
      fused: valid[0].probabilities,
      divergence: null,
      weights: { [valid[0].source]: 1.0 },
      confidence: 0.5,
      strategy: 'single-source',
      nSources,
    };
  }

  // 三源 JSD 分歧计算
  const divergence = {};
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const key = valid[i].source + ':' + valid[j].source;
      divergence[key] = jsDivergence(valid[i].probabilities, valid[j].probabilities);
    }
  }

  // 判断分歧级别
  const maxDiv = Math.max(...Object.values(divergence), 0);
  let divergenceLevel = 'low';
  if (maxDiv >= 0.15) divergenceLevel = 'high';
  else if (maxDiv >= 0.05) divergenceLevel = 'medium';

  // 计算权重
  const availableSources = valid.map(s => s.source);
  const weights = computeSourceWeights(availableSources);

  // 选择融合策略
  const strategy = mlConfig.oddsFusion.strategy;
  let fused;

  if (strategy === 'bayesian') {
    fused = bayesianFusion(valid, weights);
  } else {
    fused = logOddsWeightedAverage(valid, weights);
  }

  // 置信度评估
  const confidence = computeFusionConfidence(nSources, divergence, weights);

  // 校准
  const calibrated = calibrate(fused, confidence);

  return {
    fused: calibrated,
    divergence: {
      pairwise: divergence,
      maxDivergence: Math.round(maxDiv * 10000) / 10000,
      level: divergenceLevel,
    },
    weights,
    confidence: Math.round(confidence * 10000) / 10000,
    strategy,
    nSources,
  };
}

/**
 * 策略 A: 对数赔率加权平均
 * 在 log-odds 空间加权平均后再映射回概率
 */
function logOddsWeightedAverage(sources, weights) {
  const eps = 1e-10;
  const logOdds = { homeWin: 0, draw: 0, awayWin: 0 };
  let totalWeight = 0;

  for (const s of sources) {
    const w = weights[s.source] || 0;
    if (w <= 0) continue;
    totalWeight += w;
    for (const k of ['homeWin', 'draw', 'awayWin']) {
      const p = Math.max(Math.min(s.probabilities[k], 1 - eps), eps);
      logOdds[k] += w * Math.log(p / (1 - p));
    }
  }

  if (totalWeight <= 0) {
    return sources[0].probabilities;
  }

  // 转回概率
  const result = {};
  for (const k of ['homeWin', 'draw', 'awayWin']) {
    const lo = logOdds[k] / totalWeight;
    result[k] = 1 / (1 + Math.exp(-lo));
  }

  // 归一化
  const sum = (result.homeWin || 0) + (result.draw || 0) + (result.awayWin || 0);
  if (sum <= 0) return sources[0].probabilities;

  return {
    homeWin: Math.round((result.homeWin / sum) * 10000) / 10000,
    draw: Math.round((result.draw / sum) * 10000) / 10000,
    awayWin: Math.round((result.awayWin / sum) * 10000) / 10000,
  };
}

/**
 * 策略 B: 贝叶斯融合
 * ML 模型概率作为先验，市场概率作为似然
 */
function bayesianFusion(sources, weights) {
  // 找到模型源 (先验) 和市场源 (似然)
  const model = sources.find(s => s.source === 'model');
  const marketSources = sources.filter(s => s.source !== 'model');

  if (!model || marketSources.length === 0) {
    return logOddsWeightedAverage(sources, weights);
  }

  const prior = model.probabilities;

  // 市场平均作为似然
  const marketAvg = { homeWin: 0, draw: 0, awayWin: 0 };
  let mktWeight = 0;
  for (const ms of marketSources) {
    const w = weights[ms.source] || 0;
    mktWeight += w;
    marketAvg.homeWin += w * ms.probabilities.homeWin;
    marketAvg.draw += w * ms.probabilities.draw;
    marketAvg.awayWin += w * ms.probabilities.awayWin;
  }

  if (mktWeight <= 0) return logOddsWeightedAverage(sources, weights);

  marketAvg.homeWin /= mktWeight;
  marketAvg.draw /= mktWeight;
  marketAvg.awayWin /= mktWeight;

  // Beta 近似后验
  const priorStrength = 10;
  const likelihoodStrength = 5;

  const result = {};
  for (const k of ['homeWin', 'draw', 'awayWin']) {
    const alpha = prior[k] * priorStrength + marketAvg[k] * likelihoodStrength;
    const beta = priorStrength + likelihoodStrength;
    result[k] = alpha / beta;
  }

  const sum = (result.homeWin || 0) + (result.draw || 0) + (result.awayWin || 0);
  if (sum <= 0) return logOddsWeightedAverage(sources, weights);

  return {
    homeWin: Math.round((result.homeWin / sum) * 10000) / 10000,
    draw: Math.round((result.draw / sum) * 10000) / 10000,
    awayWin: Math.round((result.awayWin / sum) * 10000) / 10000,
  };
}

/**
 * 计算融合置信度
 */
function computeFusionConfidence(nSources, divergence, weights) {
  // 信源数量: 3 源满分
  const sourceScore = Math.min(nSources / 3, 1);

  // 分歧: 分歧低则置信高
  const maxDiv = Math.max(...Object.values(divergence), 0);
  const divScore = Math.max(0, 1 - maxDiv * 3);

  // 权重均匀度: 权重越均匀置信越高
  const w = Object.values(weights).filter(v => v > 0);
  const wSum = w.reduce((a, b) => a + b, 0);
  const entropy = wSum > 0
    ? -w.reduce((a, b) => a + (b / wSum) * Math.log(b / wSum), 0) / Math.log(w.length || 1)
    : 0;

  return 0.4 * sourceScore + 0.4 * divScore + 0.2 * entropy;
}

export default { fuse };
