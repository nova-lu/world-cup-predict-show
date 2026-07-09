import { Router } from 'express';
import { predictMatch } from '../services/predictionService.js';
import { getTeamInfo, getRatings } from '../services/dataService.js';
import { loadLatest, getMatch, normalizeToUnified, slugToCnName } from '../ml/odds/sources/china_sports_lottery.js';
import mlConfig from '../ml/config.js';
import { get as cacheGet, set as cacheSet } from '../middleware/cache.js';
// Polymarket 数据源（mode='polymarket' 时使用）
let _pmModule = null;
async function getPolymarket() {
  if (!_pmModule) {
    _pmModule = await import('../ml/odds/sources/polymarket.js');
  }
  return _pmModule;
}
async function getPolymarketOdds(t1, t2) {
  try {
    const pm = await getPolymarket();
    if (!mlConfig.polymarket.enabled) return null;
    const events = await pm.fetchWorldCupEvents();
    const matched = pm.findMatchingEvent(events, t1, t2);
    if (!matched) return null;
    const probs = await pm.getPrematch1X2(matched.slug);
    if (!probs || probs.home == null) return null;
    // 概率 → 公平赔率（去抽水）
    const odds = {
      home: +(1 / probs.home).toFixed(4),
      draw: +(1 / probs.draw).toFixed(4),
      away: +(1 / probs.away).toFixed(4),
    };
    console.log('[investment] polymarket odds for', t1, 'vs', t2, ':', JSON.stringify(odds));
    return odds;
  } catch (e) {
    console.warn('[investment] polymarket 不可用:', e.message);
    return null;
  }
}

const router = Router();

// ===== 内存存储（server 重启丢失） =====
let positions = [];
let capitalCurve = [];
let currentBankroll = 10000;

// ---- ML 集成模型（懒加载） ----
let mlPredictor = null;
async function getMLPredictor() {
  if (!mlConfig.enabled) return null;
  if (!mlPredictor) {
    try {
      const mod = await import('../ml/inference/predictor.js');
      const available = await mod.checkModels();
      if (available) mlPredictor = mod;
    } catch { mlPredictor = null; }
  }
  return mlPredictor;
}

// ---- 模型预测：优先匹配 match 页缓存的 Ensemble，降级到纯 Elo ----
async function getModelProbabilities(t1, t2) {
  const eloResult = predictMatch(t1, t2);
  const prob = {
    winHome: eloResult.prob.winHome / 100,
    draw: eloResult.prob.draw / 100,
    winAway: eloResult.prob.winAway / 100,
  };
  const expectedGoals = eloResult.expectedGoals;
  let source = 'elo';

  // Phase 16: 优先使用 match 路由缓存的 ensemble 预测（确保数据一致性）
  try {
    const ensKey = `ens:pred:${t1}:${t2}`;
    const cached = cacheGet(ensKey);
    if (cached && cached.hit && cached.value && cached.value.probabilities) {
      const ep = cached.value.probabilities;
      prob.winHome = ep.homeWin ?? prob.winHome;
      prob.draw = ep.draw ?? prob.draw;
      prob.winAway = ep.awayWin ?? prob.winAway;
      source = 'ensemble';
      return { prob, expectedGoals, source };
    }
  } catch (e) {
    // 静默降级
  }

  try {
    const predictor = await getMLPredictor();
    if (predictor && typeof predictor.predictMatch === 'function') {
      // 基本上下文（避免空 context 导致 ML 特征全零）
      const mlContext = { isHome: 1, isHost: 0, isKnockout: 1, tournamentWeight: 1.0 };
      const mlPred = await predictor.predictMatch(t1, t2, '', { context: mlContext });
      if (mlPred && mlPred.probabilities) {
        const ensemble = predictor.ensemblePrediction(eloResult, mlPred);
        if (ensemble && ensemble.probabilities) {
          prob.winHome = ensemble.probabilities.homeWin ?? prob.winHome;
          prob.draw = ensemble.probabilities.draw ?? prob.draw;
          prob.winAway = ensemble.probabilities.awayWin ?? prob.winAway;
          source = 'ensemble';
          // 写入共享缓存，后续调用（包括 match 页）保持一致
          try { cacheSet(ensKey, ensemble); } catch {}
        } else {
          prob.winHome = mlPred.probabilities.homeWin ?? prob.winHome;
          prob.draw = mlPred.probabilities.draw ?? prob.draw;
          prob.winAway = mlPred.probabilities.awayWin ?? prob.winAway;
          source = 'ml';
          try { cacheSet(ensKey, mlPred); } catch {}
        }
      }
    }
  } catch (e) {
    console.debug('[investment] ML 降级到 Elo:', e.message);
  }

  return { prob, expectedGoals, source };
}

// ---------- 辅助函数 ----------

/**
 * 基于 Poisson 分布精确计算胜/平/负概率 → 赔率
 * 正确方法：枚举所有可能比分 (0-0 ~ 10-10)，累加赢/平/输概率
 * 然后除以抽水因子 (~0.92) 得到市场赔率
 */
function estimateOdds(t1, t2) {
  const ratings = getRatings();
  const r1 = ratings[t1] || 1500;
  const r2 = ratings[t2] || 1500;
  const diff = r1 - r2;
  // Elo → 期望得分率
  const expectedScore = 1 / (1 + Math.pow(10, -diff / 400));
  // 映射到期望进球（世界杯场均约 2.2球）
  const homeXG = +(0.5 + expectedScore * 1.2).toFixed(3);
  const awayXG = +(0.5 + (1 - expectedScore) * 1.2).toFixed(3);

  function poisProb(λ, k) {
    let p = Math.exp(-λ);
    for (let i = 1; i <= k; i++) p *= λ / i;
    return p;
  }

  const MAX = 10;
  let pHome = 0, pDraw = 0, pAway = 0;
  for (let i = 0; i <= MAX; i++) {
    const pHG = poisProb(homeXG, i);
    for (let j = 0; j <= MAX; j++) {
      const pAG = poisProb(awayXG, j);
      const p = pHG * pAG;
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;
    }
  }

  const sum = pHome + pDraw + pAway;
  const nHome = pHome / sum;
  const nDraw = pDraw / sum;
  const nAway = pAway / sum;

  const juice = 0.92;
  return {
    home: +(1 / (nHome * juice)).toFixed(2),
    draw: +(1 / (nDraw * juice)).toFixed(2),
    away: +(1 / (nAway * juice)).toFixed(2),
  };
}

function computeOption(type, modelProb, odds, lambda) {
  const pThreshold = 0.15;
  const marketImpliedProb = 1 / odds;
  const edge = modelProb - marketImpliedProb;
  const kellyFull = (modelProb * odds - 1) / (odds - 1);
  const canBet = modelProb >= pThreshold && edge > 0;
  const capped = Math.max(0, kellyFull * lambda);
  const kellyFractional = canBet ? capped : 0;
  const expectedReturnRate = modelProb * odds - 1;

  let confidence = 'low';
  if (modelProb > 0.55) confidence = 'high';
  else if (modelProb > 0.4) confidence = 'medium';

  return {
    type,
    label: type === 'home' ? '主胜' : type === 'draw' ? '平局' : '客胜',
    odds,
    modelProb: +modelProb.toFixed(4),
    marketImpliedProb: +marketImpliedProb.toFixed(4),
    edge: +edge.toFixed(4),
    edgePct: +(edge * 100).toFixed(1),
    kellyFull: +kellyFull.toFixed(4),
    kellyFractional: +kellyFractional.toFixed(4),
    kellyPct: +(kellyFractional * 100).toFixed(1),
    expectedReturnRate: +expectedReturnRate.toFixed(4),
    isPositive: edge > 0,
    confidence,
  };
}

async function analyzeMatchData(t1, t2, lambda, mode) {
  lambda = lambda || 0.3;
  mode = mode || 'lottery';

  // ---- 先检测竞彩网主客顺序（可能和 bracket 相反） ----
  let swapped = false;
  try {
    const records = loadLatest();
    if (records && records.length > 0) {
      const cnHome = slugToCnName(t1);
      const cnAway = slugToCnName(t2);
      const match = getMatch(records, cnHome, cnAway);
      if (match && match.homeTeam && match.homeTeam !== cnHome) {
        // 竞彩网顺序与 bracket 相反，交换 t1/t2
        [t1, t2] = [t2, t1];
        swapped = true;
      }
    }
  } catch (e) {}

  const { prob, expectedGoals, source: modelSource } = await getModelProbabilities(t1, t2);
  const homeInfo = getTeamInfo(t1);
  const awayInfo = getTeamInfo(t2);
  const ratings = getRatings();

  const pHome = prob.winHome;
  const pDraw = prob.draw;
  const pAway = prob.winAway;

  // ---- 根据 mode 选择赔率来源 ----
  let oddsMap;
  let oddsSource = 'elo';

  if (mode === 'polymarket') {
    // Polymarket 模式：优先使用预测市场赔率
    const pmOdds = await getPolymarketOdds(t1, t2);
    if (pmOdds) {
      oddsMap = pmOdds;
      oddsSource = 'polymarket';
    } else {
      console.warn('[investment] polymarket 数据不可用，降级到竞彩');
    }
  }

  // 没有 Polymarket 数据（或 mode='lottery'）时走原逻辑
  if (!oddsMap) {
    try {
      const records = loadLatest();
      if (records && records.length > 0) {
        const cnHome = slugToCnName(t1);
        const cnAway = slugToCnName(t2);
        const match = getMatch(records, cnHome, cnAway);
        if (match) {
          const unified = normalizeToUnified(match);
          if (unified && unified.odds) {
            oddsMap = unified.odds;
            oddsSource = unified.source || 'china-sports-lottery';
          }
        }
      }
    } catch (e) { /* 竞彩数据加载失败，走 Elo 兜底 */ }

    if (!oddsMap) {
      oddsMap = estimateOdds(t1, t2);
    }
  }

  const types = [
    { type: 'home',  modelProb: pHome, odds: oddsMap.home },
    { type: 'draw',  modelProb: pDraw, odds: oddsMap.draw },
    { type: 'away',  modelProb: pAway, odds: oddsMap.away },
  ];

  const options = types.map(({ type, modelProb, odds }) =>
    computeOption(type, modelProb, odds, lambda)
  );

  const bestOption = options.reduce((a, b) => (a.kellyFractional > b.kellyFractional ? a : b));
  const maxProb = Math.max(pHome, pDraw, pAway);
  let riskLevel = 'high';
  if (maxProb > 0.55) riskLevel = 'low';
  else if (maxProb > 0.4) riskLevel = 'medium';

  const recommendedStake = Math.round(10000 * bestOption.kellyFractional / 100) * 100;
  const recommendedExpectedProfit = +(recommendedStake * bestOption.expectedReturnRate).toFixed(2);

  return {
    matchId: `${t1}-${t2}`,
    homeTeam: { slug: t1, ...homeInfo },
    awayTeam: { slug: t2, ...awayInfo },
    elo: {
      home: ratings[t1] || 1500,
      away: ratings[t2] || 1500,
    },
    expectedGoals,
    probabilities: {
      winHome: +pHome.toFixed(4),
      draw: +pDraw.toFixed(4),
      winAway: +pAway.toFixed(4),
    },
    oddsSource,
    modelSource,
    odds: oddsMap,
    options,
    bestOption: {
      type: bestOption.type,
      label: bestOption.label,
      odds: bestOption.odds,
      kellyFractional: bestOption.kellyFractional,
      kellyPct: bestOption.kellyPct,
      edge: bestOption.edge,
      edgePct: bestOption.edgePct,
      expectedReturnRate: bestOption.expectedReturnRate,
    },
    recommendedStake,
    recommendedExpectedProfit,
    riskLevel,
    lambda,
  };
}

function getTeamsFromMatchId(matchId) {
  const parts = matchId.split('-');
  const ratings = getRatings();
  const knownSlugs = Object.keys(ratings).concat(
    ['usa', 'mexico', 'canada', 'brazil', 'argentina', 'france', 'england', 'spain',
     'portugal', 'netherlands', 'germany', 'belgium', 'croatia', 'switzerland',
     'uruguay', 'colombia', 'japan', 'south-korea', 'iran', 'australia',
     'saudi-arabia', 'qatar', 'egypt', 'senegal', 'ghana', 'morocco',
     'tunisia', 'algeria', 'ivory-coast', 'nigeria', 'cameroon',
     'paraguay', 'ecuador', 'peru', 'chile', 'scotland', 'austria',
     'turkey', 'czech-republic', 'sweden', 'norway', 'poland', 'denmark',
     'serbia', 'italy', 'new-zealand', 'panama', 'haiti', 'jamaica',
     'costa-rica', 'honduras', 'venezuela', 'bolivia', 'dr-congo', 'mali',
     'burkina-faso', 'south-africa', 'zambia', 'angola', 'guinea',
     'cape-verde', 'gabon', 'uganda', 'benin', 'namibia', 'mozambique',
     'madagascar', 'china', 'uzbekistan', 'uae', 'qatar', 'iraq', 'syria',
     'oman', 'jordan', 'bahrain', 'kuwait', 'lebanon', 'vietnam',
     'thailand', 'indonesia', 'malaysia', 'philippines', 'singapore',
     'myanmar', 'cambodia', 'nepal', 'bangladesh',
    ]
  );

  for (let i = 1; i < parts.length; i++) {
    const t1 = parts.slice(0, i).join('-');
    const t2 = parts.slice(i).join('-');
    if (knownSlugs.includes(t1) && knownSlugs.includes(t2)) {
      return [t1, t2];
    }
  }

  if (parts.length === 2) return parts;
  const mid = Math.ceil(parts.length / 2);
  return [parts.slice(0, mid).join('-'), parts.slice(mid).join('-')];
}

// ============ API 端点 ============

/**
 * 1. GET /api/investment/analysis/:matchId
 */
router.get('/analysis/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const lambda = parseFloat(req.query.lambda) || 0.3;
    const mode = req.query.mode || 'lottery';
    const [t1, t2] = getTeamsFromMatchId(matchId);

    if (!t1 || !t2) {
      return res.status(400).json({ error: '无效的 matchId 格式，应为 "team1-team2"' });
    }

    const result = await analyzeMatchData(t1, t2, lambda, mode);
    res.json(result);
  } catch (e) {
    console.error('[investment/analysis] 失败:', e.message);
    res.status(500).json({ error: '分析失败', message: e.message });
  }
});

/**
 * 2. POST /api/investment/portfolio-optimize
 */
router.post('/portfolio-optimize', async (req, res) => {
  try {
    const { bankroll, lambda, bets, mode } = req.body;
    const b = (typeof bankroll === 'number' && bankroll > 0) ? bankroll : currentBankroll;
    const l = (typeof lambda === 'number' && lambda > 0) ? lambda : 0.3;
    const m = mode || 'lottery';
    const rawAllocations = [];
    for (const bet of (bets || [])) {
      const analysis = await analyzeMatchData(bet.t1, bet.t2, l, m);
      const best = analysis.options.reduce((a, b) => (a.kellyFractional > b.kellyFractional ? a : b));
      rawAllocations.push({ ...best, matchId: `${bet.t1}-${bet.t2}`, allocated: b * Math.max(0, best.kellyFractional) });
    }

    const riskBudget = b * 0.25;
    const n = rawAllocations.length;
    const correlationMatrix = [];
    for (let i = 0; i < n; i++) {
      correlationMatrix[i] = [];
      for (let j = 0; j < n; j++) {
        correlationMatrix[i][j] = i === j ? 1 : 0.15;
      }
    }

    let totalRisk = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const wi = rawAllocations[i].allocated / Math.max(riskBudget, 1);
        const wj = rawAllocations[j].allocated / Math.max(riskBudget, 1);
        totalRisk += wi * wj * correlationMatrix[i][j];
      }
    }
    totalRisk = +Math.sqrt(totalRisk).toFixed(4);

    res.json({
      bankroll: b, riskBudget,
      allocations: rawAllocations.map(a => ({
        matchId: a.matchId, selection: a.type, odds: a.odds,
        kelly: +a.kellyFractional.toFixed(4),
        allocated: +a.allocated.toFixed(2),
      })),
      totalRisk, lambda: l,
    });
  } catch (e) {
    res.status(500).json({ error: '优化失败', message: e.message });
  }
});

/**
 * 3. POST /api/investment/record-bet
 */
router.post('/record-bet', (req, res) => {
  try {
    const { matchId, selection, odds, stake, expectedProfit, mode } = req.body;

    if (!matchId || !selection || !odds || !stake) {
      return res.status(400).json({ error: '缺少必要字段: matchId, selection, odds, stake' });
    }

    const positionId = 'pos_' + Date.now();
    const position = {
      positionId, matchId, selection, odds, stake,
      expectedProfit: expectedProfit || 0,
      mode: mode || 'lottery',
      status: 'open',
      createdAt: new Date().toISOString(),
    };

    positions.push(position);
    currentBankroll -= stake;

    capitalCurve.push({
      timestamp: new Date().toISOString(),
      bankroll: currentBankroll,
      change: -stake,
      type: 'bet',
      positionId,
    });

    res.json({ success: true, ...position, remainingBankroll: currentBankroll });
  } catch (e) {
    console.error('[investment/record-bet] 失败:', e.message);
    res.status(500).json({ error: '记录投注失败', message: e.message });
  }
});

/**
 * 4. GET /api/investment/positions
 */
router.get('/positions', (req, res) => {
  const totalStaked = positions.reduce((s, p) => s + (p.stake || 0), 0);
  const totalReturn = positions.filter(p => p.status === 'settled').reduce((s, p) => s + (p.payout || 0), 0);
  const unrealizedPL = positions.filter(p => p.status === 'open').reduce((s, p) => s + (p.expectedProfit || 0), 0);

  res.json({
    total: positions.length,
    open: positions.filter(p => p.status === 'open').length,
    settled: positions.filter(p => p.status === 'settled').length,
    totalStaked: +totalStaked.toFixed(2),
    totalReturn: +totalReturn.toFixed(2),
    unrealizedPL: +unrealizedPL.toFixed(2),
    positions,
  });
});

/**
 * 5. GET /api/investment/capital-curve
 */
router.get('/capital-curve', (req, res) => {
  const { range } = req.query;

  if (capitalCurve.length > 0) {
    let data = capitalCurve;
    if (range === '7d') {
      const cutoff = Date.now() - 7 * 86400000;
      data = capitalCurve.filter(c => new Date(c.timestamp).getTime() >= cutoff);
    } else if (range === '30d') {
      const cutoff = Date.now() - 30 * 86400000;
      data = capitalCurve.filter(c => new Date(c.timestamp).getTime() >= cutoff);
    }
    return res.json({ points: data, bankroll: currentBankroll });
  }

  const mockCurve = [];
  let val = 10000;
  const now = Date.now();
  for (let i = 30; i >= 0; i--) {
    const change = (Math.random() - 0.48) * 200;
    val += change;
    mockCurve.push({
      timestamp: new Date(now - i * 86400000).toISOString(),
      bankroll: +Math.max(val, 8000).toFixed(2),
      change: +change.toFixed(2),
      type: 'simulated',
    });
  }
  res.json({ points: mockCurve, bankroll: currentBankroll, simulated: true });
});

/**
 * 6. POST /api/investment/reset
 */
router.post('/reset', (req, res) => {
  const { bankroll } = req.body;
  positions = [];
  capitalCurve = [];
  currentBankroll = (typeof bankroll === 'number' && bankroll > 0) ? bankroll : 10000;
  res.json({ success: true, bankroll: currentBankroll });
});

/**
 * 7. GET /api/investment/simulate-backtest
 */
router.get('/simulate-backtest', (req, res) => {
  const lambda = parseFloat(req.query.lambda) || 0.3;
  const bankroll = 10000;
  const iterations = Math.min(parseInt(req.query.iterations) || 100, 200);

  const ratings = getRatings();
  const slugs = Object.keys(ratings).filter(s => !s.includes('-placeholder'));
  if (slugs.length < 4) {
    return res.json({ error: '球队数据不足，无法回测', mock: true, results: generateMockBacktestResult(lambda) });
  }

  // 轻量同步回测：只用 Elo predictMatch + estimateOdds，不调用 async analyzeMatchData
  const results = [];
  for (let iter = 0; iter < iterations; iter++) {
    const t1 = slugs[Math.floor(Math.random() * slugs.length)];
    let t2 = slugs[Math.floor(Math.random() * slugs.length)];
    while (t2 === t1) t2 = slugs[Math.floor(Math.random() * slugs.length)];

    const elo = predictMatch(t1, t2);
    const probs = { winHome: elo.prob.winHome / 100, draw: elo.prob.draw / 100, winAway: elo.prob.winAway / 100 };
    const oddsMap = estimateOdds(t1, t2);

    const options = [
      { type: 'home', modelProb: probs.winHome, odds: oddsMap.home },
      { type: 'draw', modelProb: probs.draw, odds: oddsMap.draw },
      { type: 'away', modelProb: probs.winAway, odds: oddsMap.away },
    ].map(opt => computeOption(opt.type, opt.modelProb, opt.odds, lambda));

    const best = options.reduce((a, b) => (a.kellyFractional > b.kellyFractional ? a : b));
    if (!best || best.kellyFractional <= 0) continue;

    const stake = bankroll * best.kellyFractional;
    const r = Math.random();
    const isWin = (best.type === 'home' && r < probs.winHome)
      || (best.type === 'draw' && r < probs.draw)
      || (best.type === 'away' && r < probs.winAway);
    const profit = isWin ? (stake * best.odds - stake) : -stake;
    results.push({
      iter,
      home: slugToCnName(t1), away: slugToCnName(t2),
      selection: best.label, odds: best.odds,
      modelProb: best.modelProb, edge: best.edge,
      stake: +stake.toFixed(2), profit: +profit.toFixed(2), isWin,
    });
  }

  const wins = results.filter(r => r.isWin).length;
  const totalProfit = results.reduce((s, r) => s + r.profit, 0);
  const totalBets = results.length;

  res.json({
    lambda, initialBankroll: bankroll, totalBets, wins, losses: totalBets - wins,
    winRate: totalBets > 0 ? +(wins / totalBets * 100).toFixed(1) : 0,
    totalProfit: +totalProfit.toFixed(2),
    avgProfitPerBet: totalBets > 0 ? +(totalProfit / totalBets).toFixed(2) : 0,
    roi: bankroll > 0 ? +(totalProfit / bankroll * 100).toFixed(2) : 0,
    results: results.slice(0, 100),
  });
});

function generateMockBacktestResult(lambda) {
  const totalBets = 30;
  const wins = Math.floor(totalBets * 0.45);
  const losses = totalBets - wins;
  const totalProfit = wins * 1.5 * 200 - losses * 300;
  const roi = totalProfit / 10000 * 100;
  const winRate = wins / totalBets * 100;

  return {
    lambda, initialBankroll: 10000, totalBets, wins, losses,
    winRate: +winRate.toFixed(1),
    totalProfit: +totalProfit.toFixed(2),
    avgProfitPerBet: +(totalProfit / totalBets).toFixed(2),
    roi: +roi.toFixed(2),
    _mock: true,
  };
}

/**
 * 8. POST /api/investment/backtest-run
 */
router.post('/backtest-run', async (req, res) => {
  try {
    const { lambda, mode } = req.body;
    const l = parseFloat(lambda) || 0.3;
    const fetchedMatches = [];
    try {
      const { fetchAllMatches } = await import('../services/footballApi.js');
      const all = await fetchAllMatches();
      fetchedMatches.push(...all.filter(m => m.status === 'FT' && m.t1 && m.t2));
    } catch { /* 忽略 */ }

    if (fetchedMatches.length === 0) {
      const simResult = generateMockBacktestResult(l);
      return res.json(simResult);
    }

    let bankroll = 10000;
    const tradeHistory = [];
    let wins = 0, losses = 0;

    for (const m of fetchedMatches) {
      try {
        const [t1, t2] = getTeamsFromMatchId(`${m.t1}-${m.t2}`);
        const analysis = await analyzeMatchData(t1, t2, l);
        const best = analysis.bestOption;
        if (!best || best.kellyFractional <= 0) continue;

        const stake = bankroll * best.kellyFractional;
        const g1 = parseInt(m.g1) || 0;
        const g2 = parseInt(m.g2) || 0;
        let actualResult = 'draw';
        if (g1 > g2) actualResult = 'home';
        else if (g2 > g1) actualResult = 'away';

        const isWin = actualResult === best.type;
        const profit = isWin ? (stake * best.odds - stake) : -stake;
        bankroll += profit;
        tradeHistory.push({ match: `${t1}-${t2}`, stake: +stake.toFixed(2), profit: +profit.toFixed(2), isWin, odds: best.odds });
        if (isWin) wins++; else losses++;
      } catch { continue; }
    }

    const totalBets = tradeHistory.length;
    const totalProfit = bankroll - 10000;
    const roi = totalProfit / 10000 * 100;
    const winRate = totalBets > 0 ? wins / totalBets * 100 : 0;

    res.json({
      lambda: l, initialBankroll: 10000, finalBankroll: +bankroll.toFixed(2),
      totalBets, wins, losses, winRate: +winRate.toFixed(1),
      totalProfit: +totalProfit.toFixed(2),
      avgProfitPerBet: totalBets > 0 ? +(totalProfit / totalBets).toFixed(2) : 0,
      roi: +roi.toFixed(2),
      trades: tradeHistory.slice(0, 100),
    });
  } catch (e) {
    console.error('[investment/backtest-run] 失败:', e.message);
    res.status(500).json({ error: '回测失败', message: e.message });
  }
});

/**
 * 9. GET /api/investment/project-returns
 * 基于剩余淘汰赛的所有已知对阵，计算 Kelly 预期收益投影
 */
router.get('/project-returns', async (req, res) => {
  try {
    const lambda = parseFloat(req.query.lambda) || 0.3;
    const bankroll = parseFloat(req.query.bankroll) || currentBankroll || 10000;
    const force = req.query.force === '1';

    // 缓存：同一参数组合 5 分钟
    const cacheKey = `proj:${lambda.toFixed(2)}:${bankroll.toFixed(0)}`;
    try {
      const { get, set } = await import('../middleware/cache.js');
      if (!force) {
        const cached = get(cacheKey, { force: false });
        if (cached.hit) {
          cached.value._cached = true;
          return res.json(cached.value);
        }
      }
      // 不 await set — 分析完后缓存
      res.locals._projCacheKey = cacheKey;
    } catch {} // 缓存模块不可用时跳过

    let koMatches = [];
    try {
      const { fetchAllMatches } = await import('../services/footballApi.js');
      koMatches = await fetchAllMatches();
    } catch {
      const { getMatches } = await import('../services/dataService.js');
      koMatches = getMatches().filter(m => m.stage && m.stage.includes('round'));
    }

    const upcoming = koMatches.filter(m => {
      if (m.status === 'FT') return false;
      if (m.g1 != null && m.g2 != null) return false;
      return m.t1 && m.t2 && !m.t1.endsWith('-placeholder') && !m.t2.endsWith('-placeholder');
    });

    if (upcoming.length === 0) {
      return res.json({ projections: [], summary: { totalMatches: 0, expectedGrowth: 0, message: '无剩余比赛', recommendation: '无可投注比赛' } });
    }

    const projections = [];
    let cumulativeBankroll = bankroll;
    let totalExpectedProfit = 0;

    for (const m of upcoming) {
      try {
        const analysis = await analyzeMatchData(m.t1, m.t2, lambda);
        const best = analysis.bestOption;
        const homeName = (analysis.homeTeam && analysis.homeTeam.name) || m.t1;
        const awayName = (analysis.awayTeam && analysis.awayTeam.name) || m.t2;

        if (!best || best.kellyFractional <= 0 || !best.odds) {
          projections.push({
            matchId: `${m.t1}-${m.t2}`, home: m.t1, away: m.t2,
            homeName, awayName,
            stage: m.stage || 'unknown', skipped: true,
            reason: '无正期望选项', expectedProfit: 0, stake: 0,
          });
          continue;
        }

        const stake = Math.max(0, cumulativeBankroll * best.kellyFractional);
        const expectedReturnRate = best.expectedReturnRate || (analysis.probabilities.winHome * best.odds - 1);
        const conservativeStake = stake * 0.5;
        const conservativeProfit = conservativeStake * expectedReturnRate;

        projections.push({
          matchId: `${m.t1}-${m.t2}`, home: m.t1, away: m.t2,
          homeName, awayName,
          stage: m.stage || 'unknown', date: m.date || '',
          bestOption: { type: best.type, label: best.label, odds: best.odds },
          kellyFractional: +best.kellyFractional.toFixed(4),
          kellyPct: +(best.kellyFractional * 100).toFixed(1),
          expectedReturnRate: +expectedReturnRate.toFixed(4),
          stake: +conservativeStake.toFixed(2),
          expectedProfit: +conservativeProfit.toFixed(2),
          edge: +(best.edgePct || 0).toFixed(1),
          modelSource: analysis.modelSource || 'elo',
          oddsSource: analysis.oddsSource || 'elo',
        });

        cumulativeBankroll += conservativeProfit;
        totalExpectedProfit += conservativeProfit;
      } catch {
        const homeInfo = getTeamInfo(m.t1);
        const awayInfo = getTeamInfo(m.t2);
        projections.push({
          matchId: `${m.t1}-${m.t2}`, home: m.t1, away: m.t2,
          homeName: (homeInfo && homeInfo.name) || m.t1,
          awayName: (awayInfo && awayInfo.name) || m.t2,
          stage: m.stage || 'unknown', skipped: true,
          reason: '分析失败', expectedProfit: 0, stake: 0,
        });
      }
    }

    const growthRate = bankroll > 0 ? (totalExpectedProfit / bankroll * 100) : 0;

    const result = {
      bankroll, lambda, projections,
      summary: {
        totalMatches: projections.length,
        activeBets: projections.filter(p => !p.skipped).length,
        skipped: projections.filter(p => p.skipped).length,
        totalStake: +projections.reduce((s, p) => s + (p.stake || 0), 0).toFixed(2),
        totalExpectedProfit: +totalExpectedProfit.toFixed(2),
        expectedGrowth: +growthRate.toFixed(1),
        projectedBankroll: +(bankroll + totalExpectedProfit).toFixed(2),
        recommendation: growthRate > 10
          ? '模型认为这批比赛有较好的投注价值，建议按Kelly比例参与'
          : growthRate > 0
            ? '模型认为预期回报为正但有限，建议小仓位参与'
            : '模型认为当前无正期望机会，建议观望或减少投注',
      },
    };

    // 写入缓存（不阻塞响应）
    if (res.locals._projCacheKey) {
      try {
        const { set: cacheSet } = await import('../middleware/cache.js');
        cacheSet(res.locals._projCacheKey, result, { ttlMs: 300000 });
      } catch {}
    }

    res.json(result);
  } catch (e) {
    console.error('[investment/project-returns] 失败:', e.message);
    res.status(500).json({ error: '投影计算失败', message: e.message });
  }
});

export default router;
