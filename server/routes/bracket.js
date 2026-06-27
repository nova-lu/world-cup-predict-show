// 淘汰赛树形图 API
// 利用蒙特卡洛模拟结果构建可视化淘汰赛树

/**
 * 构建淘汰赛树数据结构
 * 从蒙特卡洛模拟结果提取各支球队在各轮次的晋级概率
 */
export async function buildBracketData(force = false) {
  // 从蒙特卡洛获取模拟数据
  const monteCarloService = await import('../services/monteCarloService.js');
  const sims = 10000;
  let result = monteCarloService.runMonteCarlo(sims, force);

  // 检查旧缓存数据：如果没有 groupRank，强制重新计算
  if (!force && result.teams && result.teams.length > 0 && !result.teams[0].groupRank) {
    console.log('[Bracket] 检测到旧缓存，强制刷新模拟数据...');
    result = monteCarloService.runMonteCarlo(sims, true);
  }

  // 小组赛阶段配置（12组）
  const groupConfig = 'ABCDEFGHIJKL'.split('').map((g, i) => ({
    group: g,
    label: g + '组',
  }));

  // 32强对阵配置（根据2026世界杯淘汰赛规则）
  const round32Matches = [
    { id: 'r32-1', label: 'R32·1', home: '1A', away: '3C/3D/3F/3G/3H', slot: 'W73' },
    { id: 'r32-2', label: 'R32·2', home: '2D', away: '2G', slot: 'W74' },
    { id: 'r32-3', label: 'R32·3', home: '1C', away: '2F', slot: 'W75' },
    { id: 'r32-4', label: 'R32·4', home: '2E', away: '2I', slot: 'W76' },
    { id: 'r32-5', label: 'R32·5', home: '1I', away: '3C/3D/3F/3G/3H', slot: 'W77' },
    { id: 'r32-6', label: 'R32·6', home: '2A', away: '2B', slot: 'W78' },
    { id: 'r32-7', label: 'R32·7', home: '1H', away: '2J', slot: 'W79' },
    { id: 'r32-8', label: 'R32·8', home: '2K', away: '2L', slot: 'W80' },
    { id: 'r32-9', label: 'R32·9', home: '1B', away: '3E/3F/3G/3I/3J', slot: 'W81' },
    { id: 'r32-10', label: 'R32·10', home: '1L', away: '3E/3H/3I/3J/3K', slot: 'W82' },
    { id: 'r32-11', label: 'R32·11', home: '1G', away: '3A/3E/3H/3I/3J', slot: 'W83' },
    { id: 'r32-12', label: 'R32·12', home: 'USA', away: '3B/3E/3F/3I/3J', slot: 'W84' },
    { id: 'r32-13', label: 'R32·13', home: '1F', away: '2C', slot: 'W85' },
    { id: 'r32-14', label: 'R32·14', home: 'Mexico', away: '3C/3E/3F/3H/3I', slot: 'W86' },
    { id: 'r32-15', label: 'R32·15', home: 'Germany', away: '3A/3B/3C/3D/3F', slot: 'W87' },
    { id: 'r32-16', label: 'R32·16', home: 'Argentina', away: '2H', slot: 'W88' },
  ];

  // 16强对阵
  const round16Matches = [
    { id: 'r16-1', label: 'R16·1', home: 'W73', away: 'W75', slot: 'W89' },
    { id: 'r16-2', label: 'R16·2', home: 'W74', away: 'W77', slot: 'W90' },
    { id: 'r16-3', label: 'R16·3', home: 'W76', away: 'W78', slot: 'W91' },
    { id: 'r16-4', label: 'R16·4', home: 'W79', away: 'W80', slot: 'W92' },
    { id: 'r16-5', label: 'R16·5', home: 'W81', away: 'W83', slot: 'W93' },
    { id: 'r16-6', label: 'R16·6', home: 'W82', away: 'W84', slot: 'W94' },
    { id: 'r16-7', label: 'R16·7', home: 'W85', away: 'W87', slot: 'W95' },
    { id: 'r16-8', label: 'R16·8', home: 'W86', away: 'W88', slot: 'W96' },
  ];

  const quarterMatches = [
    { id: 'qf-1', label: 'QF·1', home: 'W89', away: 'W90', slot: 'W97' },
    { id: 'qf-2', label: 'QF·2', home: 'W91', away: 'W92', slot: 'W98' },
    { id: 'qf-3', label: 'QF·3', home: 'W93', away: 'W94', slot: 'W99' },
    { id: 'qf-4', label: 'QF·4', home: 'W95', away: 'W96', slot: 'W100' },
  ];

  const semiMatches = [
    { id: 'sf-1', label: 'SF·1', home: 'W97', away: 'W98', slot: 'W101' },
    { id: 'sf-2', label: 'SF·2', home: 'W99', away: 'W100', slot: 'W102' },
  ];

  const finalMatch = { id: 'final', label: 'FINAL', home: 'W101', away: 'W102', slot: 'CHAMPION' };

  // 按轮次汇总团队概率
  const teamProb = {};
  (result.teams || []).forEach(t => {
    teamProb[t.slug] = {
      name: t.name,
      flag: t.flag,
      group: t.group,
      round32: t.prob.round32 || 0,
      round16: t.prob.round16 || 0,
      quarter: t.prob.quarter || 0,
      semi: t.prob.semi || 0,
      final: t.prob.final || 0,
      champion: t.prob.champion || 0,
      groupRank: t.groupRank || {},
    };
  });

  // 解析小组席位: 「1A」→ 该组最可能第1的球队, 「2D」→ 最可能第2的球队
  function resolveGroupSlot(slot) {
    const m = slot.match(/^(\d+)([A-Z])$/);
    if (!m) return null;
    const pos = parseInt(m[1]); // 1 或 2
    const grp = m[2];
    const key = pos === 1 ? 'pos1' : 'pos2';

    // 优先用 groupRank 数据（新版 Monte Carlo）
    let best = null, bestPct = 0;
    let hasGroupRank = false;
    for (const [slug, t] of Object.entries(teamProb)) {
      const gr = t.groupRank;
      const pct = gr[grp]?.[key] || 0;
      if (pct > 0) hasGroupRank = true;
      if (pct > bestPct && t.group === grp) {
        bestPct = pct;
        best = slug;
      }
    }
    if (best) return best;

    // 降级：用 round32 概率估算 — 第1名取该组 round32 最高，第2名取次高
    if (!hasGroupRank) {
      const groupTeams = Object.entries(teamProb)
        .filter(([, t]) => t.group === grp)
        .sort((a, b) => (b[1].round32 || 0) - (a[1].round32 || 0));
      if (groupTeams.length >= pos) return groupTeams[pos - 1][0];
      if (groupTeams.length > 0) return groupTeams[0][0];
    }
    return null;
  }

  // 对每个 match 解析其 home/away 席位
  function resolveMatch(m) {
    const resolved = { ...m };
    // 解析 home
    const homeTeam = resolveGroupSlot(m.home);
    if (homeTeam) { resolved.home = homeTeam; }
    // 解析 away
    const awayTeam = resolveGroupSlot(m.away);
    if (awayTeam) { resolved.away = awayTeam; }
    // 处理多组候选如 "3C/3D/3F/3G/3H" — 从候选组中取最可能晋级32强的球队
    if (m.home && m.home.includes('/') && !homeTeam) {
      const bestThird = resolveMultiSlot(m.home);
      if (bestThird) resolved.home = bestThird;
    }
    if (m.away && m.away.includes('/') && !awayTeam) {
      const bestThird = resolveMultiSlot(m.away);
      if (bestThird) resolved.away = bestThird;
    }
    return resolved;
  }

  // 解析多组候选：如 "3C/3D/3F/3G/3H" → 取这些组中 round32 概率最高的球队
  function resolveMultiSlot(slot) {
    const parts = slot.split('/');
    let best = null, bestPct = 0;
    for (const p of parts) {
      const g = p.replace(/^\d+/, ''); // "3C" → "C"
      for (const [slug, t] of Object.entries(teamProb)) {
        if (t.group === g && (t.round32 || 0) > bestPct) {
          bestPct = t.round32 || 0;
          best = slug;
        }
      }
    }
    return best;
  }

  // 解析所有比赛
  const resolved32 = round32Matches.map(resolveMatch);
  const resolved16 = round16Matches.map(resolveMatch);
  const resolvedQF = quarterMatches.map(resolveMatch);
  const resolvedSF = semiMatches.map(resolveMatch);
  const resolvedFinal = resolveMatch(finalMatch);

  return {
    groups: groupConfig,
    rounds: {
      round32: resolved32,
      round16: resolved16,
      quarter: resolvedQF,
      semi: resolvedSF,
      final: [resolvedFinal],
    },
    teams: teamProb,
    simulations: sims,
  };
}

export default async function bracketRouter(req, res) {
  try {
    const data = await buildBracketData(req.forceRefresh);
    res.json(data);
  } catch (err) {
    console.error('[Bracket]', err.message);
    res.status(500).json({ error: err.message });
  }
}
