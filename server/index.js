import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import matchesRouter from './routes/matches.js';
import standingsRouter from './routes/standings.js';
import teamsRouter from './routes/teams.js';
import oddsRouter from './routes/odds.js';  // Phase 7: 含 Polymarket + Fusion 路由
import bracketRouter from './routes/bracket.js';
import knockoutRouter from './routes/knockout.js'; // Phase 8.2
import adminRouter from './routes/admin.js'; // Phase 11: 管理 API
import aiRouter from './routes/ai.js'; // Phase 14: AI 分析 API
import { parseForceParam } from './middleware/parseForce.js';
import { checkDataFreshness } from '../scripts/check_data_freshness.mjs';
import { getAllTeams, getRatings } from './services/dataService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// EJS 模板引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// 静态文件
app.use(express.static(path.join(__dirname, '..', 'public')));

// JSON body parser (for POST requests)
app.use(express.json());

// 全局解析 force=1 参数（仅 /api 路由）
app.use('/api', parseForceParam);

// JSON API
app.use('/api/matches', matchesRouter);
app.use('/api/standings', standingsRouter);
app.use('/api/teams', teamsRouter);
app.use(oddsRouter);
app.use('/api/bracket', bracketRouter);
app.use('/api/admin', adminRouter); // Phase 11: 管理 API

// Phase 8.2: 淘汰赛过渡管线
app.use('/api/knockout', knockoutRouter);

// Phase 14: AI 分析 API
app.use('/api/ai', aiRouter);

// ML 引擎状态
app.get('/api/ml/status', async (req, res) => {
  try {
    const mlConfig = await import('./ml/config.js').then(m => m.default);
    let modelsReady = false;
    let modelInfo = null;
    let error = null;

    try {
      const predictor = await import('./ml/inference/predictor.js');
      modelsReady = await predictor.checkModels();
      if (modelsReady) {
        const manifest = await import('./ml/manifests/v1.json', { with: { type: 'json' } }).then(m => m.default).catch(() => null);
        modelInfo = manifest || { version: 'v1', status: 'manifest not found' };
      }
    } catch (e) {
      error = e.message;
    }

    // Phase 6.5c: 降级统计
    let degradeStats = null;
    try {
      const { getDegradeStats } = await import('./routes/matches.js');
      degradeStats = getDegradeStats();
    } catch {}

    // Phase 10: 数据新鲜度
    let freshness = null;
    try {
      freshness = checkDataFreshness();
    } catch { /* skip if scripts unavailable */ }

    res.json({
      enabled: mlConfig.enabled,
      engine: mlConfig.engine,
      version: mlConfig.version,
      modelsReady,
      modelInfo,
      // Phase 6.5a: 扩展字段
      ensemble: {
        base: { elo: mlConfig.ensemble.eloWeight, ml: mlConfig.ensemble.mlWeight },
        dynamic: mlConfig.ensemble.dynamic,
      },
      calibration: {
        version: modelInfo?.calibration?.version || 'platt-v1',
        calibrated: modelInfo?.calibration?.calibrated || true,
      },
      degrade: degradeStats || { degradeCount: 0 },
      // Phase 10: 数据新鲜度状态
      freshness,
      // Phase 18: Dixon-Coles 泊松修正状态
      poisson: {
        dcEnabled: mlConfig.poisson?.dcEnabled ?? true,
        dcRho: mlConfig.poisson?.dcRho ?? -0.13,
      },
      error,
    });
  } catch (e) {
    res.json({ enabled: false, error: e.message });
  }
});

// Phase 10: 数据新鲜度独立端点
app.get('/api/ml/freshness', (req, res) => {
  try {
    const freshness = checkDataFreshness();
    res.json(freshness);
  } catch (e) {
    res.json({ error: e.message, lastCheckAt: new Date().toISOString() });
  }
});

// ML 回测结果
app.get('/api/ml/backtest', async (req, res) => {
  try {
    const { runBacktest, getLastResult } = await import('./ml/backtest/engine.js');

    // ?check=1: 只检查缓存，不触发回测
    if (req.query.check === '1') {
      const cached = getLastResult();
      if (cached) return res.json(cached);
      return res.json({ success: false, summary: { total: 0, byYear: [] }, message: 'no cache' });
    }

    if (req.query.force === '1') {
      const results = await runBacktest({ force: true });
      return res.json(results);
    }
    const cached = getLastResult();
    if (cached) return res.json(cached);
    const results = await runBacktest({});
    return res.json(results);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 回测报告列表
app.get('/api/ml/backtest/reports', async (req, res) => {
  try {
    const { getReportList } = await import('./ml/backtest/engine.js');
    res.json({ reports: getReportList() });
  } catch (e) {
    res.json({ reports: [], error: e.message });
  }
});

// 加载指定回测报告
app.get('/api/ml/backtest/report/:filename', async (req, res) => {
  try {
    const safeName = path.basename(req.params.filename);
    const reportPath = path.resolve(__dirname, '../data/backtest/reports', safeName);
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ error: '报告不存在' });
    }
    const data = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 回测运行状态查询
app.get('/api/ml/backtest/status', async (req, res) => {
  try {
    const { isRunning } = await import('./ml/backtest/engine.js');
    res.json({ running: isRunning() });
  } catch (e) {
    res.json({ running: false, error: e.message });
  }
});

// 取消正在运行的回测
app.post('/api/ml/backtest/cancel', async (req, res) => {
  try {
    const { cancelBacktest } = await import('./ml/backtest/engine.js');
    const result = cancelBacktest();
    res.json(result);
  } catch (e) {
    res.status(500).json({ cancelled: false, error: e.message });
  }
});

app.get('/api/cache/stats', (req, res) => {
  import('./middleware/cache.js').then(mod => {
    const s = mod.stats();
    if (req.forceRefresh) {
      // force=1 时刷新缓存统计（清空后重新加载）
      mod.flush();
      mod.initCache().then(() => res.json(mod.stats()));
    } else {
      res.json(s);
    }
  });
});

// ===== Health check endpoint =====
app.get('/api/health', (req, res) => {
  const memory = process.memoryUsage();
  const uptime = process.uptime();
  res.json({
    status: 'ok',
    uptime: Math.floor(uptime),
    uptimeHuman: `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
    memory: {
      rss: Math.round(memory.rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memory.heapTotal / 1024 / 1024) + 'MB',
    },
    node: process.version,
    platform: process.platform,
    env: {
      port: PORT,
      nodeEnv: process.env.NODE_ENV || 'development',
      footballApi: !!process.env.FOOTBALL_API_KEY,
      oddsApi: !!process.env.ODDS_API_KEY,
    },
    timestamp: new Date().toISOString(),
  });
});

// ---------- 页面路由 ----------

// 首页：今日赛事
app.get('/', (req, res) => {
  res.render('pages/index', {
    title: '2026世界杯 · 48小时赛程（北京时间）',
    page: 'today',
    disclaimer: '所有预测数据基于数学模型计算，仅供娱乐参考，不构成任何决策建议。',
  });
});

// 赛程页
app.get('/schedule', (req, res) => {
  res.render('pages/schedule', {
    title: '2026世界杯 · 完整赛程',
    page: 'schedule',
  });
});

// 预测详情页
// Phase 13: 比赛详情页（服务端预渲染 Elo 数据）
app.get('/match/:t1/:t2', async (req, res) => {
  const { t1, t2 } = req.params;
  let serverPrediction = null;

  try {
    const { predictMatch, getScoreDistribution } = await import('./services/predictionService.js');
    const { getServerTopScores, computeServerRisk } = await import('./ml/inference/server-render.js');

    const eloPred = predictMatch(t1, t2);
    if (eloPred && eloPred.prob) {
      const topScores = getServerTopScores(eloPred, 3);
      const risk = computeServerRisk(eloPred);

      serverPrediction = {
        homeName: eloPred.home?.name || t1,
        awayName: eloPred.away?.name || t2,
        homeFlag: eloPred.home?.flag || '⚽',
        awayFlag: eloPred.away?.flag || '⚽',
        homeFlagPath: eloPred.home?.flagPath || null,
        awayFlagPath: eloPred.away?.flagPath || null,
        homeProb: eloPred.prob.winHome,
        drawProb: eloPred.prob.draw,
        awayProb: eloPred.prob.winAway,
        homeElo: eloPred.home?.elo || 0,
        awayElo: eloPred.away?.elo || 0,
        xgHome: eloPred.expectedGoals?.home,
        xgAway: eloPred.expectedGoals?.away,
        topScores: topScores.map(s => ({ home: s.home, away: s.away, prob: Math.round((s.probability || s.prob || 0) * 100) })),
        riskLevel: risk,
      };
    }
  } catch (e) {
    console.warn('[server-render] 预渲染失败:', e.message);
    // 不阻塞页面加载，客户端 JS 会兜底
  }

  res.render('pages/match', {
    title: `${t1} vs ${t2} · 赛前预测`,
    page: 'match-detail',
    team1Slug: t1,
    team2Slug: t2,
    serverPrediction,
    aiEnabled: true, // Phase 14: AI 分析功能已配置
  });
});

// 晋级概率榜
app.get('/standings', (req, res) => {
  res.render('pages/standings', {
    title: '2026世界杯 · 晋级概率榜',
    page: 'standings',
  });
});

// Phase 13: 对手矩阵
app.get('/opponent-matrix', (req, res) => {
  res.render('pages/opponent-matrix', {
    title: '2026世界杯 · 淘汰赛对手矩阵',
    page: 'opponent-matrix',
  });
});

// 球队信息库
app.get('/teams', (req, res) => {
  res.render('pages/teams', {
    title: '2026世界杯 · 球队信息库',
    page: 'teams',
  });
});

// 球队详情
app.get('/teams/:slug', (req, res) => {
  const { slug } = req.params;
  res.render('pages/team-detail', {
    title: `${slug} · 球队详情`,
    page: 'team-detail',
    teamSlug: slug,
  });
});

// 关于模型
app.get('/methodology', (req, res) => {
  res.render('pages/methodology', {
    title: '2026世界杯 · 预测模型说明',
    page: 'methodology',
  });
});

// 淘汰赛树
app.get('/bracket', (req, res) => {
  res.render('pages/bracket', {
    title: '2026世界杯 · 淘汰赛树',
    page: 'bracket',
  });
});

// Phase 8.6: 淘汰赛仪表盘
app.get('/knockout', (req, res) => {
  res.render('pages/knockout', {
    title: '2026世界杯 · 淘汰赛仪表盘',
    page: 'knockout',
  });
});

// 交互式模拟器
app.get('/simulator', (req, res) => {
  res.render('pages/simulator', {
    title: '2026世界杯 · 数据模拟器',
    page: 'simulator',
  });
});

// 模型回测
app.get('/backtest', (req, res) => {
  res.render('pages/backtest', {
    title: '2026世界杯 · 模型回测',
    page: 'backtest',
  });
});

// 分析文章
app.get('/blog', (req, res) => {
  res.render('pages/blog', {
    title: '2026世界杯 · 分析文章',
    page: 'blog',
  });
});

app.get('/blog/:slug', (req, res) => {
  res.render('pages/blog-article', {
    title: '文章 · 2026世界杯分析',
    page: 'blog',
    articleSlug: req.params.slug,
  });
});

// 世界杯最新资讯 API — 从新华网等源获取
const NEWS_CACHE = { data: null, ts: 0, TTL: 1800000 }; // 30min TTL
app.get('/api/blog/news', async (req, res) => {
  try {
    if (NEWS_CACHE.data && (Date.now() - NEWS_CACHE.ts) < NEWS_CACHE.TTL) {
      return res.json(NEWS_CACHE.data);
    }
    // 尝试从新华网获取
    let news = { items: [], source: 'xinhua', fetchedAt: new Date().toISOString() };
    try {
      const rsp = await fetch('https://www.news.cn/sports/topic/fifa2026/jfb.htm', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WorldCupBot/1.0)' },
        signal: AbortSignal.timeout(10000),
      });
      if (rsp.ok) {
        const html = await rsp.text();
        // 抓取 h3/a 标题
        const titleRegex = /<h3[^>]*>([\s\S]*?)<\/h3>/gi;
        const aRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        const allTitles = [];
        const seen = new Set();
        let m;
        while ((m = aRegex.exec(html)) !== null) {
          const text = m[2].replace(/<[^>]+>/g, '').trim();
          if (text.length > 8 && !seen.has(text)) {
            seen.add(text);
            let url = m[1];
            if (url.startsWith('/')) url = 'https://www.news.cn' + url;
            if (url.startsWith('http') && url.includes('news.cn')) {
              allTitles.push({ title: text, url, source: '新华网' });
            }
          }
        }
        // 过滤出世界杯相关
        news.items = allTitles.filter(t => /世界杯|淘汰赛|16强|晋级|点球|冷门|进球|梅西|姆巴佩/.test(t.title));
        news.items = news.items.slice(0, 20);
        news.source = 'xinhua';
      }
    } catch (e) {
      // fallback: 用嵌入数据
    }
    // 如果没抓到，用备选数据
    if (!news.items || news.items.length < 5) {
      news.items = [
        { title: '淘汰赛：16强已确定10席，多场焦点战激战正酣', url: 'https://www.news.cn/sports/topic/fifa2026/jfb.htm', source: '新华网' },
        { title: '美国2:0胜波黑 东道主全部晋级16强', url: 'https://www.news.cn/sports/topic/fifa2026/jfb.htm', source: '新华网' },
        { title: '法国3:0瑞典 姆巴佩双响创纪录', url: 'https://www.news.cn/sports/topic/fifa2026/jfb.htm', source: '新华网' },
        { title: '挪威胜科特迪瓦 哈兰德制胜球', url: 'https://www.news.cn/sports/topic/fifa2026/jfb.htm', source: '新华网' },
        { title: '墨西哥四连胜且零失球晋级16强', url: 'https://www.news.cn/sports/topic/fifa2026/jfb.htm', source: '新华网' },
        { title: '巴拉圭点球淘汰德国 荷兰点球负摩洛哥', url: 'https://www.news.cn/sports/topic/fifa2026/jfb.htm', source: '新华网' },
        { title: '巴西补时绝杀日本 2-1逆转晋级', url: 'https://www.news.cn/sports/topic/fifa2026/jfb.htm', source: '新华网' },
        { title: '凯恩双响 英格兰逆转刚果（金）晋级16强', url: 'https://www.news.cn/sports/topic/fifa2026/jfb.htm', source: '新华网' },
        { title: '比利时让二追三逆转塞内加尔', url: 'https://www.news.cn/sports/topic/fifa2026/jfb.htm', source: '新华网' },
        { title: '高温挑战：世界杯在美赛事面临超40度高温考验', url: 'https://www.news.cn/sports/topic/fifa2026/jfb.htm', source: '新华网' },
        { title: '亚洲球队整体表现分析：日本惜败巴西 韩国出局', url: 'https://www.news.cn/sports/topic/fifa2026/jfb.htm', source: '新华网' },
        { title: '摩洛哥创造历史——本届首支非洲16强球队', url: 'https://www.news.cn/sports/topic/fifa2026/jfb.htm', source: '新华网' },
      ];
    }
    NEWS_CACHE.data = news;
    NEWS_CACHE.ts = Date.now();
    res.json(news);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 预测市场 Demo
app.get('/demo', (req, res) => {
  res.render('pages/demo', {
    title: '2026世界杯 · 预测市场模拟',
    page: 'demo',
  });
});

// Phase 7: Polymarket 市场看板
app.get('/polymarket', (req, res) => {
  res.render('pages/polymarket', {
    title: '2026世界杯 · Polymarket 预测市场',
    page: 'polymarket',
  });
});

// Phase 7: 在线学习看板
app.get('/online-learning', (req, res) => {
  res.render('pages/online-learning', {
    title: '2026世界杯 · 在线学习看板',
    page: 'online-learning',
  });
});

// Phase 11: 管理后台
app.get('/admin', (req, res) => {
  try {
    const ratings = getRatings();
    const teams = getAllTeams().map(t => ({
      nameCn: t.name, nameEn: t.nameEn, slug: t.slug, flag: t.flag, group: t.group,
      elo: ratings[t.slug] || null,
    })).sort((a, b) => (b.elo || 0) - (a.elo || 0));

    res.render('pages/admin', {
      title: '管理后台',
      page: 'admin',
      teams,
    });
  } catch (e) {
    console.error('[admin] 加载 team 数据失败:', e.message);
    res.render('pages/admin', {
      title: '管理后台',
      page: 'admin',
      teams: [],
    });
  }
});

// Phase 14: AI 分析页面
app.get('/ai-analysis/:t1/:t2', async (req, res) => {
  const { t1, t2 } = req.params;
  const aiConfig = (await import('./ai/config.js')).default;
  const aiEnabled = aiConfig.enabled();
  // 获取中文队名
  const { getTeamInfo } = await import('./services/dataService.js');
  const homeInfo = getTeamInfo(t1);
  const awayInfo = getTeamInfo(t2);

  // 尝试从缓存读取已有分析结果
  let initialAnalysis = null;
  let initialDataSources = null;
  let initialSourceProbabilities = null;
  let initialRecentForm = null;
  let initialMatchInfo = null;
  if (aiEnabled) {
    try {
      const { get } = await import('./middleware/cache.js');
      const cached = get(`ai:analysis:${t1}:${t2}`, { ttlMs: aiConfig.get().cacheTtl * 1000 });
      if (cached.hit) {
        initialAnalysis = cached.value.analysis;
        initialDataSources = cached.value.dataSources;
        initialSourceProbabilities = cached.value.sourceProbabilities || null;
        initialRecentForm = cached.value.recentForm || null;
        initialMatchInfo = cached.value.matchInfo || null;
      }
    } catch {}
  }

  console.log('[AI page] cached:', JSON.stringify(initialAnalysis)?.slice(0, 60), 'dataSources:', initialDataSources ? 'yes' : 'no', 'recentForm:', initialRecentForm ? 'yes' : 'no');

  res.render('pages/ai-analysis', {
    title: `AI 分析 · ${t1} vs ${t2}`,
    page: 'ai-analysis',
    team1Slug: t1,
    team2Slug: t2,
    team1Name: homeInfo?.displayName || homeInfo?.name || t1,
    team2Name: awayInfo?.displayName || awayInfo?.name || t2,
    aiEnabled,
    initialAnalysis: JSON.stringify(initialAnalysis),
    initialDataSources: JSON.stringify(initialDataSources),
    initialSourceProbabilities: JSON.stringify(initialSourceProbabilities),
    initialRecentForm: JSON.stringify(initialRecentForm),
    initialMatchInfo: JSON.stringify(initialMatchInfo),
  });
}); // ← 这里补上了 app.get 的闭合

// 404
app.use((req, res) => {
  res.status(404).render('pages/404', { title: '404 · 页面未找到', page: '404' });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: '服务器内部错误', message: err.message });
});

app.listen(PORT, () => {
  console.log(`🌍 世界杯观赛数据助手启动: http://localhost:${PORT}`);
  console.log(`   AI 分析引擎: ${process.env.AI_API_KEY ? '✅ 已配置' : '⚠️ AI_API_KEY 未设置（LLM推理不可用，数据聚合仍正常）'}`);
  console.log(`   API 文档:`);
  console.log(`   GET /api/matches/today        今日赛事`);
  console.log(`   GET /api/matches/schedule      赛程列表`);
  console.log(`   GET /api/matches/upcoming      即将开赛`);
  console.log(`   GET /api/matches/match/:t1/:t2 单场预测`);
  console.log(`   GET /api/matches/compare/:t1/:t2 两队对比`);
  console.log(`   GET /api/matches/knockout-pred/:t1/:t2 淘汰赛加时/点球预测`);
  console.log(`   GET /api/knockout/qualifiers  出线球队(确定性)`);
  console.log(`   GET /api/knockout/third-rank  第三名竞争势态`);
  console.log(`   GET /api/knockout/bracket     确定性淘汰赛对阵`);
  console.log(`   GET /api/knockout/path/:slug  单队晋级路径分析`);
  console.log(`   GET /api/knockout/opponent-matrix 对手分布矩阵`);
  console.log(`   GET /api/standings/groups      小组积分榜`);
  console.log(`   GET /api/standings/advancement 晋级概率榜`);
  console.log(`   GET /api/teams                 球队列表`);
  console.log(`   GET /api/teams/:slug           球队详情`);
});
