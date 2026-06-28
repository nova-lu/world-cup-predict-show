// 小组结果解析器
// 从实时积分榜解析各小组名次 + 最佳第三名筛选
import { getTeamInfo } from './dataService.js';
import { fetchStandings } from './footballApi.js';

// 2026 世界杯 12 个小组
const GROUP_LETTERS = 'ABCDEFGHIJKL'.split('');

/**
 * 获取各小组最终排名
 * 返回: { A: [{slug, rank, pts, gd, gf, ga, ...}, ...], B: [...], ... }
 * 按积分 → 净胜球 → 进球数 排序
 */
export function resolveGroupStandings(apiGroups) {
  const result = {};
  for (const [groupName, groupData] of Object.entries(apiGroups)) {
    const groupKey = groupName.replace(/^Group\s+/i, '');
    const teams = [...groupData.standings || groupData];

    // 排序：积分 → 净胜球 → 进球数
    const sorted = teams
      .map(t => ({
        slug: t.slug,
        name: getTeamInfo(t.slug)?.name || t.teamName || t.slug,
        flag: getTeamInfo(t.slug)?.flag || '⚽',
        flagPath: getTeamInfo(t.slug)?.flagPath || '',
        pts: t.pts || 0,
        gd: t.gd || 0,
        gf: t.gf || 0,
        ga: t.ga || 0,
        played: t.played || 0,
        w: t.w || t.won || 0,
        d: t.d || t.draw || 0,
        l: t.l || t.lost || 0,
      }))
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
      .map((t, i) => ({ ...t, rank: i + 1 }));

    result[groupKey] = sorted;
  }
  return result;
}

/**
 * 筛选最佳第三名（取前 8 个）
 * 排序规则：积分 → 净胜球 → 进球数
 * 返回: [{slug, name, flag, group, pts, gd, gf, rank}, ...]
 */
export function rankThirdPlaces(groupStandings) {
  const thirds = [];
  for (const [g, teams] of Object.entries(groupStandings)) {
    if (teams.length >= 3) {
      thirds.push({ ...teams[2], group: g });
    }
  }
  return thirds
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
    .slice(0, 8)
    .map((t, i) => ({ ...t, overallRank: i + 1 }));
}

/**
 * 获取 32 强球队完整名单
 * 返回: { 
 *   groupWinners: [组第一列表],
 *   groupRunnersUp: [组第二列表],
 *   bestThirds: [最佳第三名列表],
 *   allTeams: [全部32队, 含身份标识]
 * }
 */
export function getQualifiedTeams(groupStandings, thirdPlaces) {
  const groupWinners = [];
  const groupRunnersUp = [];
  const thirdSet = new Set(thirdPlaces.map(t => t.slug));

  for (const [g, teams] of Object.entries(groupStandings)) {
    if (teams.length >= 1) groupWinners.push({ ...teams[0], qualification: 'group_winner', group: g });
    if (teams.length >= 2) groupRunnersUp.push({ ...teams[1], qualification: 'runner_up', group: g });
  }

  const bestThirds = thirdPlaces.map(t => ({ ...t, qualification: 'best_third' }));
  const allTeams = [...groupWinners, ...groupRunnersUp, ...bestThirds];

  return { groupWinners, groupRunnersUp, bestThirds, allTeams };
}

/**
 * 解析小组赛最终结果 + 32 强名单
 */
export async function resolveKnockoutQualifiers(forceRefresh = false) {
  const apiGroups = await fetchStandings(forceRefresh);
  const groupStandings = resolveGroupStandings(apiGroups);
  const thirdPlaces = rankThirdPlaces(groupStandings);
  const qualified = getQualifiedTeams(groupStandings, thirdPlaces);

  return {
    generatedAt: new Date().toISOString(),
    source: 'api',
    groups: groupStandings,
    thirdPlaces,
    qualifiers: qualified,
    totalQualified: qualified.allTeams.length,
  };
}

/**
 * 根据小组名次解析结果，将 bracket 配置中的席位名映射为实际球队 slug
 * 
 * bracket 配置举例:
 *   { home: '1A', away: '3C/3D/3F/3G/3H', slot: 'W73' }
 * 解析后:
 *   { home: 'mexico', away: 'paraguay', slot: 'W73' }
 * 
 * 每个第三名球队只能被分配到一个席位
 */
export function mapBracketSlots(bracketMatches, groupStandings, thirdPlaces) {
  // 已分配的第三名球队（按 slug 跟踪）
  const assignedThirds = new Set();

  // 预计算第三名按组查找
  const thirdByGroup = {};
  for (const t of thirdPlaces) {
    thirdByGroup[t.group] = t.slug;
  }

  function resolveSlot(slot) {
    // 直接球队 slug（小写匹配）
    const slugLower = slot.toLowerCase();
    const directTeam = getTeamInfo(slugLower);
    if (directTeam && directTeam.group) return slugLower;

    // 小组名次格式 "1A", "2D"
    const m = slot.match(/^(\d+)([A-Z])$/);
    if (m) {
      const pos = parseInt(m[1]);
      const grp = m[2];
      const teams = groupStandings[grp];
      if (teams && teams.length >= pos) return teams[pos - 1].slug;
      return null;
    }

    // 组第三名引用 "3RD:E" — 直接引用某组的第三名球队
    const grpMatch = slot.match(/^3RD:([A-Z])$/i);
    if (grpMatch) {
      const grp = grpMatch[1].toUpperCase();
      const slug = thirdByGroup[grp];
      if (slug) return slug;
      return null;
    }

    return null;
  }

  return bracketMatches.map(m => {
    const resolved = { ...m };
    if (m.home) {
      const ht = resolveSlot(m.home);
      if (ht) resolved.home = ht;
    }
    if (m.away) {
      const at = resolveSlot(m.away);
      if (at) resolved.away = at;
    }
    return resolved;
  });
}

export default { resolveGroupStandings, rankThirdPlaces, getQualifiedTeams, resolveKnockoutQualifiers, mapBracketSlots };
