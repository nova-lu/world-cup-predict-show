import { Router } from 'express';
import { getTeamInfo, getRatings } from '../services/dataService.js';
import { predictMatch as eloPredictMatch, predictUpcoming } from '../services/predictionService.js';
import { fetchAllMatches, fetchUpcomingMatches, fetchStandings } from '../services/footballApi.js';
import { buildCacheMeta } from '../middleware/cache.js';
import { get as cacheGet, set as cacheSet } from '../middleware/cache.js';
import { normalizePrediction, toProbabilities, validateProbabilities } from '../ml/utils/probability.js';
import mlConfig from '../ml/config.js';

// Phase 6.5c: 降级计数器
let degradeCount = 0;

// ML 推理（懒加载，仅启用时引入）
let mlPredictor = null;
async function getMLPredictor() {
  if (!mlConfig.enabled) return null;
  if (!mlPredictor) {
    try {
      const mod = await import('../ml/inference/predictor.js');
      const available = await mod.checkModels();
      if (available) mlPredictor = mod;
      else console.warn('[matches] ML 模型不可用，降级到 Elo');
    } catch (e) {
      console.warn('[matches] ML 推理加载失败:', e.message);
    }
  }
  return mlPredictor;
}

const router = Router();
const BJ_TIMEZONE = 'Asia/Shanghai';
const HOST_SLUGS = new Set(['usa', 'mexico', 'canada']);

function getFormatter(opts) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: BJ_TIMEZONE, ...opts });
}

function formatBeijingDate(d) {
  return getFormatter({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/\//g, '-');
}

function formatBeijingTime(d) {
  return getFormatter({ hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

function formatBeijingKickoffLabel(d) {
  const date = getFormatter({ month: '2-digit', day: '2-digit' }).format(d).replace(/\//g, '-');
  const time = formatBeijingTime(d);
  return `${date} ${time}`;
}

function buildRecentContext(allMatches, homeSlug, awaySlug, matchDateISO) {
  const windowSize = 5;
  const matchTs = new Date(matchDateISO).getTime();
  const finished = allMatches
    .filter(m => m.status === 'FT' && m.utcDate)
    .filter(m => new Date(m.utcDate).getTime() < matchTs)
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

  const teamWindow = (slug) => finished.filter(m => m.t1 === slug || m.t2 === slug).slice(-windowSize);

  const stat = (slug) => {
    const rows = teamWindow(slug);
    if (!rows.length) {
      return { goals: 0, conceded: 0, form: 0.5, daysSince: 7 };
    }
    let goals = 0;
    let conceded = 0;
    let formScore = 0;

    for (const m of rows) {
      const isHome = m.t1 === slug;
      const gFor = isHome ? (m.g1 ?? 0) : (m.g2 ?? 0);
      const gAgainst = isHome ? (m.g2 ?? 0) : (m.g1 ?? 0);
      goals += gFor;
      conceded += gAgainst;
      if (gFor > gAgainst) formScore += 2;
      else if (gFor === gAgainst) formScore += 1;
    }

    const last = rows[rows.length - 1];
    const daysSince = Math.max(1, Math.round((matchTs - new Date(last.utcDate).getTime()) / 86400000));

    return {
      goals: Math.round((goals / rows.length) * 100) / 100,
      conceded: Math.round((conceded / rows.length) * 100) / 100,
      form: Math.round((formScore / (rows.length * 2)) * 1000) / 1000,
      daysSince,
    };
  };

  const home = stat(homeSlug);
  const away = stat(awaySlug);
  return {
    homeRecentGoals: home.goals,
    homeRecentConceded: home.conceded,
    homeRecentForm: home.form,
    homeDaysSinceLast: home.daysSince,
    awayRecentGoals: away.goals,
    awayRecentConceded: away.conceded,
    awayRecentForm: away.form,
    awayDaysSinceLast: away.daysSince,
  };
}

// ===== 今日赛事（核心页面数据源） =====
router.get('/today', async (req, res) => {
  try {
    const windowHours = Math.min(Math.max(parseInt(req.query.hours) || 48, 1), 120);
    const now = new Date();
    const end = new Date(now.getTime() + windowHours * 3600_000);

    const all = await fetchAllMatches(req.forceRefresh);
    const matches = all
      .filter(m => {
        if (!m.utcDate) return false;
        const kickoff = new Date(m.utcDate);
        return kickoff >= now && kickoff <= end;
      })
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

    const predictions = predictUpcoming(matches);
    const finished = matches.filter(m => m.status === 'FT');

    res.json({
      date: formatBeijingDate(now),
      timezone: BJ_TIMEZONE,
      windowHours,
      windowStart: now.toISOString(),
      windowEnd: end.toISOString(),
      windowLabel: `北京时间未来${windowHours}小时赛程`,
      total: matches.length,
      finished: finished.length,
      upcoming: matches.length - finished.length,
      matches: matches.map(m => {
        const pred = predictions.find(p => p.match.t1 === m.t1 && p.match.t2 === m.t2);
        const kickoff = m.utcDate ? new Date(m.utcDate) : null;
        return {
          ...m,
          date: kickoff ? formatBeijingDate(kickoff) : m.date,
          time: kickoff ? formatBeijingTime(kickoff) : m.time,
          kickoffLabel: kickoff ? formatBeijingKickoffLabel(kickoff) : (m.time || ''),
          team1Info: getTeamInfo(m.t1),
          team2Info: getTeamInfo(m.t2),
          prediction: pred?.prediction || null,
        };
      }),
      _cache: buildCacheMeta('api:matches', true, null),
    });
  } catch (e) {
    console.error('[matches/today] API 失败，降级:', e.message);
    // 降级到静态数据
    const windowHours = Math.min(Math.max(parseInt(req.query.hours) || 48, 1), 120);
    const now = new Date();
    const { getUpcomingMatches: getStatic } = await import('../services/dataService.js');
    const today = getStatic(40);
    res.json({
      date: formatBeijingDate(now),
      timezone: BJ_TIMEZONE,
      windowHours,
      windowLabel: `北京时间未来${windowHours}小时赛程`,
      total: today.length,
      matches: today.map(m => ({
        ...m,
        kickoffLabel: m.date && m.time ? `${m.date} ${m.time}` : (m.time || ''),
        team1Info: getTeamInfo(m.t1),
        team2Info: getTeamInfo(m.t2),
      })),
      _degraded: true,
      _cache: { hit: false, degraded: true },
    });
  }
});

// ===== 赛程列表（支持筛选） =====
router.get('/schedule', async (req, res) => {
  try {
    const { date, group, status } = req.query;
    let matches = await fetchAllMatches(req.forceRefresh);

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
      _cache: buildCacheMeta('api:matches', true, null),
    });
  } catch (e) {
    console.error('[matches/schedule] 降级:', e.message);
    const { getMatches: getStatic } = await import('../services/dataService.js');
    const matches = getStatic();
    res.json({ total: matches.length, matches, _degraded: true, _cache: { hit: false, degraded: true } });
  }
});

// ===== 即将开赛 =====
router.get('/upcoming', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const matches = await fetchUpcomingMatches(14, req.forceRefresh);
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
      _cache: buildCacheMeta('api:matches', true, null),
    });
  } catch (e) {
    console.error('[matches/upcoming] 降级:', e.message);
    const { getUpcomingMatches: getStatic } = await import('../services/dataService.js');
    const matches = getStatic(20);
    res.json({ total: matches.length, matches, _degraded: true, _cache: { hit: false, degraded: true } });
  }
});

// ===== 单场比赛预测（支持引擎切换） =====
router.get('/match/:t1/:t2', async (req, res) => {
  const { t1, t2 } = req.params;
  const engine = req.query.engine || 'elo';

  let prediction;
  let allMatches = [];
  try {
    allMatches = await fetchAllMatches(req.forceRefresh);
  } catch {}

  const matched = allMatches.find(m =>
    (m.t1 === t1 && m.t2 === t2) || (m.t1 === t2 && m.t2 === t1)
  );
  const isPrimaryOrderHome = matched ? (matched.t1 === t1) : true;
  const matchDate = matched?.date || new Date().toISOString().split('T')[0];
  const isKnockout = matched?.stage ? (matched.stage !== 'GROUP_STAGE') : 0;

  const mlContext = {
    isHome: isPrimaryOrderHome ? 1 : 0,
    isHost: isPrimaryOrderHome ? (HOST_SLUGS.has(t1) ? 1 : 0) : (HOST_SLUGS.has(t2) ? 1 : 0),
    isKnockout: isKnockout ? 1 : 0,
    tournamentWeight: isKnockout ? 1.0 : 0.8,
    ...buildRecentContext(allMatches, t1, t2, `${matchDate}T00:00:00.000Z`),
  };

  if (engine === 'ml' || engine === 'ensemble') {
    const cacheKey = engine === 'ml' ? `ml:pred:${t1}:${t2}` : `ens:pred:${t1}:${t2}`;
    const cached = cacheGet(cacheKey, { force: req.forceRefresh });
    if (cached.hit) {
      prediction = cached.value;
    } else {
      const mlMod = await getMLPredictor();
      if (mlMod) {
        try {
          const mlPred = await mlMod.predictMatch(t1, t2, matchDate, { context: mlContext });
          if (engine === 'ml') {
            prediction = mlPred;
          } else {
            const eloPred = eloPredictMatch(t1, t2, null, req.forceRefresh);
            normalizePrediction(eloPred, 'elo');
            prediction = mlMod.ensemblePrediction(eloPred, mlPred);
          }
          cacheSet(cacheKey, prediction, { source: 'ml' });
        } catch (e) {
          console.warn(`[matches] ${engine} 推理失败，降级到 Elo:`, e.message);
          degradeCount++;
          prediction = eloPredictMatch(t1, t2, null, req.forceRefresh);
          prediction._degraded = true;
        }
      } else {
        degradeCount++;
        prediction = eloPredictMatch(t1, t2, null, req.forceRefresh);
        prediction._degraded = true;
      }
    }
  } else {
    prediction = eloPredictMatch(t1, t2, null, req.forceRefresh);
  }

  // 注入 team info（ML/Ensemble 引擎没有 home/away 对象，国旗需要 flagPath）
  if (prediction && !prediction.home) {
    prediction.home = { ...getTeamInfo(t1), slug: t1 };
    prediction.away = { ...getTeamInfo(t2), slug: t2 };
  }

  // Phase 6.1: 统一概率协议 — 确保 Elo 与 ML 输出格式一致
  if (!prediction.engine || prediction.engine === 'elo') {
    normalizePrediction(prediction, 'elo');
  }

  // Phase 6.5b: prob_sum_error 监控
  if (prediction.probabilities) {
    const pv = validateProbabilities(prediction.probabilities);
    if (!pv.valid) {
      console.error(`[matches] prob_sum_error | engine=${engine} | ${t1}:${t2} | ${pv.errors.join('; ')}`);
    }
  }

  try {
    const match = matched || null;

    if (match) {
      return res.json({
        match: { ...match, team1Info: getTeamInfo(t1), team2Info: getTeamInfo(t2) },
        prediction,
        _cache: buildCacheMeta(`pred:${t1}:${t2}:${engine}`, true, null),
      });
    }
  } catch {}

  res.json({ match: null, prediction, note: '基于实力的纯预测', engine, _cache: { hit: false } });
});

// Phase 10 Task D: 比赛详情数据接口（供"数据详情"Tab 懒加载使用）
// 获取预测的通用函数
async function getPrediction(t1, t2, engine, req) {
  let prediction;
  let allMatches = [];
  try {
    allMatches = await fetchAllMatches(req.forceRefresh);
  } catch {}

  const matched = allMatches.find(m =>
    (m.t1 === t1 && m.t2 === t2) || (m.t1 === t2 && m.t2 === t1)
  );
  const isPrimaryOrderHome = matched ? (matched.t1 === t1) : true;
  const matchDate = matched?.date || new Date().toISOString().split('T')[0];
  const isKnockout = matched?.stage ? (matched.stage !== 'GROUP_STAGE') : 0;

  const mlContext = {
    isHome: isPrimaryOrderHome ? 1 : 0,
    isHost: isPrimaryOrderHome ? (HOST_SLUGS.has(t1) ? 1 : 0) : (HOST_SLUGS.has(t2) ? 1 : 0),
    isKnockout: isKnockout ? 1 : 0,
    tournamentWeight: isKnockout ? 1.0 : 0.8,
    ...buildRecentContext(allMatches, t1, t2, `${matchDate}T00:00:00.000Z`),
  };

  if (engine === 'ml' || engine === 'ensemble') {
    const cacheKey = engine === 'ml' ? `ml:pred:${t1}:${t2}` : `ens:pred:${t1}:${t2}`;
    const cached = cacheGet(cacheKey, { force: req.forceRefresh });
    if (cached.hit) {
      prediction = cached.value;
    } else {
      const mlMod = await getMLPredictor();
      if (mlMod) {
        try {
          const mlPred = await mlMod.predictMatch(t1, t2, matchDate, { context: mlContext });
          if (engine === 'ml') {
            prediction = mlPred;
          } else {
            const eloPred = eloPredictMatch(t1, t2, null, req.forceRefresh);
            normalizePrediction(eloPred, 'elo');
            prediction = mlMod.ensemblePrediction(eloPred, mlPred);
          }
          cacheSet(cacheKey, prediction, { source: 'ml' });
        } catch (e) {
          degradeCount++;
          prediction = eloPredictMatch(t1, t2, null, req.forceRefresh);
          prediction._degraded = true;
        }
      } else {
        degradeCount++;
        prediction = eloPredictMatch(t1, t2, null, req.forceRefresh);
        prediction._degraded = true;
      }
    }
  } else {
    prediction = eloPredictMatch(t1, t2, null, req.forceRefresh);
  }

  if (prediction && !prediction.home) {
    prediction.home = { ...getTeamInfo(t1), slug: t1 };
    prediction.away = { ...getTeamInfo(t2), slug: t2 };
  }

  if (!prediction.engine || prediction.engine === 'elo') {
    normalizePrediction(prediction, 'elo');
  }

  return prediction;
}

router.get('/detail/:t1/:t2', async (req, res) => {
  try {
    const { t1, t2 } = req.params;
    const engine = req.query.engine || 'elo';
    const prediction = await getPrediction(t1, t2, engine, req);
    if (!prediction) return res.json({ error: '无法获取预测' });

    // 对 Elo 引擎补全 overUnder、btts、risk、coverage 等字段
    const detail = {
      homeTeam: prediction.homeTeam || t1,
      awayTeam: prediction.awayTeam || t2,
      engine: prediction.engine,
      engineVersion: prediction.engineVersion,
      expectedGoals: prediction.expectedGoals,
      topScores: prediction.topScores,
      _cache: buildCacheMeta(`detail:${t1}:${t2}:${engine}`, true, null),
    };

    // Elo 引擎没有这些字段，从 expectedGoals 用 Poisson 计算
    if (!prediction.overUnder && prediction.expectedGoals) {
      const { expectedGoals } = prediction;
      const lambda = expectedGoals.home || 1.0;
      const mu = expectedGoals.away || 1.0;
      // 计算 Poisson 概率
      function poissonPmf(k, lam) {
        return Math.exp(-lam) * Math.pow(lam, k) / (k <= 0 ? 1 : (k === 1 ? 1 : k === 2 ? 2 : k === 3 ? 6 : k === 4 ? 24 : k === 5 ? 120 : 720));
      }
      let over25 = 0, under25 = 0, over35 = 0, under35 = 0, bttsYes = 0;
      for (let a = 0; a <= 8; a++) {
        for (let b = 0; b <= 8; b++) {
          const p = poissonPmf(a, lambda) * poissonPmf(b, mu);
          if (a + b > 2.5) over25 += p; else under25 += p;
          if (a + b > 3.5) over35 += p; else under35 += p;
          if (a > 0 && b > 0) bttsYes += p;
        }
      }
      detail.overUnder = {
        over2_5: +over25.toFixed(3),
        under2_5: +under25.toFixed(3),
        over3_5: +over35.toFixed(3),
        under3_5: +under35.toFixed(3),
        expectedTotal: +(lambda + mu).toFixed(2),
      };
      detail.btts = { yes: +bttsYes.toFixed(3), no: +(1 - bttsYes).toFixed(3) };
      detail.risk = { level: 'low', score: 0, note: 'Elo 基础' };
      detail.coverage = { percent: 90, top3ScoreCoverage: 0 };
    } else {
      detail.overUnder = prediction.overUnder;
      detail.btts = prediction.btts;
      detail.risk = prediction.risk;
      detail.coverage = prediction.coverage;
      detail.metadata = prediction.metadata;
    }

    res.json(detail);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 两队对比 =====
router.get('/compare/:t1/:t2', async (req, res) => {
  const { compareTeams, getScoreDistribution } = await import('../services/predictionService.js');
  const comparison = compareTeams(req.params.t1, req.params.t2);
  const scores = req.query.scores !== 'false' ? getScoreDistribution(req.params.t1, req.params.t2) : null;
  res.json({ ...comparison, topScores: scores });
});

// Phase 8.1: 淘汰赛加时/点球预测
router.get('/knockout-pred/:t1/:t2', async (req, res) => {
  try {
    const { t1, t2 } = req.params;
    const stage = req.query.stage || 'round32';
    const { knockoutMatchProb } = await import('../services/knockoutEngine.js');
    const ratings = getRatings();
    const rA = ratings[t1] || 1500;
    const rB = ratings[t2] || 1500;
    const hb = (t1 === 'mexico' || t1 === 'usa' || t1 === 'canada') ? 75 / 2 : 0;
    const prob = knockoutMatchProb(rA, rB, hb, stage);
    res.json({ t1, t2, stage, ...prob });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

// Phase 6.5c: 降级统计导出
export function getDegradeStats() {
  return { degradeCount };
}
