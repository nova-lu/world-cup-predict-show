# Phase 11 — 运营管理仪表盘

> 基于 PHASE-INTEGRATION-GAPS.md 3.1 (ELO 管理)、3.2 (数据新鲜度)、3.5 (系统监控) 的需求扩展。
> 目标: 将当前仅命令行可操作的 ELO 更新/回滚/回缩、数据新鲜度检查/导出、系统监控集成到一个统一的管理页面中。

---

## 1. 目标

创建一个 /admin 管理页面，以 Tab 分页方式整合以下功能:

- ELO 排名实时查看、更新历史追溯、一键更新/回滚/回缩
- 数据新鲜度状态可视化、一键特征导出
- 系统健康度与缓存统计

让运维人员无需 SSH 进服务器执行脚本，即可完成日常运维操作。

---

## 2. 整体方案

### 2.1 页面结构

| 元素 | 方案 | 理由 |
|------|------|------|
| 路由 | 新建 /admin | 独立管理入口，不干扰用户页面 |
| 布局 | Tab 导航 (3 Tab) | 功能多但关联性强，Tab 切换免跳转 |
| 权限 | 无认证 (首版) | 个人工具站，后续可按需加 Basic Auth |
| 导航 | header 增加"管理"链接 | 同其他页面导航 |

清空缓存按钮置于页面标题右侧。

### 2.2 Tab 结构

| Tab ID | 标签 | 核心数据源 | 渲染方式 |
|--------|------|-----------|---------|
| elo-ranking | ELO 排名 | /api/teams | 服务端预渲染 |
| elo-history | 更新历史 | data/elo-manifests/ | 客户端 fetch |
| data-freshness | 数据新鲜度 | /api/ml/freshness | 客户端 fetch |
| ~~system~~ | ~~系统状态~~ | ~~(已移除，仅保留清空缓存按钮)~~ |

---

## 3. 任务拆解

### 3.1 管理页面框架

文件: views/pages/admin.ejs (新文件)

Tab 导航结构:

```
<nav class="admin-tabs">
  <button class="admin-tab active" data-tab="elo-ranking">ELO 排名</button>
  <button class="admin-tab" data-tab="elo-history">更新历史</button>
  <button class="admin-tab" data-tab="data-freshness">数据新鲜度</button>
</nav>
```

清空缓存按钮置于页面标题 `<h1>` 右侧。

服务端路由 (server/index.js):

```
app.get('/admin', (req, res) => {
  // 预取 teams 数据用于 elo-ranking Tab 服务端渲染
  const teams = getTeamsWithElo();
  res.render('pages/admin', {
    title: '管理后台',
    page: 'admin',
    teams: teams,
  });
});
```

### 3.2 Tab: ELO 排名 (elo-ranking)

| 项目 | 描述 |
|------|------|
| 数据源 | GET /api/teams (已有, 返回 teams[] 含 elo 字段) |
| 渲染方式 | 服务端 EJS 预渲染 |
| 实现方案 | /admin 路由中预取数据再传模板 |

页面内容:

- 顶部统计条: 总队伍数、最高ELO(队伍名+分)、最低ELO、平均分
- 排名表格 (服务端渲染):
  排名 | 球队(国旗) | ELO 评分 | 所属小组
  1    | 西班牙     | 2010     | B组
- 颜色区分: >=1950 金色, >=1850 绿色, >=1750 白色, <1750 灰色
- 每行可点击跳转到 /teams/:slug

涉及文件:
- views/pages/admin.ejs — elo-ranking 区段 (服务端 EJS)
- server/index.js — /admin 路由增加 teamData 变量

### 3.3 Tab: 更新历史 (elo-history)

| 项目 | 描述 |
|------|------|
| 数据源 | 新建 API: GET /api/admin/elo/manifests |
| 渲染方式 | 客户端 fetch 渲染表格 |

新建 API:

```
GET /api/admin/elo/manifests
→ 读取 data/elo-manifests/ 目录，解析所有 manifest JSON，按时间倒序排列
→ 响应:
{
  total: 5,
  manifests: [
    {
      manifestId: "elo_update_20260628_143000",
      generatedAt: "2026-06-28T14:30:00Z",
      matchesApplied: 4,
      matchRange: { from: "2026-06-27", to: "2026-06-28" },
      topMovers: [{ team: "DR Congo", delta: 8.5 }, ...]
    }
  ]
}
```

页面表格: 更新时间 | 比赛场次 | 日期范围 | Top Movers (前3) | 操作

操作列:
- "查看详情" → Modal 显示完整 matchDetails
- "回滚到此" → 确认框 → POST /api/admin/elo/rollback

新建 POST API:

```
POST /api/admin/elo/rollback
Body: { manifestId: "elo_update_20260627_120000" }
执行: child_process.exec → node scripts/rollback_elo.mjs --to manifestId
响应: { success: true, message: "...", rolledBackTo: "..." }
```

一键更新按钮 (表格上方):

- "执行批量更新" 按钮
- POST /api/admin/elo/update
- Body: { fromDate: "auto" }
- 执行: node server/ml/elo/update_elo_from_results.mjs --from 日期
- 成功后自动刷新 manifest 列表 + ELO 排名 Tab

一键回缩按钮:

- 弹出 Modal: 回缩速率输入 (default 0.015, min 0.005, max 0.05)
- POST /api/admin/elo/shrink
- 执行: node scripts/shrink_elo.mjs --rate 0.015
- 成功后刷新所有数据

涉及文件:
- views/pages/admin.ejs — elo-history 区段 + Modal 对话框
- server/routes/admin.js — 3 个新 POST API + 1 个 GET API
- public/js/admin.js — admin 交互逻辑

### 3.4 Tab: 数据新鲜度 (data-freshness)

| 项目 | 描述 |
|------|------|
| 数据源 | GET /api/ml/freshness (已有) |
| 渲染方式 | 客户端 fetch 渲染状态卡片 |

页面内容:

四个状态卡片:

| 卡片 | 数据字段 | 颜色逻辑 |
|------|---------|---------|
| 源数据日期 | freshness.lastDataDate | 正常蓝 |
| 特征数据日期 | freshness.lastFeatureDate | 正常蓝 |
| 数据滞后 | freshness.lagDays + "天" | lag=0绿; lag<=3黄; lag>3红 |
| 新增场次 | freshness.newMatchCount + "场" | >0 黄色提醒 |

操作区:

- "一键导出特征" 按钮 → POST /api/admin/data/export-features
  → 执行 node scripts/update_training_data.mjs --yes
  → 成功后刷新状态卡片

- 训练建议提醒 (条件显示):
  - 当 shouldSuggestTrain === true 时，显示黄色 Alert
  - 内容: "数据滞后超过阈值，建议重新训练模型"
  - "建议训练"按钮仅做提示，不触发训练 (同 TASK-A 约定)

| 涉及文件:
|- views/pages/admin.ejs — data-freshness 区段
|- server/routes/admin.js — POST /api/admin/data/export-features

### 3.5 Header 导航增加管理链接

文件: views/partials/header.ejs

在导航末尾增加:
```
<a href="/admin">管理</a>
```

---

## 4. 交付物清单

| # | 文件 | 类型 | 说明 |
|---|------|------|------|
| 1 | views/pages/admin.ejs | 新文件 | 管理页面模板(3 Tab + 清空缓存) |
| 2 | server/routes/admin.js | 新文件 | 管理 API 路由 |
| 3 | server/index.js | 修改 | 增加 /admin 路由 + /api/admin 挂载 |
| 4 | views/partials/header.ejs | 修改 | 增加"管理"导航链接 |
| 5 | public/css/app.css | 修改 | admin Tab/卡片/按钮样式 |
| 6 | public/js/admin.js | 新文件 | admin 交互逻辑 |
| 7 | docs/PHASE11-ADMIN-DASHBOARD.md | 当前文档 | Phase 11 文档 |

---

## 5. 验收标准

| 指标 | 目标值 | 验证方式 |
|------|--------|---------|
| ELO 排名显示 | 表格展示所有 48 队 + ELO | 打开 /admin 查看 elo-ranking Tab |
| ELO 更新触发 | 按钮执行批量更新并生成 manifest | 检查 data/elo-manifests/ 新文件 |
| ELO 回滚 | 选择 manifest 后回滚成功 | 对比回滚前后 elo-calibrated.json |
| ELO 回缩 | 回缩后排名变化 | 对比回缩前后数值 |
| 数据新鲜度展示 | 4 个卡片与 API 一致 | 对比 /api/ml/freshness |
| 特征导出 | 点击后特征文件更新 | 检查 features_full.csv 时间戳 |
| 清空缓存 | 点击弹出确认，清空后提示成功 | 点击按钮验证 |
| 导航 | /admin 链接可见 | 查看页面导航条 |

---

## 6. 边界约定

- ELO 更新/回滚/回缩/特征导出均通过子进程调用现有脚本，不重写业务逻辑。
- 管理页面无身份认证，后续可按需增加。
- POST API 为同步调用 (等待子进程完成)。超时 30 秒。
- 不涉及模型训练触发 (同 TASK-A)。
- 不对现有用户页面做任何修改。

---

## 7. 涉及的数据源汇总

| 数据源 | 类型 | 状态 |
|--------|------|------|
| /api/teams | REST API | ✅ 已有 |
| /api/ml/freshness | REST API | ✅ 已有 |
| /api/health | REST API | ✅ 已有 |
| /api/cache/stats | REST API | ✅ 已有 |
| data/elo-manifests/*.json | 本地文件 | ✅ 已有 |
| /api/admin/elo/manifests | REST API | ❌ 需新建 |
| /api/admin/elo/rollback | POST API | ❌ 需新建 |
| /api/admin/elo/update | POST API | ❌ 需新建 |
| /api/admin/elo/shrink | POST API | ❌ 需新建 |
| /api/admin/data/export-features | POST API | ❌ 需新建 |
