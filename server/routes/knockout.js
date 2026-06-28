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
    const { getTeamInfo, getRatings } = await import('../services/dataService.js');
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
