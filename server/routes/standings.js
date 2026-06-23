import { Router } from 'express';
import { getTeamInfo, getRatings } from '../services/dataService.js';
import { fetchStandings, fetchAllMatches } from '../services/footballApi.js';
import { runMonteCarlo } from '../services/monteCarloService.js';

const router = Router();

// ===== 实时小组积分榜（来自 API） =====
router.get('/groups', async (req, res) => {
  try {
    const apiGroups = await fetchStandings();
    const groups = {};

    for (const [groupName, table] of Object.entries(apiGroups)) {
      const cleanGroup = groupName.replace('Group ', '');

      groups[cleanGroup] = {
        standings: table.map(t => ({
          slug: t.slug,
          teamName: t.teamName,
          info: getTeamInfo(t.slug),
          played: t.played,
          w: t.won,
          d: t.draw,
          l: t.lost,
          pts: t.pts,
          gf: t.gf,
          ga: t.ga,
          gd: t.gd,
        })),
      };
    }

    res.json({ groups, updatedAt: new Date().toISOString(), source: 'api' });
  } catch (e) {
    console.error('[standings/groups] API 失败:', e.message);
    // 降级到静态数据
    const { getMatches, getGroupTeams, GROUPS } = await import('../services/dataService.js');
    const matches = getMatches().filter(m => m.status === 'FT' || (m.g1 != null && m.g2 != null));
    const groups = {};

    for (const g of GROUPS) {
      const groupTeams = getGroupTeams()[g] || [];
      const standings = {};
      for (const slug of groupTeams) {
        standings[slug] = { slug, pts: 0, gd: 0, gf: 0, ga: 0, played: 0, w: 0, d: 0, l: 0 };
      }
      for (const m of matches.filter(m => m.group === g)) {
        const s1 = standings[m.t1], s2 = standings[m.t2];
        if (!s1 || !s2) continue;
        s1.gf += m.g1; s1.ga += m.g2; s1.gd += (m.g1 - m.g2);
        s2.gf += m.g2; s2.ga += m.g1; s2.gd += (m.g2 - m.g1);
        s1.played++; s2.played++;
        if (m.g1 > m.g2) { s1.pts += 3; s1.w++; s2.l++; }
        else if (m.g1 < m.g2) { s2.pts += 3; s2.w++; s1.l++; }
        else { s1.pts += 1; s2.pts += 1; s1.d++; s2.d++; }
      }
      groups[g] = {
        standings: Object.values(standings)
          .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
          .map(r => ({ ...r, info: getTeamInfo(r.slug) })),
      };
    }

    res.json({ groups, updatedAt: new Date().toISOString(), source: 'static', _degraded: true });
  }
});

// ===== 晋级概率榜（蒙特卡洛模拟） =====
router.get('/advancement', (req, res) => {
  const sims = Math.min(parseInt(req.query.sims) || 5000, 20000);
  console.log(`[standings/advancement] 开始 ${sims} 次模拟...`);
  const result = runMonteCarlo(sims);
  res.json({
    ...result,
    note: '数学模型预测，仅供娱乐参考',
  });
});

// ===== 单组详情 =====
router.get('/groups/:group', async (req, res) => {
  const { group } = req.params;
  const g = group.toUpperCase();

  try {
    const apiGroups = await fetchStandings();
    const rawKey = Object.keys(apiGroups).find(k => k.replace('Group ', '') === g);
    if (!rawKey) throw new Error('Group not found');

    const table = apiGroups[rawKey];
    res.json({
      group: g,
      source: 'api',
      standings: table.map(t => ({
        slug: t.slug,
        teamName: t.teamName,
        info: getTeamInfo(t.slug),
        played: t.played, w: t.won, d: t.draw, l: t.lost,
        pts: t.pts, gf: t.gf, ga: t.ga, gd: t.gd,
      })),
    });
  } catch (e) {
    // 降级
    const { getMatches, getGroupTeams } = await import('../services/dataService.js');
    const teams = getGroupTeams()[g] || [];
    const standings = {};
    for (const slug of teams) {
      standings[slug] = { slug, pts: 0, gd: 0, gf: 0, ga: 0, played: 0, w: 0, d: 0, l: 0 };
    }
    for (const m of getMatches().filter(m => m.group === g && m.status === 'FT')) {
      const s1 = standings[m.t1], s2 = standings[m.t2];
      if (!s1 || !s2) continue;
      s1.gf += m.g1; s1.ga += m.g2; s1.gd += (m.g1 - m.g2);
      s2.gf += m.g2; s2.ga += m.g1; s2.gd += (m.g2 - m.g1);
      s1.played++; s2.played++;
      if (m.g1 > m.g2) { s1.pts += 3; s1.w++; s2.l++; }
      else if (m.g1 < m.g2) { s2.pts += 3; s2.w++; s1.l++; }
      else { s1.pts += 1; s2.pts += 1; s1.d++; s2.d++; }
    }
    res.json({
      group: g,
      source: 'static',
      _degraded: true,
      standings: Object.values(standings)
        .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
        .map(r => ({ ...r, info: getTeamInfo(r.slug) })),
    });
  }
});

export default router;
