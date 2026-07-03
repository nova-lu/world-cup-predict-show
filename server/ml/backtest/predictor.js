/**
 * 回测预测生成器
 *
 * Phase 17 T1: 使用 Elo 时间点快照替代当前 Elo 评分
 * getEloForTeamAtDate(slug, date) 从 eloSnapshot.js 读取
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { getEloForTeamAtDate, getSnapshotInfo } from './eloSnapshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let eloModel, mlPredictor, mlConfig;

async function ensureDeps() {
  if (!eloModel) eloModel = await import(pathToFileURL(path.resolve(__dirname, '../../services/elo-model.mjs')).href);
  if (!mlConfig) { const mod = await import(pathToFileURL(path.resolve(__dirname, '../config.js')).href); mlConfig = mod.default; }
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
  const homeElo = getEloForTeamAtDate(match.homeTeam, match.date);
  const awayElo = getEloForTeamAtDate(match.awayTeam, match.date);
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
      predictions.ml = {
        prob: { homeWin: r.probabilities?.homeWin || 0, draw: r.probabilities?.draw || 0, awayWin: r.probabilities?.awayWin || 0 },
        xg: { home: r.expectedGoals?.home || 0, away: r.expectedGoals?.away || 0 },
        confidence: r.metadata?.confidence || 0,
        overUnder: r.overUnder || { over2_5: 0.5, under2_5: 0.5 },
        btts: r.btts || { yes: 0.5, no: 0.5 },
        topScores: r.topScores || [],
        risk: r.risk || {},
        coverage: r.coverage || {},
      };
    } catch (e) { predictions.ml = null; }
  }

  // Ensemble
  if (predictions.elo && predictions.ml) {
    try {
      const e = mlPredictor.ensemblePrediction({ probabilities: predictions.elo.prob, expectedGoals: predictions.elo.xg }, { probabilities: predictions.ml.prob, expectedGoals: predictions.ml.xg });
      predictions.ensemble = { prob: { homeWin: e.probabilities?.homeWin || 0, draw: e.probabilities?.draw || 0, awayWin: e.probabilities?.awayWin || 0 }, xg: { home: e.expectedGoals?.home || 0, away: e.expectedGoals?.away || 0 }, weights: e.metadata?.ensembleWeights || { elo: 0.3, ml: 0.7 } };
    } catch (e) { predictions.ensemble = null; }
  }

  return {
    ...match,
    eloRating: { home: homeElo, away: awayElo },
    predictions,
    snapshotInfo: {
      home: getSnapshotInfo(match.date),
      away: getSnapshotInfo(match.date),
    },
  };
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
