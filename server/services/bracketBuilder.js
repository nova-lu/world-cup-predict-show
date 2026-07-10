/**
 * 确定性淘汰赛对阵生成器
 * Phase 8.2 — 小组→淘汰过渡管线
 *
 * 优先使用实际完赛结果，未完赛时根据小组排名 + 模拟决定最可能晋级球队。
 * 不同于 bracket.js 的蒙特卡洛路径（仅概率），本模块构建确定性的淘汰赛树。
 *
 * 2026 世界杯对阵配置（固定）
 * R32配对规则参照 FIFA 2026 官方格式
 */

import { mapBracketSlots } from './groupResolver.js';
import { fetchAllMatches, fetchStandings } from './footballApi.js';
import { resolveGroupStandings, rankThirdPlaces, getQualifiedTeams, resolveKnockoutQualifiers } from './groupResolver.js';
import { analyzeThirdRank } from './thirdRankResolver.js';
import { getTeamInfo, getRatings, getMatches } from './dataService.js';

// ====== 固定对阵模板 ======
const GROUP_LETTERS = 'ABCDEFGHIJKL'.split('');
const groupConfig = GROUP_LETTERS.map(g => ({ group: g, label: g + '组' }));

const round32Slots = [
  { id: 'r32-1', label: 'R32·1', home: '1A', away: '3RD_RANK:1', slot: 'W73', stage: 'round32' },
  { id: 'r32-2', label: 'R32·2', home: '2D', away: '2G', slot: 'W74', stage: 'round32' },
  { id: 'r32-3', label: 'R32·3', home: '1C', away: '2F', slot: 'W75', stage: 'round32' },
  { id: 'r32-4', label: 'R32·4', home: '2E', away: '2I', slot: 'W76', stage: 'round32' },
  { id: 'r32-5', label: 'R32·5', home: '1I', away: '3RD_RANK:2', slot: 'W77', stage: 'round32' },
  { id: 'r32-6', label: 'R32·6', home: '2A', away: '2B', slot: 'W78', stage: 'round32' },
  { id: 'r32-7', label: 'R32·7', home: '1H', away: '2J', slot: 'W79', stage: 'round32' },
  { id: 'r32-8', label: 'R32·8', home: '2K', away: '2L', slot: 'W80', stage: 'round32' },
  { id: 'r32-9', label: 'R32·9', home: '1B', away: '3RD_RANK:3', slot: 'W81', stage: 'round32' },
  { id: 'r32-10', label: 'R32·10', home: '1L', away: '3RD_RANK:4', slot: 'W82', stage: 'round32' },
  { id: 'r32-11', label: 'R32·11', home: '1G', away: '3RD_RANK:5', slot: 'W83', stage: 'round32' },
  { id: 'r32-12', label: 'R32·12', home: '1E', away: '3RD_RANK:6', slot: 'W84', stage: 'round32' },
  { id: 'r32-13', label: 'R32·13', home: '1F', away: '2C', slot: 'W85', stage: 'round32' },
  { id: 'r32-14', label: 'R32·14', home: '1D', away: '3RD_RANK:7', slot: 'W86', stage: 'round32' },
  { id: 'r32-15', label: 'R32·15', home: '1J', away: '2H', slot: 'W87', stage: 'round32' },
  { id: 'r32-16', label: 'R32·16', home: '1K', away: '3RD_RANK:8', slot: 'W88', stage: 'round32' },
];

const round16Slots = [
  { id: 'r16-1', label: 'R16·1', home: 'W78', away: 'W85', slot: 'W89', stage: 'round16' },
  { id: 'r16-2', label: 'R16·2', home: 'W77', away: 'W84', slot: 'W90', stage: 'round16' },
  { id: 'r16-3', label: 'R16·3', home: 'W75', away: 'W76', slot: 'W91', stage: 'round16' },
  { id: 'r16-4', label: 'R16·4', home: 'W73', away: 'W82', slot: 'W92', stage: 'round16' },
  { id: 'r16-5', label: 'R16·5', home: 'W79', away: 'W80', slot: 'W93', stage: 'round16' },
  { id: 'r16-6', label: 'R16·6', home: 'W83', away: 'W86', slot: 'W94', stage: 'round16' },
  { id: 'r16-7', label: 'R16·7', home: 'W74', away: 'W87', slot: 'W95', stage: 'round16' },
  { id: 'r16-8', label: 'R16·8', home: 'W81', away: 'W88', slot: 'W96', stage: 'round16' },
];

const quarterSlots = [
  { id: 'qf-1', label: 'QF·1', home: 'W90', away: 'W89', slot: 'W97', stage: 'quarter' },
  { id: 'qf-2', label: 'QF·2', home: 'W93', away: 'W94', slot: 'W98', stage: 'quarter' },
  { id: 'qf-3', label: 'QF·3', home: 'W91', away: 'W92', slot: 'W99', stage: 'quarter' },
  { id: 'qf-4', label: 'QF·4', home: 'W95', away: 'W96', slot: 'W100', stage: 'quarter' },
];

const semiSlots = [
  { id: 'sf-1', label: 'SF·1', home: 'W97', away: 'W98', slot: 'W101', stage: 'semi' },
  { id: 'sf-2', label: 'SF·2', home: 'W99', away: 'W100', slot: 'W102', stage: 'semi' },
];

const finalSlots = [
  { id: 'final', label: 'FINAL', home: 'W101', away: 'W102', slot: 'CHAMPION', stage: 'final' },
];

// 所有轮次
const ALL_ROUNDS = { round32: round32Slots, round16: round16Slots, quarter: quarterSlots, semi: semiSlots, final: finalSlots };

/**
 * 构建确定性淘汰赛树
 *
 * @param {object} qualifiers - from resolveKnockoutQualifiers()
 * @param {array} allMatches - 所有比赛数据（含已完赛淘汰赛）
 * @returns {object} 完整淘汰赛树
 */
export function buildDeterministicBracket(qualifiers, allMatches) {
  // 1. 解析小组席位 → 32 强对阵（使用已排序的第三名列表）
  const resolvedR32 = mapBracketSlots(round32Slots, qualifiers.groups, qualifiers.thirdPlaces);

  // 2. 所有已完赛的淘汰赛
  const FINISHED_STAGES = new Set([
    'ROUND_32', 'ROUND_16', 'ROUND_OF_32', 'ROUND_OF_16', 'LAST_32', 'LAST_16',
    'QUARTER_FINAL', 'QUARTER_FINALS', 'QUARTER',
    'SEMI_FINAL', 'SEMI_FINALS', 'SEMI',
    'FINAL'
  ]);
  const KNOCKOUT_ROUNDS = ['round of 32', 'round of 16', 'quarter', 'semi', 'final'];

  const finishedKnockout = (allMatches || [])
    .filter(m => {
      if (m.status !== 'FT' && (m.g1 == null || m.g2 == null)) return false;
      // 优先 stage 字段，兜底 round 字段
      const stage = (m.stage || '').toUpperCase().replace(/\s+/g, '_');
      const round = (m.round || '').toLowerCase();
      return FINISHED_STAGES.has(stage) || KNOCKOUT_ROUNDS.some(r => round.includes(r));
    })
    .map(m => {
      // 判断胜者：若有明确 store winner 字段优先（点球大战取胜），否则按常规时间比分
      let winner, loser;
      if (m.winner) {
        winner = m.winner;
        loser = winner === m.t1 ? m.t2 : m.t1;
      } else {
        winner = m.g1 != null && m.g2 != null ? (m.g1 > m.g2 ? m.t1 : m.t2) : null;
        loser = winner ? (winner === m.t1 ? m.t2 : m.t1) : null;
      }
      return { t1: m.t1, t2: m.t2, g1: m.g1, g2: m.g2, winner, loser, stage: m.stage };
    });

  // 3. 构建 slot → 结果 的索引
  const slotResults = {};
  const slotByTeamPair = {};

  // 建立 R32 的 team pair → slot 映射
  for (const m of resolvedR32) {
    const pair = [m.home, m.away].sort().join(':');
    slotByTeamPair[pair] = m.slot;
  }

  // 遍历已完赛比赛，匹配到对应 slot
  for (const fm of finishedKnockout) {
    const pair = [fm.t1, fm.t2].sort().join(':');
    const slotId = slotByTeamPair[pair];
    if (slotId) {
      slotResults[slotId] = {
        t1: fm.t1, t2: fm.t2,
        g1: fm.g1, g2: fm.g2,
        winner: fm.winner, loser: fm.loser,
        finished: true,
      };
    }
  }

  // === R16 及后续轮次（QF/SF/Final）已完赛结果匹配 ===
  // 这些轮次的 pair 只有 R32 获胜者确定后才能解析（W-slot → 真实队名）
  // 因此需要在 R32 映射完成后，再以解析后的 team pair 匹配 R16+ 赛果
  const subsequentRoundDefs = [round16Slots, quarterSlots, semiSlots, finalSlots];
  for (const roundDefs of subsequentRoundDefs) {
    const roundPairMap = {};
    for (const m of roundDefs) {
      const home = _resolveSlotWinner(m.home, slotResults);
      const away = _resolveSlotWinner(m.away, slotResults);
      if (home && away) {
        roundPairMap[[home, away].sort().join(':')] = m.slot;
      }
    }
    for (const fm of finishedKnockout) {
      const pair = [fm.t1, fm.t2].sort().join(':');
      const slotId = roundPairMap[pair];
      if (slotId && !slotResults[slotId]?.finished) {
        slotResults[slotId] = {
          t1: fm.t1, t2: fm.t2,
          g1: fm.g1, g2: fm.g2,
          winner: fm.winner, loser: fm.loser,
          finished: true,
        };
      }
    }
  }

  // 4. 结构化各轮次
  // round32 使用已解析的 resolvedR32（直接填充球队slug）
  const ratings = getRatings();
  const round32 = resolvedR32.map(m => ({
    ...m,
    winner: slotResults[m.slot]?.winner || null,
    loser: slotResults[m.slot]?.loser || null,
    g1: slotResults[m.slot]?.g1 ?? null,
    g2: slotResults[m.slot]?.g2 ?? null,
    finished: slotResults[m.slot]?.finished || false,
    resolved: true,
    // 添加球队信息和 Elo 评分
    homeInfo: m.home && !m.home.startsWith('W') && !m.home.match(/^\d/) ? { ...getTeamInfo(m.home), elo: ratings[m.home] || 1500 } : null,
    awayInfo: m.away && !m.away.startsWith('W') && !m.away.match(/^\d/) ? { ...getTeamInfo(m.away), elo: ratings[m.away] || 1500 } : null,
  }));

  // 后续轮次：基于已完赛结果填充 W-slot
  function buildRound(slotDefs) {
    return slotDefs.map(m => {
      const existing = slotResults[m.slot] || {};
      const homeTeam = existing.t1 || _resolveSlotWinner(m.home, slotResults);
      const awayTeam = existing.t2 || _resolveSlotWinner(m.away, slotResults);
      const finished = existing.finished || false;

      // 添加球队信息和 Elo
      const homeInfo = homeTeam && !homeTeam.startsWith('W') ? { ...getTeamInfo(homeTeam), elo: ratings[homeTeam] || 1500 } : null;
      const awayInfo = awayTeam && !awayTeam.startsWith('W') ? { ...getTeamInfo(awayTeam), elo: ratings[awayTeam] || 1500 } : null;

      if (m.slot === 'CHAMPION' && existing.winner) {
        return { ...m, home: homeTeam, away: awayTeam, winner: existing.winner, g1: existing.g1, g2: existing.g2, finished: true, resolved: true, homeInfo, awayInfo };
      }

      return {
        ...m,
        home: homeTeam || m.home,
        away: awayTeam || m.away,
        winner: existing.winner || null,
        g1: existing.g1 ?? null,
        g2: existing.g2 ?? null,
        finished,
        resolved: !!(homeTeam && awayTeam),
        homeInfo,
        awayInfo,
      };
    });
  }

  const rounds = {};
  for (const [rk, slotDefs] of Object.entries(ALL_ROUNDS)) {
    if (rk === 'round32') {
      rounds[rk] = round32;
    } else {
      rounds[rk] = buildRound(slotDefs);
    }
  }

  // 5. 填充冠军
  let champion = null;
  const finalRound = rounds.final[0];
  if (finalRound && finalRound.finished && finalRound.winner) {
    champion = finalRound.winner;
  }

  return {
    generatedAt: new Date().toISOString(),
    groups: groupConfig,
    rounds,
    champion,
    qualifiers: qualifiers.qualifiers,
    thirdPlaces: qualifiers.thirdPlaces,
    totalQualified: qualifiers.totalQualified,
    source: 'real',
  };
}

/**
 * 将 slot 编号解析为实际球队 slug
 */
function _resolveSlotWinner(slot, slotResults) {
  if (!slot) return null;
  if (slot.startsWith('W') || slot === 'CHAMPION') {
    const result = slotResults[slot];
    if (result && result.winner) return result.winner;
    return null;
  }
  return slot;
}

/**
 * 完整主入口
 */
export async function getKnockoutBracket(forceRefresh = false) {
  const [qualifiers, apiMatches] = await Promise.all([
    resolveKnockoutQualifiers(forceRefresh),
    fetchAllMatches(forceRefresh),
  ]);

  // 本地 JSON 数据（wc2026-results.json）覆盖 API 数据
  // 用户编辑 JSON 后会直接生效，不依赖外部 API 返回的数据
  const localMatches = getMatches(forceRefresh);
  const allMatches = apiMatches.map(apiM => {
    const localM = localMatches.find(m => m.t1 === apiM.t1 && m.t2 === apiM.t2 && m.date === apiM.date);
    if (localM && localM.status === 'FT') {
      return {
        ...apiM,
        g1: localM.g1, g2: localM.g2,
        winner: localM.winner || (localM.g1 > localM.g2 ? localM.t1 : localM.t2),
        status: 'FT',
        stage: localM.stage || apiM.stage,
        pens1: localM.pens1,
        pens2: localM.pens2,
      };
    }
    return apiM;
  });

  // 也把本地 JSON 中但 API 没有的比赛加进去
  const KO_STAGE_SET = new Set([
    'ROUND_32', 'ROUND_16', 'ROUND_OF_32', 'ROUND_OF_16', 'LAST_32', 'LAST_16',
    'QUARTER_FINAL', 'QUARTER_FINALS', 'QUARTER',
    'SEMI_FINAL', 'SEMI_FINALS', 'SEMI',
    'FINAL'
  ]);
  const KO_ROUND_SET = ['round of 32', 'round of 16', 'quarter', 'semi', 'final'];
  for (const localM of localMatches) {
    if (localM.status !== 'FT' && (localM.g1 == null || localM.g2 == null)) continue;
    const stage = (localM.stage || '').toUpperCase().replace(/\s+/g, '_');
    const round = (localM.round || '').toLowerCase();
    const isKo = KO_STAGE_SET.has(stage) || KO_ROUND_SET.some(r => round.includes(r));
    if (isKo) {
      const exists = allMatches.some(am => am.t1 === localM.t1 && am.t2 === localM.t2);
      if (!exists) {
        allMatches.push({
          t1: localM.t1, t2: localM.t2,
          g1: localM.g1, g2: localM.g2,
          winner: localM.winner || (localM.g1 > localM.g2 ? localM.t1 : localM.t2),
          status: 'FT',
          stage: localM.stage,
          date: localM.date,
          pens1: localM.pens1, pens2: localM.pens2,
        });
      }
    }
  }

  return buildDeterministicBracket(qualifiers, allMatches);
}

/**
 * 获取已确定的出线球队
 */
export async function getQualified(forceRefresh = false) {
  const q = await resolveKnockoutQualifiers(forceRefresh);
  return q;
}

/**
 * 获取第三名竞争态势
 */
export async function getThirdRank(forceRefresh = false) {
  const apiGroups = await fetchStandings(forceRefresh);
  const groupStandings = resolveGroupStandings(apiGroups);
  return analyzeThirdRank(groupStandings);
}

export default { buildDeterministicBracket, getKnockoutBracket, getQualified, getThirdRank };

/**
 * 从全部 12 组中提取所有第三名（不筛选）
 */
export function getAllThirdPlaces(groupStandings) {
  const thirds = [];
  for (const [g, teams] of Object.entries(groupStandings)) {
    if (teams && teams.length >= 3) {
      thirds.push({ ...teams[2], group: g });
    }
  }
  return thirds;
}
