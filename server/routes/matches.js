import { Router } from 'express';
import { getTeamInfo, getRatings } from '../services/dataService.js';
import { predictMatch, predictUpcoming } from '../services/predictionService.js';
import { fetchAllMatches, fetchTodayMatches, fetchUpcomingMatches, fetchStandings } from '../services/footballApi.js';

const router = Router();

// ===== 今日赛事（核心页面数据源） =====
router.get('/today', async (req, res) => {
  try {
    const matches = await fetchTodayMatches();
    const predictions = predictUpcoming(matches);
    const finished = matches.filter(m => m.status === 'FT');

    res.json({
      date: new Date().toISOString().slice(0, 10),
      total: matches.length,
      finished: finished.length,
      upcoming: matches.length - finished.length,
      matches: matches.map(m => {
        const pred = predictions.find(p => p.match.t1 === m.t1 && p.match.t2 === m.t2);
        return {
          ...m,
          team1Info: getTeamInfo(m.t1),
          team2Info: getTeamInfo(m.t2),
          prediction: pred?.prediction || null,
        };
      }),
    });
  } catch (e) {
    console.error('[matches/today] API 失败，降级:', e.message);
    // 降级到静态数据
    const { getTodayMatches: getStatic } = await import('../services/dataService.js');
    const today = getStatic();
    res.json({
      date: new Date().toISOString().slice(0, 10),
      total: today.length,
      matches: today.map(m => ({
        ...m,
        team1Info: getTeamInfo(m.t1),
        team2Info: getTeamInfo(m.t2),
      })),
      _degraded: true,
    });
  }
});

// ===== 赛程列表（支持筛选） =====
router.get('/schedule', async (req, res) => {
  try {
    const { date, group, status } = req.query;
    let matches = await fetchAllMatches();

    if (date) matches = matches.filter(m => m.date === date);
    if (group && group !== 'all') matches = matches.filter(m => m.group === group);
    if (status === 'finished') matches = matches.filter(m => m.status === 'FT');
    if (status === 'upcoming') matches = matches.filter(m => m.status !== 'FT');

    res.json({
      total: matches.length,
      matches: matches.map(m => ({
        ...m,
        team1Info: getTeamInfo(m.t1),
        team2Info: getTeamInfo(m.t2),
      })),
    });
  } catch (e) {
    console.error('[matches/schedule] 降级:', e.message);
    const { getMatches: getStatic } = await import('../services/dataService.js');
    const matches = getStatic();
    res.json({ total: matches.length, matches, _degraded: true });
  }
});

// ===== 即将开赛 =====
router.get('/upcoming', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const matches = await fetchUpcomingMatches(14);
    const predictions = predictUpcoming(matches);

    res.json({
      total: predictions.length,
      matches: predictions
        .filter(p => p.match.status !== 'FT')
        .slice(0, limit)
        .map(p => ({
          ...p.match,
          team1Info: getTeamInfo(p.match.t1),
          team2Info: getTeamInfo(p.match.t2),
          prediction: p.prediction,
        })),
    });
  } catch (e) {
    console.error('[matches/upcoming] 降级:', e.message);
    const { getUpcomingMatches: getStatic } = await import('../services/dataService.js');
    const matches = getStatic(20);
    res.json({ total: matches.length, matches, _degraded: true });
  }
});

// ===== 单场比赛预测（支持 API 和静态数据） =====
router.get('/match/:t1/:t2', async (req, res) => {
  const { t1, t2 } = req.params;
  const prediction = predictMatch(t1, t2);

  try {
    // 尝试从 API 获取比赛信息
    const all = await fetchAllMatches();
    const match = all.find(m =>
      (m.t1 === t1 && m.t2 === t2) || (m.t1 === t2 && m.t2 === t1)
    );

    if (match) {
      return res.json({
        match: { ...match, team1Info: getTeamInfo(t1), team2Info: getTeamInfo(t2) },
        prediction,
      });
    }
  } catch {}

  // 降级：纯实力预测
  res.json({ match: null, prediction, note: '基于 Elo 实力的纯预测' });
});

// ===== 两队对比 =====
router.get('/compare/:t1/:t2', async (req, res) => {
  const { compareTeams, getScoreDistribution } = await import('../services/predictionService.js');
  const comparison = compareTeams(req.params.t1, req.params.t2);
  const scores = req.query.scores !== 'false' ? getScoreDistribution(req.params.t1, req.params.t2) : null;
  res.json({ ...comparison, topScores: scores });
});

export default router;
