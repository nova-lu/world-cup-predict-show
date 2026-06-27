// 蒙特卡洛模拟服务 —— 完整淘汰赛模拟
// 数据来源：football-data.org API（优先）→ 本地静态数据（降级）
import { sampleMatch, matchProb } from './elo-model.mjs';
import { getRatings, getTeamInfo, getMatches as getStaticMatches } from './dataService.js';
import { get, set } from '../middleware/cache.js';

const HOME_BONUS = 75;
const HOSTS = new Set(['mexico', 'usa', 'canada']);

function getRating(slug) {
  const ratings = getRatings();
  return ratings[slug] ?? 1500;
}

function isFinished(m) {
  return m.status === 'FT' || (m.g1 != null && m.g2 != null);
}

// ===== 获取比赛数据（API 优先） =====
async function getMatchesData() {
  try {
    const { fetchAllMatches } = await import('./footballApi.js');
    const matches = await fetchAllMatches();
    if (matches && matches.length > 0) return matches;
  } catch {}
  const { getMatches } = await import('./dataService.js');
  return getMatches();
}

// ===== 单场淘汰赛模拟 =====
function simulateKnockout(slugA, slugB, rng) {
  const rA = getRating(slugA);
  const rB = getRating(slugB);
  // 淘汰赛无平局
  let { goalsA, goalsB } = sampleMatch(rA, rB, 0, false, rng);
  return { winner: goalsA > goalsB ? slugA : slugB, loser: goalsA > goalsB ? slugB : slugA, g1: goalsA, g2: goalsB };
}

// ===== 运行一次完整锦标赛模拟 =====
function simulateTournament(matches, rng) {
  // 1. 小组赛阶段
  const standings = {};
  const groupMatches = matches.filter(m => m.stage === 'GROUP_STAGE' || m.group);

  for (const m of groupMatches) {
    if (!m.group) continue;
    const g = m.group;
    if (!standings[g]) standings[g] = {};
    if (!standings[g][m.t1]) standings[g][m.t1] = { slug: m.t1, pts: 0, gd: 0, gf: 0, ga: 0, w: 0, d: 0, l: 0 };
    if (!standings[g][m.t2]) standings[g][m.t2] = { slug: m.t2, pts: 0, gd: 0, gf: 0, ga: 0, w: 0, d: 0, l: 0 };

    let g1, g2;
    if (isFinished(m)) {
      g1 = m.g1; g2 = m.g2;
    } else {
      const rHome = getRating(m.t1), rAway = getRating(m.t2);
      const hb = HOSTS.has(m.t1) ? HOME_BONUS / 2 : 0;
      const sim = sampleMatch(rHome, rAway, hb, true, rng);
      g1 = sim.goalsA; g2 = sim.goalsB;
    }

    const s1 = standings[g][m.t1], s2 = standings[g][m.t2];
    s1.gf += g1; s1.ga += g2; s1.gd += (g1 - g2);
    s2.gf += g2; s2.ga += g1; s2.gd += (g2 - g1);
    if (g1 > g2) { s1.pts += 3; s1.w++; s2.l++; }
    else if (g1 < g2) { s2.pts += 3; s2.w++; s1.l++; }
    else { s1.pts += 1; s2.pts += 1; s1.d++; s2.d++; }
  }

  // 小组排名 → 前 2 + 4 个最佳第三 → 32 强
  const qualified = [];
  const thirdPlace = [];

  for (const [g, teams] of Object.entries(standings)) {
    const sorted = Object.values(teams).sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd !== a.gd) return b.gd - a.gd;
      return b.gf - a.gf;
    });
    if (sorted.length >= 2) {
      qualified.push({ ...sorted[0], group: g, rank: 1 });
      qualified.push({ ...sorted[1], group: g, rank: 2 });
    }
    if (sorted.length >= 3) {
      thirdPlace.push({ ...sorted[2], group: g, rank: 3 });
    }
  }

  // 4 个最佳第三名
  thirdPlace.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  const bestThirds = thirdPlace.slice(0, 4);
  qualified.push(...bestThirds);

  // 2. LAST_32 → LAST_16 → QF → SF → FINAL
  // 2026格式：32队淘汰赛（小组前2=24 + 最佳第三=8，实际是32队）
  // 对阵方式：简化版 — 按种子排名配对
  const knockoutTeams = qualified.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);

  // 每一轮的对阵（32 → 16 → 8 → 4 → 2 → 1）
  let remaining = knockoutTeams.map(t => t.slug);
  const results = {
    round32: [],
    round16: [],
    quarter: [],
    semi: [],
    final: null,
    third: null,
    champion: null,
  };

  // LAST_32
  const nextRound32 = [];
  for (let i = 0; i < remaining.length; i += 2) {
    if (i + 1 >= remaining.length) { nextRound32.push(remaining[i]); break; }
    const sim = simulateKnockout(remaining[i], remaining[i + 1], rng);
    results.round32.push({ t1: remaining[i], t2: remaining[i + 1], ...sim });
    nextRound32.push(sim.winner);
  }
  remaining = nextRound32;

  // LAST_16
  const nextRound16 = [];
  for (let i = 0; i < remaining.length; i += 2) {
    if (i + 1 >= remaining.length) { nextRound16.push(remaining[i]); break; }
    const sim = simulateKnockout(remaining[i], remaining[i + 1], rng);
    results.round16.push({ t1: remaining[i], t2: remaining[i + 1], ...sim });
    nextRound16.push(sim.winner);
  }
  remaining = nextRound16;

  // QF
  const nextQF = [];
  for (let i = 0; i < remaining.length; i += 2) {
    if (i + 1 >= remaining.length) { nextQF.push(remaining[i]); break; }
    const sim = simulateKnockout(remaining[i], remaining[i + 1], rng);
    results.quarter.push({ t1: remaining[i], t2: remaining[i + 1], ...sim });
    nextQF.push(sim.winner);
  }
  remaining = nextQF;

  // SF
  const nextSF = [];
  for (let i = 0; i < remaining.length; i += 2) {
    const sim = simulateKnockout(remaining[i], remaining[i + 1], rng);
    results.semi.push({ t1: remaining[i], t2: remaining[i + 1], ...sim });
    nextSF.push(sim.winner);
  }
  remaining = nextSF;

  // FINAL (第1 vs 第2)
  if (remaining.length >= 2) {
    const sim = simulateKnockout(remaining[0], remaining[1], rng);
    results.final = { t1: remaining[0], t2: remaining[1], ...sim };
    results.champion = sim.winner;
  } else if (remaining.length === 1) {
    results.champion = remaining[0];
  }

  // 返回小组排名信息
  results.groupStandings = standings;
  return results;
}

// ===== 主入口：N 次蒙特卡洛模拟 =====
export function runMonteCarlo(numSims = 5000, force = false) {
  const cacheKey = `mc:full:${numSims}`;
  const cached = get(cacheKey, { force });
  if (cached.hit) return cached.value;

  // 使用 dataService 获取静态比赛数据
  const matches = getStaticMatches();
  const allTeams = Object.keys(getRatings());

  const counts = {};
  // 小组排名追踪 (每组1/2名)
  const groupRankCounts = {};

  for (const slug of allTeams) {
    counts[slug] = { champion: 0, final: 0, semi: 0, quarter: 0, round16: 0, round32: 0 };
    groupRankCounts[slug] = {};
  }

  const start = Date.now();
  for (let i = 0; i < numSims; i++) {
    const rng = () => Math.random();
    const result = simulateTournament(matches, rng);

    // 统计小组排名: standings 是 {A: {slug1: {slug, pts,...}}} 结构，需排序
    if (result.groupStandings) {
      for (const [g, teamsObj] of Object.entries(result.groupStandings)) {
        // 移除 "Group " 前缀，与球队信息中的 group 字段一致
        const groupKey = g.replace(/^Group\s+/i, '');
        const sorted = Object.values(teamsObj).sort((a, b) => {
          if (b.pts !== a.pts) return b.pts - a.pts;
          if (b.gd !== a.gd) return b.gd - a.gd;
          return b.gf - a.gf;
        });
        sorted.forEach((entry, idx) => {
          const slug = entry.slug;
          if (!groupRankCounts[slug]) groupRankCounts[slug] = {};
          if (!groupRankCounts[slug][groupKey]) groupRankCounts[slug][groupKey] = { pos1: 0, pos2: 0 };
          if (idx === 0) groupRankCounts[slug][groupKey].pos1++;
          if (idx === 1) groupRankCounts[slug][groupKey].pos2++;
        });
      }
    }

    // 统计各阶段
    const track = new Set();

    // 冠军
    if (result.champion && counts[result.champion]) {
      counts[result.champion].champion++;
      counts[result.champion].final++;
      counts[result.champion].semi++;
      counts[result.champion].quarter++;
      counts[result.champion].round16++;
      counts[result.champion].round32++;
      track.add(result.champion);
    }

    // 决赛
    if (result.final) {
      const losers = [result.final.t1, result.final.t2].filter(s => s !== result.champion);
      for (const s of losers) {
        if (s && counts[s] && !track.has(s)) {
          counts[s].final++; counts[s].semi++; counts[s].quarter++;
          counts[s].round16++; counts[s].round32++;
          track.add(s);
        }
      }
    }

    // 半决赛
    for (const s of result.semi) {
      const losers = [s.t1, s.t2].filter(slug => slug !== result.champion && (!result.final || (slug !== result.final.t1 && slug !== result.final.t2)));
      for (const slug of [s.t1, s.t2]) {
        if (slug && counts[slug] && !track.has(slug) && !losers.includes(slug)) {
          counts[slug].semi++; counts[slug].quarter++;
          counts[slug].round16++; counts[slug].round32++;
          track.add(slug);
        }
      }
      // semi losers
      if (s.loser && counts[s.loser] && !track.has(s.loser)) {
        counts[s.loser].semi++; counts[s.loser].quarter++;
        counts[s.loser].round16++; counts[s.loser].round32++;
        track.add(s.loser);
      }
    }

    // 8强
    for (const s of result.quarter) {
      for (const slug of [s.t1, s.t2, s.loser]) {
        if (slug && counts[slug] && !track.has(slug)) {
          counts[slug].quarter++; counts[slug].round16++; counts[slug].round32++;
          track.add(slug);
        }
      }
    }

    // 16强
    for (const s of result.round16) {
      for (const slug of [s.t1, s.t2, s.loser]) {
        if (slug && counts[slug] && !track.has(slug)) {
          counts[slug].round16++; counts[slug].round32++;
          track.add(slug);
        }
      }
    }

    // 32强
    for (const s of result.round32) {
      for (const slug of [s.t1, s.t2, s.winner]) {
        if (slug && counts[slug] && !track.has(slug)) {
          counts[slug].round32++;
          track.add(slug);
        }
      }
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  // 转为概率百分比
  const teams = allTeams
    .filter(slug => counts[slug] && getTeamInfo(slug).group) // 只显示 48 支参赛队
    .map(slug => {
      const info = getTeamInfo(slug);
      return {
        slug,
        group: info?.group || null,
        flag: info?.flag || '⚽',
        name: info?.name || slug,
        nameEn: info?.nameEn || slug,
        elo: getRating(slug),
        prob: {
          round32: +((counts[slug].round32 / numSims) * 100).toFixed(1),
          round16: +((counts[slug].round16 / numSims) * 100).toFixed(1),
          quarter: +((counts[slug].quarter / numSims) * 100).toFixed(1),
          semi: +((counts[slug].semi / numSims) * 100).toFixed(1),
          final: +((counts[slug].final / numSims) * 100).toFixed(1),
          champion: +((counts[slug].champion / numSims) * 100).toFixed(1),
        },
        // 小组排名概率: 每组第1/第2占比
        groupRank: (() => {
          const gr = {};
          for (const [g, r] of Object.entries(groupRankCounts[slug] || {})) {
            gr[g] = {
              pos1: +((r.pos1 / numSims) * 100).toFixed(1),
              pos2: +((r.pos2 / numSims) * 100).toFixed(1),
            };
          }
          return gr;
        })(),
      };
    })
    .sort((a, b) => b.prob.champion - a.prob.champion);

  const output = {
    generatedAt: new Date().toISOString(),
    simulations: numSims,
    elapsed: `${elapsed}s`,
    teams,
  };

  // 设置缓存
  set(cacheKey, output, { source: 'computed', ttlMs: 1800000 });
  console.log(`[MonteCarlo] ${numSims} 次模拟完成，耗时 ${elapsed}s`);
  return output;
}

// 不再需要 require_or_static，使用 dataService.getMatches
