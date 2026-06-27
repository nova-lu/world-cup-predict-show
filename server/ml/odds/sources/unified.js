/**
 * 统一信源适配层
 * Phase 7.2 — 统一三种信源的接口
 *
 * 三种信源:
 *   1. odds-api.io (传统博彩, 现有 oddsApi.js)
 *   2. Polymarket (预测市场, 新)
 *   3. ML/Elo Model (模型, 已存在)
 */
import { fetchOddsForMatch, fetchAllAvailableOdds } from '../../../services/oddsApi.js';
import { getPrematch1X2, fetchWorldCupEvents } from './polymarket.js';
import mlConfig from '../../config.js';

/**
 * 获取比赛的所有可用信源概率
 * @returns {Array<{source: string, probabilities: object, metadata: object}>}
 */
export async function fetchAllSources(t1, t2) {
  const sources = [];

  // 1. odds-api
  if (mlConfig.oddsFusion.enabled && process.env.ODDS_API_KEY) {
    try {
      const oddsData = await fetchOddsForMatch(t1, t2);
      if (oddsData && oddsData.found && oddsData.consensus) {
        // 使用去抽水的 consensus 概率
        const c = oddsData.consensus;
        sources.push({
          source: 'oddsApi',
          probabilities: {
            homeWin: Math.round(c.home * 10000) / 10000,
            draw: Math.round(c.draw * 10000) / 10000,
            awayWin: Math.round(c.away * 10000) / 10000,
          },
          metadata: {
            nBookmakers: oddsData.nBookmakers || 0,
            overround: oddsData.overround || 0,
          },
        });
      }
    } catch (e) {
      console.warn('[fusion] odds-api 不可用:', e.message);
    }
  }

  // 2. Polymarket
  if (mlConfig.polymarket.enabled) {
    try {
      // 使用 findMatchingEvent (带别名映射 USA→usa, South Korea→korea-republic)
      const { findMatchingEvent } = await import('./polymarket.js');
      const events = await fetchWorldCupEvents();
      const matched = findMatchingEvent(events, t1, t2);
      if (matched) {
        const pmProb = await getPrematch1X2(matched.slug);
        if (pmProb) {
          sources.push({
            source: 'polymarket',
            probabilities: {
              homeWin: Math.round(pmProb.home * 10000) / 10000,
              draw: Math.round(pmProb.draw * 10000) / 10000,
              awayWin: Math.round(pmProb.away * 10000) / 10000,
            },
            metadata: {
              overround: pmProb.overround,
              rawHome: pmProb.rawHome,
              rawDraw: pmProb.rawDraw,
              rawAway: pmProb.rawAway,
            },
          });
        }
      }
    } catch (e) {
      console.warn('[fusion] Polymarket 不可用:', e.message);
    }
  }

  return sources;
}

/**
 * 把模型预测转换为统一格式
 */
export function modelToSource(prediction) {
  if (!prediction || !prediction.probabilities) return null;
  return {
    source: 'model',
    probabilities: {
      homeWin: prediction.probabilities.homeWin,
      draw: prediction.probabilities.draw,
      awayWin: prediction.probabilities.awayWin,
    },
    metadata: {
      engine: prediction.engine || prediction._engine || 'unknown',
      confidence: prediction.metadata?.confidence,
    },
  };
}

export default { fetchAllSources, modelToSource };
