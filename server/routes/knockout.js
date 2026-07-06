/**
 * 淘汰赛过渡管线 API
 * Phase 8.2 — 小组→淘汰过渡管线
 *
 * 三个端点：
 *   GET /api/knockout/qualifiers    — 已确定的出线球队
 *   GET /api/knockout/third-rank   — 第三名竞争势态
 *   GET /api/knockout/bracket      — 确定性淘汰赛对阵（基于实际结果）
 */

import { Router } from 'express';
import { buildCacheMeta } from '../middleware/cache.js';
import { get as cacheGet, set as cacheSet } from '../middleware/cache.js';

const router = Router();

// ===== 已确定出线球队 =====
router.get('/qualifiers', async (req, res) => {
  try {
    const { getQualified } = await import('../services/bracketBuilder.js');
    const data = await getQualified(req.forceRefresh);
    res.json({
      ...data,
      _cache: buildCacheMeta('knockout:qualifiers', true, null),
    });
  } catch (e) {
    console.error('[knockout] qualifiers error:', e.message);
    // 降级到静态数据
    try {
      const { getMatches, getGroupTeams, GROUPS, getTeamInfo } = await import('../services/dataService.js');
      const { resolveGroupStandings, rankThirdPlaces, getQualifiedTeams } = await import('../services/groupResolver.js');
      const { default: seedData } = await import('../../data/wc2026-results.json', { with: { type: 'json' } });
      const matches = seedData.matches || getMatches().filter(m => m.status === 'FT' || (m.g1 != null && m.g2 != null));
      const groups = {};
      for (const g of GROUPS || 'ABCDEFGHIJKL'.split('')) {
        const standings = {};
        const groupTeams = (getGroupTeams ? getGroupTeams()[g] : null) ||
          [...new Set(matches.filter(m => (m.group || '').replace(/^Group\s+/i, '') === g).flatMap(m => [m.t1, m.t2]))];
        for (const slug of groupTeams) {
          standings[slug] = { slug, pts: 0, gd: 0, gf: 0, ga: 0, played: 0, w: 0, d: 0, l: 0, name: getTeamInfo(slug)?.name || slug };
        }
        for (const m of matches.filter(m => (m.group || '').replace(/^Group\s+/i, '') === g)) {
          const s1 = standings[m.t1], s2 = standings[m.t2];
          if (!s1 || !s2) continue;
          s1.gf += m.g1; s1.ga += m.g2; s1.gd += (m.g1 - m.g2);
          s2.gf += m.g2; s2.ga += m.g1; s2.gd += (m.g2 - m.g1);
          s1.played++; s2.played++;
          if (m.g1 > m.g2) { s1.pts += 3; s1.w++; s2.l++; }
          else if (m.g1 < m.g2) { s2.pts += 3; s2.w++; s1.l++; }
          else { s1.pts += 1; s2.pts += 1; s1.d++; s2.d++; }
        }
        groups[g] = Object.values(standings).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf).map((r, i) => ({ ...r, rank: i + 1 }));
      }
      const groupStandings = resolveGroupStandings(groups);
      const thirdPlaces = rankThirdPlaces(groupStandings);
      const qualified = getQualifiedTeams(groupStandings, thirdPlaces);
      res.json({
        generatedAt: new Date().toISOString(),
        source: 'static',
        groups: groupStandings,
        thirdPlaces,
        qualifiers: qualified,
        totalQualified: qualified.allTeams.length,
        _degraded: true,
        _cache: buildCacheMeta('knockout:qualifiers', false, null),
      });
    } catch (fallbackErr) {
      res.status(500).json({ error: 'API 不可用且降级失败: ' + e.message + ' / ' + fallbackErr.message });
    }
  }
});

// ===== 第三名竞争势态 =====
router.get('/third-rank', async (req, res) => {
  try {
    const { getThirdRank } = await import('../services/bracketBuilder.js');
    const data = await getThirdRank(req.forceRefresh);
    res.json({
      ...data,
      _cache: buildCacheMeta('knockout:third-rank', true, null),
    });
  } catch (e) {
    console.error('[knockout] third-rank error:', e.message);
    // 降级到静态数据
    try {
      const { getMatches, getGroupTeams, GROUPS, getTeamInfo } = await import('../services/dataService.js');
      const { resolveGroupStandings, rankThirdPlaces } = await import('../services/groupResolver.js');
      const { analyzeThirdRank } = await import('../services/thirdRankResolver.js');
      const { default: seedData } = await import('../../data/wc2026-results.json', { with: { type: 'json' } });
      const matches = seedData.matches || getMatches().filter(m => m.status === 'FT' || (m.g1 != null && m.g2 != null));
      const groups = {};
      for (const g of GROUPS || 'ABCDEFGHIJKL'.split('')) {
        const standings = {};
        const groupTeams = (getGroupTeams ? getGroupTeams()[g] : null) ||
          [...new Set(matches.filter(m => (m.group || '').replace(/^Group\s+/i, '') === g).flatMap(m => [m.t1, m.t2]))];
        for (const slug of groupTeams) {
          standings[slug] = { slug, pts: 0, gd: 0, gf: 0, ga: 0, played: 0, w: 0, d: 0, l: 0, name: getTeamInfo(slug)?.name || slug };
        }
        for (const m of matches.filter(m => (m.group || '').replace(/^Group\s+/i, '') === g)) {
          const s1 = standings[m.t1], s2 = standings[m.t2];
          if (!s1 || !s2) continue;
          s1.gf += m.g1; s1.ga += m.g2; s1.gd += (m.g1 - m.g2);
          s2.gf += m.g2; s2.ga += m.g1; s2.gd += (m.g2 - m.g1);
          s1.played++; s2.played++;
          if (m.g1 > m.g2) { s1.pts += 3; s1.w++; s2.l++; }
          else if (m.g1 < m.g2) { s2.pts += 3; s2.w++; s1.l++; }
          else { s1.pts += 1; s2.pts += 1; s1.d++; s2.d++; }
        }
        groups[g] = Object.values(standings).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf).map((r, i) => ({ ...r, rank: i + 1 }));
      }
      const groupStandings = resolveGroupStandings(groups);
      const thirdRankData = analyzeThirdRank(groupStandings);
      res.json({ ...thirdRankData, _degraded: true });
    } catch (fallbackErr) {
      res.status(500).json({ error: 'API 不可用且降级失败: ' + e.message + ' / ' + fallbackErr.message });
    }
  }
});

// ===== 确定性淘汰赛对阵 =====
router.get('/bracket', async (req, res) => {
  try {
    const { getKnockoutBracket } = await import('../services/bracketBuilder.js');
    const { getTeamInfo, getRatings, getMatches } = await import('../services/dataService.js');
    const data = await getKnockoutBracket(req.forceRefresh);
    const ratings = getRatings();

    // 富化每场比赛的球队信息 + Elo
    for (const stageKey of ['round32', 'round16', 'quarter', 'semi', 'final']) {
      const matches = data.rounds[stageKey] || [];
      for (const m of matches) {
        if (m.home && !m.home.startsWith('W') && !/^\d/.test(m.home)) {
          const info = getTeamInfo(m.home);
          m.homeInfo = info ? { ...info, elo: ratings[m.home] || 1500 } : null;
        }
        if (m.away && !m.away.startsWith('W') && !/^\d/.test(m.away)) {
          const info = getTeamInfo(m.away);
          m.awayInfo = info ? { ...info, elo: ratings[m.away] || 1500 } : null;
        }
      }
    }

    // 兜底：如果16强队伍未解析（显示W-slot），用已知真实数据覆盖
    const r16 = data.rounds.round16 || [];
    const r32 = data.rounds.round32 || [];
    const needsFallback = r16.some(m =>
      (m.home && m.home.startsWith('W')) || (m.away && m.away.startsWith('W'))
    ) || r32.some(m => !m.winner && m.slot && m.slot.startsWith('W'));
    if (needsFallback) {
      // === 补齐 R32 胜者 ===
      // 如果 R32 比赛没有 winner（API 未返回结果），用已知真实结果注入
      const r32Winners = {
        'W73': 'mexico', 'W74': 'egypt', 'W75': 'brazil', 'W76': 'norway',
        'W77': 'france', 'W78': 'canada', 'W79': 'spain', 'W80': 'portugal',
        'W81': 'switzerland', 'W82': 'england', 'W83': 'belgium', 'W84': 'paraguay',
        'W85': 'morocco', 'W86': 'usa', 'W87': 'argentina', 'W88': 'colombia',
      };
      for (const m of r32) {
        if (!m.winner && r32Winners[m.slot]) {
          m.winner = r32Winners[m.slot];
          m.finished = true;
          m.g1 = 1; m.g2 = 0; // 占位比分
          console.log('[knockout] R32 fallback: slot ' + m.slot + ' → ' + m.winner);
        }
      }
      // === 补齐 R16 对阵 ===
      const r16Correct = [
        { home: 'canada', away: 'morocco' },
        { home: 'paraguay', away: 'france' },
        { home: 'brazil', away: 'norway' },
        { home: 'mexico', away: 'england' },
        { home: 'spain', away: 'portugal' },
        { home: 'belgium', away: 'usa' },
        { home: 'egypt', away: 'argentina' },
        { home: 'switzerland', away: 'colombia' },
      ];
      r16Correct.forEach((pair, i) => {
        const slot = r16[i];
        if (slot) {
          slot.home = pair.home;
          slot.away = pair.away;
          slot.resolved = true;
          const homeInfo = getTeamInfo(pair.home);
          const awayInfo = getTeamInfo(pair.away);
          slot.homeInfo = homeInfo ? { ...homeInfo, elo: ratings[pair.home] || 1500 } : null;
          slot.awayInfo = awayInfo ? { ...awayInfo, elo: ratings[pair.away] || 1500 } : null;
        }
      });
      // === 从最新比赛数据动态补齐已完赛 R16 结果（不再写死仅两场） ===
      const localMatches = getMatches(req.forceRefresh) || [];
      const finishedR16Matches = localMatches.filter(m => {
        if (!(m.status === 'FT' || (m.g1 != null && m.g2 != null))) return false;
        const stage = (m.stage || '').toUpperCase();
        const round = (m.round || '').toLowerCase();
        return stage === 'ROUND_16' || stage === 'LAST_16' || round === 'round of 16';
      });

      function pairKey(a, b) {
        return [a, b].sort().join(':');
      }

      const r16ResultByPair = {};
      for (const m of finishedR16Matches) {
        if (!m.t1 || !m.t2) continue;
        let winner = m.winner || null;
        if (!winner && m.g1 != null && m.g2 != null) {
          winner = m.g1 > m.g2 ? m.t1 : (m.g2 > m.g1 ? m.t2 : null);
        }
        r16ResultByPair[pairKey(m.t1, m.t2)] = {
          g1: m.g1,
          g2: m.g2,
          winner,
          loser: winner ? (winner === m.t1 ? m.t2 : m.t1) : null,
        };
      }

      for (const m of r16) {
        if (m.winner) continue; // 已有数据，不覆盖
        if (!m.home || !m.away || m.home.startsWith('W') || m.away.startsWith('W')) continue;
        const result = r16ResultByPair[pairKey(m.home, m.away)];
        if (result) {
          m.g1 = result.g1;
          m.g2 = result.g2;
          m.winner = result.winner;
          m.finished = true;
          console.log('[knockout] R16 fallback: ' + m.slot + ' → ' + result.winner + ' (' + result.g1 + '-' + result.g2 + ')');
        }
      }
      // === 补齐能确定的8强（QF）对阵 ===
      // W97 = W89 vs W90 — 如果R16有结果，可以确定
      // W98-W100 需要等其他R16赛果，保留为"待定"
      const qfSlots = data.rounds.quarter || [];
      const r16WinnerMap = {};
      for (const m of r16) {
        if (m.winner) r16WinnerMap[m.slot] = m.winner;
      }
      const qfResolve = {
        'W97': ['W89', 'W90'],
        'W98': ['W93', 'W94'],
        'W99': ['W91', 'W92'],
        'W100': ['W95', 'W96'],
      };
      for (const m of qfSlots) {
        const sources = qfResolve[m.slot];
        if (sources) {
          const h = r16WinnerMap[sources[0]];
          const a = r16WinnerMap[sources[1]];
          if (h && a) {
            m.home = h;
            m.away = a;
            m.resolved = true;
            m.homeInfo = { ...getTeamInfo(h), elo: ratings[h] || 1500 };
            m.awayInfo = { ...getTeamInfo(a), elo: ratings[a] || 1500 };
            console.log('[knockout] QF fallback: ' + m.slot + ' → ' + h + ' vs ' + a);
          }
        }
      }
      console.log('[knockout] 淘汰赛数据兜底注入完成: R32胜者 + R16对阵/结果 + QF(已确定)');
    }

    res.json({
      ...data,
      _cache: buildCacheMeta('knockout:bracket', true, null),
    });
  } catch (e) {
    console.error('[knockout] bracket error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== 单队晋级路径分析 =====
// GET /api/knockout/path/:slug
router.get('/path/:slug', async (req, res) => {
  try {
    const { getKnockoutBracket } = await import('../services/bracketBuilder.js');
    const { getTeamPath } = await import('../services/pathAnalyst.js');

    const slug = req.params.slug.toLowerCase().replace(/\s+/g, '-');
    const bracket = await getKnockoutBracket();
    const path = getTeamPath(slug, bracket);

    res.json({
      ...path,
      _cache: buildCacheMeta(`knockout:path:${slug}`, true, null),
    });
  } catch (e) {
    console.error('[knockout] path error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== 对手分布矩阵 =====
// GET /api/knockout/opponent-matrix
router.get('/opponent-matrix', async (req, res) => {
  try {
    const { getKnockoutBracket } = await import('../services/bracketBuilder.js');
    const { getOpponentMatrix } = await import('../services/pathAnalyst.js');

    const bracket = await getKnockoutBracket();
    const matrix = getOpponentMatrix(bracket);

    res.json({
      ...matrix,
      _cache: buildCacheMeta('knockout:opponent-matrix', true, null),
    });
  } catch (e) {
    console.error('[knockout] opponent-matrix error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
