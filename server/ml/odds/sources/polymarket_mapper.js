/**
 * Polymarket 市场映射器
 * Phase 7.1 — TokenID → match mapping
 */
import mlConfig from '../../config.js';

// WC 2026 tag id on Polymarket
const WC_TAG = mlConfig.polymarket.worldCupTagId;

// 支持的比赛类型
const OUTCOME_TYPES = {
  MONEYLINE: 'moneyline',
  OVER_UNDER: 'over_under',
  BOTH_TO_SCORE: 'both_to_score',
  WINNER: 'winner',
  GROUP_QUALIFIER: 'group_qualifier',
  CHAMPION: 'champion',
};

/**
 * 判断市场类型
 */
export function classifyMarket(market) {
  const type = (market.sportsMarketType || '').toLowerCase();
  const title = (market.groupItemTitle || '').toLowerCase();
  if (type === 'moneyline') return OUTCOME_TYPES.MONEYLINE;
  if (type === 'overunder') return OUTCOME_TYPES.OVER_UNDER;
  if (/both\s+to\s+score/i.test(title)) return OUTCOME_TYPES.BOTH_TO_SCORE;
  if (/winner/i.test(market.title || '')) return OUTCOME_TYPES.WINNER;
  if (/champion/i.test(market.title || '') || /to win/i.test(title)) return OUTCOME_TYPES.CHAMPION;
  if (/qualif|group|advance/i.test(title)) return OUTCOME_TYPES.GROUP_QUALIFIER;
  return null;
}

/**
 * 从 market 的 groupItemTitle 解析比赛双方
 */
export function parseMarketTeams(market, eventTitle) {
  const title = market.groupItemTitle || '';
  if (!title) return { home: null, away: null };

  // 标题格式: "Brazil" (vs team name, single outcome)
  // 或 "Brazil vs Argentina - Home" (moneyline)
  if (title.startsWith('Draw')) {
    const parts = (eventTitle || '').split(/\s+vs\.?\s+/i);
    if (parts.length === 2) return { home: parts[0].trim(), away: parts[1].trim() };
  }

  const vsMatch = title.match(/^(.+)\s+vs\.?\s+(.+)$/i);
  if (vsMatch) return { home: vsMatch[1].trim(), away: vsMatch[2].trim() };

  return { home: title, away: null };
}

/**
 * 获取 1X2 市场三元组
 */
export function getMoneylineTriplet(markets) {
  const ml = markets.filter(m => m.sportsMarketType === 'moneyline');
  if (ml.length !== 3) return null;

  const home = ml.find(m => !/^draw/i.test(m.groupItemTitle || '') && 
    !/^draw/i.test(m.title || ''));
  const away = ml.find(m => !/^draw/i.test(m.groupItemTitle || '') &&
    !/^draw/i.test(m.title || '') && m !== home);
  const draw = ml.find(m => /^draw/i.test(m.groupItemTitle || '') || 
    /^draw/i.test(m.title || ''));

  if (!home || !away || !draw) return null;

  return { home, draw, away };
}

export default { OUTCOME_TYPES, classifyMarket, parseMarketTeams, getMoneylineTriplet };
