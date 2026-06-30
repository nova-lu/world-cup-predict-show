// ===== AI 数据聚合层 =====
// 收集所有与比赛相关的数据源，输出统一结构供 Prompt 使用
// 每个数据源独立 try/catch，避免单点故障

import { predictMatch } from '../services/predictionService.js';
import { getTeamInfo } from '../services/dataService.js';

let mlPredictor, predictionServiceEnsemble, oddsApi, chinaLottery, knockoutEngine;

// 延迟加载避免启动时依赖所有模块
async function lazyLoad() {
  if (!mlPredictor) {
    const m = await import('../ml/inference/predictor.js');
    mlPredictor = m;
    predictionServiceEnsemble = m;
  }
  if (!oddsApi) {
    try {
      const m = await import('../services/oddsApi.js');
      oddsApi = m;
    } catch { oddsApi = null; }
  }
  if (!chinaLottery) {
    try {
      const m = await import('../ml/odds/sources/china_sports_lottery.js');
      chinaLottery = m;
    } catch { chinaLottery = null; }
  }
  if (!knockoutEngine) {
    try {
      const m = await import('../services/knockoutEngine.js');
      knockoutEngine = m;
    } catch { knockoutEngine = null; }
  }
}

// 缓存 getMatches 结果避免每次都 import
let _allMatches = null;

async function loadAllMatches() {
  if (_allMatches) return _allMatches;
  const { getMatches } = await import('../services/dataService.js');
  _allMatches = getMatches();
  return _allMatches;
}

// 查找比赛的预赛阶段/日期等信息
async function findMatchInfo(t1, t2) {
  try {
    const matches = await loadAllMatches();
    if (!matches || !Array.isArray(matches)) return null;
    for (const m of matches) {
      // 兼容不同数据格式: home/homeTeam/team1, away/awayTeam/team2, slug/t1/t2
      const h = m.home?.slug || m.homeTeam?.slug || m.team1?.slug || m.t1 || m.team1 || '';
      const a = m.away?.slug || m.awayTeam?.slug || m.team2?.slug || m.t2 || m.team2 || '';
      if (h === t1 && a === t2) return m;
    }
  } catch (e) {
    console.warn('[AI-aggregator] findMatchInfo 失败:', e.message);
  }
  return null;
}

/**
 * 聚合所有数据源
 * @param {string} t1 - 主队 slug
 * @param {string} t2 - 客队 slug
 * @returns {object} 聚合数据结构
 */
export async function aggregateMatchData(t1, t2) {
  await lazyLoad();

  const homeInfo = getTeamInfo(t1) || { name: t1, nameEn: t1, slug: t1, flag: '⚽', flagPath: null };
  const awayInfo = getTeamInfo(t2) || { name: t2, nameEn: t2, slug: t2, flag: '⚽', flagPath: null };

  // 查找比赛信息
  const matchInfo = await findMatchInfo(t1, t2);

  const result = {
    matchInfo: {
      homeTeam: { slug: t1, name: homeInfo.name, flagPath: homeInfo.flagPath },
      awayTeam: { slug: t2, name: awayInfo.name, flagPath: awayInfo.flagPath },
      stage: matchInfo?.stage || null,
      group: matchInfo?.group || null,
      date: matchInfo?.date || null,
      status: matchInfo?.status || 'scheduled',
    },
    eloPrediction: null,
    mlPrediction: null,
    ensemblePrediction: null,
    oddsData: null,
    polymarket: null,
    chinaSportsLottery: null,
    recentForm: null,
    knockoutPrediction: null,
    result: null,
  };

  // ---- 1. Elo ----
  try {
    const eloPred = predictMatch(t1, t2);
    if (eloPred) {
      result.eloPrediction = {
        homeRating: eloPred.home?.elo || 0,
        awayRating: eloPred.away?.elo || 0,
        homeBonus: eloPred.home?.bonus || 0,
        probabilities: {
          homeWin: +(eloPred.prob?.winHome || 0).toFixed(3),
          draw: +(eloPred.prob?.draw || 0).toFixed(3),
          awayWin: +(eloPred.prob?.winAway || 0).toFixed(3),
        },
        expectedGoals: {
          home: +(eloPred.expectedGoals?.home || 0).toFixed(2),
          away: +(eloPred.expectedGoals?.away || 0).toFixed(2),
        },
      };
    }
  } catch (e) {
    console.warn('[AI-aggregator] Elo 预测失败:', e.message);
  }

  // ---- 2. ML ----
  if (mlPredictor && typeof mlPredictor.predictMatch === 'function') {
    try {
      const mlPred = mlPredictor.predictMatch(t1, t2);
      if (mlPred) {
        result.mlPrediction = {
          available: true,
          probabilities: {
            homeWin: +(mlPred.probabilities?.homeWin || mlPred.homeWin || 0).toFixed(3),
            draw: +(mlPred.probabilities?.draw || mlPred.draw || 0).toFixed(3),
            awayWin: +(mlPred.probabilities?.awayWin || mlPred.awayWin || 0).toFixed(3),
          },
          expectedGoals: {
            home: +(mlPred.expectedGoals?.home || 0).toFixed(2),
            away: +(mlPred.expectedGoals?.away || 0).toFixed(2),
          },
          topScores: mlPred.topScores?.slice(0, 3) || null,
          overUnder: mlPred.overUnder ? {
            over2_5: +(mlPred.overUnder.over2_5 || 0).toFixed(3),
            under2_5: +(mlPred.overUnder.under2_5 || 0).toFixed(3),
            expectedTotal: +(mlPred.overUnder.expectedTotal || 0).toFixed(2),
          } : null,
          btts: mlPred.btts ? {
            yes: +(mlPred.btts.yes || 0).toFixed(3),
            no: +(mlPred.btts.no || 0).toFixed(3),
          } : null,
          risk: mlPred.risk ? {
            level: mlPred.risk.level || 'unknown',
            score: mlPred.risk.score || 0,
          } : null,
        };
      }
    } catch (e) {
      console.warn('[AI-aggregator] ML 预测失败:', e.message);
    }
  }
  if (!result.mlPrediction) {
    result.mlPrediction = { available: false };
  }

  // ---- 3. Ensemble ----
  if (predictionServiceEnsemble && result.eloPrediction) {
    try {
      const eloPred = predictMatch(t1, t2);
      const mlPred = result.mlPrediction?.available
        ? { probabilities: result.mlPrediction.probabilities, expectedGoals: result.mlPrediction.expectedGoals }
        : null;

      const ens = predictionServiceEnsemble.ensemblePrediction
        ? predictionServiceEnsemble.ensemblePrediction(eloPred, mlPred)
        : null;

      if (ens) {
        result.ensemblePrediction = {
          available: true,
          probabilities: {
            homeWin: +(ens.probabilities?.homeWin || ens.homeWin || 0).toFixed(3),
            draw: +(ens.probabilities?.draw || ens.draw || 0).toFixed(3),
            awayWin: +(ens.probabilities?.awayWin || ens.awayWin || 0).toFixed(3),
          },
          weights: ens.weights || null,
          dynamicAdjusted: ens.dynamicAdjusted || false,
        };
      }
    } catch (e) {
      console.warn('[AI-aggregator] Ensemble 失败:', e.message);
    }
  }
  if (!result.ensemblePrediction) {
    result.ensemblePrediction = { available: false };
  }

  // ---- 4. 市场赔率 ----
  if (oddsApi && typeof oddsApi.fetchOddsForMatch === 'function') {
    try {
      const odds = await oddsApi.fetchOddsForMatch(t1, t2);
      if (odds && odds.consensus) {
        result.oddsData = {
          available: true,
          consensus: {
            home: odds.consensus.home || 0,
            draw: odds.consensus.draw || 0,
            away: odds.consensus.away || 0,
          },
          bookmakerDetails: Array.isArray(odds.bookmakers) ? odds.bookmakers.map(b => ({
            name: b.name || b.bookmaker || 'unknown',
            odds: b.odds || {},
          })) : null,
          nBookmakers: odds.nBookmakers || odds.bookmakers?.length || 0,
          divergence: odds.divergence || null,
        };
      }
    } catch (e) {
      console.warn('[AI-aggregator] 赔率数据失败:', e.message);
    }
  }
  if (!result.oddsData) {
    result.oddsData = { available: false };
  }

  // ---- 5. Polymarket ----
  try {
    const { fetchWorldCupEvents, findMatchingEvent, getPrematch1X2, getMarketVolume } = await import('../ml/odds/sources/polymarket.js');
    const events = await fetchWorldCupEvents();
    if (events && Array.isArray(events)) {
      const match = findMatchingEvent(events, t1, t2);
      if (match) {
        const prematch = await getPrematch1X2(match.slug);
        if (prematch) {
          result.polymarket = {
            available: true,
            probabilities: {
              homeWin: +(prematch.home || 0).toFixed(3),
              draw: +(prematch.draw || 0).toFixed(3),
              awayWin: +(prematch.away || 0).toFixed(3),
            },
            volume: await getMarketVolume(match.slug).catch(() => 0) || 0,
            title: match.title || '',
          };
        }
      }
    }
  } catch (e) {
    console.warn('[AI-aggregator] Polymarket 失败:', e.message);
  }
  if (!result.polymarket) {
    result.polymarket = { available: false };
  }

  // ---- 6. 竞彩网 ----
  if (chinaLottery && typeof chinaLottery.loadLatest === 'function') {
    try {
      const { getMatch, normalizeToUnified, loadLatest } = chinaLottery;
      const records = loadLatest();
      if (records && records.length > 0) {
        const lotteryMatch = getMatch(records, t1, t2);
        if (lotteryMatch) {
          const unified = normalizeToUnified ? normalizeToUnified(lotteryMatch) : null;
          result.chinaSportsLottery = {
            available: true,
            probabilities: unified?.probabilities ? {
              homeWin: +(unified.probabilities.homeWin || 0).toFixed(3),
              draw: +(unified.probabilities.draw || 0).toFixed(3),
              awayWin: +(unified.probabilities.awayWin || 0).toFixed(3),
            } : null,
            odds: unified?.odds || null,
            returnRate: unified?.returnRate || 0,
          };
        }
      }
    } catch (e) {
      console.warn('[AI-aggregator] 竞彩网失败:', e.message);
    }
  }
  if (!result.chinaSportsLottery) {
    result.chinaSportsLottery = { available: false };
  }

  // ---- 7. 近期状态 ----
  try {
    // 从 wc2026-results.json 获取已结束比赛
    const { getFinishedMatches } = await import('../services/dataService.js');
    const allMatches = getFinishedMatches() || [];

    const homeMatches = allMatches.filter(m =>
      m.t1 === t1 || m.t2 === t1
    ).slice(0, 5);
    const awayMatches = allMatches.filter(m =>
      m.t1 === t2 || m.t2 === t2
    ).slice(0, 5);

    result.recentForm = {
      home: {
        last5: homeMatches.map(m => ({
          opponent: m.t1 === t1 ? m.t2 : m.t1,
          result: m.g1 != null && m.g2 != null
            ? (m.t1 === t1 ? `${m.g1}-${m.g2}` : `${m.g2}-${m.g1}`)
            : '-',
          gf: m.t1 === t1 ? (m.g1 ?? 0) : (m.g2 ?? 0),
          ga: m.t1 === t1 ? (m.g2 ?? 0) : (m.g1 ?? 0),
        })),
        form: homeMatches.map(m => {
          const isHome = m.t1 === t1;
          const score = isHome ? (m.g1 - m.g2) : (m.g2 - m.g1);
          return score > 0 ? 'W' : score < 0 ? 'L' : 'D';
        }).join(''),
      },
      away: {
        last5: awayMatches.map(m => ({
          opponent: m.t1 === t2 ? m.t2 : m.t1,
          result: m.g1 != null && m.g2 != null
            ? (m.t1 === t2 ? `${m.g1}-${m.g2}` : `${m.g2}-${m.g1}`)
            : '-',
          gf: m.t1 === t2 ? (m.g1 ?? 0) : (m.g2 ?? 0),
          ga: m.t1 === t2 ? (m.g2 ?? 0) : (m.g1 ?? 0),
        })),
        form: awayMatches.map(m => {
          const isHome = m.t1 === t2;
          const score = isHome ? (m.g1 - m.g2) : (m.g2 - m.g1);
          return score > 0 ? 'W' : score < 0 ? 'L' : 'D';
        }).join(''),
      },
    };
  } catch (e) {
    console.warn('[AI-aggregator] 近期状态失败:', e.message);
  }

  // ---- 8. 淘汰赛加时/点球 ----
  if (knockoutEngine && typeof knockoutEngine.knockoutMatchProb === 'function') {
    try {
      const kp = knockoutEngine.knockoutMatchProb(t1, t2);
      if (kp) {
        result.knockoutPrediction = {
          available: true,
          regWin: +(kp.regWin || kp.regularTime || 0).toFixed(3),
          etWin: +(kp.etWin || kp.extraTime || 0).toFixed(3),
          pkWin: +(kp.pkWin || kp.penalty || 0).toFixed(3),
        };
      }
    } catch (e) {
      console.warn('[AI-aggregator] 淘汰赛预测失败:', e.message);
    }
  }
  if (!result.knockoutPrediction) {
    result.knockoutPrediction = { available: false };
  }

  // ---- 9. 比赛结果 ----
  if (matchInfo && matchInfo.status === 'completed' && matchInfo.homeScore !== undefined) {
    result.result = {
      homeScore: matchInfo.homeScore,
      awayScore: matchInfo.awayScore,
      status: 'completed',
    };
  }

  return result;
}
