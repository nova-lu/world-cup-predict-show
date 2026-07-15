// 淘汰赛树形图 API — 蒙特卡洛模拟版
// 用实时小组数据确定 32强，然后用 MC 概率完整模拟每轮晋级结果

const GROUP_LETTERS = 'ABCDEFGHIJKL'.split('');
const groupConfig = GROUP_LETTERS.map(g => ({ group: g, label: g + '组' }));

const round32Matches = [
  { id: 'r32-1', label: 'R32·1', home: '1A', away: '3RD_RANK:1', slot: 'W73' },
  { id: 'r32-2', label: 'R32·2', home: '2D', away: '2G', slot: 'W74' },
  { id: 'r32-3', label: 'R32·3', home: '1C', away: '2F', slot: 'W75' },
  { id: 'r32-4', label: 'R32·4', home: '2E', away: '2I', slot: 'W76' },
  { id: 'r32-5', label: 'R32·5', home: '1I', away: '3RD_RANK:2', slot: 'W77' },
  { id: 'r32-6', label: 'R32·6', home: '2A', away: '2B', slot: 'W78' },
  { id: 'r32-7', label: 'R32·7', home: '1H', away: '2J', slot: 'W79' },
  { id: 'r32-8', label: 'R32·8', home: '2K', away: '2L', slot: 'W80' },
  { id: 'r32-9', label: 'R32·9', home: '1B', away: '3RD_RANK:3', slot: 'W81' },
  { id: 'r32-10', label: 'R32·10', home: '1L', away: '3RD_RANK:4', slot: 'W82' },
  { id: 'r32-11', label: 'R32·11', home: '1G', away: '3RD_RANK:5', slot: 'W83' },
  { id: 'r32-12', label: 'R32·12', home: '1E', away: '3RD_RANK:6', slot: 'W84' },
  { id: 'r32-13', label: 'R32·13', home: '1F', away: '2C', slot: 'W85' },
  { id: 'r32-14', label: 'R32·14', home: '1D', away: '3RD_RANK:7', slot: 'W86' },
  { id: 'r32-15', label: 'R32·15', home: '1J', away: '2H', slot: 'W87' },
  { id: 'r32-16', label: 'R32·16', home: '1K', away: '3RD_RANK:8', slot: 'W88' },
];

const round16Matches = [
  { id: 'r16-1', label: 'R16·1', home: 'W78', away: 'W85', slot: 'W89' },
  { id: 'r16-2', label: 'R16·2', home: 'W77', away: 'W84', slot: 'W90' },
  { id: 'r16-3', label: 'R16·3', home: 'W75', away: 'W76', slot: 'W91' },
  { id: 'r16-4', label: 'R16·4', home: 'W73', away: 'W82', slot: 'W92' },
  { id: 'r16-5', label: 'R16·5', home: 'W79', away: 'W80', slot: 'W93' },
  { id: 'r16-6', label: 'R16·6', home: 'W83', away: 'W86', slot: 'W94' },
  { id: 'r16-7', label: 'R16·7', home: 'W74', away: 'W87', slot: 'W95' },
  { id: 'r16-8', label: 'R16·8', home: 'W81', away: 'W88', slot: 'W96' },
];

const quarterMatches = [
  { id: 'qf-1', label: 'QF·1', home: 'W90', away: 'W89', slot: 'W97' },
  { id: 'qf-2', label: 'QF·2', home: 'W93', away: 'W94', slot: 'W98' },
  { id: 'qf-3', label: 'QF·3', home: 'W91', away: 'W92', slot: 'W99' },
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
 * 优先使用真实完赛结果，未赛的比赛用 MC 概率比较
 * @param {Array} resolvedR32 - 已解析的 32 强对阵
 * @param {Object} teamProb - MC 球队晋级概率
 * @param {Object} [realResults] - 真实完赛结果 { slot: { winner, home, away, g1, g2 } }
 */
function simulateFullBracket(resolvedR32, teamProb, realResults = {}) {
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

  // 第1步：确定 R32 胜者（优先真实结果）
  const round32 = resolvedR32.map(m => {
    const real = realResults[m.slot];
    if (real && real.finished) {
      const result = { ...m, winner: real.winner, home: real.home || m.home, away: real.away || m.away,
        g1: real.g1, g2: real.g2, finished: true, simulated: false,
        winnerProb: Math.max(teamProb[real.winner]?.round16 || 0, 0) };
      matchBySlot[result.slot] = result;
      return result;
    }
    const winner = pickWinner(m.home, m.away, 0);
    const result = { ...m, winner, simulated: true, finished: false,
      winnerProb: Math.max(teamProb[winner]?.round16 || 0, 0) };
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
  // 强制禁用浏览器/中间代理缓存 - 确保实时数据
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  try {
    let roundData, teamProbData, mcSims;
    let source = 'simulated';
    let message = '';
    let realCount = 0;

    // 获取 MC 概率数据（用于未赛比赛的模拟）
    const mc = await import('../services/monteCarloService.js');
    const mcResult = await mc.runMonteCarlo(10000, req.forceRefresh || false);
    teamProbData = buildTeamProb(mcResult);
    mcSims = mcResult.simulations;

    // 获取真实比赛数据
    try {
      const { fetchAllMatches } = await import('../services/footballApi.js');
      const allMatches = await fetchAllMatches(req.forceRefresh || false);

      // 提取 R32 比赛（LAST_32）
      const r32Real = (allMatches || [])
        .filter(m => m.stage === 'LAST_32' && m.t1 && m.t2)
        .map(m => ({
          t1: m.t1, t2: m.t2,
          stage: 'round32',
          g1: m.g1, g2: m.g2,
          status: m.status,
          finished: m.status === 'FT',
          winner: m.status === 'FT' ? (m.g1 > m.g2 ? m.t1 : m.t2) : null,
        }));

      if (r32Real.length === 16) {
        console.log('[Bracket] 使用真实 R32 对阵数据');

        // 将 16 场 R32 分配到 slot W73-W88
        // 使用 bracket 结构树（2026 官方）：W78+W85→W89, W77+W84→W90, W75+W76→W91,
        // W73+W82→W92, W79+W80→W93, W83+W86→W94, W74+W87→W95, W81+W88→W96
        const slotPairs = [
          ['W78', 'W85'], ['W77', 'W84'], ['W75', 'W76'],
          ['W73', 'W82'], ['W79', 'W80'], ['W83', 'W86'],
          ['W74', 'W87'], ['W81', 'W88'],
        ];

        // 确定每个 R32 比赛在 bracket 树中的"邻居"（同一个 R16 对手）
        // 通过 real R16 matches 的已知配对来分组
        const r16Known = (allMatches || [])
          .filter(m => m.stage === 'LAST_16' && m.t1 && m.t2)
          .map(m => [m.t1, m.t2]);

        // 按已知 R16 配对将 R32 比赛分组
        const pairedGroups = [];
        const usedInGroup = new Set();

        for (const [r16a, r16b] of r16Known) {
          const group = r32Real.filter(m =>
            !usedInGroup.has(m.t1 + ':' + m.t2) &&
            (m.t1 === r16a || m.t2 === r16a || m.t1 === r16b || m.t2 === r16b)
          );
          if (group.length === 2) {
            group.forEach(m => usedInGroup.add(m.t1 + ':' + m.t2));
            pairedGroups.push(group);
          }
        }

        // 未分组的比赛单独配对
        const remaining = r32Real.filter(m => !usedInGroup.has(m.t1 + ':' + m.t2));
        for (let i = 0; i < remaining.length; i += 2) {
          if (i + 1 < remaining.length) {
            pairedGroups.push([remaining[i], remaining[i + 1]]);
          } else {
            pairedGroups.push([remaining[i]]);
          }
        }

        // 分配到 slot
        const resolvedR32 = [];
        for (let i = 0; i < Math.min(pairedGroups.length, slotPairs.length); i++) {
          const group = pairedGroups[i];
          const [slot1, slot2] = slotPairs[i];
          const labels = [`R32·${i * 2 + 1}`, `R32·${i * 2 + 2}`];

          // 每组第一场比赛 → slot1
          if (group[0]) {
            const m = group[0];
            resolvedR32.push({
              id: `r32-${i * 2 + 1}`, label: `R32·${i * 2 + 1}`,
              home: m.t1, away: m.t2, slot: slot1, stage: 'round32',
              winner: m.winner, g1: m.g1, g2: m.g2,
              finished: m.finished, resolved: true,
            });
          }

          // 每组第二场比赛 → slot2
          if (group[1]) {
            const m = group[1];
            resolvedR32.push({
              id: `r32-${i * 2 + 2}`, label: `R32·${i * 2 + 2}`,
              home: m.t1, away: m.t2, slot: slot2, stage: 'round32',
              winner: m.winner, g1: m.g1, g2: m.g2,
              finished: m.finished, resolved: true,
            });
          }
        }

        // 构建 realResults 映射供 simulateFullBracket 使用
        const realResults = {};
        for (const m of resolvedR32) {
          if (m.finished && m.winner) {
            realResults[m.slot] = {
              home: m.home, away: m.away,
              winner: m.winner, g1: m.g1, g2: m.g2,
              finished: true,
            };
          }
        }
        realCount = Object.keys(realResults).length;

        // 模拟完整淘汰赛
        roundData = simulateFullBracket(resolvedR32, teamProbData, realResults);
        source = 'simulated';
        message = `MCS模拟 · 真实R32对阵 · ${mcSims}次模拟 · ${realCount}场已完赛使用真实结果`;
      }
    } catch (realErr) {
      console.log('[Bracket] 真实比赛数据不可用:', realErr.message);
    }

    // 降级：无真实数据时用纯 MC 模拟
    if (!roundData) {
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
        const thirdRank = away.match(/^3RD_RANK:(\d+)$/i);
        if (thirdRank) {
          const rank = parseInt(thirdRank[1]);
          const sortedThirds = Object.entries(teamProbData)
            .filter(([, t]) => (t.round32 || 0) > 0)
            .sort((a, b) => (b[1].round32 || 0) - (a[1].round32 || 0));
          if (sortedThirds.length >= rank) away = sortedThirds[rank - 1][0];
        } else {
          const awayThird = away.match(/^3RD:([A-Z])$/i);
          if (awayThird) {
            const grp = awayThird[1];
            const third = Object.entries(teamProbData)
              .filter(([, t]) => t.group === grp && (t.round32 || 0) > 0)
              .sort((a, b) => (b[1].round32 || 0) - (a[1].round32 || 0));
            if (third.length > 0) away = third[0][0];
          }
        }
        return { ...m, home, away };
      });
      roundData = simulateFullBracket(simR32, teamProbData, {});
      source = 'simulated';
      message = `MCS纯模拟 · 无真实比赛数据 · ${mcSims}次模拟推算`;
    }

    // 完整真实淘汰赛结果应用
    if (roundData) {
      const { getTeamInfo, getRatings, getMatches } = await import('../services/dataService.js');
      const ratings = getRatings();
      const localMatches = getMatches(req.forceRefresh) || [];
      
      // 提取所有已完成的淘汰赛
      const finishedKnockoutMatches = localMatches.filter(m => {
        if (!(m.status === 'FT' || (m.g1 != null && m.g2 != null))) return false;
        const stage = (m.stage || '').toUpperCase().replace(/\s+/g, '_');
        const round = (m.round || '').toLowerCase();
        const isKo = ['ROUND_32', 'ROUND_16', 'QUARTER_FINAL', 'QUARTER_FINALS', 'QUARTER', 'SEMI_FINAL', 'SEMI_FINALS', 'SEMI', 'FINAL', 'LAST_32', 'LAST_16'].includes(stage) ||
                     ['round of 32', 'round of 16', 'quarter', 'semi', 'final'].some(r => round.includes(r));
        return isKo;
      });
      
      function pairKey(a, b) {
        return [a, b].sort().join(':');
      }
      
      const resultByPair = {};
      for (const m of finishedKnockoutMatches) {
        if (!m.t1 || !m.t2) continue;
        let winner = m.winner || null;
        if (!winner && m.g1 != null && m.g2 != null) {
          winner = m.g1 > m.g2 ? m.t1 : (m.g2 > m.g1 ? m.t2 : null);
        }
        resultByPair[pairKey(m.t1, m.t2)] = {
          t1: m.t1, t2: m.t2,
          g1: m.g1, g2: m.g2,
          pens1: m.pens1, pens2: m.pens2,
          winner,
          loser: winner ? (winner === m.t1 ? m.t2 : m.t1) : null,
          stage: m.stage,
        };
      }
      
      // 构建胜者追踪映射：slot → winner
      const slotWinnerMap = {};
      
      // 先修正 R16 对阵和结果
      const r16 = roundData.round16 || [];
      for (let i = 0; i < r16.length; i++) {
        const m = r16[i];
        if (!m.home || !m.away) continue;
        
        const key = pairKey(m.home, m.away);
        const result = resultByPair[key];
        
        if (result) {
          // 修正比分方向
          if (result.t1 === m.home) {
            m.g1 = result.g1;
            m.g2 = result.g2;
          } else {
            m.g1 = result.g2;
            m.g2 = result.g1;
          }
          
          m.winner = result.winner;
          m.finished = true;
          m.simulated = false;
          
          // 记录 slot 胜者
          if (m.slot && m.winner) {
            slotWinnerMap[m.slot] = m.winner;
          }
        }
      }
      
      // 修正 QF 对阵和结果
      const qf = roundData.quarter || [];
      const qfSlotMapping = {
        'W97': ['W89', 'W90'], // R16 winner 1 vs R16 winner 2
        'W98': ['W93', 'W94'], // R16 winner 5 vs R16 winner 6
        'W99': ['W91', 'W92'], // R16 winner 3 vs R16 winner 4
        'W100': ['W95', 'W96'], // R16 winner 7 vs R16 winner 8
      };
      
      // 先根据 R16 胜者修正 QF 对阵
      for (const m of qf) {
        const sourceSlots = qfSlotMapping[m.slot];
        if (sourceSlots) {
          const homeFromSlot = slotWinnerMap[sourceSlots[0]];
          const awayFromSlot = slotWinnerMap[sourceSlots[1]];
          if (homeFromSlot) {
            m.home = homeFromSlot;
            m.homeInfo = null;
          }
          if (awayFromSlot) {
            m.away = awayFromSlot;
            m.awayInfo = null;
          }
        }
        
        // 然后应用 QF 结果
        if (m.home && m.away) {
          const key = pairKey(m.home, m.away);
          const result = resultByPair[key];
          if (result) {
            if (result.t1 === m.home) {
              m.g1 = result.g1;
              m.g2 = result.g2;
            } else {
              m.g1 = result.g2;
              m.g2 = result.g1;
            }
            m.winner = result.winner;
            m.finished = true;
            m.simulated = false;
            
            if (m.slot && m.winner) {
              slotWinnerMap[m.slot] = m.winner;
            }
          }
        }
      }
      
      // 对无真实结果的 QF 比赛，用已修正球队重新计算胜者
      const probKeys = ['round16', 'quarter', 'semi', 'final', 'champion'];
      function rePickWinner(homeSlug, awaySlug, roundIdx) {
        if (!homeSlug || !awaySlug) return homeSlug || awaySlug;
        const key = probKeys[roundIdx] || 'champion';
        const hp = teamProbData[homeSlug]?.[key] || 0;
        const ap = teamProbData[awaySlug]?.[key] || 0;
        return hp >= ap ? homeSlug : awaySlug;
      }
      for (const m of qf) {
        if (m.winner && m.home && m.away && !m.finished) {
          // 胜者不在当前球队中 → 必然需要重新计算
          if (m.winner !== m.home && m.winner !== m.away) {
            m.winner = rePickWinner(m.home, m.away, 2);
            m.winnerProb = Math.max(teamProbData[m.winner]?.semi || 0, 0);
          }
          if (m.slot && m.winner) {
            slotWinnerMap[m.slot] = m.winner;
          }
        }
      }
      
      // 修正 SF 对阵（根据 QF 胜者）
      const sf = roundData.semi || [];
      const sfSlotMapping = {
        'W101': ['W97', 'W98'],
        'W102': ['W99', 'W100'],
      };
      
      for (const m of sf) {
        const sourceSlots = sfSlotMapping[m.slot];
        if (sourceSlots) {
          const homeFromSlot = slotWinnerMap[sourceSlots[0]];
          const awayFromSlot = slotWinnerMap[sourceSlots[1]];
          if (homeFromSlot) {
            m.home = homeFromSlot;
            m.homeInfo = null;
          }
          if (awayFromSlot) {
            m.away = awayFromSlot;
            m.awayInfo = null;
          }
        }
      }
      
      // === 对 SF 应用真实结果 ===
      for (const m of sf) {
        if (m.home && m.away && !m.home.startsWith('W') && !m.away.startsWith('W')) {
          const key = pairKey(m.home, m.away);
          const result = resultByPair[key];
          if (result) {
            if (result.t1 === m.home) { m.g1 = result.g1; m.g2 = result.g2; }
            else { m.g1 = result.g2; m.g2 = result.g1; }
            m.winner = result.winner;
            m.loser = result.loser || (result.winner ? (result.winner === m.home ? m.away : m.home) : null);
            m.finished = true;
            m.simulated = false;
            m.winnerProb = Math.max(teamProbData[m.winner]?.final || 0, 0);
            if (m.slot) slotWinnerMap[m.slot] = m.winner;
            console.log('[Bracket] SF real result applied:', m.slot, m.winner, m.g1 + '-' + m.g2);
          }
        }
      }
      
      // 对无真实结果的 SF 重新计算胜者
      for (const m of sf) {
        if (!m.finished && m.home && m.away && !m.home.startsWith('W') && !m.away.startsWith('W')) {
          m.winner = rePickWinner(m.home, m.away, 3);
          m.winnerProb = Math.max(teamProbData[m.winner]?.final || 0, 0);
          if (m.slot) slotWinnerMap[m.slot] = m.winner;
        }
      }
      
      // 修正决赛对阵（根据 SF 胜者）
      const final_ = roundData.final || [];
      for (const m of final_) {
        // final slots = W101 vs W102
        const homeFromSlot = slotWinnerMap['W101'];
        const awayFromSlot = slotWinnerMap['W102'];
        if (homeFromSlot) {
          m.home = homeFromSlot;
          m.homeInfo = null;
        }
        if (awayFromSlot) {
          m.away = awayFromSlot;
          m.awayInfo = null;
        }
      }
      
      // === 对 Final 应用真实结果 ===
      for (const m of final_) {
        if (m.home && m.away && !m.home.startsWith('W') && !m.away.startsWith('W')) {
          const key = pairKey(m.home, m.away);
          const result = resultByPair[key];
          if (result) {
            if (result.t1 === m.home) { m.g1 = result.g1; m.g2 = result.g2; }
            else { m.g1 = result.g2; m.g2 = result.g1; }
            m.winner = result.winner;
            m.finished = true;
            m.simulated = false;
            m.winnerProb = 100;
            if (m.slot) slotWinnerMap[m.slot] = m.winner;
            console.log('[Bracket] Final real result applied:', m.winner, m.g1 + '-' + m.g2);
          }
        }
      }
      
      // 对无真实结果的 Final 重新计算胜者
      for (const m of final_) {
        if (!m.finished && m.home && m.away && !m.home.startsWith('W') && !m.away.startsWith('W')) {
          m.winner = rePickWinner(m.home, m.away, 4);
          m.winnerProb = Math.max(teamProbData[m.winner]?.champion || 0, 0);
          if (m.slot) slotWinnerMap[m.slot] = m.winner;
        }
      }
      
      // 补全所有 teamInfo
      for (const stageMatches of [r16, qf, sf, final_]) {
        for (const m of stageMatches) {
          if (m.home && !m.homeInfo && !m.home.startsWith('W')) {
            const info = getTeamInfo(m.home);
            m.homeInfo = info ? { ...info, elo: ratings[m.home] || 1500 } : null;
          }
          if (m.away && !m.awayInfo && !m.away.startsWith('W')) {
            const info = getTeamInfo(m.away);
            m.awayInfo = info ? { ...info, elo: ratings[m.away] || 1500 } : null;
          }
        }
      }
      
      if (Object.keys(slotWinnerMap).length > 0) {
        source = 'corrected';
        message = `MCS模拟 · 真实淘汰赛结果应用(R16/QF/SF已更新) · ${mcSims}次模拟`;
        console.log('[Bracket] 淘汰赛结果修正完成:', Object.keys(slotWinnerMap).length, '场比赛结果已应用');
      }
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
