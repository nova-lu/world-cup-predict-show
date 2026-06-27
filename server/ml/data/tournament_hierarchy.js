/**
 * 联赛层级标签系统
 * Phase 7.3 — 赛事层级分割
 *
 * T1: FIFA World Cup (世界杯本赛)
 * T2: Continental Championships (欧洲杯/美洲杯等)
 * T3: WC Qualifiers (世界杯预选赛)
 * T4: Continental Qualifiers
 * T5: Friendlies
 */
import mlConfig from '../config.js';

const TIER_ORDER = { T1: 1, T2: 2, T3: 3, T4: 4, T5: 5, base: 6 };

// 比赛类型关键字匹配
const TIER_RULES = [
  {
    tier: 'T1',
    keywords: ['world cup', 'fifa world cup'],
    tournaments: ['WC_2026', 'WC_2022', 'WC_2018', 'WC_2014', 'WC_2010', 'WC_2006'],
  },
  {
    tier: 'T2',
    keywords: ['european championship', 'uefa euro', 'copa america',
      'africa cup of nations', 'asian cup', 'concacaf gold cup',
      'ofc nations cup', 'euros', 'copa américa'],
    tournaments: ['EURO', 'COPA', 'AFCON', 'ASIAN_CUP', 'GOLD_CUP'],
  },
  {
    tier: 'T3',
    keywords: ['world cup qualifying', 'world cup qualification',
      'wc qualifier', 'fifa world cup qualifying'],
    tournaments: ['WCQ'],
  },
  {
    tier: 'T4',
    keywords: ['euro qualifying', 'afcon qualifying', 'asian cup qualifying',
      'concacaf qualifying', 'copa america qualifying'],
    tournaments: ['EURO_Q', 'AFCON_Q', 'ASIAN_Q', 'GOLD_Q'],
  },
  {
    tier: 'T5',
    keywords: ['friendly', 'international friendly', 'fifa friendly'],
    tournaments: ['FRIENDLY'],
  },
];

/**
 * 根据比赛信息判断层级
 */
export function getMatchTier(match) {
  const tournament = (match.tournament || match.competition || '').toLowerCase();
  const stage = (match.stage || '').toLowerCase();
  const name = (match.name || '').toLowerCase();
  const text = tournament + ' ' + stage + ' ' + name;

  // 特别: 世界杯比赛 (GROUP_STAGE / R16 / QF / SF / FINAL)
  if (match.stage && match.stage !== 'GROUP_STAGE' && 
      (tournament.includes('world cup') || tournament.includes('fifa world cup') || match.isWorldCup)) {
    return 'T1';
  }
  if (match.stage === 'GROUP_STAGE' && 
      (tournament.includes('world cup') || match.isWorldCup)) {
    return 'T1';
  }

  for (const rule of TIER_RULES) {
    if (rule.keywords.some(kw => text.includes(kw))) return rule.tier;
    if (rule.tournaments.some(t => text.includes(t.toLowerCase()))) return rule.tier;
  }

  // 默认: base (全量模型)
  return 'base';
}

/**
 * 获取选择器链 (从最佳到回退)
 */
export function getFallbackChain(primaryTier) {
  const config = mlConfig.tournamentHierarchy;
  if (!config.enabled) return ['base'];

  const idx = TIER_ORDER[primaryTier] || 99;
  const chain = config.fallbackChain.filter(t => (TIER_ORDER[t] || 99) >= idx);
  if (!chain.includes('base')) chain.push('base');
  return chain;
}

export function compareTiers(a, b) {
  return (TIER_ORDER[a] || 99) - (TIER_ORDER[b] || 99);
}

export default { getMatchTier, getFallbackChain, TIER_ORDER };
