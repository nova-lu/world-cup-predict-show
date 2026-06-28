import express from 'express';
import {
  fetchWcEvents,
  fetchOddsForMatch,
  fetchAllAvailableOdds,
  findEventId,
  DEFAULT_BOOKMAKERS,
} from '../services/oddsApi.js';
import { getTeamInfo } from '../services/dataService.js';

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

// ===== Phase 7: Polymarket & 赔率融合 =====

// 将 Polymarket 英文比赛标题转为中文
// e.g. "Mexico vs South Africa" → "墨西哥 vs 南非"
function _slugFallback(name) {
  // Polymarket 特殊队名 → 内部 slug 映射
  var map = {
    'south korea': 'korea-republic',
    'korea republic': 'korea-republic',
    'czech republic': 'czech-republic',
    'czechia': 'czech-republic',
    'bosnia and herzegovina': 'bosnia-and-herzegovina',
    'united states': 'usa',
    'saudi arabia': 'saudi-arabia',
    'costa rica': 'costa-rica',
    'south africa': 'south-africa',
    'el salvador': 'el-salvador',
  };
  var key = name.toLowerCase().replace(/\s+/g, ' ');
  return map[key] || key.replace(/\s+/g, '-');
}

function translateTitle(title) {
  var parts = (title || '').split(/\s+vs\.?\s+/i);
  if (parts.length < 2) return title;
  var home = parts[0].trim();
  var away = parts[1].trim();
  var infoHome = getTeamInfo(_slugFallback(home));
  var infoAway = getTeamInfo(_slugFallback(away));
  return (infoHome ? infoHome.name : home) + ' vs ' + (infoAway ? infoAway.name : away);
}

// Polymarket 市场列表 (含批处理价格，支持 scope=upcoming|historical)
router.get('/api/odds/polymarket', async (req, res) => {
  try {
    const { fetchWorldCupEvents, batchPrematchPrices } = await import('../ml/odds/sources/polymarket.js');
    const scope = req.query.scope || 'upcoming';
    let events = [];
    try {
      if (scope === 'historical') {
        // 历史已结算：从6月1日至今
        events = await fetchWorldCupEvents('2026-06-01', new Date().toISOString().split('.')[0] + 'Z', true);
      } else {
        // 近期：今天到48小时后，只拉活跃
        events = await fetchWorldCupEvents();
      }
    } catch (e) {
      return res.json({
        reachable: false, total: 0, priced: 0,
        events: [],
        error: 'Polymarket API 连接失败: ' + e.message,
      });
    }
    // 按市场类型分组加载价格：只有match类型有1X2价格
    const matchSlugs = events.filter(e => e.marketType === 'match').map(e => e.slug);
    const prices = [];
    try { const loaded = await batchPrematchPrices(matchSlugs); prices.push(...loaded); } catch {}
    const priceMap = {};
    for (const p of prices) priceMap[p.slug] = p;

    // 各类型计数
    const typeCount = {};
    for (const e of events) {
      typeCount[e.marketType] = (typeCount[e.marketType] || 0) + 1;
    }

    res.json({
      reachable: true, total: events.length, priced: prices.length,
      typeCount,
      events: events.map(e => ({
        slug: e.slug, title: translateTitle(e.title), kickoff: e.kickoff, closed: e.closed,
        marketType: e.marketType,
        prices: e.marketType === 'match' ? (priceMap[e.slug] || null) : null,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Polymarket 单场比赛 (使用 findMatchingEvent 别名匹配)
router.get('/api/odds/polymarket/match/:t1/:t2', async (req, res) => {
  try {
    const { fetchWorldCupEvents, findMatchingEvent, getPrematch1X2, getMarketVolume } = await import('../ml/odds/sources/polymarket.js');
    const { t1, t2 } = req.params;
    const events = await fetchWorldCupEvents();
    const matched = findMatchingEvent(events, t1, t2);
    if (!matched) return res.json({ found: false, message: '未找到 Polymarket 市场' });

    const [probs, volume] = await Promise.all([
      getPrematch1X2(matched.slug),
      getMarketVolume(matched.slug),
    ]);

    res.json({
      found: true, slug: matched.slug, title: matched.title,
      probabilities: probs ? { home: probs.home, draw: probs.draw, away: probs.away } : null,
      volumeUsdc: volume,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 赔率融合（三源）— 8秒超时
router.get('/api/odds/fusion/match/:t1/:t2', async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const { t1, t2 } = req.params;
    const engine = req.query.engine || 'ensemble';
    const { fetchAllSources, modelToSource } = await import('../ml/odds/sources/unified.js');
    const { fuse } = await import('../ml/odds/fusion/fusion.js');

    // 获取模型预测
    const predService = await import('../services/predictionService.js');
    let modelPrediction = null;

    if (engine === 'ml' || engine === 'ensemble') {
      try {
        const predictor = await import('../ml/inference/predictor.js');
        const available = await predictor.checkModels();
        if (available) {
          const mlPred = await predictor.predictMatch(t1, t2, '', { context: {} });
          if (engine === 'ensemble') {
            const eloPred = predService.predictMatch(t1, t2, null, true);
            modelPrediction = predictor.ensemblePrediction(eloPred, mlPred);
          } else {
            modelPrediction = mlPred;
          }
        }
      } catch {}
    }

    if (!modelPrediction) {
      modelPrediction = predService.predictMatch(t1, t2, null, true);
    }

    const sources = await fetchAllSources(t1, t2);
    const modelSource = modelToSource(modelPrediction);
    const fusionResult = fuse(sources, modelSource);

    res.json({
      match: { t1, t2 },
      sources: sources.map(s => ({ source: s.source, probabilities: s.probabilities, metadata: s.metadata })),
      model: modelSource,
      fusion: fusionResult,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    clearTimeout(timeout);
  }
});

// 今日比赛融合（批量，供首页使用）
router.get('/api/odds/fusion/today', async (req, res) => {
  try {
    const { getUpcomingMatches } = await import('../services/dataService.js');
    const { fetchAllSources } = await import('../ml/odds/sources/unified.js');
    const { fuse } = await import('../ml/odds/fusion/fusion.js');
    const matches = getUpcomingMatches(48);
    const results = [];

    for (const m of matches.slice(0, 20)) {
      try {
        const sources = await fetchAllSources(m.t1, m.t2);
        if (sources.length === 0) continue;
        const fusionResult = fuse(sources, null);
        if (!fusionResult) continue;
        const polymarket = sources.find(s => s.source === 'polymarket');
        const oddsApi = sources.find(s => s.source === 'oddsApi');
        results.push({
          t1: m.t1, t2: m.t2,
          fusion: fusionResult,
          polymarket: polymarket?.probabilities || null,
          oddsApi: oddsApi?.probabilities || null,
        });
      } catch {}
    }

    res.json({ total: results.length, fusion: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 融合状态
router.get('/api/odds/fusion/status', async (req, res) => {
  try {
    const { getAverageBrier, getAvailableSources } = await import('../ml/odds/fusion/weights.js');
    const mlConfig = (await import('../ml/config.js')).default;
    const sources = getAvailableSources();
    const briers = {};
    for (const s of sources) { briers[s] = getAverageBrier(s); }

    res.json({
      enabled: mlConfig.oddsFusion.enabled,
      strategy: mlConfig.oddsFusion.strategy,
      sourceWeights: mlConfig.oddsFusion.sourceWeights,
      polymarket: mlConfig.polymarket,
      sourceBriers: briers,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
