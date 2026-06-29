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
            overround: c.overround || 0,
            bookmakerDetails: oddsData.bookmakers || [],
            divergence: oddsData.divergence || null,
          },
        });
      }
    } catch (e) {
      console.warn('[fusion] odds-api 不可用:', e.message);
    }
  }

  // 2. Polymarket (实时 + 缓存回退)
  if (mlConfig.polymarket.enabled) {
    try {
      const { findMatchingEvent, fetchWorldCupEvents } = await import('./polymarket.js');
      const events = await fetchWorldCupEvents();
      const matched = findMatchingEvent(events, t1, t2);
      if (matched) {
        const { getPrematch1X2 } = await import('./polymarket.js');
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
      console.warn('[fusion] Polymarket 实时不可用:', e.message);
      // 尝试从磁盘缓存读取 Polymarket 数据（备用）
      try {
        const { findMatchingEvent } = await import('./polymarket.js');
        const { readDiskCacheEvents } = await import('./polymarket.js');
        const diskEvents = readDiskCacheEvents ? readDiskCacheEvents() : null;
        if (diskEvents && diskEvents.length) {
          console.log(`[fusion] 使用 Polymarket 磁盘缓存 (${diskEvents.length} 个事件)`);
          const matched = findMatchingEvent(diskEvents, t1, t2);
          if (matched) {
            const { getPrematch1X2 } = await import('./polymarket.js');
            const pmProb = await getPrematch1X2(matched.slug);
            if (pmProb) {
              sources.push({
                source: 'polymarket',
                probabilities: {
                  homeWin: Math.round(pmProb.home * 10000) / 10000,
                  draw: Math.round(pmProb.draw * 10000) / 10000,
                  awayWin: Math.round(pmProb.away * 10000) / 10000,
                },
                metadata: { overround: pmProb.overround, _cached: true },
              });
            }
          }
        }
      } catch (e2) {
        console.warn('[fusion] Polymarket 缓存回退也失败:', e2.message);
      }
    }
  }

  // 3. 竞彩网离线数据（最后回退）
  if (sources.length === 0) {
    try {
      const mx = await import('./china_sports_lottery.js');
      if (mx) {
        const records = mx.loadLatest();
        if (records && records.length) {
          // 中文队名映射查找
          const TEAM_NAME_MAP = {
            'argentina': ['阿根廷'], 'france': ['法国'], 'brazil': ['巴西'], 'portugal': ['葡萄牙'],
            'spain': ['西班牙'], 'germany': ['德国'], 'england': ['英格兰'], 'netherlands': ['荷兰'],
            'italy': ['意大利'], 'croatia': ['克罗地亚'], 'belgium': ['比利时'], 'denmark': ['丹麦'],
            'switzerland': ['瑞士'], 'uruguay': ['乌拉圭'], 'japan': ['日本'], 'korea-republic': ['韩国', '南韩'],
            'usa': ['美国'], 'mexico': ['墨西哥'], 'canada': ['加拿大'], 'morocco': ['摩洛哥'],
            'senegal': ['塞内加尔'], 'nigeria': ['尼日利亚'], 'cameroon': ['喀麦隆'], 'ghana': ['加纳'],
            'türkiye': ['土耳其'], 'turkey': ['土耳其'], 'poland': ['波兰'], 'serbia': ['塞尔维亚'],
            'sweden': ['瑞典'], 'norway': ['挪威'], 'ukraine': ['乌克兰'], 'austria': ['奥地利'],
            'scotland': ['苏格兰'], 'wales': ['威尔士'], 'hungary': ['匈牙利'], 'greece': ['希腊'],
            'romania': ['罗马尼亚'], 'czech-republic': ['捷克'], 'slovakia': ['斯洛伐克'],
            'slovenia': ['斯洛文尼亚'], 'australia': ['澳大利亚'], 'iran': ['伊朗'], 'saudi-arabia': ['沙特'],
            'qatar': ['卡塔尔'], 'united-arab-emirates': ['阿联酋'], 'iraq': ['伊拉克'],
            'ecuador': ['厄瓜多尔'], 'peru': ['秘鲁'], 'chile': ['智利'], 'colombia': ['哥伦比亚'],
            'paraguay': ['巴拉圭'], 'venezuela': ['委内瑞拉'], 'costa-rica': ['哥斯达黎加'],
            'jamaica': ['牙买加'], 'honduras': ['洪都拉斯'], 'panama': ['巴拿马'],
            'dpr-korea': ['朝鲜'], 'new-zealand': ['新西兰'],
          };
          const cnHome = (TEAM_NAME_MAP[t1] || [''])[0];
          const cnAway = (TEAM_NAME_MAP[t2] || [''])[0];
          if (cnHome && cnAway) {
            const match = mx.getMatch(records, cnHome, cnAway);
            if (match) {
              const normalized = mx.normalizeToUnified(match);
              if (normalized) {
                sources.push({
                  source: 'china-sports-lottery',
                  probabilities: {
                    homeWin: Math.round(normalized.homeWin * 10000) / 10000,
                    draw: Math.round(normalized.draw * 10000) / 10000,
                    awayWin: Math.round(normalized.awayWin * 10000) / 10000,
                  },
                  metadata: { _cached: true, _offline: true },
                });
                console.log(`[fusion] 竞彩网离线数据命中: ${cnHome} vs ${cnAway}`);
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[fusion] 竞彩网离线回退失败:', e.message);
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
