> 本文档为 Phase 10 完成后的代码审查记录，已包含追溯标注。
> 其中的集成差距已在以下 Phase 文档中分解为具体开发任务:
>   - PHASE11-ADMIN-DASHBOARD.md  — ELO管理/数据新鲜度/系统监控
>   - PHASE12-ODDS-ENHANCEMENT.md — 竞彩网/公司明细/映射统一
>   - PHASE13-PERF-NAV.md         — 预渲染/对手矩阵/导航文档
> 本文档保留作为分析追溯参考，不再作为待办清单。
# Phase 10 — 功能特性集成审查与建议

> 本文档基于代码审查整理，记录 Phase 10 功能的集成完成度、未集成到页面的 API/特性、以及已知问题。
> 不涉及代码修改，仅作为后续集成开发的需求文档。

生成日期: 2026-06-30

---

## 一、Phase 10 实现完成度确认

| 任务 | 交付物 | 状态 | 验证文件 |
|------|--------|------|---------|
| A: 数据新鲜度 | check_data_freshness.mjs | ✅ | scripts/ |
| A: 数据新鲜度 | update_training_data.mjs | ✅ | scripts/ |
| A: 数据新鲜度 | /api/ml/freshness 端点 | ✅ | server/index.js |
| A: 数据新鲜度 | /api/ml/status freshness 字段 | ✅ | server/index.js |
| B: ELO 更新 | update_elo_from_results.mjs | ✅ | server/ml/elo/ |
| B: ELO manifest | data/elo-manifests/ | ✅ | data/ |
| B: ELO 回滚 | rollback_elo.mjs | ✅ | scripts/ |
| B: ELO 回缩 | shrink_elo.mjs | ✅ | scripts/ |
| C: 赔率多源 | oddsApi.js 多公司增强 | ✅ | server/services/ |
| C: 赔率共识 | consensus + divergence 输出 | ✅ | oddsApi.js (export) |
| C: 竞彩适配器 | china_sports_lottery.js | ✅ | server/ml/odds/sources/ |
| C: 队名映射 | CN_NAME_TO_SLUG 表(代码) | ✅ | china_sports_lottery.js |
| C: 竞彩文档 | docs/ODDS_SOURCES_CN.md | ✅ | docs/ |
| D: 方向门控 | filterScoresByDirection | ✅ | poisson.js |
| D: Top3 一致性 | predictor.js 集成 | ✅ | predictor.js |
| D: Tab 结构 | match.ejs 三 Tab 重构 | ✅ | views/pages/match.ejs |
| D: 懒加载 | 分歧+数据 Tab lazy load | ✅ | match.ejs |
| D: CSS 变量 | app.css 自定义属性 | ✅ | public/css/app.css |
| D: JS 独立文件 | public/js/app.js | ✅ | public/js/ |

> 结论: Phase 10 所有交付物已全部存在于代码库中。

---

## 二、API 端点完整度审查

以下 API 端点存在于服务端但未被任何视图页面消费:

| 端点 | 用途 | 未集成情况 | 优先级 |
|------|------|-----------|--------|
| /api/matches/upcoming | 未来 14 天未开赛比赛 | 无页面使用 | 中 |
| /api/odds/available | 有赔率的比赛+公司列表 | 调试用,无管理页 | 低 |
| /api/odds/events | 赛程事件 ID 列表 | 调试端点 | 低 |
| /api/odds/polymarket/match/:t1/:t2 | 单场 Polymarket 价格 | 分歧 Tab 只用了融合 | 中 |
| /api/knockout/opponent-matrix | 淘汰赛对手分布矩阵 | 无全局矩阵页面 | 中 |
| /api/cache/stats | 缓存命中率统计 | 无管理页面 | 低 |
| /api/health | 服务器健康度 | 无监控页面 | 低 |

---

## 三、功能特性未集成到页面的清单

### 3.1 ELO 管理无页面

Phase 10 新增了 4 个 ELO 脚本但没有任何页面展示或触发它们:

| 功能 | 当前入口 | 缺失的 UI |
|------|---------|----------|
| ELO 批量更新 | node update_elo_from_results.mjs --from 日期 | 无触发按钮/进度/历史 |
| ELO Manifest 浏览 | data/elo-manifests/ JSON 文件 | 无列表页/delta 汇总 |
| ELO 回滚 | node rollback_elo.mjs --to manifestId | 无选择 UI/确认/记录 |
| ELO 回缩 | node shrink_elo.mjs [--rate 0.015] | 无触发 UI/参数配置 |
| ELO 变化监控 | 手动查看 manifests | 无走势图/Top Mover |

建议: 创建 /admin/elo 管理页: 更新历史列表+ELO排名+一键更新+manifest回滚+回缩触发。

### 3.2 数据训练管理无页面

| 功能 | 当前入口 | 缺失的 UI |
|------|---------|----------|
| 数据新鲜度 | /api/ml/freshness API | 页面无状态展示 |
| 特征重导出 | node update_training_data.mjs | 无导出按钮/进度 |
| 训练建议 | 脚本 stdout | 无页面通知 |

建议: 在 /online-learning 或 /admin/data 页面加入状态面板。

### 3.3 竞彩网数据无页面展示

| 功能 | 当前入口 | 缺失的 UI |
|------|---------|----------|
| 竞彩数据导入 | data/odds/china-sports-lottery/ | 无上传/导入状态 |
| 竞彩数据展示 | china_sports_lottery.js getMatch() | 无展示页面 |
| 竞彩对比 | fusion.js sources | 无比对表格 |

建议: 分歧 Tab 中将竞彩作为独立信源始终加载，或 polymarket 页面增加竞彩 Tab。

### 3.4 页面导航缺失

| 页面路由 | 功能 | 当前发现 |
|----------|------|---------|
| /online-learning | 在线学习看板 | header 导航无此链接 |
| /backtest | 模型回测结果 | header 导航无此链接 |
| /methodology | 模型方法论说明 | header 导航无此链接 |

### 3.5 README.md API 文档缺失

以下端点未在 README.md 的 API 表格中列出:

/api/matches/detail/:t1/:t2, /api/knockout/qualifiers, /api/knockout/third-rank,
/api/knockout/bracket, /api/knockout/path/:slug, /api/knockout/opponent-matrix,
/api/odds/polymarket/match/:t1/:t2, /api/odds/fusion/today, /api/odds/fusion/status,
/api/ml/freshness, /api/cache/stats, /api/health

---

## 四、已知技术问题

### 4.1 赔率 API 免费版限制

oddsApi.js 使用 DEFAULT_BOOKMAKERS.slice(0, 2) — 免费 API 每请求最多 2 家公司。
实际可用多公司赔率最多 2 家，达不到 KPI >= 3 家。
建议: 升级 API 套餐或在 unified.js 中增加多源聚合逻辑。

### 4.2 竞彩网在融合链路中的位置不当

unified.js 的 fetchAllSources() 将竞彩放在 sources.length === 0 才触发，
竞彩数据很少参与融合展示。
建议: 改为始终尝试加载竞彩网信源。

### 4.3 队名映射重复维护

中文队名映射表存在于 china_sports_lottery.js (~110条) 和 unified.js (~55条) 两处。
建议: 统一从 china_sports_lottery.js 导出，unified.js 通过 import 引用。

### 4.4 match.ejs 结论 Tab 仍用客户端渲染

filterScoresByDirection() 在服务端执行，但 match.ejs 结论 Tab 仍用客户端 fetch 渲染，
与 TASK-D "服务端预渲染"策略不一致，存在白屏窗口。
建议: 核心概率/Top3比分/风险通过 EJS 变量直接输出到 HTML。

### 4.5 博彩公司明细未完全暴露

oddsApi.js 导出 calculateDivergence 和 buildBookmakerDetails，
但 /api/odds/match/:t1/:t2 响应未包含这些字段。
建议: 在路由响应中增加 bookmakerDetails 和 divergence 字段。

---

## 五、集成优先级建议

| 优先级 | 建议 | 预估 | 关联 |
|--------|------|------|------|
| P0 | match.ejs 结论 Tab 服务端预渲染 | 中型(2-3天) | TASK-D |
| P0 | 分歧 Tab 集成公司明细+竞彩网 | 中型(2-3天) | TASK-C |
| P1 | 升级赔率 API 达 >=3 家公司 | 视方案定 | TASK-C |
| P1 | ELO 管理页面 | 大型(4-5天) | TASK-B |
| P1 | 数据新鲜度管理面板 | 中型(2-3天) | TASK-A |
| P2 | header 导航补充三个页面链接 | 小型(0.5天) | - |
| P2 | 统一队名映射表 | 小型(0.5天) | TASK-C |
| P3 | 对手矩阵页面 | 中型(2天) | - |
| P3 | README.md API 表格补全 | 小型(0.5天) | - |
| P3 | 健康检查/缓存监控页 | 中型(2天) | - |

---

## 六、总结

Phase 10 代码实现完整，所有交付物均已存在。核心问题在"已实现的功能没有被页面有效集成":

1. ELO 管理层 — 4 个脚本无 UI 入口，仅命令行可操作
2. 数据新鲜度层 — API 就绪但页面无状态提示和操作入口
3. 赔率展示层 — 竞彩网数据/公司明细已实现但未被 match.ejs 充分使用
4. 首屏性能 — 仍用客户端渲染，未达预渲染 KPI
5. 导航和文档 — 部分页面和 API 缺少链接和记录

> 后续建议重心从"加功能"转"做集成": 功能集成进页面、管理端工具、导航和文档完善。

