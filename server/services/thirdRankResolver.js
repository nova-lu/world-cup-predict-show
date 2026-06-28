/**
 * 第三名竞争势态分析器
 * Phase 8.2 — 小组→淘汰过渡管线
 *
 * 2026 世界杯规则：
 * - 12 个小组的第 3 名中前 8 个晋级 32 强
 * - 排序：积分 > 净胜球 > 进球数 > 纪律积分
 * - 可能涉及已确定 vs 未确定席位
 */

const GROUP_LETTERS = 'ABCDEFGHIJKL'.split('');

/**
 * 获取第三名竞争态势
 *
 * 根据已完赛和未完赛情况，分析每个第三名的出线状态
 *
 * @param {object} groupStandings — {A: [{slug, pts, gd, gf, ...}, ...], ...}
 * @returns {object}
 */
export function analyzeThirdRank(groupStandings) {
  const allThirds = [];
  const unfinishedGroups = [];

  for (const [g, teams] of Object.entries(groupStandings)) {
    if (!teams || teams.length < 3) {
      unfinishedGroups.push(g);
      continue;
    }

    const third = { ...teams[2], group: g };
    allThirds.push(third);

    // 检查该组是否已完赛（所有队 played >= 4？2026小组赛每队4场）
    const groupFinished = teams.every(t => (t.played || 0) >= 4);
    if (!groupFinished && !unfinishedGroups.includes(g)) {
      unfinishedGroups.push(g);
    }
  }

  // 排序：积分 > 净胜球 > 进球数
  const sorted = allThirds
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
    .map((t, i) => ({ ...t, overallRank: i + 1 }));

  const totalThirds = sorted.length;
  const cutoff = 8; // 最佳 8 个晋级

  // 已确认晋级的第三名（排名 ≤ 8 且组已完赛）
  const confirmed = sorted.filter(t => t.overallRank <= cutoff && !unfinishedGroups.includes(t.group));

  // 已确认被淘汰的第三名（排名 > 8 且组已完赛）
  const eliminated = sorted.filter(t => t.overallRank > cutoff && !unfinishedGroups.includes(t.group));

  // 待定（该组未完赛，或排名处于边缘）
  const pending = sorted.filter(t => unfinishedGroups.includes(t.group) || Math.abs(t.overallRank - cutoff) <= 2);

  return {
    totalGroups: Object.keys(groupStandings).length,
    totalThirds,
    spots: sorted.map(t => ({
      rank: t.overallRank,
      slug: t.slug,
      name: t.name,
      flag: t.flag,
      group: t.group,
      pts: t.pts,
      gd: t.gd,
      gf: t.gf,
      played: t.played,
      status: t.overallRank <= cutoff
        ? (unfinishedGroups.includes(t.group) ? 'likely_qualified' : 'qualified')
        : (unfinishedGroups.includes(t.group) ? 'possible' : 'eliminated'),
    })),
    qualifiers: sorted.filter(t => t.overallRank <= cutoff).map(t => t.slug),
    summary: {
      confirmed: confirmed.length,
      eliminated: eliminated.length,
      pending: pending.length,
      unfinishedGroups,
      cutoff, // 前 8 晋级
    },
    maxPossiblePts: _calcMaxPossible(allThirds),
  };
}

/**
 * 计算可能的最大积分（用于显示竞争上限）
 */
function _calcMaxPossible(thirds) {
  if (thirds.length === 0) return 0;
  return Math.max(...thirds.map(t => {
    // 假设未完赛的组，第三名最多再赢所有剩余比赛
    const remaining = Math.max(0, 4 - (t.played || 0));
    return t.pts + remaining * 3;
  }));
}

/**
 * 将第三名分配到各席位（避免重复分配）
 * 已预先在 groupResolver.mapBracketSlots 中实现
 * 此处只做修正辅助
 */
export function assignThirdToSlots(thirdPlaces, slotCandidates) {
  const assigned = new Set();
  const result = {};
  const ranked = [...thirdPlaces].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);

  for (const [slotId, candidates] of Object.entries(slotCandidates)) {
    // 从候选组中找到排名最高且未被分配第三名
    let best = null;
    for (const candidateSlug of candidates) {
      if (assigned.has(candidateSlug)) continue;
      const rd = ranked.find(t => t.slug === candidateSlug);
      if (rd && (!best || rd.overallRank < best.overallRank)) {
        best = rd;
      }
    }
    if (best) {
      assigned.add(best.slug);
      result[slotId] = best.slug;
    }
  }
  return result;
}

export default { analyzeThirdRank, assignThirdToSlots };
