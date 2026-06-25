import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matchesRouter from './routes/matches.js';
import standingsRouter from './routes/standings.js';
import teamsRouter from './routes/teams.js';
import oddsRouter from './routes/odds.js';
import bracketRouter from './routes/bracket.js';
import { parseForceParam } from './middleware/parseForce.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// EJS 模板引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// 静态文件
app.use(express.static(path.join(__dirname, '..', 'public')));

// 全局解析 force=1 参数（仅 /api 路由）
app.use('/api', parseForceParam);

// JSON API
app.use('/api/matches', matchesRouter);
app.use('/api/standings', standingsRouter);
app.use('/api/teams', teamsRouter);
app.use(oddsRouter);
app.use('/api/bracket', bracketRouter);

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
        const manifest = await import('./ml/manifests/v1.json', { assert: { type: 'json' } }).then(m => m.default).catch(() => null);
        modelInfo = manifest || { version: 'v1', status: 'manifest not found' };
      }
    } catch (e) {
      error = e.message;
    }

    res.json({
      enabled: mlConfig.enabled,
      engine: mlConfig.engine,
      version: mlConfig.version,
      modelsReady,
      modelInfo,
      error,
    });
  } catch (e) {
    res.json({ enabled: false, error: e.message });
  }
});

// ML 回测结果
app.get('/api/ml/backtest', async (req, res) => {
  try {
    const { runBacktest } = await import('./ml/backtest/engine.js');
    const results = await runBacktest(req.forceRefresh);
    res.json(results);
  } catch (e) {
    res.json({ status: 'error', engine: 'ml', message: e.message });
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
app.get('/match/:t1/:t2', (req, res) => {
  const { t1, t2 } = req.params;
  res.render('pages/match', {
    title: `${t1} vs ${t2} · 赛前预测`,
    page: 'match-detail',
    team1Slug: t1,
    team2Slug: t2,
  });
});

// 晋级概率榜
app.get('/standings', (req, res) => {
  res.render('pages/standings', {
    title: '2026世界杯 · 晋级概率榜',
    page: 'standings',
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

// 预测市场 Demo
app.get('/demo', (req, res) => {
  res.render('pages/demo', {
    title: '2026世界杯 · 预测市场模拟',
    page: 'demo',
  });
});

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
  console.log(`   API 文档:`);
  console.log(`   GET /api/matches/today        今日赛事`);
  console.log(`   GET /api/matches/schedule      赛程列表`);
  console.log(`   GET /api/matches/upcoming      即将开赛`);
  console.log(`   GET /api/matches/match/:t1/:t2 单场预测`);
  console.log(`   GET /api/matches/compare/:t1/:t2 两队对比`);
  console.log(`   GET /api/standings/groups      小组积分榜`);
  console.log(`   GET /api/standings/advancement 晋级概率榜`);
  console.log(`   GET /api/teams                 球队列表`);
  console.log(`   GET /api/teams/:slug           球队详情`);
});
