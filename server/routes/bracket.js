// 淘汰赛树形图 API — 蒙特卡洛模拟版
// 用实时小组数据确定 32强，然后用 MC 概率完整模拟每轮晋级结果

const GROUP_LETTERS = 'ABCDEFGHIJKL'.split('');
const groupConfig = GROUP_LETTERS.map(g => ({ group: g, label: g + '组' }));

const round32Matches = [
  { id: 'r32-1', label: 'R32·1', home: '1A', away: '3RD:E', slot: 'W73' },
  { id: 'r32-2', label: 'R32·2', home: '2D', away: '2G', slot: 'W74' },
  { id: 'r32-3', label: 'R32·3', home: '1C', away: '2F', slot: 'W75' },
  { id: 'r32-4', label: 'R32·4', home: '2E', away: '2I', slot: 'W76' },
  { id: 'r32-5', label: 'R32·5', home: '1I', away: '3RD:F', slot: 'W77' },
  { id: 'r32-6', label: 'R32·6', home: '2A', away: '2B', slot: 'W78' },
  { id: 'r32-7', label: 'R32·7', home: '1H', away: '2J', slot: 'W79' },
  { id: 'r32-8', label: 'R32·8', home: '2K', away: '2L', slot: 'W80' },
  { id: 'r32-9', label: 'R32·9', home: '1B', away: '3RD:J', slot: 'W81' },
  { id: 'r32-10', label: 'R32·10', home: '1L', away: '3RD:K', slot: 'W82' },
  { id: 'r32-11', label: 'R32·11', home: '1G', away: '3RD:I', slot: 'W83' },
  { id: 'r32-12', label: 'R32·12', home: '1E', away: '3RD:D', slot: 'W84' },
  { id: 'r32-13', label: 'R32·13', home: '1F', away: '2C', slot: 'W85' },
  { id: 'r32-14', label: 'R32·14', home: '1D', away: '3RD:B', slot: 'W86' },
  { id: 'r32-15', label: 'R32·15', home: '1J', away: '2H', slot: 'W87' },
  { id: 'r32-16', label: 'R32·16', home: '1K', away: '3RD:L', slot: 'W88' },
];

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

// 按轮次汇总团队概率（蒙特卡洛数据）
function buildTeamProb(result) {
  const teamProb = {};
  (result.teams || []).forEach(t => {
    teamProb[t.slug] = {
      name: t.name, flag: t.flag, flagPath: t.flagPath, color: t.color, group: t.group,
      round32: t.prob.round32 || 0, round16: t.prob.round16 || 0,
      quarter: t.prob.quarter || 0, semi: t.prob.semi || 0,
      final: t.prob.final || 0, champion: t.prob.champion || 0,
      groupRank: t.groupRank || {},
    };
  });
  return teamProb;
}

/**
 * 用 MC 概率模拟完整淘汰赛树
 * 逐个轮次解析：R32胜者→R16→QF→SF→决赛
 */
function simulateFullBracket(resolvedR32, teamProb) {
  const matchBySlot = {};

  // 晋级概率键
  const probKeys = ['round16', 'quarter', 'semi', 'final', 'champion'];

  function pickWinner(homeSlug, awaySlug, nextRoundIdx) {
    if (!homeSlug || !awaySlug) return (homeSlug || awaySlug);
    const key = probKeys[nextRoundIdx] || 'champion';
    const hp = teamProb[homeSlug]?.[key] || 0;
    const ap = teamProb[awaySlug]?.[key] || 0;
    return hp >= ap ? homeSlug : awaySlug;
  }

  // 第1步：确定 R32 胜者（比 round16 概率）
  const round32 = resolvedR32.map(m => {
    const winner = pickWinner(m.home, m.away, 0);
    const result = { ...m, winner, simulated: true, winnerProb: Math.max(teamProb[winner]?.round16 || 0, 0) };
    matchBySlot[result.slot] = result;
    return result;
  });

  // 第2步：用 R32 胜者解析 R16（比 quarter 概率）
  const round16 = round16Matches.map(tmpl => {
    const homeSlug = matchBySlot[tmpl.home]?.winner;
    const awaySlug = matchBySlot[tmpl.away]?.winner;
    const winner = pickWinner(homeSlug, awaySlug, 1);
    const match = { ...tmpl, home: homeSlug, away: awaySlug, winner, simulated: true,
      winnerProb: Math.max(teamProb[winner]?.quarter || 0, 0) };
    matchBySlot[match.slot] = match;
    return match;
  });

  // 第3步：用 R16 胜者解析 QF（比 semi 概率）
  const quarter = quarterMatches.map(tmpl => {
    const homeSlug = matchBySlot[tmpl.home]?.winner;
    const awaySlug = matchBySlot[tmpl.away]?.winner;
    const winner = pickWinner(homeSlug, awaySlug, 2);
    const match = { ...tmpl, home: homeSlug, away: awaySlug, winner, simulated: true,
      winnerProb: Math.max(teamProb[winner]?.semi || 0, 0) };
    matchBySlot[match.slot] = match;
    return match;
  });

  // 第4步：用 QF 胜者解析 SF（比 final 概率）
  const semi = semiMatches.map(tmpl => {
    const homeSlug = matchBySlot[tmpl.home]?.winner;
    const awaySlug = matchBySlot[tmpl.away]?.winner;
    const winner = pickWinner(homeSlug, awaySlug, 3);
    const match = { ...tmpl, home: homeSlug, away: awaySlug, winner, simulated: true,
      winnerProb: Math.max(teamProb[winner]?.final || 0, 0) };
    matchBySlot[match.slot] = match;
    return match;
  });

  // 第5步：用 SF 胜者解析决赛（比 champion 概率）
  const final_ = (() => {
    const tmpl = finalMatch;
    const homeSlug = matchBySlot[tmpl.home]?.winner;
    const awaySlug = matchBySlot[tmpl.away]?.winner;
    const winner = pickWinner(homeSlug, awaySlug, 4);
    const match = { ...tmpl, home: homeSlug, away: awaySlug, winner, simulated: true,
      winnerProb: Math.max(teamProb[winner]?.champion || 0, 0) };
    matchBySlot[match.slot] = match;
    return [match];
  })();

  return { round32, round16, quarter, semi, final: final_ };
}

// ===== 主路由 =====
export default async function bracketRouter(req, res) {
  try {
    let roundData, teamProbData, mcSims;
    let source = 'simulated';
    let message = '';

    // 尝试获取实时小组数据
    try {
      const { resolveKnockoutQualifiers, mapBracketSlots } = await import('../services/groupResolver.js');
      const qualifiers = await resolveKnockoutQualifiers(req.forceRefresh);
      const groupCount = Object.keys(qualifiers.groups || {}).length;

      if (groupCount >= 12 && qualifiers.totalQualified >= 32) {
        // 确定真实 32强
        const resolvedR32 = mapBracketSlots(round32Matches, qualifiers.groups, qualifiers.thirdPlaces);

        // 获取 MC 概率数据
        const mc = await import('../services/monteCarloService.js');
        const mcResult = await mc.runMonteCarlo(10000, false);
        teamProbData = buildTeamProb(mcResult);
        mcSims = mcResult.simulations;

        // 完整模拟淘汰赛
        roundData = simulateFullBracket(resolvedR32, teamProbData);

        source = 'simulated';
        message = `MCS模拟 · 32强基于实时小组数据 · ${mcSims}次模拟晋级路径`;
      }
    } catch (realErr) {
      console.log('[Bracket] 真实数据不可用:', realErr.message);
    }

    // 降级：纯 MC 模拟
    if (!roundData) {
      const mc = await import('../services/monteCarloService.js');
      const mcResult = await mc.runMonteCarlo(10000, req.forceRefresh);
      teamProbData = buildTeamProb(mcResult);
      mcSims = mcResult.simulations;

      const simR32 = round32Matches.map(m => {
        let home = m.home, away = m.away;
        const homeGrp = home.match(/^(\d+)([A-Z])$/);
        const awayGrp = away.match(/^(\d+)([A-Z])$/);
        if (homeGrp) {
          const pos = parseInt(homeGrp[1]), grp = homeGrp[2];
          const cs = Object.entries(teamProbData)
            .filter(([, t]) => t.group === grp)
            .sort((a, b) => (b[1].round32 || 0) - (a[1].round32 || 0));
          if (cs.length >= pos) home = cs[pos - 1][0];
        }
        if (awayGrp) {
          const pos = parseInt(awayGrp[1]), grp = awayGrp[2];
          const cs = Object.entries(teamProbData)
            .filter(([, t]) => t.group === grp)
            .sort((a, b) => (b[1].round32 || 0) - (a[1].round32 || 0));
          if (cs.length >= pos) away = cs[pos - 1][0];
        }
        const awayThird = away.match(/^3RD:([A-Z])$/i);
        if (awayThird) {
          const grp = awayThird[1];
          const third = Object.entries(teamProbData)
            .filter(([, t]) => t.group === grp && (t.round32 || 0) > 0)
            .sort((a, b) => (b[1].round32 || 0) - (a[1].round32 || 0));
          if (third.length > 0) away = third[0][0];
        }
        return { ...m, home, away };
      });

      roundData = simulateFullBracket(simR32, teamProbData);
      source = 'simulated';
      message = `MCS纯模拟 · 无实时数据 · ${mcSims}次模拟推算`;
    }

    res.json({
      groups: groupConfig,
      rounds: roundData,
      teams: teamProbData,
      simulations: mcSims,
      source,
      message,
    });
  } catch (err) {
    console.error('[Bracket]', err.message);
    res.status(500).json({ error: err.message });
  }
}
