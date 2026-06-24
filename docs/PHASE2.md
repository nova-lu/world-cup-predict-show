# Phase 2 — 外部数据集成与完整功能迭代

## 现状（Phase 1 已完成）

- [x] Express 服务器 + API 路由
- [x] Elo + Dixon-Coles 模型服务化
- [x] 6 个前端页面（首页、预测详情、晋级榜、球队库、球队详情、模型说明）
- [x] 合规标注全覆盖
- [x] `football-data.org` API 已调通（Competition 2000），104 场比赛完整

## 待完成（Phase 2）

### 1️⃣ 外部数据集成（football-data.org API 服务层）

**P0 - 必须优先完成**

| 任务 | 说明 |
|---|---|
| Team name mapping | API 名称（48 队）→ 模型 slug 的映射表 |
| Match fetcher | 定时抓取赛程+结果，缓存策略 |
| Standings fetcher | 12 组实时积分榜拉取 |
| 降级策略 | API 超时/限流时 fallback 到本地 JSON |

### 2️⃣ 数据服务层重构

- 将 `dataService.js` 改造为：API 优先 → 缓存 → 本地 JSON 降级
- 今日赛事、赛程查询全部基于实时 API 数据
- 替换静态 `wc2026-results.json` 的使用

### 3️⃣ 核心预测逻辑强化

- 赛前预测：基于 API 赛程 + Elo 模型，自动计算所有未开赛比赛
- 比分分布重新实现（在 predictionService 中已完成，需端到端验证）
- 赛场事件：进球后重新计算胜率（后期迭代）

### 4️⃣ 蒙特卡洛完全实现

- 小组赛阶段：72 场小组赛模拟（已实现）
- **LAST_32**（16 强）：小组前 2 名 + 4 个最佳小组第三 → 32 队淘汰赛
- **LAST_16 → QF → SF → FINAL**：完整模拟
- THIRD_PLACE：季军赛模拟
- 输出：出线概率 / 8强概率 / 4强概率 / 决赛概率 / 夺冠概率

### 5️⃣ 前端完善

- 今日赛事页：从实时数据加载，显示今日确切的比赛时间
- 淘汰赛 bracket 可视化（可选，后期）
- 赛中实时胜率（P1 功能，需 WebSocket）

## 实施顺序

```
1. Team name mapping + football API service  ← 我今天先做这个
2. 重构 dataService（API 优先模式）
3. 验证今日赛事页有数据
4. 蒙特卡洛完整淘汰赛
5. 前端优化与测试
```

## 数据流

```
football-data.org API
        ↓ (每6小时轮询)
  footballApi.js (fetcher + 缓存)
        ↓
  dataService.js (API优先 → 缓存命中 → JSON降级)
        ↓
  predictionService.js (模型计算)
  monteCarloService.js (晋级概率)
        ↓
  REST API → 前端渲染
```
