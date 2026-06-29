# Phase 10 - 任务 D: 比分推荐方向一致性与比赛详情页改版

> 对应原 PHASE10.md 10.3 + 10.6 的细化与边界约定。
> 依赖：任务 C 的赔率增强接口（Tab 2 使用），但展示层 fallback 机制使 TV 上可独立交付。

---

## 1. 目标

比分推荐控制在 Top 3 且与胜平负方向一致，消除"推荐分裂感"；同时升级比赛详情页的结构、视觉和性能。

- Top3 与主方向一致率 >= 95%。
- 首屏关键信息在桌面/移动端均可见。
- 页面加载时间 <= 800ms（缓存命中）。

---

## 2. 任务拆解

### 2.1 方向门控工具

文件: `server/ml/inference/poisson.js`

新增函数:

```js
/**
 * 方向门控过滤 Top N 比分
 * @param {Array} topScores - [{ home, away, probability }] (来自 computeTopScores)
 * @param {string} mainDirection - 'home' | 'draw' | 'away'
 * @param {number} n - 需要返回的条数（默认 3）
 * @returns {Array} 方向一致的最多 n 条 + 补齐的最近邻
 */
export function filterScoresByDirection(topScores, mainDirection, n = 3)
```

门控逻辑:

| mainDirection | 保留条件 | 补齐策略 |
|---------------|---------|---------|
| home | home > away | 按 probability 降序取 home > away 的比分优先；若不足 n 条，从"home 与 away 差值最小"的比分中补足（保持 home > away） |
| draw | home === away | 优先保留平局比分；若不足，按"总进球数与最可能平局比分最接近"补齐 |
| away | home < away | 同 home 逻辑，方向对称 |

主方向判定: 取 `probabilities` 中值最大的结果（homeWin / draw / awayWin）。

### 2.2 Top3 一致性集成

文件: `server/ml/inference/predictor.js`

在 `predictMatch()` 返回结果之前，对 `topScores` 字段增加方向过滤：

- 调用 `filterScoresByDirection(topScores, mainDirection, 3)` 替换原有的 `computeTopScores(matrix, 5)` 得到的 Top 5
- 在输出的 `topScores` 中保持与原有结构一致：`[{ home, away, probability }]`
- 在 `metadata` 中增加字段: `{ directionGate: { mainDirection, originalTopScores: [...], gated: true } }`

### 2.3 比赛详情页三 Tab 结构

文件: `views/pages/match.ejs`

按照分层 Tab 结构重构页面。现有引擎选择器（Elo/ML/集成 Tab）保持不变，三 Tab 是**下面的次级导航**。

**Tab 结构:**

| Tab | 标题 | 内容 | 渲染方式 |
|-----|------|------|---------|
| 结论 | 预测结论 | 胜平负概率卡片 + Top3 比分 + 风险等级 + 引擎切换 | 服务端 EJS 预渲染 |
| 分歧 | 市场分歧 | 赔率公司对比 + Polymarket + 模型三角分歧 + 竞彩（如有） | 客户端懒加载 fetch |
| 数据 | 数据详情 | 预期进球 λ、大小球、BTTS、历史趋势、特征明细 | 客户端懒加载 fetch |

**服务端预渲染内容（结论 Tab 直接嵌入 EJS）:**

```ejs
<div id="conclusion-tab" class="tab-content active">
  <!-- 概率卡片 - 服务端直接输出 -->
  <div class="prediction-summary">
    <div class="prob-card" style="background: <%= homeProbBg %>">
      <span class="prob-label">主胜</span>
      <span class="prob-value"><%= prediction.probabilities.homeWin %>%</span>
    </div>
    <!-- draw, awayWin 类似 -->
  </div>
  <!-- Top3 比分 - 服务端直接输出 -->
  <div class="top-scores">
    <% topScores.forEach(s => { %>
      <div class="score-item"><%= s.home %>:<%= s.away %></div>
    <% }) %>
  </div>
  <!-- 风险等级 - 服务端直接输出 -->
  <div class="risk-badge"><%= prediction.risk.level %></div>
</div>
```

**客户端懒加载内容:**

```html
<div id="divergence-tab" class="tab-content" data-lazy="/api/odds/fusion/match/<%= t1 %>/<%= t2 %>">
  <div class="lazy-placeholder">加载市场分歧...</div>
</div>
<div id="data-tab" class="tab-content" data-lazy="/api/matches/detail/<%= t1 %>/<%= t2 %>">
  <div class="lazy-placeholder">加载数据详情...</div>
</div>
```

### 2.4 CSS 主题升级

文件: `public/css/app.css`

新增/修改:

- `--color-primary`, `--color-bg`, `--color-card`, `--color-text` 等 CSS 自定义属性（variables），集中在文件头部
- Tab 导航样式: `.tab-nav` / `.tab-btn` / `.tab-btn.active`（底部横线高亮模式）
- 首屏固定布局: 使用 `position: sticky` 将引擎选择器和 Tab 导航固定在顶部
- 移动端优化: 
  - 结论 Tab 中概率卡片使用 flex wrap，单行宽度自适应
  - Top3 比分以大号数字突出显示
  - 风险等级使用颜色标识（绿/黄/红）
- 卡片密度: 间距由 16px 缩小到 12px，信息密度更高
- 加载占位符样式: `.lazy-placeholder` 使用骨架屏效果（灰色渐变闪烁）

### 2.5 JS 交互优化

文件: `public/js/app.js`（新建或修改现有内联脚本）

核心功能:
- Tab 切换（点击 tab-btn 切换 tab-content 的 active 状态）
- 懒加载控制器: 当某个 tab-content 的 `data-lazy` 属性存在且尚未加载时，fetch 对应 URL 并渲染内容；切换 Tab 时自动触发
- 引擎切换后触发三 Tab 整体刷新，结论 Tab 整页重载，其他 Tab 重新 fetch
- 缓存已加载的 Tab 内容，在引擎切换时清除缓存
- 移动端 touch 优化：Tab 导航支持左右滑动

文件结构建议: 将现有 match.ejs 中的 `<script>` 内联代码提取到独立 JS 文件中。

---

## 3. 交付物清单

| # | 文件 | 类型 | 说明 |
|---|------|------|------|
| 1 | server/ml/inference/poisson.js | 修改 | 新增 filterScoresByDirection 函数 |
| 2 | server/ml/inference/predictor.js | 修改 | predictMatch 中集成方向门控 Top3 |
| 3 | views/pages/match.ejs | 重写 | 三 Tab 结构，服务端预渲染 + 客户端懒加载 |
| 4 | public/css/app.css | 修改 | CSS 变量、Tab 样式、移动端、骨架屏 |
| 5 | public/js/app.js | 新文件（或拆分） | Tab 切换、懒加载、缓存管理（提取自原有内联脚本） |
| 6 | docs/PHASE10-TASK-D.md | 当前文档 | 任务文档 |

---

## 4. 验收标准

| 指标 | 目标值 | 验证方式 |
|------|--------|---------|
| 方向一致率 | Top3 与主方向一致率 >= 95% | 对回测数据集运行方向门控，统计一致比分比例 |
| 候选不足补齐 | 门控后不足 3 条时能补齐到 3 条 | 构造极端场景（如主胜但泊松产出 1 个主胜比分）验证 |
| 首屏关键信息 | 概率 + Top3 + 风险在 1.5 屏内可见 | 桌面 1280px + 移动端 375px 截图验证 |
| Tab 切换 | 点击 Tab 按钮切换内容 | 手动操作验证 |
| 懒加载 | 结论 Tab 无额外 fetch，分歧/data Tab 首次点击才拉取 | 打开网页查看 Network Tab |
| 加载时间 | <= 800ms（缓存命中时） | 缓存预热后测量 |
| 引擎切换 | 切换引擎后所有 Tab 刷新 | 手动验证 |

---

## 5. 边界约定

- 不修改原有引擎选择器（Elo/ML/集成）的样式和逻辑，仅在其下方新增 Tab 导航。
- 不改变页面 URL 结构（仍为 /match/:t1/:t2）。
- 现有 match.ejs 中 knockout 加时/点球分解面板、赔率融合面板等逻辑保留，重新归属到对应 Tab 下。
- 不引入新的前端框架（保持纯 JS + EJS）。
- 分歧 Tab 依赖任务 C 的 /api/odds/fusion/match/:t1/:t2 接口。如果任务 C 未完成，分歧 Tab 显示"数据加载中"并 graceful degradation。
- 方向门控只影响比分推荐的展示，不影响概率数值本身。

---

## 6. 关键技术决策

- 结论 Tab 采用服务端预渲染，确保首屏即见核心信息，不需要等待 JS 执行。
- 懒加载按需触发，而非预加载所有 Tab——减少首屏网络请求数量。
- 方向门控在服务端执行，不依赖客户端 JS 计算，保证一致性。
- CSS 自定义属性集中在文件头部，后续主题切换只需修改变量值。
- 移动端以 375px 为设计基准宽度，使用 `@media (max-width: 480px)` 作为断点。
- JS 独立文件使缓存友好，且与 EJS 模板解耦。
- 方向门控中的"最近邻补齐"策略: 按 (home - away) 与目标方向的偏差绝对值排序，取偏差最小的补足，使推荐的比分尽可能接近主方向。
