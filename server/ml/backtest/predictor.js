/**
 * 回测预测生成器
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let eloModel, mlPredictor, eloRatings, rankingModule, mlConfig;

async function ensureDeps() {
  if (!eloModel) eloModel = await import(pathToFileURL(path.resolve(__dirname, '../../services/elo-model.mjs')).href);
  if (!rankingModule) rankingModule = await import(pathToFileURL(path.resolve(__dirname, '../data/rankings.js')).href);
  if (!mlConfig) { const mod = await import(pathToFileURL(path.resolve(__dirname, '../config.js')).href); mlConfig = mod.default; }
  if (!eloRatings) eloRatings = rankingModule.loadEloRatings();
  if (!mlPredictor) {
    try { mlPredictor = await import(pathToFileURL(path.resolve(__dirname, '../inference/predictor.js')).href); }
    catch (e) { console.warn('[backtest/predictor] ML:', e.message); }
  }
}

function isGroupStage(stage) {
  if (!stage) return false;
  const s = String(stage);
  return s.startsWith('Group') || s === 'GROUP_STAGE';
}

export async function predictOne(match, opts = {}) {
  await ensureDeps();
  const mlEnabled = opts.mlEnabled !== false && !!mlPredictor;
  const homeElo = getEloForTeam(match.homeTeam);
  const awayElo = getEloForTeam(match.awayTeam);
  const predictions = {};

  // Elo: 小组赛有主场优势，淘汰赛/中立场 neutral
  const isNeutral = match.neutral === true || !isGroupStage(match.stage);
  const homeBonus = isNeutral ? 0 : 0.18;
  try {
    const r = eloModel.matchProb(homeElo, awayElo, homeBonus);
    predictions.elo = { prob: { homeWin: r.winA || 0, draw: r.draw || 0, awayWin: r.winB || 0 }, xg: { home: r.expectedGoalsA || 0, away: r.expectedGoalsB || 0 } };
  } catch (e) { predictions.elo = null; }

  // ML
  if (mlEnabled) {
    try {
      const ctx = { isHome: true, isHost: false, isKnockout: !isGroupStage(match.stage), tournamentWeight: match.year === 2026 ? 1.0 : 0.9 };
      const r = await mlPredictor.predictMatch(match.homeTeam, match.awayTeam, match.date, { context: ctx });
      predictions.ml = { prob: { homeWin: r.probabilities?.homeWin || 0, draw: r.probabilities?.draw || 0, awayWin: r.probabilities?.awayWin || 0 }, xg: { home: r.expectedGoals?.home || 0, away: r.expectedGoals?.away || 0 }, confidence: r.metadata?.confidence || 0 };
    } catch (e) { predictions.ml = null; }
  }

  // Ensemble
  if (predictions.elo && predictions.ml) {
    try {
      const e = mlPredictor.ensemblePrediction({ probabilities: predictions.elo.prob, expectedGoals: predictions.elo.xg }, { probabilities: predictions.ml.prob, expectedGoals: predictions.ml.xg });
      predictions.ensemble = { prob: { homeWin: e.probabilities?.homeWin || 0, draw: e.probabilities?.draw || 0, awayWin: e.probabilities?.awayWin || 0 }, xg: { home: e.expectedGoals?.home || 0, away: e.expectedGoals?.away || 0 }, weights: e.metadata?.ensembleWeights || { elo: 0.3, ml: 0.7 } };
    } catch (e) { predictions.ensemble = null; }
  }

  return { ...match, eloRating: { home: homeElo, away: awayElo }, predictions };
}

export async function predictBatch(matches, opts = {}) {
  const results = [];
  for (let i = 0; i < matches.length; i++) {
    // 检查取消标志
    try {
      const { isCancelled } = await import('./engine.js');
      if (isCancelled()) throw new Error('CANCELLED');
    } catch (e) {
      if (e.message === 'CANCELLED') throw new Error('回测已被用户取消');
    }
    results.push(await predictOne(matches[i], opts));
    if ((i + 1) % 20 === 0) console.log(`[backtest/predictor] ${i + 1}/${matches.length}`);
  }
  return results;
}

function getEloForTeam(slug) {
  if (!eloRatings) return 1500;
  if (eloRatings[slug]) return eloRatings[slug].rating || eloRatings[slug] || 1500;
  for (const [key, val] of Object.entries(eloRatings)) {
    if (key.toLowerCase().replace(/[^a-z0-9]/g, '-') === slug) return val.rating || val || 1500;
  }
  return 1500;
}
