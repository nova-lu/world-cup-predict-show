# Phase 13 — 页面性能优化与导航体验

> 基于 PHASE-INTEGRATION-GAPS.md 3.4 (导航缺失), 3.5 (README文档缺失), 4.4 (结论Tab客户端渲染), 以及 2 (未用API端点) 的需求扩展。
> 目标: 优化 match.ejs 首屏性能达到 <=800ms KPI，补全导航和文档，创建对手矩阵页面。

---

## 1. 目标

- match.ejs 结论 Tab 改为服务端 EJS 预渲染，消除白屏窗口
- 创建对手矩阵页面，使用已有的 /api/knockout/opponent-matrix 端点
- Header 导航补全 online-learning / backtest / methodology 链接
- README.md API 表格补全所有已有端点

---

## 2. 任务拆解

### 2.1 match.ejs 结论 Tab 服务端预渲染

这是最高优先级的性能优化。当前 match.ejs 完全依赖客户端 JS fetch 渲染，存在明显的白屏窗口。

#### 现状分析

- `server/index.js` 中 `/match/:t1/:t2` 路由仅传入 `{ title, page, team1Slug, team2Slug }`
- match.ejs 在客户端执行 `loadMatchData()` → fetch `/api/matches/match/:t1/:t2` + compare → innerHTML
- 首屏的加载顺序: HTML → CSS → JS → fetch → 渲染，整个过程约 1-3 秒

#### 修改方案

步骤 1: 在 `/match/:t1/:t2` 路由中增加服务端预测预取

```js
// server/index.js
app.get("/match/:t1/:t2", async (req, res) => {
  const { t1, t2 } = req.params;
  let serverPrediction = null;
  try {
    // 使用 Elo 引擎做服务端预渲染（快速、无依赖）
    const { predictMatch } = await import("./services/predictionService.js");
    const eloPred = predictMatch(t1, t2);
    // 转为统一概率格式
    const { normalizePrediction, toProbabilities } = await import("./ml/utils/probability.js");
    normalizePrediction(eloPred, "elo");
    serverPrediction = {
      homeName: eloPred.home?.name || t1,
      awayName: eloPred.away?.name || t2,
      homeProb: (eloPred.probabilities.homeWin * 100).toFixed(1),
      drawProb: (eloPred.probabilities.draw * 100).toFixed(1),
      awayProb: (eloPred.probabilities.awayWin * 100).toFixed(1),
      xgHome: eloPred.expectedGoals.home,
      xgAway: eloPred.expectedGoals.away,
      // Top3 比分（带方向门控）
      topScores: getServerTopScores(eloPred),
      riskLevel: computeServerRisk(eloPred),
    };
  } catch (e) {
    console.warn("[server-render] 预渲染失败:", e.message);
    // 失败不影响页面，客户端 JS 会兜底
  }
  res.render("pages/match", {
    title: `${t1} vs ${t2} · 赛前预测`,
    page: "match-detail",
    team1Slug: t1,
    team2Slug: t2,
    serverPrediction: serverPrediction, // 新增：服务端预渲染数据
  });
});
```

步骤 2: match.ejs 修改

结论 Tab 的判断逻辑:
```
<% if (serverPrediction) { %>
  <!-- 服务端预渲染：直接输出 HTML -->
  <div class="prediction-summary">
    <div class="prob-card prob-home-bg">
      <span class="prob-label">主胜</span>
      <span class="prob-value"><%= serverPrediction.homeProb %>%</span>
    </div>
    <!-- draw, awayWin 类似 -->
  </div>
  <div class="top-scores">
    <% serverPrediction.topScores.forEach(s => { %>
      <div class="score-item"><%= s.home %>:<%= s.away %></div>
    <% }) %>
  </div>
  <div class="risk-badge"><%= serverPrediction.riskLevel %></div>
<% } else { %>
  <!-- 服务端预渲染不可用时的加载占位 -->
  <div id="prediction-detail-placeholder" class="lazy-placeholder">
    <div class="skeleton-line"></div>
    <div class="skeleton-line"></div>
  </div>
<% } %>
```

步骤 3: 客户端 JS 增强

- 初始加载时，如果服务端已渲染数据，客户端 JS 跳过 fetch，直接使用已渲染的内容
- 引擎切换时 (switchEngine)，仍然通过客户端 fetch 获取新引擎数据，并替换结论 Tab 内容
- 区分"首屏"和"引擎切换": 首屏不 fetch，引擎切换才 fetch

具体修改:
```js
// match.ejs 内联脚本
const hasServerRender = <%= JSON.stringify(!!serverPrediction) %>;

async function loadMatchData(force, engine) {
  if (hasServerRender && engine === "elo" && !force) {
    // 服务端已渲染 Elo 引擎数据，跳过 fetch
    document.getElementById("loading-spinner").style.display = "none";
    document.getElementById("prediction-detail").style.display = "block";
    // 仅加载次要数据（赔率、融合、比较）
    loadSecondaryData();
    return;
  }
  // 原有的客户端 fetch 逻辑...(keep for engine switching)
  // ...
}
```

#### 服务端预渲染的 TopScores + 方向门控

新增一个纯函数工具，供服务端路由调用:

文件: server/ml/inference/server-render.js (新文件)
```
export function getServerTopScores(eloPred, n = 3) {
  // 从 Elo prediction 计算 Poisson 矩阵 → Top3 → 方向门控
  const { computePoissonMatrix, computeTopScores, filterScoresByDirection } = await import("./poisson.js");
  const lambdaH = eloPred.expectedGoals.home;
  const lambdaA = eloPred.expectedGoals.away;
  const matrix = computePoissonMatrix(lambdaH, lambdaA);
  const rawTop = computeTopScores(matrix, 5);
  // 确定主方向
  const p = eloPred.probabilities;
  const mainDir = p.homeWin > p.draw && p.homeWin > p.awayWin ? "home"
    : p.draw > p.homeWin && p.draw > p.awayWin ? "draw" : "away";
  return filterScoresByDirection(rawTop, mainDir, n);
}

export function computeServerRisk(eloPred) {
  // 简化版风险等级（纯 Elo 引擎）
  const p = eloPred.probabilities;
  const maxProb = Math.max(p.homeWin, p.draw, p.awayWin);
  if (maxProb >= 0.55) return "low";
  if (maxProb >= 0.35) return "medium";
  return "high";
}
```

涉及文件:
- server/index.js — /match/:t1/:t2 路由增加服务端预测
- server/ml/inference/server-render.js — 新文件，服务端渲染工具函数
- views/pages/match.ejs — 结论 Tab 区分服务端/客户端渲染

### 2.2 对手矩阵页面

利用已有的 `/api/knockout/opponent-matrix` API 创建一个可视化页面。

#### 页面布局

文件: views/pages/opponent-matrix.ejs (新文件)

- 右上角统计: "淘汰赛队伍数: N | 覆盖对战组合: M 对"
- 主表格: 每队为一行
- 按轮次分栏 (R32 → R16 → QF → SF → Final)
- 每格显示: 对手队名 + 对阵概率 (基于 Elo)

数据表结构 (示例):

```
队伍    | R32             | R16         | QF    | SF    | Final
────────┼─────────────────┼─────────────┼───────┼───────|───────
阿根廷   | 沙特 (78%)      | 英格兰(55%) | 巴西  | 法国  | 西班牙
法国     | 澳大利亚 (82%)   | 瑞士 (60%)  | 葡萄牙 | 荷兰  | 德国
```

API 返回的 opponent-matrix 数据中，每个队伍的 path 对象包含在每个轮次的所有潜在对手。页面需要做:

1. 分组: 按队伍分组，每队一行
2. 轮次列: 每队在各轮次中的可能对手（如果有确定对手直接显示，如果有多个可能对手则显示最可能的 1-2 个）
3. 概率条: 可选，展示对阵 Elo 概率

#### 路由与导航

server/index.js:
```js
app.get("/opponent-matrix", (req, res) => {
  res.render("pages/opponent-matrix", {
    title: "2026世界杯 · 淘汰赛对手矩阵",
    page: "opponent-matrix",
  });
});
```

header.ejs 增加链接: `<a href="/opponent-matrix">对手矩阵</a>`

涉及文件:
- views/pages/opponent-matrix.ejs — 新页面
- server/index.js — 新增路由
- views/partials/header.ejs — 导航增加链接

### 2.3 Header 导航补全

文件: views/partials/header.ejs

当前导航链接:
```
今日 | 赛程 | 晋级 | 模拟 | 淘汰赛 | 模拟器 | 球队 | 市场 | Polymarket | 分析
```

需补充:
```
| 对手矩阵 | 在线学习 | 回测 | 方法论
```

导航栏总条目变多，建议对移动端做折叠处理 (已有移动端菜单按钮，只需确保新链接也在移动菜单中可见)。

完整导航顺序建议:
```
今日 | 赛程 | 晋级 | 淘汰赛 | 模拟器 | 球队 | 对手矩阵 | Polymarket | 在线学习 | 回测 | 分析 | 方法论
```

涉及文件:
- views/partials/header.ejs — 增加导航链接

### 2.4 README.md API 文档补全

文件: README.md

当前 README.md 的 API 端点表格缺失以下端点:

```
| GET /api/matches/detail/:t1/:t2 | 比赛详情数据(数据Tab) |
| GET /api/knockout/qualifiers | 出线球队列表 |
| GET /api/knockout/third-rank | 第三名竞争势态 |
| GET /api/knockout/bracket | 确定性淘汰赛对阵 |
| GET /api/knockout/path/:slug | 单队晋级路径分析 |
| GET /api/knockout/opponent-matrix | 对手分布矩阵 |
| GET /api/odds/polymarket/match/:t1/:t2 | 单场Polymarket价格 |
| GET /api/odds/fusion/today | 今日比赛融合数据 |
| GET /api/odds/fusion/status | 融合引擎状态 |
| GET /api/ml/freshness | 数据新鲜度状态 |
| GET /api/cache/stats | 缓存统计 |
| GET /api/health | 健康检查 |
```

同时更新"页面路由"表格，补充:

```
| /opponent-matrix | 淘汰赛对手矩阵 |
| /admin | 管理后台 |
```

涉及文件:
- README.md — 更新 API 表格 + 页面路由表格

---

## 3. 交付物清单

| # | 文件 | 类型 | 说明 |
|---|------|------|------|
| 1 | server/index.js | 修改 | /match/:t1/:t2 服务端预渲染 + /opponent-matrix 路由 |
| 2 | server/ml/inference/server-render.js | 新文件 | 服务端渲染工具 (TopScores方向门控+风险) |
| 3 | views/pages/match.ejs | 修改 | 结论 Tab 区分服务端/客户端渲染 |
| 4 | views/pages/opponent-matrix.ejs | 新文件 | 对手矩阵可视化页面 |
| 5 | views/partials/header.ejs | 修改 | 增加导航链接 |
| 6 | README.md | 修改 | API 表格 + 页面路由补全 |
| 7 | public/css/app.css | 修改 | 对手矩阵表格/骨架屏样式 |
| 8 | docs/PHASE13-PERF-NAV.md | 当前文档 | Phase 13 文档 |

---

## 4. 验收标准

| 指标 | 目标值 | 验证方式 |
|------|--------|---------|
| match 首屏加载 | <= 800ms (缓存命中) | Chrome DevTools Network 面板 |
| match 首屏无白屏 | 首帧即见概率和比分 | 截图对比 (改前: 加载中... → 改后: 直接显示) |
| 引擎切换 | 切换后客户端 fetch 替换结论 | 手动验证 Elo/ML/集成切换 |
| 对手矩阵页 | 显示所有队伍和各轮次对手 | 打开 /opponent-matrix 查看 |
| 导航完整性 | 新页面链接在 header 可见 | 查看导航条 |
| README 完整 | API 表格覆盖所有已有端点 | 对照路由文件逐条检查 |

---

## 5. 边界约定

- 服务端预渲染仅使用 Elo 引擎（最快、无外部依赖）。ML 和集成引擎仅在客户端引擎切换时通过 fetch 加载。
- 服务端预渲染失败时，页面自动降级为客户端全量渲染（不报错）。
- 对手矩阵页面使用已有 API 数据，不做新的数据计算。
- header 导航总条目变多，移动端使用已有的折叠菜单。
- 不对除 match.ejs 和 opponent-matrix.ejs 之外的其他页面做样式或结构修改。

---

## 6. 涉及的数据源汇总

| 数据源 | 类型 | 状态 |
|--------|------|------|
| predictionService.predictMatch | Node Module | ✅ 已有 |
| /api/matches/match/:t1/:t2 | REST API | ✅ 已有(客户端引擎切换用) |
| /api/knockout/opponent-matrix | REST API | ✅ 已有(对手矩阵页面用) |
| poisson.js (filterScoresByDirection) | Node Module | ✅ 已有(Phase 10) |
| /api/odds/fusion/match/:t1/:t2 | REST API | ✅ 已有(分歧 Tab 用) |

---

## 7. 页面加载对比 (改前 vs 改后)

| 阶段 | 改前 (全客户端) | 改后 (服务端预渲染) |
|------|---------------|-------------------|
| 请求 HTML | 1 次 | 1 次 (含预渲染数据) |
| 加载 CSS | 1 次 | 1 次 |
| 加载 JS | 1 次 | 1 次 |
| 客户端 fetch | 2-3 次 (match + compare + fusion) | 0 次 (首屏) |
| 首屏可见 | 约 1.5-3 秒 (等待 fetch) | < 800ms (HTML 直接渲染) |
| 引擎切换 | fetch 新数据 | fetch 新数据 (同改前) |
