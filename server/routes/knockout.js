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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
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
