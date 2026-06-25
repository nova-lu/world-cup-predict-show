 # Phase 5 — 基于历史数据的机器学习预测模型训练与集成

 ## 现状分析（Phase 1-4 已完成）

 当前项目的预测引擎基于 **Elo + Dixon-Coles 双变量泊松模型**，由 `elo-calibrated.json`（48 支球队的手动校准 Elo 评分）驱动。这一方案有以下结构性局限：

 | 局限 | 影响 |
 |---|---|
 | Elo 评分仅依赖约 900 场国际比赛（2023.10–2026.06）校准 | 样本量小，对非传统强队评估不稳定 |
 | 无结构化特征工程 | 无法利用排名差、主客场、大赛阶段、近期状态等因子 |
 | 无独立测试集验证 | 没有在历史杯赛上做客观回测，模型的泛化能力未知 |
 | 无赔率/盘口数据接入 | 无法与市场预期交叉验证，缺少风险与覆盖度指标 |
 | 预测输出单一 | 只有胜平负概率 + 预期进球，缺少比分分布、大小球、BTTS 等 |
 | 无 ML 模型支持 | 纯统计模型不能从历史数据中自动学习非线性模式 |

 Phase 5 的目标是利用你已有的三类数据源，构建一套 **数据驱动的 ML 训练与预测管线**，输出带有概率、风险、覆盖度、预期进球、泊松比分矩阵、大小球和 BTTS 的完整比赛预测，并作为可选引擎无缝集成到当前项目中。

 ---

 ## 一、可用的源数据资产

 ### A. 历史比赛数据

 **`results.csv`（或 `matches_1930_2022.csv`）**

 - 约 54,000+ 场国际比赛（1872–2026）
 - 核心列：`date, home_team, away_team, home_score, away_score, tournament, city, country, neutral`
 - `tournament` 字段可按赛事层级筛选（FIFA World Cup、Qualification、Friendly 等）
 - `matches_1930_2022.csv` 额外包含 xG、红黄牌、换人、点球等精细事件

 ### B. FIFA 排名数据

 **`fifa_ranking_2022-10-06.csv` 与 `fifa_ranking_2026-06-08.csv`**

 - 列：`team, team_code, association, rank, previous_rank, points, previous_points`（2026 版额外含 `rated_matches`）
 - 可作为每场比赛的"赛前排名快照"特征
 - 支持计算：排名差、积分差、同协会标识、积分变化趋势

 ### C. 现有 ML 管线参考

 **`pipeline_sports_analytics.py`**（来自 UNIRIO 学术项目）

 - 特征工程：`team_rank, team_points, opponent_rank, opponent_points, rank_diff, points_diff, is_host, is_home, is_knockout, same_confed, host_points_diff, team_recent_goals`
 - 模型：Random Forest Regressor 预测每队预期进球
 - 测试结果（2022 WC）：RMSE ≈ 1.30，MAE ≈ 1.00
 - 特征重要性：`points_diff` 33.8% > `rank_diff` 24.5% > `team_recent_goals` 9.4%

 此管线可作为 **基线参考实现**，Phase 5 将在其基础上做以下扩展。

 ### D. 2026 世界杯赛程与实时结果

 - `schedule_2026.csv`：104 场小组赛 + 淘汰赛场次的时间、场地、对阵
 - 项目已有 `footballApi.js` 拉取实时比赛数据（football-data.org）
 - 项目已有 `wc2026-results.json` 用于存储已完赛结果

 ---

 ## 二、架构设计：双引擎预测系统

 Phase 5 引入 **ML 引擎** 作为原 Elo 引擎的并行或替代方案，两个引擎共享同一套前端展示层。

 ```
                              +---------------------------+
                              |     前端展示层（不变）       |
                              |   /match/:t1/:t2 → 预测详情  |
                              |   /standings → 晋级概率      |
                              +------------+---------------+
                                           |
                            +--------------+--------------+
                            |                             |
                   +--------v--------+          +--------v--------+
                   |   Engine A      |          |   Engine B      |
                   |  (Elo + DC)     |          |  (ML Pipeline)  |
                   |  现有引擎, 不    |          |  Phase 5 新增    |
                   |  做改动          |          |                  |
                   +-----------------+          +--------+---------+
                                                         |
                                           +-------------+-------------+
                                           |             |             |
                                          ML           赛前事实      赔率/盘口
                                        模型推理        + 特征构造     适配器
                                           |             |             |
                                           +------+------+-------------+
                                                   |
                                          +--------v--------+
                                          |  特征存储 &      |
                                          |  训练数据仓库     |
                                          +-----------------+
 ```

 **设计原则：**

 - **引擎可切换**：API 端点接受 `?engine=elo|ml|ensemble` 参数，前端在预测详情页提供引擎切换开关
 - **渐进式替换**：Elo 引擎保留作为降级方案，ML 引擎未就绪时不影响现有功能
 - **数据管线解耦**：特征工程、模型训练、模型推理、赔率接入各自为独立模块
 - **可重复训练**：所有训练步骤从 CSV 源开始，生成可版本化的模型文件

 ---

 ## 三、任务分解

 ### 任务 1：训练数据仓库（server/ml/data/）

 **目标：** 构建结构化的训练数据集，将 `results.csv`、FIFA 排名与赛事元数据融合为每场比赛的特征向量 + 标签。

 **1a. 数据加载与清洗模块** `server/ml/data/loader.js`

 - 从 `results.csv`（或 `matches_1930_2022.csv`）加载原始比赛记录
 - 过滤策略：
   - P0：FIFA World Cup + FIFA World Cup qualification（约 5,000+ 场）
   - P1：所有 A 级国际赛事（去除 U23、B 队友谊赛）
   - P2：全部记录（含友谊赛，用赛事权重降采样）
 - 清洗：处理缺失比分、无效队名、重复记录
 - 输出 Schema：
   ```json
   {
     "match_id": "wc2022-final",
     "date": "2022-12-18",
     "tournament": "FIFA World Cup",
     "round": "Final",
     "home_team": "Argentina",
     "away_team": "France",
     "home_score": 3,
     "away_score": 3,
     "neutral": true,
     "year": 2022
   }
   ```

 **1b. FIFA 排名时间线** `server/ml/data/rankings.js`

 - 将 `fifa_ranking_*-*.csv` 构建为按时间索引的排名快照序列
 - 支持任意比赛日期查询当时排名：`getRankingAtDate("Argentina", "2022-11-20")` → `{rank, points, association}`
 - 历史排名不足时的补齐策略：按 2002 年排名向后填充，或使用 Elo 评分替代
 - 最新排名定期从 `football-data.org` API 同步（复用现有 `footballApi.js`）

 **1c. 特征工程管线** `server/ml/data/features.js`

 为每场比赛生成本队视角和对方视角的对称特征向量。参考管线中的特征并扩展：

 **基础特征（参考管线已验证）：**

 | 特征 | 类型 | 说明 |
 |---|---|---|
 | `team_rank` | 连续 | 赛前 FIFA 排名 |
 | `team_points` | 连续 | 赛前 FIFA 积分 |
 | `opponent_rank` | 连续 | 对方排名 |
 | `opponent_points` | 连续 | 对方积分 |
 | `rank_diff` | 连续 | opponent_rank - team_rank（正数 = 本队排名更高） |
 | `points_diff` | 连续 | team_points - opponent_points |
 | `is_home` | 布尔 | 是否为主队（世界杯中立场地统一为 0） |
 | `is_host` | 布尔 | 是否为东道主 |
 | `is_knockout` | 布尔 | 是否为淘汰赛阶段 |
 | `same_confed` | 布尔 | 是否同洲足联 |
 | `host_points_diff` | 连续 | is_host × points_diff（交互项） |
 | `team_recent_goals` | 连续 | 该队在该赛事中最近 N 场的平均进球（滚动窗口） |

 **扩展特征（Phase 5 新增）：**

 | 特征 | 类型 | 说明 |
 |---|---|---|
 | `team_recent_conceded` | 连续 | 最近 N 场场均失球 |
 | `team_recent_xg` | 连续 | 最近 N 场场均预期进球（如数据可用） |
 | `team_recent_form` | 分类 | 最近 5 场结果序列编码（W/D/L 转数值） |
 | `elo_rating_team` | 连续 | 项目已有的 Elo 评分（桥梁特征） |
 | `elo_rating_opponent` | 连续 | 对手 Elo 评分 |
 | `elo_diff` | 连续 | 两队 Elo 差值 |
 | `head_to_head_winrate` | 连续 | 近 5 年交手胜率 |
 | `days_since_last_match` | 连续 | 距离上一场的休息天数 |
 | `tournament_weight` | 连续 | 赛事层级权重（WC=1.0, Qualifier=0.8, Friendly=0.4） |
 | `group_stage_position` | 分类 | 小组赛排名位置（仅淘汰赛可用时） |
 | `attendance_log` | 连续 | 观众数对数（反映比赛重要性/氛围） |

 **标签（target）：**

 | 目标 | 类型 | 用于模型 | 说明 |
 |---|---|---|---|
 | `home_score` | 连续回归 | 预期进球模型 | 主队实际进球数 |
 | `away_score` | 连续回归 | 预期进球模型 | 客队实际进球数 |
 | `result` | 多分类 | 胜平负模型 | W/D/L（基于比分推导） |
 | `total_goals` | 连续回归 | 大小球模型 | home_score + away_score |
 | `both_scored` | 二分类 | BTTS 模型 | home_score>0 AND away_score>0 |

 **1d. 数据集划分与版本化**

 - 时间序列分割（防止未来数据泄露）：
   - 训练集：≤ 2018 年
   - 验证集：2019–2022 年（含 2022 WC）
   - 测试集：2023–2026 年（含 2026 WC 已完赛部分）
 - 每届世界杯做一次留出验证（LOO-CV）：用 2002–2018 训练 → 预测 2022，以此类推
 - 导出为版本化 CSV/JSON：`data/ml/train/v1/features_train.csv`

 ---

 ### 任务 2：模型训练管线（server/ml/training/）

 **目标：** 基于任务 1 生成的特征数据，训练多个预测模型并导出为可加载格式。

 **2a. 模型类型与选择**

 训练多个模型并对比，选取最优组合：

 | 模型 | 用途 | 预期优势 |
 |---|---|---|
 | Random Forest Regressor | 预期进球（主/客） | 非线性关系，抗过拟合，特征重要性可解释 |
 | XGBoost Regressor | 预期进球（主/客） | 梯度提升，通常优于 RF，可调参数多 |
 | Poisson Regression (GLM) | 预期进球（主/客） | 与足球得分分布天然吻合，可解释性强 |
 | Random Forest Classifier | 胜平负分类 | 直接输出 1X2 概率 |
 | Ordinal Regression | 胜平负有序分类 | 考虑 W/D/L 的有序性 |
 | XGBoost Classifier | 大小球 / BTTS | 二分类辅助模型 |

 **推荐方案：多模型集成（Ensemble）**

 ```
 主模型：XGBoost Regressor — 预测 λ_home, λ_away（预期进球）
 辅助模型 A：Random Forest Classifier — 预测 1X2（交叉验证）
 辅助模型 B：XGBoost Classifier — 预测 BTTS (y/n)
 辅助模型 C：XGBoost Classifier — 预测 Over 2.5 (y/n)
 最终输出：将 λ_home, λ_away 代入 Dixon-Coles 泊松计算比分分布矩阵
           + 模型置信度校准 (Platt Scaling / Isotonic)
 ```

 **2b. 训练脚本** `server/ml/training/train.py`

 - 使用 Python（scikit-learn / xgboost / statsmodels）
 - 接收特征 CSV 路径参数
 - 输出为 ONNX 或 Pickle 格式模型文件：`server/ml/models/v1/`
 - 训练报告：`server/ml/training/reports/v1/`
   - 特征重要性图
   - 混淆矩阵 + 分类报告
   - 校准曲线（Calibration Curve）
   - 测试集 RMSE / MAE / LogLoss / Brier Score
   - 各届世界杯留出验证结果

 **2c. 超参数调优**

 - 使用 Optuna 或 GridSearchCV 搜索最优参数
 - 指标优化目标：LogLoss（分类）/ RMSE（回归）
 - 每次调优结果记录到 `reports/v1/hparams.json`

 **2d. 模型导出与版本控制**

 - 每个训练版本生成清单文件 `manifests/v1.json`：
   ```json
   {
     "version": "v1",
     "date": "2026-06-25",
     "model_files": ["xgboost_home.json", "xgboost_away.json", "rf_classifier.pkl"],
     "features": ["team_rank", "points_diff", ...],
     "test_metrics": {
       "home_rmse": 1.12,
       "away_rmse": 1.08,
       "classification_accuracy": 0.61,
       "log_loss": 0.95,
       "brier_score": 0.21
     },
     "training_data": {
       "source": "results.csv",
       "train_range": "2002-01-01..2018-12-31",
       "test_range": "2022-01-01..2022-12-31",
       "n_matches_train": 3200,
       "n_matches_test": 64
     },
     "features_used": ["team_rank", "points_diff", ...]
   }
   ```

 ---

 ### 任务 3：模型推理服务（server/ml/inference/）

 **目标：** Node.js 端加载训练好的模型，对未开赛比赛运行推理，输出结构化预测结果。

 **3a. ONNX Runtime 推理层** `server/ml/inference/predictor.js`

 ```javascript
 // 加载模型（启动时或懒加载）
 const sessionHome = await ort.InferenceSession.create('./models/v1/xgboost_home.onnx');
 const sessionAway = await ort.InferenceSession.create('./models/v1/xgboost_away.onnx');
 const sessionClassifier = await ort.InferenceSession.create('./models/v1/rf_1x2.onnx');

 // 推理接口
 export async function predictMatch(homeTeam, awayTeam, matchDate, options = {}) {
   // 1. 构造特征向量（复用 features.js）
   const features = await buildFeatures(homeTeam, awayTeam, matchDate);

   // 2. 模型推理
   const lambdaHome = await runSession(sessionHome, features);
   const lambdaAway = await runSession(sessionAway, features);

   // 3. Poisson 比分分布矩阵 (0-8)
   const scoreMatrix = computePoissonMatrix(lambdaHome, lambdaAway);

   // 4. 导出 1X2、大小球、BTTS 等
   return {
     homeTeam,
     awayTeam,
     engine: 'ml-v1',
     expectedGoals: { home: lambdaHome, away: lambdaAway },
     probabilities: computeProbabilities(scoreMatrix),
     scoreDistribution: scoreMatrix,
     overUnder: computeOverUnder(scoreMatrix),
     btts: computeBTTS(scoreMatrix),
     risk: computeRisk(scoreMatrix, classifierConfidence),
     coverage: computeCoverage(scoreMatrix),
     metadata: {
       modelVersion: 'v1',
       confidence: classifierConfidence,
       calibrated: true
     }
   };
 }
 ```

 **3b. 替代方案：Node.js 本地 ML（无 ONNX）**

 如果项目不希望引入 ONNX Runtime 或 Python 依赖，可在纯 Node.js 中实现 **轻量 Poisson Regression**：

 ```javascript
 // 基于训练好的系数，在 Node.js 中直接计算 λ
 export function predictLambda(features, coefficients) {
   // log(λ) = β₀ + β₁·x₁ + β₂·x₂ + ...
   const logLambda = coefficients.intercept +
     features.reduce((sum, f, i) => sum + f.value * coefficients.beta[i], 0);
   return Math.exp(logLambda);
 }
 ```

 此方案牺牲一定精度但零外部依赖，适合 MVP 快速上线。

 **3c. 推理结果缓存**

 - 复用 Phase 4 的统一缓存层（`cache.js`）
 - 缓存键模式：`ml:pred:{t1}:{t2}:{date}:{v}`
 - TTL：30 分钟（与现有预测缓存一致）

 ---

 ### 任务 4：预测输出扩展

 **目标：** 设计标准化的预测结果结构，前端可直接消费。

 ```typescript
 interface MatchPrediction {
   // 引擎元数据
   engine: 'elo' | 'ml-v1' | 'ensemble';
   engineVersion: string;

   // 预期进球
   expectedGoals: {
     home: number;      // 1.53
     away: number;      // 0.87
   };

   // 1X2 概率（已校准）
   probabilities: {
     homeWin: number;   // 0.52
     draw: number;      // 0.26
     awayWin: number;   // 0.22
   };

   // 泊松比分矩阵 (9×9)
   scoreDistribution: number[][];

   // 比分 TOP 5（按概率排序）
   topScores: Array<{
     home: number;
     away: number;
     probability: number;
   }>;

   // 大小球
   overUnder: {
     over2_5: number;   // 0.48
     under2_5: number;  // 0.52
     over3_5: number;   // 0.25
     under3_5: number;  // 0.75
     expectedTotal: number;  // 2.40
   };

   // BTTS
   btts: {
     yes: number;       // 0.45
     no: number;        // 0.55
   };

   // 风险评估
   risk: {
     level: 'low' | 'medium' | 'high';
     score: number;     // 0-1, 越高越推荐
     description: string;
   };

   // 覆盖度
   coverage: {
     percent: number;   // 预测覆盖的胜平负概率总和
     top3ScoreCoverage: number; // TOP 3 比分覆盖的总概率
   };

   // 市场参考（如有赔率源）
   market?: {
     homeOdds: number;
     drawOdds: number;
     awayOdds: number;
     impliedHomeProb: number;
     source: string;
     timestamp: string;
   };

   // 回测参考
   backtest?: {
     similarMatches: number;
     historicalWinRate: number;
     avgGoalsInRound: number;
   };
 }
 ```

 ---

 ### 任务 5：赔率/赛前事实数据接入

 **目标：** 从可配置的数据源获取赛前赔率和事实，融入预测特征。

 **5a. 赔率适配器架构** `server/ml/odds/`

 ```
 server/ml/odds/
 ├── adapter.js          # 统一接口，路由到具体数据源
 ├── sources/
 │   ├── football-data.js  # football-data.org （复用现有）
 │   ├── odds-api.js       # the-odds-api.com （复用现有）
 │   └── custom-source.js  # 用户配置的任意 JSON/CSV 数据源
 └── schema.js           # 标准化赔率结构
 ```

 **5b. 标准化赔率结构**

 ```typescript
 interface PreMatchOdds {
   homeTeam: string;
   awayTeam: string;
   matchDate: string;
   source: string;
   openingOdds?: { home: number; draw: number; away: number };
   currentOdds: { home: number; draw: number; away: number };
   overUnder?: { over2_5: number; under2_5: number };
   bttsOdds?: { yes: number; no: number };
   lastUpdated: string;
 }
 ```

 **5c. 赔率数据作为模型特征**

 将赔率反推隐含概率作为特征加入模型：

 | 特征 | 来源 | 说明 |
 |---|---|---|
 | `market_home_implied` | 当前赔率 | 1 / homeOdds |
 | `market_draw_implied` | 当前赔率 | 1 / drawOdds |
 | `market_away_implied` | 当前赔率 | 1 / awayOdds |
 | `market_margin` | 计算 | impliedHome + impliedDraw + impliedAway - 1 |
 | `market_sharpness` | 计算 | 1 / margin（市场效率指标） |
 | `odds_movement_home` | 比较开盘 | (currentHome - openingHome) / openingHome |

 **5d. 用户自定义数据源**

 - 支持用户通过配置文件（`config/ml-sources.json`）添加自定义数据源
 - 数据源返回标准 JSON 格式，系统自动解析为特征
 - 示例配置：
   ```json
   {
     "sources": [
       {
         "name": "my-odds-feed",
         "type": "json",
         "url": "http://localhost:8080/odds/{date}",
         "auth": { "type": "bearer", "token_env": "ODDS_API_KEY" },
         "schedule": { "interval_minutes": 15 }
       }
     ]
   }
   ```

 ---

 ### 任务 6：回测验证框架（server/ml/backtest/）

 **目标：** 对历史世界杯逐届回测，提供模型性能透明度。

 **6a. 回测引擎** `server/ml/backtest/engine.js`

 - 对 2002、2006、2010、2014、2018、2022 每届世界杯运行预测
 - 对每场比赛比较预测概率 vs 实际结果
 - 聚合指标：

 | 指标 | 计算方式 | 目标值 |
 |---|---|---|
 | Accuracy | 正确预测的胜/平/负比例 | > 55% |
 | LogLoss | 预测概率的对数损失 | < 1.0 |
 | Brier Score | 均方概率误差 | < 0.22 |
 | AUC-ROC | 分类区分能力 | > 0.65 |
 | RMSE（进球） | 预期进球 vs 实际进球 | < 1.3 |
 | Calibration Error | 概率校准期望误差 | < 0.05 |
 | Ranked Probability Score (RPS) | 有序多分类校准 | < 0.20 |

 **6b. 回测结果展示** `GET /api/backtest`

 ```json
 {
   "status": "ok",
   "engine": "ml-v1",
   "tournaments": [
     {
       "year": 2022,
       "accuracy": 0.58,
       "logLoss": 0.96,
       "brierScore": 0.21,
       "rmse": 1.28,
       "matchesPredicted": 64,
       "topScoreHitRate": 0.12
     }
   ],
   "overall": {
     "accuracy": 0.56,
     "logLoss": 0.98,
     "brierScore": 0.22,
     "rmse": 1.30,
     "totalMatches": 384
   }
 }
 ```

 **6c. 前端回测页面** `/backtest`（Phase 3 已有路由规划）

 - 年份选择器
 - 每场比赛的预测 vs 实际结果对比
 - 校准曲线图
 - 按赛段（小组赛/淘汰赛/决赛）拆分准确率
 - 按赔率区间拆分准确率

 ---

 ### 任务 7：与现有系统集成

 **7a. API 路由增强 `server/routes/matches.js`**

 ```javascript
 // 现有端点增加 engine 参数
 // GET /api/matches/match/:t1/:t2?engine=ml
 router.get('/match/:t1/:t2', async (req, res) => {
   const engine = req.query.engine || 'elo';
   let prediction;
   switch (engine) {
     case 'ml':
       prediction = await mlPredictor.predictMatch(t1, t2, date);
       break;
     case 'ensemble':
       const eloPred = await eloPredictor.predictMatch(t1, t2);
       const mlPred = await mlPredictor.predictMatch(t1, t2);
       prediction = weightedAverage(eloPred, mlPred, { eloWeight: 0.3, mlWeight: 0.7 });
       break;
     default:
       prediction = await eloPredictor.predictMatch(t1, t2);
   }
   res.json({ ...prediction, engine });
 });
 ```

 **7b. 前端引擎切换**

 - 在预测详情页 (`/match/:t1/:t2`) 添加引擎选择器（Segmented Control）
 - 选项：Elo Classic | ML v1 | Ensemble
 - 切换时重新请求对应引擎的数据，不刷新整个页面
 - 展示对比：两引擎的预期进球、概率、置信度差异

 **7c. 蒙特卡洛模拟增强**

 - 当前 `monteCarloService.js` 使用 Elo 模型计算每场胜率
 - 新增 ML 版蒙特卡洛：用 ML 预测的 1X2 概率驱动模拟
 - 对比两种模拟的晋级概率，取加权或择优展示

 **7d. 模型说明页更新**

 - 在 `/methodology` 页增加 ML 引擎说明：
   - 数据来源与特征
   - 模型架构与训练方式
   - 回测性能指标
   - 引擎切换时机指导

 ---

 ### 任务 8：配置与运维

 **8a. 模型版本管理**

 - 目录结构：
   ```
   server/ml/
   ├── models/
   │   ├── v1/         # 首个训练版本
   │   ├── v2/         # 后续更新
   │   └── current -> v1   # 软链接指向当前版本
   ├── manifests/
   │   └── v1.json     # 版本元数据
   └── config.js       # 选择当前版本
   ```

 - 启动时 `config.js` 读取 `models/current` 软链接，加载对应模型
 - 版本切换通过更新软链接 + 信号重启推理服务实现

 **8b. 配置项 `server/config.js`**

 ```javascript
 ml: {
   enabled: true,
   engine: 'xgboost',    // xgboost | randomforest | poisson
   version: 'v1',
   useOnnx: true,
   cacheTtlMs: 30 * 60 * 1000,
   featurePath: path.join(DATA_DIR, 'ml', 'features'),
   modelPath: path.join(ML_DIR, 'models'),
   backtestEnabled: true,
   oddsSources: [
     { name: 'football-data', enabled: true },
     { name: 'the-odds-api', enabled: false }
   ]
 }
 ```

 **8c. 自定义数据源配置**

 - 用户通过 `config/ml-sources.json` 配置自己的数据源
 - 支持的数据源类型：
   - **JSON API**：定时拉取标准化比赛数据
   - **CSV 文件**：本地文件映射
   - **WebSocket**：实时赛事事件流
   - **Python 脚本**：执行外部脚本的输出作为特征输入

 ---

 ## 四、实施顺序与依赖关系

 ```
 第1步: 任务 1a-1c → 数据加载 + 特征工程管线（data/loader.js, data/rankings.js, data/features.js）
 第2步: 任务 1d → 数据集划分与导出
 第3步: 任务 2a-2d → Python 训练脚本，产出首批模型
 第4步: 任务 3a-3c → Node.js 推理服务，加载模型输出预测
 第5步: 任务 4 → 预测输出结构标准化 & 前端适配
 第6步: 任务 5 → 赔率数据接入
 第7步: 任务 6a-6c → 回测框架
 第8步: 任务 7a-7d → 系统集成（路由、前端切换、蒙特卡洛增强、说明页）
 第9步: 任务 8a-8c → 配置与运维
 第10步: 全面测试 + 端到端验证
 ```

 **关键里程碑：**

 | 里程碑 | 任务 | 验证标准 |
 |---|---|---|
 | M1: 数据就绪 | 1a-1d | 特征 CSV 可加载，无数据泄露 |
 | M2: 模型可用 | 2a-2d, 3a-3c | Node.js 端成功加载模型并输出有效预测 |
 | M3: 预测上线 | 4, 7a-7c | 前端可选择 ML 引擎并看到扩展预测结果 |
 | M4: 可信透明 | 5, 6a-6c | 回测页面展示所有历史准确率指标 |
 | M5: 运维完善 | 8a-8c | 版本切换、自定义数据源、配置管理就绪 |

 ---

 ## 五、边界情况与降级策略

 | 场景 | 行为 |
 |---|---|
 | 模型文件未找到 | 自动降级到 Elo 引擎，响应标记 `_degraded: true` |
 | 特征数据缺失（如无排名） | 用 Elo 评分填充缺失特征，记录 warning |
 | 赔率 API 超时 | 跳过赔率特征，使用无赔率的模型变体 |
 | 训练数据不足 | 启用数据增强：赛事加权采样、合成少数类 |
 | 模型预测极端概率（0.99） | 应用 Platt Calibration 拉回合理区间 |
 | ONNX Runtime 不可用 | 回退到 Node.js 本地 Poisson Regression 实现 |
 | 自定义数据源格式错误 | 忽略该数据源，不影响其他特征，记录 error |
 | 比赛跨越多个时区 | 所有日期时间统一为 UTC，特征计算以此为基准 |
 | 新增球队无历史数据 | 用 FIFA 排名 + 同协会平均特征作为 fallback |

 ---

 ## 六、文件变更清单

 | 操作 | 文件 | 说明 |
 |---|---|---|
 | **新增** | server/ml/data/loader.js | 比赛记录加载与清洗 |
 | **新增** | server/ml/data/rankings.js | FIFA 排名时间线查询 |
 | **新增** | server/ml/data/features.js | 特征工程管线 |
 | **新增** | server/ml/training/train.py | Python 训练脚本 |
 | **新增** | server/ml/training/hparams.sh | 超参数调优脚本 |
 | **新增** | server/ml/inference/predictor.js | Node.js 模型推理 |
 | **新增** | server/ml/inference/poisson.js | 泊松比分矩阵计算 |
 | **新增** | server/ml/inference/probability.js | 概率、大小球、BTTS 计算 |
 | **新增** | server/ml/odds/adapter.js | 赔率数据统一接口 |
 | **新增** | server/ml/odds/sources/football-data.js | football-data.org 适配 |
 | **新增** | server/ml/odds/sources/odds-api.js | the-odds-api 适配 |
 | **新增** | server/ml/odds/schema.js | 赔率标准化结构 |
 | **新增** | server/ml/backtest/engine.js | 回测引擎 |
 | **新增** | server/ml/config.js | ML 模块配置 |
 | **新增** | server/ml/models/.gitkeep | 模型目录占位 |
 | **新增** | server/ml/training/reports/.gitkeep | 训练报告目录 |
 | **新增** | config/ml-sources.json.example | 自定义数据源示例配置 |
 | **修改** | server/routes/matches.js | 添加 engine 参数支持 |
 | **修改** | server/routes/standings.js | 添加 engine 参数传递 |
 | **修改** | server/services/monteCarloService.js | ML 引擎版蒙特卡洛 |
 | **修改** | server/config.js | 添加 ML 配置项 |
 | **修改** | views/pages/match.ejs | 引擎切换 UI |
 | **修改** | views/pages/methodology.ejs | ML 模型说明 |
 | **修改** | views/pages/backtest.ejs | 回测结果展示页 |
 | **新增** | docs/PHASE5.md | 本文档 |

 ---

 ## 七、验收标准

 ### 数据与训练
 - [ ] `loader.js` 从 `results.csv` 加载并清洗至少 5,000 场世界杯及预选赛记录
 - [ ] `rankings.js` 对任意历史比赛日期返回该队当时的 FIFA 排名
 - [ ] `features.js` 输出包含至少 20 个特征的向量，含新增的扩展特征
 - [ ] 训练脚本产出至少一个可用模型（XGBoost 或 RF），RMSE < 1.3
 - [ ] 模型训练使用严格的时间序列分割，无数据泄露

 ### 推理与预测
 - [ ] Node.js 可加载模型并返回标准化预测结构
 - [ ] 预测输出包含：预期进球、胜平负概率、TOP 5 比分、大小球、BTTS、风险评估、覆盖度
 - [ ] `GET /api/matches/match/:t1/:t2?engine=ml` 正常工作
 - [ ] `GET /api/matches/match/:t1/:t2?engine=ensemble` 返回融合结果
 - [ ] 引擎切换在前端正常工作，无页面刷新

 ### 回测与透明度
 - [ ] 回测引擎对 2002–2022 六届世界杯运行完毕
 - [ ] /backtest 页面展示逐届准确率、LogLoss、Brier Score、校准曲线
 - [ ] 模型说明页含 ML 引擎的完整方法论与性能指标

 ### 赔率与数据源
 - [ ] 至少一个赔率数据源适配完成，赔率特征可加入模型
 - [ ] 支持用户通过 `config/ml-sources.json` 配置自定义数据源
 - [ ] 数据源不可用时自动降级，不影响其他特征

 ### 运维
 - [ ] 模型可通过软链接切换版本
 - [ ] 服务器启动时自动加载指定版本的模型
 - [ ] 模型加载失败时自动降级到 Elo 引擎
 - [ ] 所有配置在 `server/config.js` 中有默认值

 ---

 ## 八、技术选型指引

 ### 为什么在 Phase 5 引入 Python 训练？

 - **生态成熟度**：scikit-learn / XGBoost / Optuna 在表格数据预测上远超 Node.js 生态
 - **开发效率**：现有的 `pipeline_sports_analytics.py` 可直接作为基线代码复用
 - **推理分离**：训练在 Python 中完成，推理通过 ONNX Runtime 在 Node.js 中运行，两者互不干扰

 ### 为什么不直接替换 Elo 模型，而是做双引擎？

 - **渐进迁移**：Elo 模型用户已熟悉，ML 模型需要时间验证可信度
 - **A/B 对比**：双引擎让用户可以直接对比两种方法的预测差异
 - **降级保障**：ML 引擎的任何问题都不会影响现有功能的可用性
 - **集成创新**：Ensemble 模式融合统计模型与 ML 模型的优势

 ### 模型选型建议清单

 | 场景 | 推荐模型 | 备选 |
 |---|---|---|
 | 预期进球预测 | XGBoost Regressor | Random Forest, Poisson GLM |
 | 胜平负概率 | Random Forest Classifier | XGBoost, Ordinal Regression |
 | 大小球分类 | XGBoost Classifier | Logistic Regression |
 | BTTS分类 | XGBoost Classifier | Logistic Regression |
 | 置信校准 | Platt Scaling | Isotonic Regression |
 | 超参数搜索 | Optuna | GridSearchCV |
 | 模型导出 | ONNX | Pickle + [secure] |
 | 特征选择 | Recursive Feature Elimination | SHAP values |
