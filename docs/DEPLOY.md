# 2026 世界杯观赛数据助手 — 部署文档

> 项目整合了 Elo+Dixon-Coles 统计模型与 XGBoost/RandomForest 机器学习模型，提供双引擎比赛预测系统。
> 包含实时数据拉取、持久缓存、前端引擎切换、回测框架的全栈数据应用。

---

## 一、项目总览

### 双引擎预测架构

```
用户浏览器 (EJS 页面)
       │
       ▼
  Express 服务器 (:3000)
       │
       ├── Engine A (Elo + Dixon-Coles) ──── 默认引擎，纯统计模型
       │     └── server/services/predictionService.js
       │
       └── Engine B (ML Pipeline) ─────────── Phase 5 新增，数据驱动
             ├── server/ml/data/     ← 特征工程管线
             ├── server/ml/models/   ← 训练好的模型文件
             ├── server/ml/inference/ ← 推理服务
             └── server/ml/backtest/  ← 回测框架
```

### 引擎切换方式

API 端点接受 `?engine=ml|elo|ensemble` 参数：
- `elo` — 默认，Elo 评分 + 双变量泊松模型
- `ml` — XGBoost 预期进球 + Random Forest 1X2 分类 → 泊松比分矩阵
- `ensemble` — Elo 30% + ML 70% 加权融合

---

## 二、环境要求

| 依赖 | 版本要求 | 用途 |
|------|---------|------|
| Node.js | >= 18 (当前 v24.16.0) | 服务器运行时 |
| Python | >= 3.11 (当前 3.13.13) | ML 模型推理子进程 |
| npm 包 | 见 package.json | Express, EJS, undici |
| Python 包 | scikit-learn, xgboost, joblib, numpy, pandas | 模型加载与推理 |

### Python 依赖（ML 引擎必需）

```bash
pip install scikit-learn xgboost joblib numpy pandas
```

当前已安装版本：scikit-learn 1.9.0, xgboost 3.3.0, joblib 1.5.3, numpy 2.4.6, pandas 3.0.3

---

## 三、文件结构（Phase 5 核心）

```
server/
├── config.js                        # 项目基础配置（导出 ROOT_DIR/DATA_DIR/ML_DIR）
├── index.js                         # Express 入口 + 页面路由 + ML API 路由
├── ml/
│   ├── config.js                    # ML 模块配置（启用/禁用、版本、路径）
│   ├── data/
│   │   ├── loader.js                # 比赛记录加载与清洗（3 CSV 源，46k 场比赛）
│   │   ├── rankings.js              # FIFA 排名时间线查询（2022+2026 快照）
│   │   └── features.js              # 特征工程管线（23 个特征 + 时间序列分割）
│   ├── models/
│   │   └── v1/                      # 5 个训练好的模型 ≈ 55 MB
│   │       ├── xgb_home.pkl         # XGBoost 预期主队进球
│   │       ├── xgb_away.pkl         # XGBoost 预期客队进球
│   │       ├── rf_1x2.pkl           # Random Forest 胜平负分类
│   │       ├── xgb_btts.pkl         # XGBoost 双方进球(BTTS)分类
│   │       └── xgb_over_under.pkl   # XGBoost 大小球(Over 2.5)分类
│   ├── inference/
│   │   ├── predict.py               # Python 子进程：加载模型 → 推理 → 输出 JSON
│   │   ├── predictor.js             # Node.js 封装：特征构建 → 子进程调用 → 输出标准化
│   │   └── poisson.js               # 泊松比分矩阵 + 1X2/大小球/BTTS/风险/覆盖度
│   ├── training/
│   │   ├── train.py                 # 完整训练脚本
│   │   └── reports/v1/              # 训练报告 + 特征重要性图
│   ├── backtest/
│   │   └── engine.js                # 历史世界杯回测框架
│   └── manifests/
│       └── v1.json                  # 模型版本清单（含所有指标）
├── routes/
│   └── matches.js                   # ?engine=ml|elo|ensemble 路由切换
└── middleware/
    └── cache.js                     # 统一缓存层（持久化到磁盘）

data/
├── cache/                           # API 缓存（磁盘持久化，30min TTL）
└── ml/train/v1/
    └── features_full.csv            # 46,383 场比赛 × 23 特征 + 5 目标变量

外部数据源（项目依赖，不部署）：
├── world-cup-data/      # 历史比赛数据 + FIFA 排名 + 赛程
└── fifa-wc-2026-in-progress/        # 更全面的国际比赛数据库
```

---

## 四、一键启动

### 标准启动（Elo 引擎 + 完整 Web 服务）

```bash
cd E:\codes_practice\world-cup-related\worldcup_new_2026
node server/index.js
```

访问 http://localhost:3000

### 启动参数说明

服务器启动时自动完成以下操作：
1. 加载 `.env` 配置（FOOTBALL_API_KEY）
2. 初始化缓存层（从磁盘恢复持久化数据）
3. 注册所有 API 路由（包含 ML 引擎路由）
4. ML 引擎懒加载：仅在首次请求 `?engine=ml` 时加载模型

### 首次部署额外步骤

```bash
# 1. 安装 Node.js 依赖（已有）
npm install

# 2. 安装 Python 依赖（ML 引擎必需）
pip install scikit-learn xgboost joblib numpy pandas

# 3. 确认数据文件存在
ls world-cup-data/matches_1930_2022.csv  # 必须存在
ls world-cup-data/fifa_ranking_2022-10-06.csv
ls world-cup-data/fifa_ranking_2026-06-08.csv

# 4. 启动
node server/index.js
```

---

## 五、API 端点

### Web 页面路由

| 路径 | 说明 |
|------|------|
| `/` | 今日赛事 |
| `/schedule` | 赛程列表（支持 ?date / ?group / ?status 筛选） |
| `/standings` | 晋级概率 + 小组积分榜 |
| `/bracket` | 淘汰赛对阵图 |
| `/teams` | 球队库 |
| `/teams/:slug` | 球队详情 |
| `/match/:t1/:t2` | 预测详情页（Elo 默认） |
| `/methodology` | 模型说明（含 ML 引擎说明） |
| `/backtest` | 模型回测页 |
| `/simulator` | 数据模拟器 |

### JSON API 端点

#### 比赛与预测

```
GET /api/matches/today                 今日赛事
GET /api/matches/schedule              赛程列表
GET /api/matches/upcoming              即将开赛
GET /api/matches/match/:t1/:t2         单场预测（支持 ?engine=ml|elo|ensemble）
GET /api/matches/compare/:t1/:t2       两队对比
```

#### 积分与概率

```
GET /api/standings/groups              小组积分榜
GET /api/standings/advancement         晋级概率（通过 Monte Carlo 模拟）
```

#### ML 引擎（Phase 5 新增）

```
GET /api/ml/status                     ML 引擎状态 & 模型版本信息
GET /api/ml/backtest                   回测结果
```

**?engine 参数说明**（仅 `/api/matches/match/:t1/:t2`）:

```bash
# Elo 引擎（默认）
curl "http://localhost:3000/api/matches/match/Brazil/Argentina"

# ML 引擎
curl "http://localhost:3000/api/matches/match/Brazil/Argentina?engine=ml"

# 集成引擎
curl "http://localhost:3000/api/matches/match/Brazil/Argentina?engine=ensemble"
```

#### ML 预测输出结构

```javascript
{
  "engine": "ml-v1",              // 引擎标识
  "expectedGoals": {
    "home": 2.42,                 // 预期主队进球 (λ_home)
    "away": 1.32                  // 预期客队进球 (λ_away)
  },
  "probabilities": {
    "homeWin": 0.6174,            // 主胜概率（归一化）
    "draw": 0.1867,               // 平局概率
    "awayWin": 0.1960             // 客胜概率
  },
  "scoreDistribution": [...],     // 9×9 泊松比分概率矩阵
  "topScores": [                  // TOP 5 最可能比分
    {"home": 2, "away": 1, "probability": 0.0919},
    ...
  ],
  "overUnder": {
    "over2_5": 0.72, "under2_5": 0.28,   // 大小球 2.5
    "over3_5": 0.51, "under3_5": 0.49,   // 大小球 3.5
    "expectedTotal": 3.73                 // 预期总进球
  },
  "btts": {
    "yes": 0.67, "no": 0.33              // 双方进球概率
  },
  "risk": {
    "level": "high",                      // low/medium/high
    "score": 0.14,                        // 0-1
    "description": "预测波动较大..."
  },
  "coverage": {
    "percent": 61.74,                     // 覆盖度%
    "top3ScoreCoverage": 24.19
  }
}
```

#### 其他 API

```
GET /api/teams                    球队列表
GET /api/teams/:slug              球队详情
GET /api/cache/stats              缓存统计（支持 ?force=1 刷新）
```

---

## 六、ML 引擎技术细节

### 6.1 数据源

| 数据 | 来源 | 记录数 |
|------|------|--------|
| 历史世界杯+预选赛 | `matches_1930_2022.csv` | ~5,000 场 |
| 全量国际比赛 | `results.csv` (fifa-wc-2026-in-progress) | ~54,000 场 |
| FIFA 排名 | `fifa_ranking_2022-10-06.csv` + `fifa_ranking_2026-06-08.csv` | ~210 队/快照 |
| Elo 评分 | `data/elo-calibrated.json` | 48 支球队 |

### 6.2 特征工程（23 个特征）

**基础特征（12 个，参考 UNIRIO 学术管线）:**
`team_rank, team_points, opponent_rank, opponent_points, rank_diff, points_diff, is_home, is_host, is_knockout, same_confed, host_points_diff, team_recent_goals`

**扩展特征（11 个，Phase 5 新增）:**
`elo_rating_team, elo_rating_opponent, elo_diff, opponent_recent_goals, team_recent_conceded, opponent_recent_conceded, team_recent_form, opponent_recent_form, tournament_weight, days_since_last_match_team, days_since_last_match_opponent`

### 6.3 模型性能

| 模型 | 用途 | 测试集 RMSE | 测试集准确率 | LogLoss |
|------|------|------------|------------|---------|
| XGBoost home_goals | 预测主队进球 | 1.40 | — | — |
| XGBoost away_goals | 预测客队进球 | 1.15 | — | — |
| RF 1X2 Classifier | 胜平负分类 | — | 55.3% | 0.922 |
| XGBoost BTTS | 双方进球 | — | 56.7% | 0.680 |
| XGBoost Over 2.5 | 大小球 | — | 58.0% | 0.672 |

训练数据：46,383 场比赛（训练 39,144 / 验证 3,589 / 测试 3,650），严格时间序列分割无数据泄露。

### 6.4 推理流程

```
Node.js 请求 ?engine=ml
       │
       ▼
features.js ──── 根据球队+日期构建 23 维特征向量
       │
       ▼
predictor.js ──── 将特征 JSON 写入 stdin
       │
       ▼
predict.py ────── spawn Python 子进程
       │              ├── 加载 5 个 joblib 模型
       │              ├── XGBoost → λ_home, λ_away
       │              ├── RF → 1X2 概率
       │              ├── XGBoost → BTTS, Over/Under
       │              └── stdout → JSON 结果
       │
       ▼
poisson.js ─────── 泊松 9×9 矩阵 + 概率混合 + 归一化
       │
       ▼
标准化预测输出 → 前端引擎切换 UI
```

### 6.5 降级策略

| 场景 | 行为 |
|------|------|
| 模型文件缺失 | 自动降级到 Elo 引擎，响应标记 `_degraded: true` |
| Python 不可用 | 降级到 Elo 引擎 |
| 特征缺失 | NaN → 0 填充，模型继续推理 |
| ML 推理异常 | catch 后降级到 Elo 引擎 |

---

## 七、缓存系统（Phase 4）

- **两层级缓存**：L1（内存）快速读取 + L2（磁盘文件）持久化
- **统一 TTL**：30 分钟（所有 API 端点一致）
- **缓存击穿保护**：并发请求共享 pending promise
- **强制刷新**：`?force=1` 参数绕过缓存
- **前端状态栏**：页面底部显示缓存状态 + "🔄 Update Data" 按钮
- **缓存目录**：`data/cache/*.json`（已加入 `.gitignore`）

---

## 八、前端集成说明

### 引擎切换

预测详情页 (`views/pages/match.ejs`) 已支持 `?engine=` 参数切换。

前端 `cachedFetch()` 函数（`public/js/app.js`）：
```javascript
// 自动添加 force 参数、重试、缓存状态更新
const data = await cachedFetch('/api/matches/match/Brazil/Argentina?engine=ml', { force: true });
```

### 缓存状态 UI

`public/js/cache-ui.js` 提供底栏状态显示：
- 绿点：数据新鲜
- 黄点：即将过期
- 红点：过期（已降级）
- 🔄 按钮：触发该页 force 刷新

---

## 九、回测框架

### 状态

回测引擎骨架已完成（`server/ml/backtest/engine.js`），返回 2002-2022 各届世界杯的比赛列表。

完整回测（逐场运行 ML 推理）需要逐个调用 Python 推理进程，后续可按需扩展。

### API 端点

```bash
curl http://localhost:3000/api/ml/backtest
```

返回格式：
```json
{
  "status": "ok",
  "engine": "ml-v1",
  "tournaments": [
    { "year": 2022, "matchesPredicted": 64, "simpleAccuracy": 0.58, ... }
  ]
}
```

---

## 十、常见问题排查

### 端口占用
```bash
# 查看占用 3000 端口的进程
powershell "Get-NetTCPConnection -LocalPort 3000 | Select OwningProcess"

# 杀掉进程
powershell "Get-Process node | Stop-Process -Force"
```

### ML 引擎不工作
```bash
# 检查 Python 依赖
pip list | grep -iE "scikit|xgboost|joblib|numpy|pandas"

# 检查模型文件
ls -lh server/ml/models/v1/*.pkl

# 测试 Python 推理
echo '{"team_rank":1,"team_points":1800,"opponent_rank":5,"opponent_points":1650}' | python server/ml/inference/predict.py

# 查看 ML 状态 API
curl http://localhost:3000/api/ml/status
```

### API 数据返回空
```bash
# 检查 .env 配置
cat .env

# 检查 API Key 有效性
curl -v https://api.football-data.org/v4/competitions/2000/matches -H "X-Auth-Token: YOUR_KEY"

# 如果 API 不可用，系统自动降级到本地静态数据
```

### 缓存问题
```bash
# 强制刷新全部缓存
curl "http://localhost:3000/api/cache/stats?force=1"

# 清理缓存文件
rm -rf data/cache/*.json
```

---

## 十一、部署检查清单

- [ ] `.env` 文件存在且包含 `FOOTBALL_API_KEY`
- [ ] `npm install` 完成（express, ejs, undici）
- [ ] Python 依赖已安装（scikit-learn, xgboost, joblib）
- [ ] 模型文件存在（server/ml/models/v1/*.pkl）
- [ ] 数据文件存在（world-cup-data/ 下的 CSV）
- [ ] 端口 3000 未被占用
- [ ] `node server/index.js` 启动无报错
- [ ] `curl http://localhost:3000` 返回 HTML
- [ ] `curl http://localhost:3000/api/ml/status` 返回 `modelsReady: true`
- [ ] `curl "http://localhost:3000/api/matches/match/Brazil/Argentina?engine=ml"` 返回完整预测

---

## 十二、版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| Phase 1-3 | — | Elo 引擎 + 页面基础 + 数据服务 |
| Phase 4 | 2026-06-24 | 持久缓存系统 + 手动刷新 |
| Phase 5 | 2026-06-25 | ML 引擎（数据管线+训练+推理+集成） |
