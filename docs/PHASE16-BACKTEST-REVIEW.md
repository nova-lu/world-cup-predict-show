 # Phase 16 — 模型回测与复盘分析

 > 本文档定义统一的回测方法论：如何基于历史数据与预测快照验证当前模型（Elo / ML / Ensemble）的预测准确性与概率校准能力，为后续迭代提供量化依据。
 >
 > **核心问题**: 当前模型的预测概率和方向选择是否可靠？在哪些阶段、哪些场景下表现好/差？提升空间在哪？
 >
 > **输出**: 一份可重复执行的回测脚本 + 结构化的分析报告框架。

 ---

 ## 1. 背景与目标

 ### 1.1 现状

 系统目前运行三种预测引擎:

 | 引擎 | 方法 | 状态 |
 |------|------|------|
 | **Elo** | Dixon-Coles 双变量 Poisson + Elo 评分 | 生产就绪，线上正常运行 |
 | **ML** (XGBoost / RandomForest) | 23维特征向量 + Python 子进程推理 | 模型已训练，需手动启用 |
 | **Ensemble** | Elo + ML 动态加权融合 | 依赖 ML 可用性 |

 页面 `/backtest` 已有前端回测面板，但它依赖 `/api/matches/schedule` 接口中的 **2026 年实时比赛数据**，未被覆盖的缺失包括:

 - **历史世界杯回测**: 2002、2006、2010、2014、2018、2022 六届世界杯的模型表现未知
 - **引擎对比**: 无法直接比较 Elo vs ML vs Ensemble 在相同比赛集上的表现
 - **深入分析**: 无系统化的错误模式分析、置信度校准评估、基线对比

 后端 `server/ml/backtest/engine.js` 已存在骨架，但指标字段为 `null` 占位，实际推理未接入。

 ### 1.2 目标

 **G1 数据可追溯**: 能够针对任意历史时间窗口，重建模型在该时间点的预测，并与真实赛果对比。

 **G2 指标完整**: 覆盖准确性、校准度、区分度、盈利能力四类维度。

 **G3 引擎可比**: 在同一比赛集上并行运行 Elo / ML / Ensemble，产出可直接对比的指标。

 **G4 趋势可见**: 随时间（按届/按轮次）的模型表现趋势可观察。

 **G5 复盘闭环**: 回测结果能反哺模型迭代，指明改进方向。

 ### 1.3 验收 KPI

 | 指标 | 目标值 | 验证方式 |
 |------|--------|---------|
 | 历史回测覆盖 | >= 6 届世界杯（2002-2022） | 脚本运行后输出覆盖年份列表 |
 | 引擎对比 | 每届至少产出 Elo + ML 两套指标 | 回测报告包含多引擎列 |
 | 校准分析 | ECE 计算且标注等级 | 报告含校准曲线表 |
 | 基线对比 | 随机基线(33.3%) + 赔率基线 | 报告含基线对比行 |
 | 可重复执行 | 单脚本一键运行，幂等 | `node scripts/run_backtest.js` 执行 |

 ---

 ## 2. 数据获取方法论

 ### 2.1 数据分类

 回测覆盖两类数据源:

 ```
 ┌──────────────────────────────────────────────────────┐
 │                   回测数据总览                         │
 ├──────────────────────┬───────────────────────────────┤
 │     A: 历史世界杯     │     B: 2026 实时比赛           │
 │    (2002-2022)        │    (2026-06-11 至今)          │
 ├──────────────────────┼───────────────────────────────┤
 │ matches_1930_2022.csv │ /api/matches/schedule          │
 │ + Elo manifests       │ + wc2026-results.json         │
 │ + ML model inference  │ + external API (实时结果)     │
 └──────────────────────┴───────────────────────────────┘
 ```

 ### 2.2 数据源 A: 历史世界杯 (2002-2022)

 #### 比赛结果数据

 | 文件 | 路径 | 说明 |
 |------|------|------|
 | 世界杯历史 CSV | `world-cup-data/matches_1930_2022.csv` | 1930-2022 所有世界杯比赛 |
 | 扩展结果 CSV | `histroy-match-data/results.csv` | 含更多赛事，含近期比赛结果 |

 **加载路径**: `server/ml/data/loader.js` → `loadMatches(csvPath, { filterLevel: 'P0', minYear, maxYear })` 已封装。
 回测时调用 `loadMatches()` + 按 `tournament === 'FIFA World Cup'` 过滤即可。

 #### 预测重建策略

 > **🔗 Phase 17 — T1**: Elo 时间点快照系统未集成。当前 predictor.js 使用当前 Elo 评分而非历史快照。详见 `PHASE17-BACKTEST-ENHANCEMENT.md`

 回测的核心挑战是：**对于一场历史比赛，我们无法"穿越"到过去，只能基于当前模型的参数重建预测**。

 有两种策略：

 **策略 1: 使用当前模型参数预测历史比赛（推荐用于 ML 引擎）**

 假设模型在训练时已包含该历史比赛之前的所有数据，因此用当前训练的 XGBoost / RF 模型 + 比赛当时的特征（Elo 评分、FIFA 排名、近期状态等）来生成预测。

 实现方式:
 ```
 1. 加载比赛 m
 2. 构建特征向量: buildMatchFeatures(homeTeam, awayTeam, m.date, context)
    - Elo 评分从 calibrated.json 读取（当前值，近似当时值）
    - FIFA 排名用 getRankingAtDate(team, m.date) → 时间点映射
    - 近期状态来自该日期之前的滚动窗口
 3. 运行 ML 推理: predictMatch(home, away, m.date, { context })
 4. 记录预测概率与真实结果
 ```

 **策略 2: 使用时间点约束的 Elo 快照（推荐用于 Elo 引擎）**

 对于 Elo 引擎，需要比赛当时的 Elo 评分，而非当前最新值。

 实现方式:
 ```
 1. 加载 Elo manifests: data/elo-manifests/*.json
 2. 找到比赛日期之前最近的 manifest
 3. 提取该时间点的球队 Elo 评分
 4. 用该评分运行 matchProb(ratingA, ratingB, homeBonus) → 1X2 概率
 5. 记录预测概率与真实结果
 ```

 **备选**: 如果 manifest 覆盖不全，可反向推算——从当前 Elo 回退比赛已知结果的影响（用 Elo update 公式逆推）。但精度低于 manifest 快照。

 #### 回测周期

 | 届次 | 年份 | 比赛数 | ML 训练截止 | 说明 |
 |------|------|--------|------------|------|
 | 韩日世界杯 | 2002 | 64 | 2002-05-31 | ML 训练集含 2002 前数据 |
 | 德国世界杯 | 2006 | 64 | 2006-06-09 | ML 训练集含 2006 前数据 |
 | 南非世界杯 | 2010 | 64 | 2010-06-11 | |
 | 巴西世界杯 | 2014 | 64 | 2014-06-12 | |
 | 俄罗斯世界杯 | 2018 | 64 | 2018-06-14 | ML 验证集截止 |
 | 卡塔尔世界杯 | 2022 | 64 | 2022-11-20 | ML 测试集 |

 ### 2.3 数据源 B: 2026 实时比赛

 #### 数据获取

 当前 `/api/matches/schedule` 已返回完整赛程 + 预测 + 结果。回测引擎可直接复用该接口数据，或直接加载底层数据:

 | 来源 | 路径 | 说明 |
 |------|------|------|
 | 赛程 CSV | `world-cup-data/schedule_2026.csv` | 官方赛程 |
 | 结果 JSON | `data/wc2026-results.json` | 已完赛结果 |
 | Elo 校准 | `data/elo-calibrated.json` | 当前 Elo 评分 |
 | 外部 API | footballApi.js / oddsApi.js | 实时赔率与结果 |

 #### 预测数据

 2026 比赛的预测是实时生成的:

 - Elo 预测: 使用当前 Elo 评分 + 主场优势系数 → 实时计算
 - ML 预测: 使用训练的模型 + 当前特征 → Python 推理
 - Ensemble: 加权融合

 回测时无需"重建"——预测已在生产环境中生成并存档在响应中。

 **但需要设计持久化机制**: 目前的预测是"运行即生成、用完即丢弃"的。回测要求我们捕获预测快照，与赛果配对存储。

> **🔗 Phase 17 — T3**: 2026 预测持久化机制未实现。`data/backtest/predictions/` 目录为空，routes/matches.js 无 FT 触发保存。详见 `PHASE17-BACKTEST-ENHANCEMENT.md`

 推荐方案:

 ```
 ┌─────────────┐     ┌─────────────────┐     ┌──────────────┐
 │ 比赛开赛前    │ →  │ 记录预测快照      │ →  │ { match_id,   │
 │ 系统生成预测  │     │ (Elo/ML/Ensemble) │   │   t1, t2,     │
 └─────────────┘     └─────────────────┘     │   pred_probs, │
                                              │   timestamp } │
 ┌─────────────┐     ┌─────────────────┐     └──────┬───────┘
 │ 比赛结束后    │ →  │ 记录真实赛果      │         │
 │ 结果更新     │     │ (比分/胜平负)    │         │
 └─────────────┘     └─────────────────┘         ▼
                                          ┌─────────────────┐
                                          │ 配对: 预测 vs 结果 │
                                          │ ← 回测分析的输入  │
                                          └─────────────────┘
 ```

 **持久化格式建议（JSON Lines）:**

 ```json
 {"match_id": "wc2026-argentina-france", "t1": "argentina", "t2": "france", "date": "2026-07-04",
  "predicted_at": "2026-07-03T12:00:00Z", "stage": "QUARTER_FINALS",
  "elo": {"homeWin": 0.452, "draw": 0.271, "awayWin": 0.277, "xgHome": 1.35, "xgAway": 1.65},
  "ml": {"homeWin": 0.483, "draw": 0.245, "awayWin": 0.272},
  "ensemble": {"homeWin": 0.472, "draw": 0.253, "awayWin": 0.275, "weights": {"elo": 0.3, "ml": 0.7}},
  "oddsConsensus": {"homeWin": 0.501, "draw": 0.268, "awayWin": 0.231},
  "polymarket": {"homeWin": 0.485, "draw": 0.280, "awayWin": 0.235},
  "result": {"homeScore": 2, "awayScore": 1, "outcome": "HOME"},
  "metadata": {"eloVersion": "calibrated", "mlVersion": "v1", "modelDate": "2026-06-30"}}
 ```

 存储位置: `data/backtest/predictions/`，按月份或轮次分文件。

 #### 回测的最小条件

 回测执行前需确认:

 - [ ] 已完赛比赛数 >= 1
 - [ ] 这些比赛在预测生成时有完整记录
 - [ ] Elo 评分 `elo-calibrated.json` 存在且非空
 - [ ] ML 模型文件齐全（如果启用 ML 回测）

 ---

 ## 3. 回测引擎设计

 ### 3.1 架构图

 ```
 runBacktest.js (入口脚本)
  │
  ├─ 1. collectData()
  │    ├─ 加载历史比赛 (loader.js + filter by year+tournament)
  │    ├─ 加载 2026 赛程/结果 (schedule_2026.csv + wc2026-results.json)
  │    └─ 输出: matchList [{ match_id, t1, t2, date, stage, result }]
  │
  ├─ 2. generatePredictions()
  │    ├─ Elo 引擎: predictionService.predictMatch() + Elo manifest 时间点查找
  │    ├─ ML 引擎: mlPredictor.predictMatch() + 日期上下文构建
  │    └─ Ensemble: ensemblePrediction(elo, ml)
  │    输出: [{ ...match, predictions: { elo, ml, ensemble } }]
  │
  ├─ 3. computeMetrics()
  │    ├─ 逐场指标: accuracy, brier, log_loss, calibration_bin
  │    ├─ 阶段聚合: by stage, by confidence decile
  │    ├─ 引擎对比: 横向对比 Elo vs ML vs Ensemble
  │    └─ 基线对比: random baseline, odds baseline
  │
  ├─ 4. analyze()
  │    ├─ 错误分析: 哪些比赛预测错误、共性是什么
  │    ├─ 校准分析: 置信度 vs 实际频率 (ECE)
  │    ├─ 趋势分析: 按届/按轮的指标变化
  │    └─ 场景分析: 冷门识别能力、大小球预测等
  │
  └─ 5. exportReport()
       ├─ JSON 详细报告
       ├─ CSV 逐场明细
       ├─ Markdown 摘要
       └─ (可选) 图表输出到 static/images/backtest/
 ```

 ### 3.2 核心数据流

 每条回测记录的结构:

 ```
 BacktestRecord {
   matchId: string          // 比赛唯一标识
   date: string             // YYYY-MM-DD
   year: number             // 届次年份
   stage: string            // GROUP_STAGE / LAST_32 / ... / FINAL
   homeTeam: string
   awayTeam: string
   actualOutcome: 'HOME' | 'DRAW' | 'AWAY'
   actualScore: { home: number, away: number }

   // 各引擎预测
   predictions: {
     elo: {
       prob: { homeWin, draw, awayWin }  // 0-1
       xg: { home, away }
     }
     ml?: {
       prob: { homeWin, draw, awayWin }
       xg: { home, away }
       confidence: number
     }
     ensemble?: {
       prob: { homeWin, draw, awayWin }
       weights: { elo, ml }
     }
     oddsConsensus?: {
       prob: { homeWin, draw, awayWin }
       nSources: number
     }
   }

   // 计算结果
   metrics: {
     elo:    { correct, brier, logLoss, predictedOutcome, probForActual }
     ml?:    { correct, brier, logLoss, predictedOutcome, probForActual }
     ensemble?: { ... }
   }
 }
 ```

 ### 3.3 引擎时间点适配

 不同引擎对"时间点"的处理方式不同，需分别适配:

 | 引擎 | 时间点要求 | 适配方式 |
 |------|-----------|---------|
 | Elo | 需要比赛当时的评分 | 使用 Elo manifests 快照；无快照时从当前评分反向回退 |
 | ML | 特征中的 Elo/排名使用当时值 | `getRankingAtDate()` 按日期映射；Elo 同 Elo 引擎 |
 | Ensemble | 基于 Elo + ML 的权重 | 组合上述两种结果 |
 | 赔率共识 | 需开赛前赔率 | `oddsApi.js` 用比赛日期调用历史赔率接口 |

 ---

 ## 4. 回测指标体系

 ### 4.1 核心指标一览

 | 类别 | 指标 | 公式 | 说明 | 理想值 |
 |------|------|------|------|--------|
 | 准确性 | 准确率 (Accuracy) | 正确预测数 / 总比赛数 | 方向预测（胜/平/负）正确比例 | > 40% |
 | 准确性 | Top-1 Hit Rate | 最高概率结果命中的比例 | 与 Accuracy 等价 | > 40% |
 | 校准度 | Brier 评分 | Σ(p_i - o_i)² / N | 概率预测的均方误差（三结果平均） | < 0.25 |
 | 校准度 | Log Loss | -Σ(o_i * ln(p_i)) / N | 交叉熵损失 | < 0.80 |
 | 校准度 | ECE | Σ|置信区间频率 - 实际频率| / 分区数 | 预期校准误差 | < 10% |
 | 区分度 | AUC-ROC | ROC 曲线下面积 | 正类 vs 负类区分能力 | > 0.65 |
 | 盈利能力 | ROI (模拟) | 基于市场赔率的模拟投注回报 | 假设按预测下注的收益 | > 100% |

 ### 4.2 指标详细定义

 #### 准确率 (Accuracy)

 ```
 accuracy = correct_predictions / total_matches
 ```

 预测方向 = max(prob.homeWin, prob.draw, prob.awayWin) 对应的结果。
 基线: 随机猜测 33.3%。

 #### Brier 评分

 三结果版本:

 ```
 Brier = (p_home - o_home)² + (p_draw - o_draw)² + (p_away - o_away)²
 ```

 其中:
 - `p_*` = 预测概率 (0-1)
 - `o_*` = 实际结果 (1 表示该结果发生，否则 0)

 范围: [0, 2]。0 = 完美预测，2 = 完全错误且 100% 置信。
 随机基线 ≈ 0.667。

 #### Log Loss (对数损失)

 ```
 LogLoss = -[ y_home * ln(p_home) + y_draw * ln(p_draw) + y_away * ln(p_away) ]
 ```

 其中 `y_*` 为实际结果 one-hot 编码。
 范围: [0, +∞)。越小越好。完美 = 0。
 随机基线 ≈ 1.099。

 #### 预期校准误差 (ECE)

 将预测概率按 10 个等宽置信区间分区（0-10%, 10-20%, ..., 90-100%），在每个区间内比较：

 ```
 ECE = Σ_{b=1}^{10} (|B_b| / N) * |acc(B_b) - conf(B_b)|
 ```

 其中:
 - `|B_b|` = 区间 b 中的样本数
 - `N` = 总样本数
 - `acc(B_b)` = 区间 b 中实际阳性比例
 - `conf(B_b)` = 区间 b 中平均预测概率

 ECE < 0.05 = 校准良好，0.05-0.15 = 中等，> 0.15 = 校准较差。

 #### AUC-ROC

 对于"主胜"二分类:
 - 正类 = 实际主胜
 - 负类 = 实际非主胜 (平局 + 客胜)
 - 模型分数 = p(主胜)

 同理可计算平局和客胜的 AUC。

 ### 4.3 基线对比

 > **🔗 Phase 17 — T4**: 赔率共识基线 + Polymarket 基线未实现。当前仅随机基线和 Always Home 基线。详见 `PHASE17-BACKTEST-ENHANCEMENT.md`

 | 基线 | 预期准确率 | 预期 Brier | 说明 |
 |------|-----------|-----------|------|
 | 随机猜测 | 33.3% | 0.667 | 三结果均匀分布 |
 | 总是预测主胜 | ~45% (历史数据) | ~0.50 | 世界杯历史主胜频率 |
 | 市场赔率 (consensus) | 待计算 | 待计算 | 赔率隐含概率的校准度 |
 | Polymarket | 待计算 | 待计算 | 预测市场的表现 |
 | 简单 Elo (无 DC) | 待计算 | 待计算 | 去掉 Dixon-Coles 的效果 |

 ---

 ## 5. 分析报告框架

 ### 5.1 报告结构

 每次回测执行输出一份结构化报告，包含以下章节:

 ```
 1. 执行概要
    - 回测范围（届次/比赛数/引擎）
    - 总体指标一览表
    - 核心发现（3-5 条关键结论）

 2. 总体指标
    - 各引擎指标对比表
    - 与基线的偏差
    - 指标趋势图（按届）

 3. 阶段分解
    - 小组赛 vs 淘汰赛各轮次
    - 哪个阶段预测最准/最差
    - 小组赛冷门率 vs 淘汰赛可预测性

 4. 校准分析
    - 校准曲线（置信度 vs 实际频率）
    - ECE 及分区详情
    - 过自信/欠自信诊断

 5. 错误分析
    - 错误预测的比赛列表
    - 错误模式聚类（弱队爆冷、强强对话、平局误判等）
    - 错误比赛的共同特征（Elo 差小、近期状态异常等）

 6. 引擎对比
    - Elo vs ML vs Ensemble 逐场差异分布
    - 哪些比赛 ML 胜过 Elo / Elo 胜过 ML
    - Ensemble 是否真正优于单引擎

 7. 趋势分析
    - 每届准确率变化趋势
    - 各引擎随时间是否稳定
    - 模型退化风险信号（如近 10 场准确率骤降）

 8. 场景分析
> **🔗 Phase 17 — T5**: 大小球/BTTS/比分/加时点球分析未实现。详见 `PHASE17-BACKTEST-ENHANCEMENT.md`
    - 大小球预测准确性
    - BTTS (双方进球) 预测
    - 比分预测准确性
    - 加时/点球预测（淘汰赛）

 9. 结论与建议
    - 模型当前的能力边界
    - 建议优先改进的方向
    - 下一期回测的关注点
 ```

 ### 5.2 输出格式

 | 格式 | 文件 | 用途 |
 |------|------|------|
 | JSON | `data/backtest/reports/backtest_{engine}_{date}.json` | 机器解析/前端展示 |
 | CSV | `data/backtest/reports/backtest_detail_{date}.csv` | 逐场数据分析 |
 | Markdown | `data/backtest/reports/backtest_summary_{date}.md` | 人工阅读/分享 |
 | (可选) 图表 | `public/images/backtest/` | 前端回测页面增强 |

 ### 5.3 关键分析维度的 SQL/伪代码逻辑

 #### 错误聚类

 > **🔗 Phase 17 — T6**: 错误聚类分析（Elo 差梯度分组）未实现。详见 `PHASE17-BACKTEST-ENHANCEMENT.md`

 ```sql
 -- 找出系统性地预测错误的模式
 SELECT
   CASE
     WHEN elo_diff BETWEEN -50 AND 50 THEN '势均力敌'
     WHEN elo_diff > 150 THEN '大热'
     WHEN elo_diff < -150 THEN '大冷'
     ELSE '普通'
   END as match_type,
   COUNT(*) as n,
   SUM(CASE WHEN correct THEN 0 ELSE 1 END) as errors,
   ROUND(100.0 * SUM(CASE WHEN correct THEN 0 ELSE 1 END) / COUNT(*), 1) as error_rate
 FROM backtest_results
 GROUP BY match_type
 ORDER BY error_rate DESC
 ```

 #### 置信度分层

 ```sql
 SELECT
   FLOOR(confidence * 10) * 10 as decile_start,
   COUNT(*) as n,
   ROUND(AVG(CASE WHEN correct THEN 1.0 ELSE 0.0 END), 3) as actual_freq,
   ROUND(AVG(confidence), 3) as avg_confidence,
   ROUND(AVG(ABS(avg_confidence - actual_freq)), 3) as calibration_gap
 FROM backtest_results
 GROUP BY decile_start
 ORDER BY decile_start
 ```

 #### 引擎优势场景

 > **🔗 Phase 17 — T6**: 引擎优势分析未实现。详见 `PHASE17-BACKTEST-ENHANCEMENT.md`

 ```sql
 SELECT scenario, COUNT(*) as n, AVG(elo_better) as elo_wins, AVG(ml_better) as ml_wins
 FROM (
   SELECT
     CASE
       WHEN elo_diff > 200 THEN '悬殊对决'
       WHEN recent_form_diff > 0.2 THEN '状态差大'
       WHEN is_knockout = 1 THEN '淘汰赛'
       ELSE '普通'
     END as scenario,
     CASE WHEN elo_brier < ml_brier THEN 1 ELSE 0 END as elo_better,
     CASE WHEN ml_brier < elo_brier THEN 1 ELSE 0 END as ml_better
   FROM backtest_results
 ) t
 GROUP BY scenario
 ORDER BY n DESC
 ```

 ---

 ## 6. 实施规划

 ### 6.1 实施阶段 (6 天)

 #### D1-D2: 数据层与预测重建

 **任务 1 — 完成历史数据加载管线**

 | 交付物 | 说明 |
 |--------|------|
 | `server/ml/backtest/collector.js` | 从 loader.js + schedule_2026.csv + wc2026-results.json 统一收集比赛 |
 | 输出: matchList 标准化数组 | 包含所有需要回测的比赛及真实结果 |

 **任务 2 — Elo 时间点快照系统**
 > **🔗 Phase 17 — T1**: 此任务未完成。详见 `PHASE17-BACKTEST-ENHANCEMENT.md`

 | 交付物 | 说明 |
 |--------|------|
 | 验证 Elo manifests data/elo-manifests/ 的时间覆盖 | 确保每届世界杯前有可用快照 |
 | 回退算法 | 无快照时从当前 Elo 评分反推 |
 | `loadEloSnapshot(date)` 函数 | 返回最接近 date 的 Elo 评分表 |

 **任务 3 — 预测生成器**

 | 交付物 | 说明 |
 |--------|------|
 | `server/ml/backtest/predictor.js` | 对一组比赛运行 Elo / ML / Ensemble 推理 |
 | 每一场比赛记录三个引擎的预测概率 + 预期进球 |

 #### D3-D4: 指标计算与基线

 **任务 4 — 指标引擎**

 | 交付物 | 说明 |
 |--------|------|
 | `server/ml/backtest/metrics.js` | 计算准确率、Brier、LogLoss、ECE、AUC |
 | 逐场指标与聚合指标函数 | 支持按分组聚合 |

 **任务 5 — 基线计算**
 > **🔗 Phase 17 — T4**: 赔率基线 + Polymarket 基线未完成。详见 `PHASE17-BACKTEST-ENHANCEMENT.md`

 | 交付物 | 说明 |
 |--------|------|
 | 随机基线 | 理论 33.3% + 蒙特卡洛模拟 |
 | 赔率基线 | 从 /api/odds/fusion/... 获取共识赔率隐含概率 |
 | Polymarket 基线 | 从 Polymarket 获取市场预测概率 |

 #### D5-D6: 报告生成与分析

 **任务 6 — 报告生成器**
 > **🔗 Phase 17 — T7**: 报告仅覆盖5章（共9章），缺失引擎对比/场景分析/结论建议章节。详见 `PHASE17-BACKTEST-ENHANCEMENT.md`

 | 交付物 | 说明 |
 |--------|------|
 | `server/ml/backtest/reporter.js` | JSON + CSV + Markdown 三重输出 |
 | 包含 5.1 节中全部 9 个章节 |

 **任务 7 — 执行脚本与前端集成**

 | 交付物 | 说明 |
 |--------|------|
 | `scripts/run_backtest.js` | 一键执行: 收集 → 预测 → 计算 → 报告 |
 | 更新 views/pages/backtest.ejs | 增加历史回测 Tab，切换 2026 / 历史 / 对比 视图 |
 | 新增 /api/ml/backtest/history 端点 | 返回历史回测结果 |

 ### 6.2 风险与降级

 | 风险 | 影响 | 缓解措施 |
 |------|------|---------|
 | Elo manifest 覆盖不足 | 部分历史比赛无法准确重建 | 使用回退算法 + 标注不确定性 |
 | ML Python 推理超时 | 大批量回测耗时过长 | 批次推理 + 并行度控制 |
 | 赔率历史数据不可用 | 无法计算赔率基线 | 跳过赔率基线，仅用随机基线 |
 | 预测快照未持久化 | 2026 比赛无历史预测记录 | 从当前预测重建（部分有效）+ 尽快上线持久化 |

 ### 6.3 交付物清单

 | # | 文件 | 类型 | 说明 |
 |---|------|------|------|
 | 1 | server/ml/backtest/collector.js | 新建 | 历史 + 2026 比赛数据收集 |
 | 2 | server/ml/backtest/predictor.js | 新建 | 三种引擎批量预测生成 |
 | 3 | server/ml/backtest/metrics.js | 新建 | 全部指标计算 |
 | 4 | server/ml/backtest/reporter.js | 新建 | 报告生成（JSON/CSV/MD） |
 | 5 | scripts/run_backtest.js | 新建 | 一键执行入口 |
 | 6 | server/ml/backtest/engine.js | 修改 | 集成真实推理 |
 | 7 | server/routes/matches.js | 修改 | 新增预测持久化中间件\n> **🔗 Phase 17 — T3**: 此项未完成，详见 `PHASE17-BACKTEST-ENHANCEMENT.md` |
 | 8 | data/backtest/predictions/ | 新建目录 | 预测快照存储 |
 | 9 | views/pages/backtest.ejs | 修改 | 增加历史回测 Tab |
 | 10 | public/js/backtest-history.js | 新建 | 历史回测前端交互 |
 | 11 | docs/PHASE16-BACKTEST-REVIEW.md | 当前文档 | Phase 16 总览文档 |

 ---

 ## 7. 复盘迭代流程

 ### 7.1 回测 → 模型改进闭环

 ```
 ┌──────────────┐     ┌──────────────────┐     ┌────────────────┐
 │  执行回测     │ →  │  分析报告，找出    │ →  │  根据发现改进   │
 │  (脚本一键)   │     │  模型薄弱环节     │     │  (特征/参数/模型)│
 └──────────────┘     └──────────────────┘     └───────┬────────┘
         ▲                                              │
         │                                              ▼
         │                                     ┌────────────────┐
         └─────────────────────────────────────│  重新回测验证   │
                                               │  改进是否有效   │
                                               └────────────────┘
 ```

 ### 7.2 回测触发条件

 | 触发条件 | 原因 | 操作 |
 |---------|------|------|
 | 每轮淘汰赛结束后 | 阶段数据积累 | 自动触发回测 |
 | 新的 ML 模型训练后 | 评估新模型 | 对比新旧模型指标 |
 | Elo K 因子调整后 | 验证调整效果 | 回测历史比赛 + 近 10 场 |
 | 特征工程修改后 | 评估特征变更 | 全量回测 |
 | 按需手动触发 | 复盘特定比赛 | 单场或单届回测 |

 ### 7.3 关键复盘问题清单

 每次回测后，以下问题应能回答:

 **整体层面**
 - 模型准确率是否高于随机基线 10% 以上？如果否，根因是什么？
 - Brier 评分是否在 0.25 以下？校准是否在合理范围内？

 **引擎层面**
 - Ensemble 是否始终优于单引擎？有没有引擎"拖后腿"的场景？
 - ML 引擎是否因训练数据不足或特征质量而在某些届次表现差？
 - Elo 引擎在淘汰赛中的表现是否优于小组赛？

 **场景层面**
 - 模型在"势均力敌"的比赛中是否比随机好？（这是最难预测的场景）
 - 模型对冷门的捕捉能力如何？
 - 高置信度预测（>80%）的准确率是否达到 80% 以上？
 - 平局预测的召回率和精确率如何？

 ---

 ## 8. 与现有系统的集成

 ### 8.1 现有代码复用

 | 现有模块 | 复用方式 | 在回测中的角色 |
 |----------|---------|---------------|
 | data/loader.js → loadMatches() | 直接调用 | 加载历史比赛 CSV |
 | data/features.js → buildMatchFeatures() | 直接调用 | 构建 ML 特征 |
 | data/rankings.js → getRankingAtDate() | 直接调用 | 时间点排名映射 |
 | elo-model.mjs → matchProb() | 直接调用 | Elo 预测核心 |
 | inference/predictor.js → predictMatch() | 直接调用 | ML 预测 |
 | inference/predictor.js → ensemblePrediction() | 直接调用 | Ensemble 预测 |
 | inference/poisson.js | 直接调用 | 泊松矩阵、大小球、BTTS |
 | utils/probability.js → toProbabilities() | 直接调用 | 概率标准化 |
 | config.js | 读取 | 回测参数 |

 ### 8.2 新增代码与现有系统的边界

 ```
 server/ml/backtest/
 ├── collector.js     ← 新文件: 收集所有比赛数据
 ├── predictor.js     ← 新文件: 调用现成的预测函数
 ├── metrics.js       ← 新文件: 纯计算，无外部依赖
 ├── reporter.js      ← 新文件: 格式输出
 └── engine.js        ← 修改: 集成真实数据流
 ```

 回测模块不修改现有的预测引擎、数据服务、或路由逻辑（除 2026 预测持久化外）。

 ### 8.3 2026 预测持久化集成

 > **🔗 Phase 17 — T3**: 此项未完成，详见 `PHASE17-BACKTEST-ENHANCEMENT.md`

 在 `server/routes/matches.js` 中，当比赛状态变为 FT 时，将之前的预测记录持久化:

 ```
 match.status === 'FT' → 触发 savePredictionSnapshot(match)
 ```

 或者在 `/api/matches/schedule` 返回数据时异步保存，不影响主响应。

 ---

 > 最后更新: 2026-07-03
 > 本文档定义 Phase 16 回测复盘的整体方法论与实施规划。标记为 **🔗 Phase 17** 的未完成项已移至 `docs/PHASE17-BACKTEST-ENHANCEMENT.md` 跟踪。
