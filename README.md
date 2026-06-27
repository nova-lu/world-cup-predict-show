# 🏆 2026 世界杯观赛数据助手 (World Cup 2026 Data Assistant)

基于 **Elo + Dixon-Coles 双变量泊松**与 **XGBoost/Random Forest 机器学习双引擎**的赛事数据分析平台，集成 **传统博彩赔率 + Polymarket 预测市场**三源融合概率。为球迷提供赛前预测、晋级概率、赔率对比与球队数据功能。

> ⚠️ **合规声明：** 本站所有预测数据均基于公开数学模型计算，仅供娱乐与数据分析科普参考，**不构成任何投注建议或决策指导**。根据中国法律法规，境内任何网络体育博彩均属于非法活动。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 后端框架 | Node.js + Express (ESM, v24.16.0) |
| 模板引擎 | EJS (服务端渲染，暗色主题) |
| 预测引擎 A | Elo 评分 → Dixon-Coles 双变量泊松 → 蒙特卡洛模拟 |
| 预测引擎 B | XGBoost 回归 + Random Forest 分类 → 泊松比分矩阵 |
| 集成引擎 | Elo 30% + ML 70% 加权融合 |
| 赔率融合 | log-odds 加权 / 贝叶斯三源融合（博彩+Polymarket+模型） |
| 缓存 | L1 内存字典 + L2 磁盘文件 (30min TTL, 手动刷新) |
| ML 训练 | Python 3.11+ (scikit-learn, xgboost, joblib) |
| ML 推理 | Node.js → Python 子进程 (stdin/stdout JSON) |
| 代理支持 | undici ProxyAgent (Polymarket API 跨墙) |
| 前端 | 纯 CSS (暗色主题，移动端适配，无框架依赖) |
| 数据源 | Football-data.org API · The Odds API · Polymarket GAMMA/CLOB API · 历史比赛 CSV (46k 场) · FIFA 排名 |

## 快速启动

```bash
# 安装 Node.js 依赖
npm install

# 安装 Python 依赖（ML 引擎必需）
pip install scikit-learn xgboost joblib numpy pandas

# 复制环境变量模板
cp .env.example .env
# 编辑 .env 填入 ODDS_API_KEY / FOOTBALL_API_KEY

# 启动服务器（需代理访问 Polymarket 时设置 HTTPS_PROXY）
export HTTPS_PROXY=http://127.0.0.1:7890
node server/index.js

# 访问
http://localhost:3000
```

> 默认启用 Elo 引擎。首次请求 `?engine=ml` 时自动加载 ML 模型（约 3-5 秒）。

## 功能架构

```
用户浏览器 (EJS 页面)
       │
       ▼
  Express 服务器 (:3000)
       │
       ├── ?? 预测引擎 ─────────────────────────────────────
       │     ├── Engine A (Elo + Dixon-Coles) ──── 默认
       │     │     └── server/services/predictionService.js
       │     ├── Engine B (ML Pipeline) ─────────── Phase 5
       │     │     ├── server/ml/data/            特征工程
       │     │     ├── server/ml/models/          5 个模型 (55MB)
       │     │     ├── server/ml/inference/       推理服务
       │     │     └── server/ml/backtest/        回测框架
       │     └── 引擎切换 ─────────────────────── ?engine=ml|elo|ensemble
       │
       ├── 📈 赔率与市场融合 ───────────────────── Phase 7
       │     ├── 传统博彩 ──── The Odds API (odds-api.io)
       │     │     └── server/services/oddsApi.js
       │     ├── 预测市场 ──── Polymarket GAMMA + CLOB API
       │     │     └── server/ml/odds/sources/polymarket.js
       │     ├── 三源融合 ──── log-odds 加权 / 贝叶斯
       │     │     └── server/ml/odds/fusion/fusion.js
       │     └── 代理支持 ──── undici ProxyAgent
       │           └── server/utils/proxyFetch.js
       │
       └── 📊 蒙特卡洛模拟 ────────────────────────
             └── server/services/monteCarloService.js
```

## 项目结构

```
worldcup_new_2026/
├── server/
│   ├── index.js                    # Express 入口 + 页面路由
│   ├── config.js                   # 全局配置
│   ├── routes/
│   │   ├── matches.js              # 赛事/预测 API（支持 ?engine）
│   │   ├── standings.js            # 积分榜/晋级概率 API
│   │   ├── bracket.js              # 淘汰赛对阵
│   │   ├── teams.js                # 球队信息 API
│   │   └── odds.js                 # ★ 赔率+Polymarket+融合 API (Phase 7)
│   ├── services/
│   │   ├── footballApi.js          # Football-data.org API 封装
│   │   ├── dataService.js          # 数据加载 + 降级
│   │   ├── predictionService.js    # Elo 预测服务
│   │   ├── monteCarloService.js    # 蒙特卡洛模拟 (晋级概率)
│   │   └── oddsApi.js              # ★ The Odds API 封装 (Phase 6)
│   ├── middleware/
│   │   ├── cache.js                # L1+L2 持久化缓存
│   │   └── parseForce.js           # ?force=1 中间件
│   ├── utils/
│   │   └── proxyFetch.js           # ★ 代理感知 fetch 工具 (Phase 7)
│   └── ml/
│       ├── config.js               # ML/odds 模块配置
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
│       ├── manifests/v1.json       # 模型版本清单
│       └── odds/                   # ★ 赔率融合 (Phase 7)
│           ├── sources/
│           │   ├── polymarket.js       # Polymarket GAMMA/CLOB API
│           │   ├── polymarket_mapper.js# 队名映射
│           │   └── unified.js          # 统一信源适配层
│           └── fusion/
│               ├── fusion.js           # 融合引擎核心
│               ├── weights.js          # Brier Score 权重跟踪
│               └── calibrator.js       # 概率校准
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
│   ├── cache/                      # 磁盘缓存
│   └── ml/train/v1/                # 特征数据集
├── scripts/
│   └── inspect_pm_events.js        # Polymarket 事件类型检查
├── docs/
│   └── DEPLOY.md                   # 部署文档
└── package.json
```

## 页面路由

| 路径 | 页面 | 说明 |
|---|---|---|
| `/` | 今日赛事首页 | 48h 赛程、Elo/ML 预测、赔率对比、Polymarket 融合 |
| `/match/:t1/:t2` | 比赛详情页 | 引擎切换、三源融合概率、比分分布、赔率对比 |
| `/schedule` | 完整赛程 | 全部 104 场比赛日历 |
| `/standings` | 晋级概率榜 | 小组积分 + 蒙特卡洛晋级/夺冠概率 |
| `/teams` | 球队列表 | 48 队 Elo 评分排名 |
| `/teams/:slug` | 球队详情 | 战绩、实力对比、相关比赛 |
| `/polymarket` | 预测市场 | ★ Polymarket 实时价格 (近期 48h / 历史已结算) |
| `/methodology` | 模型说明 | 预测算法科普 |
| `/backtest` | 回测结果 | 模型历史准确率 |
| `/simulator` | 数据模拟器 | 自定义比赛模拟 |
| `/demo` | 市场模拟 | 预测市场模拟 |
| `/bracket` | 淘汰赛树图 | 完整对阵图 |
| `/blog` | 博客列表 | 赛事数据分析文章 |

## API 文档

### 赛程与预测

| 端点 | 说明 |
|---|---|
| `GET /api/matches/today?hours=48` | 今日赛事列表（含 Elo 预测） |
| `GET /api/matches/schedule?date=&group=&status=` | 赛程查询（支持筛选） |
| `GET /api/matches/upcoming?limit=10` | 即将开赛的比赛 |
| `GET /api/matches/match/:t1/:t2?engine=ml` | 单场预测（支持引擎切换） |
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

### 传统赔率与市场数据 (Phase 6-7)

| 端点 | 说明 |
|---|---|
| `GET /api/odds/available` | 有赔率的比赛列表 |
| `GET /api/odds/match/:t1/:t2` | 某场比赛传统赔率（去抽水） |
| `GET /api/odds/events` | 博彩 API 事件列表（调试） |
| `GET /api/odds/polymarket?scope=upcoming` | ★ 预测市场事件列表（近期 48h / 历史） |
| `GET /api/odds/polymarket/match/:t1/:t2` | ★ 单场 Polymarket 概率 |
| `GET /api/odds/fusion/match/:t1/:t2?engine=ensemble` | ★ 三源融合概率（博彩+Polymarket+模型） |
| `GET /api/odds/fusion/today` | ★ 今日所有比赛批量融合 |
| `GET /api/odds/fusion/status` | ★ 融合引擎状态 & 权重 |

### ML 引擎

| 端点 | 说明 |
|---|---|
| `GET /api/ml/status` | ML 引擎状态 & 模型版本 |
| `GET /api/ml/backtest` | 历史世界杯回测 |

### 缓存管理

| 端点 | 说明 |
|---|---|
| `GET /api/cache/stats?force=1` | 缓存统计 + 强制刷新 |

## 预测引擎

### Engine A: Elo + Dixon-Coles（默认）

1. **Elo 评分**：基于 913 场国际比赛（2023.10 – 2026.06）校准的球队实力评级
2. **Dixon-Coles 泊松**：计算胜平负概率与预期进球，修正低比分偏差
3. **蒙特卡洛模拟**：模拟上万次赛程走向，计算晋级概率

模型回测 62% 准确率，预期校准误差 2.3%。

### Engine B: ML Pipeline（Phase 5）

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

## 赔率融合系统 — Phase 7

### 三源融合

```
┌──────────┐   ┌────────────┐   ┌─────────────┐
│ 传统博彩  │   │ Polymarket │   │ ML/Elo 模型 │
│ odds-api  │   │ 预测市场   │   │             │
└─────┬────┘   └──────┬─────┘   └──────┬──────┘
      │               │                │
      └───────────────┼────────────────┘
                      ▼
           ┌──────────────────┐
           │  融合引擎 (fuse)  │
           │  log-odds 加权   │
           │  或 贝叶斯融合   │
           │  Brier 权重跟踪  │
           │  概率校准        │
           └────────┬─────────┘
                    ▼
          ┌───────────────────┐
          │  融合概率 + 置信度 │
          │  + JSD 分歧指标   │
          └───────────────────┘
```

### 融合策略

- **A: log-odds-weighted（默认）** — 在 log-odds 空间加权平均，再映射回概率空间
- **B: bayesian** — ML 模型概率为 Beta 先验，市场概率为似然，后验为融合结果

### 权重跟踪

- 每次比赛结束后，根据实际结果计算各信源的 **Brier Score**
- 历史 Brier Score 越低 → 权重越高
- 动态调整，保留最近 30 场比赛记录

## 缓存系统

- **两层级**：L1 内存 (快速) + L2 磁盘文件 (持久化)
- **统一 TTL**：30 分钟（赔率类 5 分钟）
- **击穿保护**：并发请求共享 pending promise
- **强制刷新**：`?force=1` 参数或页面底部「🔄 刷新」按钮
- **状态指示**：比赛详情页底部缓存状态栏（绿/黄/红点）

## 数据来源

- **实时 API**：
  - Football-data.org — 比赛赛程、结果、积分榜
  - The Odds API — 传统博彩赔率 (ODDS_API_KEY)
  - Polymarket GAMMA API — 预测市场事件列表（公开，无需 Key）
  - Polymarket CLOB API — 链上价格历史（公开）
- **FIFA 排名**：FIFA 官方（2022.10 + 2026.06 快照）
- **历史数据**：46,383 场国际比赛（1930~2026）
- **代理支持**：墙外 API 通过 undici ProxyAgent + `HTTPS_PROXY` 环境变量自动代理

## 环境变量

| 变量 | 说明 | 必需 |
|---|---|---|
| `FOOTBALL_API_KEY` | Football-data.org API Key | 是 |
| `ODDS_API_KEY` | The Odds API Key | 赔率功能必需 |
| `HTTPS_PROXY` | 代理地址 (墙外 API 访问) | Polymarket 必需 |
| `PORT` | 端口 (默认 3000) | 否 |

## 部署

详见 [`docs/DEPLOY.md`](docs/DEPLOY.md)

```bash
# 部署前检查清单
# 1. .env 文件存在且包含必要 API Key
# 2. npm install 完成
# 3. pip install scikit-learn xgboost joblib
# 4. 模型文件存在 (server/ml/models/v1/*.pkl)
# 5. 端口 3000 未被占用
# 6. HTTPS_PROXY 配置（如需 Polymarket）
# 7. node server/index.js 启动无报错
```

## License

MIT
