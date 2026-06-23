import express from 'express';
import {
  fetchWcEvents,
  fetchOddsForMatch,
  fetchAllAvailableOdds,
  findEventId,
  DEFAULT_BOOKMAKERS,
} from '../services/oddsApi.js';

const router = express.Router();

// 赔率状态中间件
function oddsEnabled(req, res, next) {
  if (!process.env.ODDS_API_KEY) {
    return res.json({ enabled: false, message: 'ODDS_API_KEY 未配置' });
  }
  next();
}

// 获取所有有赔率的世界杯比赛
router.get('/api/odds/available', oddsEnabled, async (req, res) => {
  try {
    const odds = await fetchAllAvailableOdds();
    res.json({
      total: odds.length,
      bookmakers: DEFAULT_BOOKMAKERS,
      matches: odds,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取某场比赛的赔率（通过球队 slug）
router.get('/api/odds/match/:t1/:t2', oddsEnabled, async (req, res) => {
  try {
    const { t1, t2 } = req.params;
    const odds = await fetchOddsForMatch(t1, t2);
    if (!odds) {
      return res.json({ found: false, message: '未找到该场比赛的赔率数据' });
    }
    res.json({ found: true, ...odds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取世界杯事件列表（用于调试/查看）
router.get('/api/odds/events', oddsEnabled, async (req, res) => {
  try {
    const events = await fetchWcEvents(req.query.force === '1');
    res.json({
      total: events.length,
      events: events.map(e => ({
        id: e.id,
        home: e.home,
        away: e.away,
        homeSlug: e.homeSlug,
        awaySlug: e.awaySlug,
        date: e.date,
        status: e.status,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
