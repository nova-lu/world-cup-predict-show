# Phase 7 — 赔率融合引擎、分联赛迁移学习与在线学习体系

## 背景

Phase 1-6 已完成双引擎（Elo + ML）集成管线、统一概率协议、权重参数网格搜索、校准质量评估和线上可观测性。当前系统具备生产级集成能力：
- 三引擎切换（elo / ml / ensemble），动态权重门限
- 概率校准（Platt-v1）与 ECE 持续评估
- L1+L2 持久化缓存 + force 刷新
- 赔率数据源（odds-api.io）接入（Bet365 等 8 家博彩公司）

Phase 6 结论已指出：完成 Phase 6 后，再进入下一阶段（如赔率融合、分联赛迁移学习、在线学习）会更稳健。

2026 世界杯已开赛，实际比赛结果正在快速回流。当前系统有以下关键的进阶方向：

| 方向 | 现有能力 | 瓶颈 / 机遇 |
|------|---------|-------------|
| 赔率融合 | odds-api.io 单源展示 | 没有多源融合，无去抽水隐含概率融入模型 |
| 预测市场 | /demo 纯虚拟模拟器 | 未接入真实 Polymarket 数据 |
| 模型泛化 | 单一全量模型（46k 场） | 世界杯仅占 5%，分布不对齐 |
| 模型更新 | 静态训练 | 无法在线吸收赛时新信息 |
| 决策信号 | 双引擎独立预测 | 未将市场赔率作为第三信号源 |

Phase 7 核心目标是**构建从模型预测到多信源智慧融合的进化体系**。

---

## Phase 7 完成状态

| 任务 | 状态 | 说明 |
|------|------|------|
| 7.1 Polymarket API 接入 | ✅ 完成 | `sources/polymarket.js` + `mapper.js`, 公开 API, 缓存 1h/5min |
| 7.2 赔率融合引擎 | ✅ 完成 | `fusion/fusion.js` (log-odds + bayesian) + weights.js + calibrator.js |
| 7.3 分联赛迁移学习 | ⏳ 框架完成 | `data/tournament_hierarchy.js` T1-T5 标签系统 + fallback chain |
| 7.4 在线学习管线 | ⚡ 框架待补 | 配置已在 config.js, 看板页面已创建, 增量训练脚本待数据回流后启动 |
| 7.5 前端集成 | ✅ 完成 | match.ejs 融合面板 + polymarket.ejs + online-learning.ejs + 导航<br>CSS 样式 + API 路由全部完成 |

### 目标 G1：三源赔率融合
- 每场比赛三源概率对比（Model vs Market vs Polymarket）
- 融合概率输出（对数赔率加权 / 贝叶斯融合）
- 融合回测指标优于单源 baseline

### 目标 G2：Polymarket 成为可消费数据源
- 定时拉取 WC 2026 市场（比赛结果 / 晋级 / 冠军）
- 展示价格 / 成交量 / 流动性
- 对比市场智慧与模型偏差

### 目标 G3：ML 模型持续进化
- 按联赛层级分割训练（WC / Qualifiers / Continental / Friendlies）
- 赛时新结果在线增量吸收
- 模型版本管理 + 退化自动回滚

---

## 一、架构总览

`
Phase 7 架构扩展：

                            +-----------------------------+
                            |       前端展示（Phase 7 扩展） |
                            |  - 赔率融合面板                |
                            |  - Polymarket 市场看板         |
                            |  - 联赛切换器                  |
                            |  - 在线学习看板                |
                            +------------+----------------+
                                         |
                          +--------------+--------------+
                          |                             |
                 +--------v--------+          +--------v--------+
                 |  原有引擎（不变） |          |  Phase 7 新增    |
                 |  elo / ml / ens |          |  fusion 融合引擎  |
                 +--------+---------+          +--------+---------+
                          |                             |
                          +-------------+---------------+
                                        |
                           +------------v------------+
                           |   赔率融合服务 OddsFusion   |
                           |   server/ml/odds/fusion/    |
                           +------------+---------------+
                                        |
                +-------------------+----+----+-------------------+
                |                   |         |                   |
        +-------v------+   +------v------+  +v---------+  +------v------+
        | odds-api.io  |   | Polymarket  |  | ML Model |  | Elo Engine |
        | (现有8家)    |   | (GAMMA API)  |  | 概率输出   |  | 概率输出    |
        +--------------+   +------+------+  +----------+  +-------------+
                                  |
                        +---------v----------+
                        | 在线学习引擎 (OL)    |
                        | server/ml/online/   |
                        +--------------------+
`

### 设计原则
- **三源独立**：融合层不依赖任一源可用
- **融合可解释**：可追溯各源概率、权重、分歧原因
- **在线安全**：版本回滚、效果门限、灰度机制
- **渐进增强**：以面板形式增量添加，不破坏现有布局

---

## 二、任务分解

---

### 任务 7.1：Polymarket API 数据接入

目标：将 Polymarket GAMMA API 作为实时预测市场数据源引入系统。

#### 背景
Polymarket 是最大的去中心化预测市场。GAMMA API 提供开放的实时事件交易数据。WC 2026 存在大量活跃市场：单场 1X2 / 小组出线 / 冠军 / 金靴等。其真钱属性隐含概率仅含 2% 协议费，比传统博彩（3-8% 抽水）更能反映集体智慧。

#### 实施项
1. **GAMMA API 封装**（server/ml/odds/sources/polymarket.js）
   - 使用 Polymarket GAMMA API（公开，无需 API Key）
   - 端点：/events（按标签筛选）、/price、/market等
   - 自动发现 WC 2026 相关市场，匹配球队 slug
   - 参考文件：../markets.py

2. **数据缓存**：价格 1-5 分钟；市场列表 1 小时

3. **市场映射**（polymarket_mapper.js）：TokenID → (homeTeam, awayTeam, outcomeType)，支持 1X2 / Over/Under / BTTS

4. **隐含概率计算**：USDC 价格直接读取，无需去抽水；24h 成交量作为流动性信号

#### 交付物
- server/ml/odds/sources/polymarket.js
- server/ml/odds/sources/polymarket_mapper.js
- GET /api/odds/polymarket（市场列表）
- GET /api/odds/polymarket/match/:t1/:t2（单场数据）

---

### 任务 7.2：赔率融合引擎

目标：将 odds-api（博彩）、Polymarket（预测市场）、Model（Elo/ML）三源概率融合为校准概率，量化分歧。

#### 背景
| 信源 | 优势 | 劣势 |
|------|------|------|
| odds-api | 覆盖广、含庄家经验 | 抽水 3-8% |
| Polymarket | 低抽水 2%、集体智慧 | 流动性不足时噪声大 |
| ML Model | 可解释、无羊群效应 | 数据滞后 |

融合关键是**量化分歧** + **自适应加权**。

#### 实施项
1. **融合引擎**（server/ml/odds/fusion/）
   - fusion.js：核心融合
   - sources.js：统一信源适配接口
   - weights.js：历史 Brier Score → 权重
   - calibrator.js：融合后校准

2. **融合策略**（可配置切换）
   - **A：对数赔率加权平均**（log-odds averaging）
   - **B：贝叶斯融合**（ML 先验 × 市场似然）

3. **分歧量化**
   - Jensen-Shannon Divergence（三源两两计算）
   - 分类：一致→高置信 / 模型分歧→提示 / 全分歧→降级均匀分布

4. **信源可信度跟踪**
   - 每场比赛后 Brier Score
   - 分层评估：小组赛 / 淘汰赛 / 强弱分明

#### 交付物
- server/ml/odds/fusion/fusion.js / weights.js / calibrator.js
- server/ml/odds/sources/unified.js
- GET /api/odds/fusion/match/:t1/:t2
- GET /api/odds/fusion/status

---

### 任务 7.3：分联赛迁移学习

目标：通过赛事层级分割 + 迁移学习让模型专精于世界杯预测。

#### 背景
| 层级 | 占比 | 质量 |
|------|------|------|
| Friendly | ~35% | 噪声大 |
| Qualification | ~40% | 中等 |
| Continental | ~12% | 高质量 |
| World Cup | ~5% | 最相关但最少 |

全量模型在世界杯上表现不如验证集平均——分布显著不同。

#### 实施项
1. **联赛标签系统**（	ournament_hierarchy.js）
   - T1: FIFA World Cup / T2: Continental Championships
   - T3: WC Qualifiers / T4: Continental Qualifiers / T5: Friendlies

2. **Base + League-Specific Heads**
   - Base 全量预训练（已有）
   - T1 在世界杯数据微调（LR x 0.1）
   - 模型命名：xgb_home_t1.pkl

3. **迁移学习管线**（	ransfer_train.py）

4. **推理自适应选择**：比赛类型自动选 T1/T2/.../Base（链式 Fallback）

#### 交付物
- server/ml/data/tournament_hierarchy.js
- server/ml/training/transfer_train.py
- server/ml/models/v2/ + predictor_v2.js

---

### 任务 7.4：在线学习（Online Learning）

目标：2026 世界杯赛时持续吸收新比赛结果，模型不断进化。

#### 实施项
1. **调度器**（scheduler.js）
   - 监听结果更新事件
   - 训练队列防并发，超时保护 30s

2. **增量训练**（incremental_train.py）
   - XGBoost 原生增量：xgb_model.fit(X_new, y_new, xgb_model=model)
   - RF：缓存 N 场 re-fit + ensemble
   - Elo 贝叶斯在线更新

3. **版本管理 + 自动回滚**
   - log loss 退化 > 3% 或 ECE > 2% → 自动回退
   - 每天最多 3 次更新

4. **安全策略**
   - 仅更新 T1 模型
   - Base 模型手动触发
   - 线上默认当前版本，降级回 v1-stable

#### 交付物
- server/ml/online/scheduler.js / incremental_train.py / evaluator.js
- GET /api/ml/online/status
- 页面 /online-learning

---

### 任务 7.5：前端集成

目标：将 Phase 7 新能力以直观方式呈现，尽量嵌入现有页面。

#### 7.5.1 赔率融合面板（match.ejs）
在现有市场赔率区块下方新增赔率融合区域：
- **三源概率对比柱状图**：Model / Market（去抽水）/ Polymarket / Fused（高亮）
- **分歧指示器**：JSD 数值 + 颜色编码（绿 < 0.05 / 黄 < 0.15 / 红 >= 0.15）
- **信源可信度**：各源历史 Brier Score

#### 7.5.2 Polymarket 市场看板
新增 /polymarket 页面：
- WC 2026 所有活跃市场列表 + 筛选（1X2 / 晋级 / 冠军 / 特殊）
- 每个市场卡片：当前价格 / 24h 成交量（USDC）/ 价格趋势 / 模型偏差

#### 7.5.3 联赛切换器（match.ejs）
引擎选择器旁新增联赛层级切换：T1 世界杯模型（默认）/ T2 洲际大赛 / Base 通用模型

#### 7.5.4 在线学习看板
新增 /online-learning 页面：
- 模型版本时间线 / log loss 趋势图 / 预测 vs 实际对比 / 回滚记录

#### 7.5.5 首页/赛程微调
- 首页赛程卡片增加融合赔率徽章
- 赛程列表增加市场分歧过滤器

#### 交付物
- views/pages/polymarket.ejs / views/pages/online-learning.ejs
- match.ejs / index.ejs / schedule.ejs 扩展 + app.css 样式

---

## 三、验收 KPI

| 指标 | 目标 | 对比基线 | 关联任务 |
|------|------|---------|---------|
| 融合 log_loss | 低于 ML 单源 >= 3% | ML 引擎 log_loss=0.906 | 7.2 赔率融合 |
| 融合 Brier Score | <= 0.18 | ML 引擎 ~0.21 | 7.2 赔率融合 |
| Polymarket 覆盖率 | >= 90% 比赛有对应市场 | N/A | 7.1 Polymarket |
| T1 模型 log_loss | 低于 Base 模型 >= 5% | Base log_loss=0.906 | 7.3 迁移学习 |
| 在线更新耗时 | <= 30 秒 / 次 | N/A | 7.4 在线学习 |
| 在线回滚率 | <= 5% | N/A | 7.4 在线学习 |
| 前端面板加载 | <= 200ms（含所有信源） | 当前 ~50ms | 7.5 前端集成 |

---

## 四、推荐迭代节奏（三周）

### Week 1（基础设施与数据接入）
| 天 | 任务 | 交付 |
|----|------|------|
| Day 1-2 | Polymarket GAMMA API 封装 | server/ml/odds/sources/polymarket.js |
| Day 3-4 | 市场映射表 + 比赛匹配 | polymarket_mapper.js |
| Day 5 | API 端点 + 缓存 | GET /api/odds/polymarket/* |
| Day 6-7 | 联赛层级标签系统 | 	ournament_hierarchy.js |

### Week 2（核心算法）
| 天 | 任务 | 交付 |
|----|------|------|
| Day 1-2 | 赔率融合引擎核心 | fusion.js + weights.js |
| Day 3 | 校准器 + 统一信源层 | calibrator.js + unified.js |
| Day 4 | 迁移学习训练脚本 | 	ransfer_train.py + T1 模型 |
| Day 5 | 推理层级选择器 | predictor_v2.js |
| Day 6 | 在线学习调度 + 增量训练 | server/ml/online/ |
| Day 7 | 版本管理 + 回滚 | v2_online.json manifest |

### Week 3（前端集成与联调）
| 天 | 任务 | 交付 |
|----|------|------|
| Day 1-2 | 比赛详情页融合面板 | match.ejs 扩展 |
| Day 3 | Polymarket 市场看板 | polymarket.ejs |
| Day 4 | 联赛切换 + 在线学习看板 | match.ejs + online-learning.ejs |
| Day 5 | 首页/赛程微调 + 样式 | index.ejs / schedule.ejs / app.css |
| Day 6-7 | 联调 + 回测 + 文档 | 全功能验证 |

---

## 五、发布与回滚策略

### 灰度发布（三阶段）
| 阶段 | 范围 | 验证项 | 持续时间 |
|------|------|--------|---------|
| alpha | 内部 API | 数据正确性、匹配准确率 | 2 天 |
| beta | Fusion API | 融合逻辑、回测对比 | 3 天 |
| gamma | 前端面板 10% 流量 | 加载性能、用户理解度 | 2 天 |
| GA | 全量 | - | - |

### 回滚策略
| 异常类型 | 自动措施 | 手动措施 |
|---------|---------|---------|
| Polymarket 不可用 | 降级到 odds-api 单源 | 禁用 polymarket.enabled |
| 融合 log_loss 退化 | 回退最佳历史融合参数 | 切回 ensemble 引擎 |
| 在线学习退化 | 自动回退 v1 稳定版 | 禁用 online.enabled |
| 前端面板加载超时 | 隐藏融合面板显示原有赔率 | 配置关闭 |

### 配置项扩展（server/ml/config.js）

`javascript
// Phase 7 新增配置
polymarket: {
  enabled: true,
  refreshIntervalMs: 60000,
  marketListCacheMs: 3600000,
  minLiquidityUsdc: 1000,
},
oddsFusion: {
  enabled: true,
  strategy: log-odds-weighted, // log-odds-weighted | bayesian
  minSources: 1,
  sourceWeights: { oddsApi: 0.35, polymarket: 0.30, model: 0.35 },
  divergenceAlert: 0.15,
},
tournamentHierarchy: {
  enabled: true,
  defaultTier: T1,
  fallbackChain: [T1, T2, T3, T4, T5, base],
},
online: {
  enabled: false,
  maxUpdatesPerDay: 3,
  timeoutMs: 30000,
  minNewMatches: 1,
  evaluationWindow: 5,
  rollbackThreshold: { logLossIncrease: 0.03, eceIncrease: 0.02 },
},
`

---

## 六、项目文件变更清单

### 新增文件（15 个）

`
server/ml/odds/sources/polymarket.js            # Polymarket GAMMA API 封装
server/ml/odds/sources/polymarket_mapper.js     # 市场到比赛映射
server/ml/odds/sources/unified.js                # 统一信源适配层
server/ml/odds/fusion/fusion.js                  # 赔率融合引擎核心
server/ml/odds/fusion/weights.js                # 权重策略 + 历史可信度
server/ml/odds/fusion/calibrator.js             # 融合后校准
server/ml/data/tournament_hierarchy.js           # 联赛层级标签
server/ml/training/transfer_train.py            # 迁移学习训练
server/ml/online/scheduler.js                   # 在线学习调度
server/ml/online/incremental_train.py           # 增量训练
server/ml/online/evaluator.js                   # 在线评估
server/ml/manifests/v2_online.json              # 在线模型 manifest
server/ml/inference/predictor_v2.js             # 推理时自适应层级选择
server/ml/views/pages/polymarket.ejs            # Polymarket 市场看板
server/ml/views/pages/online-learning.ejs       # 在线学习看板
`

### 修改文件（8 个）

`
server/ml/config.js               # Phase 7 配置扩展
server/routes/odds.js             # Polymarket + Fusion API 路由
server/index.js                   # 新页面路由
server/ml/inference/predictor.js  # 可选：集成 v2 推理
server/services/oddsApi.js        # 可选：为融合引擎暴露内部接口
server/views/pages/match.ejs      # 赔率融合面板 + 联赛切换器
server/views/pages/index.ejs      # 融合赔率徽章
server/views/pages/schedule.ejs   # 分歧过滤器
server/public/css/app.css         # 样式扩展
server/public/js/app.js           # 新功能 JS 逻辑
`

---

## 七、结论

Phase 7 标志着项目从**一个更好的预测模型**进化为**一个多信源集体智慧系统**。它不做简单叠加，而是实现四点质变：

1. **打开真实市场窗口**：Polymarket 接入让系统不再闭门预测，而是能感知全球交易者的集体判断

2. **学会倾听分歧**：赔率融合引擎的核心产出不仅仅是融合概率，更是分歧信号——模型与市场不一致的地方往往是最有价值的信息

3. **开始持续进化**：在线学习打破了训练-部署-冻结的静态模式，让模型在世界杯进行中不断成长

4. **专精而非通用**：分联赛迁移学习让模型成为世界杯专家而非全能半桶水

这套体系的价值不止于 2026 世界杯。赔率融合引擎、在线学习管线、分联赛迁移学习框架都是可复用的架构资产，可以延续到未来的赛事、联赛、甚至跨运动项目使用。

完成 Phase 7 后，项目将真正具备**数据驱动 + 市场智慧 + 持续学习**三位一体的能力。
