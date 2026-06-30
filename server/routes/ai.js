// ===== AI 分析 API 路由 =====
// POST /api/ai/analyze/:t1/:t2   - 分析比赛
// GET  /api/ai/status            - 检查 AI 功能状态

import { Router } from 'express';
import { aggregateMatchData } from '../ai/data-aggregator.js';
import { buildPrompt, summarizeData } from '../ai/prompt-builder.js';
import { callLLM, testConnection } from '../ai/llm-client.js';
import aiConfig from '../ai/config.js';
import { get, set, buildCacheMeta } from '../middleware/cache.js';

const router = Router();

/**
 * POST /api/ai/analyze/:t1/:t2
 * 触发 AI 分析并返回结果
 */
router.post('/analyze/:t1/:t2', async (req, res) => {
  const { t1, t2 } = req.params;
  const { force } = req.body || {};

  if (!t1 || !t2) {
    return res.status(400).json({ success: false, error: '缺少队伍参数' });
  }

  if (!aiConfig.enabled()) {
    return res.json({
      success: false,
      error: 'AI_API_KEY 未配置，请在 .env 中设置 AI_API_KEY',
      actionable: true,
    });
  }

  // 检查缓存
  const cacheKey = `ai:analysis:${t1}:${t2}`;
  const cached = get(cacheKey, { force: !!force, ttlMs: aiConfig.get().cacheTtl * 1000 });
  if (cached.hit) {
    return res.json({
      success: true,
      match: { t1, t2 },
      analysis: cached.value.analysis,
      matchInfo: cached.value.matchInfo || null,
      dataSources: cached.value.dataSources,
      sourceProbabilities: cached.value.sourceProbabilities || null,
      recentForm: cached.value.recentForm || null,
      generatedAt: cached.meta.createdAt || cached.meta.updatedAt,
      cached: true,
      _cache: buildCacheMeta(cacheKey, true, cached.meta),
    });
  }

  // ===== 先聚合数据（不依赖 LLM，必须成功） =====
  let aggregated = null;
  let summary = null;
  try {
    aggregated = await aggregateMatchData(t1, t2);
    console.error('[AI route] aggregateMatchData done, elo:', !!aggregated.eloPrediction, 'ml:', aggregated.mlPrediction?.available, 'matchInfo:', !!aggregated.matchInfo);
    summary = summarizeData(aggregated);
    console.error('[AI route] summarizeData done, sources:', summary.sources);
  } catch (e) {
    console.error('[AI route] 数据聚合失败:', e.message);
    console.error('[AI route] 数据聚合失败 stack:', e.stack?.slice(0,500));
    return res.json({
      success: false,
      error: `数据聚合失败: ${e.message.slice(0, 200)}`,
      actionable: false,
    });
  }

  // 构建数据源清单（无论 LLM 成败都返回）
  const dataSources = {
    elo: !!aggregated.eloPrediction,
    ml: aggregated.mlPrediction?.available || false,
    ensemble: aggregated.ensemblePrediction?.available || false,
    oddsApi: aggregated.oddsData?.available || false,
    polymarket: aggregated.polymarket?.available || false,
    chinaLottery: aggregated.chinaSportsLottery?.available || false,
    form: !!aggregated.recentForm,
    knockout: aggregated.knockoutPrediction?.available || false,
  };

  // 各信源原始概率
  const sourceProbabilities = {};
  if (aggregated.eloPrediction) {
    // Elo 可能返回百分比格式(21.4=21.4%)，归一化为小数
    const p = aggregated.eloPrediction.probabilities;
    const norm = {};
    for (const [k, v] of Object.entries(p)) {
      norm[k] = v > 1 ? v / 100 : v;
    }
    sourceProbabilities.elo = norm;
  }
  if (aggregated.mlPrediction?.available && aggregated.mlPrediction.probabilities) {
    const ml = aggregated.mlPrediction.probabilities;
    // 检查是否全零（异常数据）
    if (ml.homeWin + ml.draw + ml.awayWin > 0) {
      sourceProbabilities.ml = ml;
    }
  }
  if (aggregated.ensemblePrediction?.available && aggregated.ensemblePrediction.probabilities) {
    sourceProbabilities.ensemble = aggregated.ensemblePrediction.probabilities;
  }
  if (aggregated.oddsData?.available && aggregated.oddsData.consensus) {
    sourceProbabilities.odds = aggregated.oddsData.consensus;
  }
  if (aggregated.polymarket?.available && aggregated.polymarket.probabilities) {
    sourceProbabilities.polymarket = aggregated.polymarket.probabilities;
  }

  // 近期表现数据（进球/失球）
  let recentForm = null;
  if (aggregated.recentForm?.home?.last5 && aggregated.recentForm?.away?.last5) {
    const homeGf = aggregated.recentForm.home.last5.reduce((s, m) => s + (m.gf || 0), 0);
    const homeGa = aggregated.recentForm.home.last5.reduce((s, m) => s + (m.ga || 0), 0);
    const awayGf = aggregated.recentForm.away.last5.reduce((s, m) => s + (m.gf || 0), 0);
    const awayGa = aggregated.recentForm.away.last5.reduce((s, m) => s + (m.ga || 0), 0);
    recentForm = {
      home: { gf: homeGf, ga: homeGa, formStr: aggregated.recentForm.home.form || '' },
      away: { gf: awayGf, ga: awayGa, formStr: aggregated.recentForm.away.form || '' },
    };
  }

  // ===== 再调 LLM（可能失败，失败时仍返回 dataSources） =====
  try {
    console.error('[AI route] building prompt...');
    const prompt = buildPrompt(aggregated);
    console.error('[AI route] prompt built, length:', prompt.length);

    // 调用 LLM
    console.error('[AI route] calling LLM...');
    const analysis = await callLLM(prompt);
    console.error('[AI route] LLM returned, keys:', Object.keys(analysis).join(','));

    // 验证 LLM 返回结构完整性
    const validated = validateAnalysis(analysis);

    const result = {
      analysis: validated,
      matchInfo: aggregated.matchInfo || null,
      dataSources,
      sourceProbabilities,
      recentForm,
      _sourcesSummary: summary,
    };

    // 写入缓存
    set(cacheKey, result, {
      ttlMs: aiConfig.get().cacheTtl * 1000,
      source: 'ai-analysis',
    });

    res.json({
      success: true,
      match: { t1, t2 },
      analysis: validated,
      matchInfo: aggregated.matchInfo || null,
      dataSources,
      sourceProbabilities,
      recentForm,
      generatedAt: new Date().toISOString(),
      cached: false,
      _cache: buildCacheMeta(cacheKey, false, { createdAt: new Date().toISOString(), ttlMs: aiConfig.get().cacheTtl * 1000 }),
    });
  } catch (e) {
    console.error('[AI route] LLM 调用失败:', e.message);
    console.error('[AI route] ERROR stack:', e.stack?.slice(0,1000));

    if (e.message.includes('abort') || e.message.includes('timeout')) {
      return res.json({
        success: false,
        dataSources, // ← 关键：即使 LLM 超时也返回数据源
        error: 'AI 服务超时，请稍后重试。以下数据源已就绪。',
        timeout: true,
        llmFailed: true,
        actionable: false,
      });
    }

    // LLM 失败但数据聚合成功 —— 返回部分成功
    res.json({
      success: false,
      error: `AI 分析暂不可用: ${e.message.slice(0, 200)}`,
      dataSources,     // ← 关键：返回已聚合的数据源
      llmFailed: true,
      actionable: false,
    });
  }
});

/**
 * GET /api/ai/status
 * 检查 AI 功能是否可用
 */
router.get('/status', async (req, res) => {
  const enabled = aiConfig.enabled();
  const cfg = aiConfig.get();

  const result = {
    enabled,
    model: cfg.model,
    apiBase: cfg.apiBase,
    cacheTtl: cfg.cacheTtl,
    maxTokens: cfg.maxTokens,
  };

  if (enabled) {
    try {
      const conn = await testConnection();
      result.reachable = conn.reachable;
      if (!conn.reachable) result.error = conn.error;
    } catch {
      result.reachable = false;
      result.error = '连通性测试异常';
    }
  }

  res.json(result);
});

/**
 * 验证并修复 LLM 返回的分析结果
 */
function validateAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object') {
    throw new Error('LLM 返回无效的分析结果');
  }

  // 确保 probabilities 存在且总和 ≈1
  if (!analysis.probabilities) {
    analysis.probabilities = { homeWin: 0.33, draw: 0.34, awayWin: 0.33 };
  }
  const p = analysis.probabilities;
  if (typeof p.homeWin !== 'number') p.homeWin = 0.33;
  if (typeof p.draw !== 'number') p.draw = 0.34;
  if (typeof p.awayWin !== 'number') p.awayWin = 0.33;

  // 确保概率和归一化
  const sum = p.homeWin + p.draw + p.awayWin;
  if (sum > 0) {
    p.homeWin = +(p.homeWin / sum).toFixed(4);
    p.draw = +(p.draw / sum).toFixed(4);
    p.awayWin = +(p.awayWin / sum).toFixed(4);
  }

  // 确保 confidence 存在
  if (typeof analysis.confidence !== 'number') analysis.confidence = 0.5;

  // 确保 scorePrediction 存在
  if (!analysis.scorePrediction || typeof analysis.scorePrediction.home !== 'number') {
    analysis.scorePrediction = { home: 1, away: 1 };
  }

  // 确保 reasoning 存在
  if (!analysis.reasoning) analysis.reasoning = 'AI 分析已完成。';
  if (!Array.isArray(analysis.keyFactors)) analysis.keyFactors = [];
  if (!Array.isArray(analysis.riskFactors)) analysis.riskFactors = [];

  // 确保 recommendedPick
  if (!['home', 'draw', 'away'].includes(analysis.recommendedPick)) {
    const maxKey = Object.entries(p).reduce((a, b) => a[1] > b[1] ? a : b)[0];
    analysis.recommendedPick = maxKey === 'homeWin' ? 'home' : maxKey === 'awayWin' ? 'away' : 'draw';
  }

  return analysis;
}

export default router;
