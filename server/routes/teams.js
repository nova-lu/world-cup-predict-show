import { Router } from 'express';
import { getAllTeams, getTeamInfo, getRatings } from '../services/dataService.js';
import { predictMatch } from '../services/predictionService.js';

const router = Router();

// 球队列表
router.get('/', (req, res) => {
  const ratings = getRatings();
  const teams = getAllTeams().map(t => ({
    ...t,
    elo: ratings[t.slug] || null,
  })).sort((a, b) => b.elo - a.elo);
  res.json({ total: teams.length, teams });
});

// 球队详情
router.get('/:slug', (req, res) => {
  const { slug } = req.params;
  const info = getTeamInfo(slug);
  if (!info) return res.status(404).json({ error: `未找到球队: ${slug}` });
  const ratings = getRatings();
  res.json({
    ...info,
    elo: ratings[slug] || null,
  });
});

// 球队对比（快速入口）
router.get('/:slug/compare/:opponent', (req, res) => {
  const { slug, opponent } = req.params;
  const prediction = predictMatch(slug, opponent);
  const reversed = predictMatch(opponent, slug);
  res.json({
    teamA: prediction.home,
    teamB: prediction.away,
    whenAIsHome: prediction,
    whenBIsHome: reversed,
  });
});

export default router;
