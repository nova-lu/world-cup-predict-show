# 🏆 2026 世界杯观赛数据助手 (World Cup 2026 Data Assistant)

基于 **Elo + Dixon-Coles 双变量泊松**与 **XGBoost/Random Forest 机器学习双引擎**的赛事数据分析工具，为球迷提供赛前预测、晋级概率与球队数据对比功能。

> ⚠️ **合规声明：** 本站所有预测数据均基于公开数学模型计算，仅供娱乐与数据分析科普参考，**不构成任何投注建议或决策指导**。根据中国法律法规，境内任何网络体育博彩均属于非法活动。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 后端框架 | Node.js + Express (ESM, v24.16.0) |
| 模板引擎 | EJS (服务端渲染) |
| 预测引擎 A | Elo 评分 → Dixon-Coles 双变量泊松 → 蒙特卡洛模拟 |
| 预测引擎 B | XGBoost 回归 + Random Forest 分类 → 泊松比分矩阵 |
| 集成引擎 | Elo 30% + ML 70% 加权融合 |
| 缓存 | L1 内存 + L2 磁盘持久化 (30min TTL, 手动刷新) |
| ML 训练 | Python 3.11+ (scikit-learn, xgboost, joblib) |
| ML 推理 | Node.js → Python 子进程 (stdin/stdout JSON) |
| 前端 | 纯 CSS (暗色主题，移动端适配) |
| 数据源 | Football-data.org API + 历史比赛 CSV (46k 场) + FIFA 排名 |

## 快速启动

```bash
# 安装 Node.js 依赖
npm install

# 安装 Python 依赖（ML 引擎必需）
pip install scikit-learn xgboost joblib numpy pandas

# 启动服务器
node server/index.js

# 访问
http://localhost:3000
```

> 默认启用 Elo 引擎。首次请求 `?engine=ml` 时自动加载 ML 模型。

## 双引擎预测架构

```
用户浏览器 (EJS 页面)
       │
       ▼
  Express 服务器 (:3000)
       │
       ├── Engine A (Elo + Dixon-Coles) ──── 默认引擎
       │     └── server/services/predictionService.js
       │
       ├── Engine B (ML Pipeline) ─────────── Phase 5 新增
       │     ├── server/ml/data/        特征工程管线
       │     ├── server/ml/models/      5 个训练模型 (55MB)
       │     ├── server/ml/inference/   推理服务
       │     └── server/ml/backtest/    回测框架
       │
       └── 引擎切换 ─────────────────── ?engine=ml|elo|ensemble
```

**API 引擎切换：**
```bash
# Elo 引擎（默认）
curl "http://localhost:3000/api/matches/match/Brazil/Argentina"

# ML 引擎
curl "http://localhost:3000/api/matches/match/Brazil/Argentina?engine=ml"

# 集成引擎（Elo 30% + ML 70%）
curl "http://localhost:3000/api/matches/match/Brazil/Argentina?engine=ensemble"
```

**页面引擎切换**：比赛详情页顶部 Tab 选择器，点击即时切换。

## 项目结构

```
worldcup_new_2026/
├── server/
│   ├── index.js                    # Express 入口 + 页面路由 + ML API
│   ├── config.js                   # 项目全局配置
│   ├── routes/
│   │   ├── matches.js              # 赛事/预测 API（支持 ?engine 参数）
│   │   ├── standings.js            # 积分榜/晋级概率 API
│   │   ├── bracket.js              # 淘汰赛对阵
│   │   ├── teams.js                # 球队信息 API
│   │   └── odds.js                 # 赔率数据 API
│   ├── services/
│   │   ├── footballApi.js          # Football-data.org API 封装
│   │   ├── dataService.js          # 数据加载 + 降级
│   │   ├── predictionService.js    # Elo 预测服务
│   │   ├── monteCarloService.js    # 蒙特卡洛模拟 (晋级概率)
│   │   └── oddsApi.js              # 赔率服务
│   ├── middleware/
│   │   ├── cache.js                # L1+L2 持久化缓存
│   │   └── parseForce.js           # ?force=1 中间件
│   └── ml/                         # ★ ML 引擎 (Phase 5)
│       ├── config.js               # ML 模块配置
│       ├── data/
│       │   ├── loader.js           # 历史比赛加载 (46k 场)
│       │   ├── rankings.js         # FIFA 排名 + Elo 评分
│       │   └── features.js         # 23 维特征工程
│       ├── models/v1/              # 训练好的模型 (55MB)
│       ├── inference/
│       │   ├── predict.py          # Python 子进程推理
│       │   ├── predictor.js        # Node.js 封装
│       │   └── poisson.js          # 泊松比分矩阵
│       ├── training/
│       │   └── train.py            # Python 训练脚本
│       └── manifests/v1.json       # 模型版本清单
├── views/
│   ├── partials/                   # 页头/页脚组件
│   └── pages/                      # 页面模板 (EJS)
├── public/
│   ├── css/app.css                 # 暗色主题样式
│   └── js/
│       ├── app.js                  # 前端工具函数
│       └── cache-ui.js             # 缓存状态指示器
├── data/
│   ├── elo-calibrated.json         # 48 支球队 Elo 评分
│   ├── wc2026-results.json         # 已完赛结果
│   ├── cache/                      # 磁盘缓存 (已 gitignore)
│   └── ml/train/v1/                # 特征数据集
├── docs/
│   └── DEPLOY.md                   # 部署文档
└── package.json
```

## API 文档

### 赛程与预测

| 端点 | 说明 |
|---|---|
| `GET /api/matches/today` | 今日赛事列表（含预测） |
| `GET /api/matches/schedule?date=&group=&status=` | 赛程查询（支持筛选） |
| `GET /api/matches/upcoming?limit=10` | 即将开赛的比赛 |
| `GET /api/matches/match/:t1/:t2?engine=ml` | **单场预测（支持引擎切换）** |
| `GET /api/matches/compare/:t1/:t2?scores=true` | 两队实力对比 + 比分分布 |

### 积分与晋级

| 端点 | 说明 |
|---|---|
| `GET /api/standings/groups` | 12 小组实时积分榜 |
| `GET /api/standings/groups/:group` | 单组积分榜 |
| `GET /api/standings/advancement?sims=5000` | 蒙特卡洛晋级概率 |

### 球队信息

| 端点 | 说明 |
|---|---|
| `GET /api/teams` | 48 支球队列表（含 Elo 评分） |
| `GET /api/teams/:slug` | 球队详情 |
| `GET /api/teams/:slug/compare/:opponent` | 球队快速对比 |

### ML 引擎（Phase 5 新增）

| 端点 | 说明 |
|---|---|
| `GET /api/ml/status` | ML 引擎状态 & 模型版本信息 |
| `GET /api/ml/backtest` | 历史世界杯回测 |

### 缓存管理

| 端点 | 说明 |
|---|---|
| `GET /api/cache/stats?force=1` | 缓存统计 + 强制刷新 |

### ML 预测输出结构

```json
{
  "engine": "ml-v1",
  "expectedGoals": { "home": 2.42, "away": 1.32 },
  "probabilities": { "homeWin": 0.6174, "draw": 0.1867, "awayWin": 0.1960 },
  "scoreDistribution": [ [9x9 泊松矩阵] ],
  "topScores": [
    { "home": 2, "away": 1, "probability": 0.0919 },
    ...
  ],
  "overUnder": {
    "over2_5": 0.72, "under2_5": 0.28,
    "over3_5": 0.51, "under3_5": 0.49,
    "expectedTotal": 3.73
  },
  "btts": { "yes": 0.67, "no": 0.33 },
  "risk": { "level": "high", "score": 0.14, "description": "..." },
  "coverage": { "percent": 61.74, "top3ScoreCoverage": 24.19 },
  "metadata": {
    "modelVersion": "v1", "confidence": 0.38,
    "calibrated": true,
    "features": ["team_rank", "team_points", ...]
  }
}
```

## 页面路由

| 路径 | 页面 |
|---|---|
| `/` | 今日赛事首页 |
| `/match/:t1/:t2` | 比赛预测详情页（支持引擎切换） |
| `/schedule` | 完整赛程 |
| `/standings` | 晋级概率榜 + 小组积分榜 |
| `/teams` | 球队信息库 |
| `/teams/:slug` | 球队详情页 |
| `/methodology` | 预测模型科普说明 |
| `/backtest` | 模型历史回测 |
| `/simulator` | 数据模拟器 |
| `/demo` | 预测市场模拟 |

## 模型说明

### Engine A: Elo + Dixon-Coles（默认）

1. **Elo 评分**：基于 913 场国际比赛（2023.10 – 2026.06）校准的球队实力评级
2. **Dixon-Coles 泊松**：计算胜平负概率与预期进球，修正低比分偏差
3. **蒙特卡洛模拟**：模拟上万次赛程走向，计算晋级概率

模型回测 62% 准确率，预期校准误差 2.3%。详见 `/methodology` 页面。

### Engine B: ML Pipeline（Phase 5 新增）

| 模型 | 类型 | 用途 | 测试指标 |
|---|---|---|---|
| xgb_home | XGBoost 回归 | 预期主队进球 | RMSE=1.40 |
| xgb_away | XGBoost 回归 | 预期客队进球 | RMSE=1.15 |
| rf_1x2 | Random Forest 分类 | 胜平负 | Acc=55.3% |
| xgb_btts | XGBoost 分类 | 双方进球 | Acc=56.7% |
| xgb_over_under | XGBoost 分类 | >2.5 球 | Acc=58.0% |

- **训练数据**：46,383 场国际比赛（1930~2026），严格时间序列分割
- **特征空间**：23 维（FIFA 排名、Elo 评分、近期战绩、锦标赛权重等）
- **推理流程**：Node.js 构建特征向量 → Python 子进程推理 → 泊松比分矩阵 → 标准化输出

### Engine Ensemble（集成）

Elo 30% + ML 70% 概率加权融合，归一化输出。

## 缓存系统（Phase 4）

- **两层级**：L1 内存 (快速) + L2 磁盘文件 (持久化)
- **统一 TTL**：30 分钟
- **击穿保护**：并发请求共享 pending promise
- **强制刷新**：`?force=1` 参数或页面底部「🔄 Update Data」按钮
- **定位**：比赛详情页底部缓存状态栏（绿/黄/红点）

## 数据来源

- 实时 API：Football-data.org · OpenFootball
- FIFA 排名：FIFA 官方（2022.10 + 2026.06 快照）
- 灵感模型：[world-cup-2026-prediction-model](https://cup26matches.com/)

## 部署

详见 [`docs/DEPLOY.md`](docs/DEPLOY.md)

```bash
# 部署前检查清单
# 1. .env 文件存在且包含 FOOTBALL_API_KEY
# 2. npm install 完成
# 3. pip install scikit-learn xgboost joblib
# 4. 模型文件存在 (server/ml/models/v1/*.pkl)
# 5. 端口 3000 未被占用
# 6. node server/index.js 启动无报错
```

## License

MIT
