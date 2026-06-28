# 🏆 2026 世界杯预测分析平台

**双引擎预测 · 实时数据 · 淘汰赛仪表盘 · 赔率融合 · 在线学习**

实时世界杯预测平台，基于 Elo 评分系统和机器学习（XGBoost + 随机森林）双引擎，整合 Polymarket 预测市场赔率，提供完整的淘汰赛追踪和晋级概率分析。

⏳ **2026 世界杯已进入淘汰赛阶段！** 系统使用实时赛果更新预测，支持蒙特卡洛模拟生成晋级概率。

---

## 功能一览

| 功能 | 说明 |
|------|------|
| **📊 小组积分榜** | 实时积分 / 净胜球 / 晋级概率，中文队名 + SVG 国旗 |
| **🏆 淘汰赛仪表盘** | 晋级树 / 32 强队伍 / 第三名竞争势态 / 比赛列表 |
| **🤖 双引擎预测** | Elo 评分系统 + ML 模型（XGBoost / RF 校准）+ 集成学习 |
| **📈 蒙特卡洛模拟** | 5000-20000 次模拟，逐轮计算晋级概率 |
| **🧬 Polymarket 融合** | 预测市场赔率接入，加时/点球预测 |
| **🎯 球队详情** | 单队晋级路径分析 + 对手矩阵 |
| **📚 在线学习** | 动态权重 + 误差反馈 + 回测系统 |
| **✅ CI/CD 管线** | GitHub Actions + Docker 容器化 + 一键部署 |
| **🏥 健康检查** | `GET /api/health` 端点，监控服务器状态 |

---

## 技术栈

| 层 | 技术 |
|----|------|
| **前端** | Express + EJS 模板 + CSS 自定义变量 |
| **后端** | Node.js 24 + Express 4.x |
| **ML 引擎** | Python 3.11 + scikit-learn + xgboost + joblib |
| **数据源** | football-data.org API (实时赛果) / Odds-API.io / Polymarket |
| **缓存** | 内存 L1 缓存 + 磁盘 L2 缓存 |
| **同步** | crontab 定时同步 + 人工触发刷新 |
| **部署** | Docker + GitHub Actions + Railway / Render / VPS |

---

## 快速开始

### 环境要求
- Node.js 24+
- Python 3.11+（可选，ML 引擎需要）
- npm 依赖 + pip 依赖

### 安装

```bash
# 1. 克隆仓库
git clone <repo-url>
cd worldcup_new_2026

# 2. 复制环境变量
cp .env.template .env
# 编辑 .env 填入 API Key

# 3. 安装依赖
npm ci

# 4. 安装 Python 依赖（ML 引擎）
pip install -r requirements.txt

# 5. 启动
node server/index.js
```

访问 `http://localhost:3000`

### 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `FOOTBALL_API_KEY` | ✅ | football-data.org API Key |
| `ODDS_API_KEY` | ✅ | Odds-API.io API Key（降级使用缓存） |
| `PORT` | 否 | 端口号（默认 3000） |
| `NODE_ENV` | 否 | production / development |
| `HTTPS_PROXY` | 否 | HTTP 代理地址（国内访问外部 API 需要） |

---

## API 端点

| 端点 | 说明 |
|------|------|
| `GET /api/health` | 健康检查（uptime / 内存 / 环境变量状态） |
| `GET /api/teams` | 球队列表（含 Elo 评分） |
| `GET /api/teams/:slug` | 球队详情 |
| `GET /api/matches/today` | 今日赛事 |
| `GET /api/matches/schedule` | 赛程列表 |
| `GET /api/matches/upcoming` | 即将开赛 |
| `GET /api/matches/match/:t1/:t2` | 单场预测（Elo + ML + 融合） |
| `GET /api/matches/compare/:t1/:t2` | 两队对比 |
| `GET /api/matches/knockout-pred/:t1/:t2` | 淘汰赛加时/点球预测 |
| `GET /api/standings/groups` | 小组积分榜 |
| `GET /api/standings/advancement` | 晋级概率榜（MC 模拟） |
| `GET /api/knockout/bracket` | 确定性淘汰赛对阵 |
| `GET /api/knockout/qualifiers` | 出线球队（32强完整名单） |
| `GET /api/knockout/third-rank` | 第三名竞争势态 |
| `GET /api/knockout/path/:slug` | 单队晋级路径分析 |
| `GET /api/knockout/opponent-matrix` | 对手分布矩阵 |
| `GET /api/odds/polymarket` | Polymarket 市场列表 |
| `GET /api/bracket` | 淘汰赛树（含 MC 概率） |
| `GET /api/ml/status` | ML 引擎状态 |
| `GET /api/ml/backtest` | ML 回测结果 |

支持 `?force=1` 参数跳过缓存强制刷新。

---

## 页面路由

| 路径 | 说明 |
|------|------|
| `/` | 首页 / 今日赛事 |
| `/schedule` | 完整赛程 |
| `/standings` | 小组积分 + 晋级概率 |
| `/knockout` | 淘汰赛仪表盘（晋级树 / 32强 / 第三名 / 比赛列表） |
| `/bracket` | 晋级树全景（含 MC 冠军概率） |
| `/simulation` | 蒙特卡洛模拟详情 |
| `/match/:t1/:t2` | 单场预测详情 |
| `/team/:slug` | 球队详情（含晋级路径分析） |
| `/teams` | 球队列表 |
| `/polymarket` | Polymarket 预测市场 |
| `/online-learning` | 在线学习仪表盘 |

---

## 部署

### Railway（推荐）
Railway 支持 Node.js + Python 双语言环境，免费层每月 $5 额度。

```bash
# railway.json 已配置，push 后自动部署
git push main
```
在 Railway Dashboard 设置环境变量 `FOOTBALL_API_KEY` 和 `ODDS_API_KEY`。

### Render
```bash
# render.yaml 已配置，连接 GitHub 仓库自动部署
```
在 Render Dashboard 设置环境变量。

### Docker 部署
```bash
# 构建镜像
docker build -t worldcup-predict:latest .

# 运行
docker run -d -p 3000:3000 \
  -e FOOTBALL_API_KEY=xxx \
  -e ODDS_API_KEY=xxx \
  --name worldcup \
  worldcup-predict:latest
```

### VPS + Docker + GitHub Actions
配置 GitHub Secrets 后手动触发 deploy-vps workflow：
- `SSH_HOST`, `SSH_USER`, `SSH_KEY`
- `DOCKER_REGISTRY`（可选，默认 ghcr.io）

---

## 项目结构

```
worldcup_new_2026/
├── server/                 # Node.js 后端
│   ├── index.js            # Express 入口 + 健康检查
│   ├── routes/             # API 路由
│   │   ├── matches.js      # 比赛预测 / 对比
│   │   ├── standings.js    # 积分榜 + 晋级概率
│   │   ├── teams.js        # 球队信息
│   │   ├── bracket.js      # 淘汰赛树 + MC 模拟
│   │   ├── knockout.js     # 淘汰赛管线（Phase 8）
│   │   └── odds.js         # Polymarket + 赔率融合
│   ├── services/           # 核心服务
│   │   ├── monteCarloService.js  # MC 模拟引擎
│   │   ├── bracketBuilder.js     # 构建淘汰赛对阵
│   │   ├── groupResolver.js      # 小组解析
│   │   ├── thirdRankResolver.js  # 第三名分析
│   │   ├── pathAnalyst.js        # 晋级路径分析
│   │   └── dataService.js        # 球队数据 + 国旗
│   └── ml/                 # ML 引擎
│       ├── config.js       # 引擎配置
│       ├── elo/            # Elo 评分系统
│       ├── inference/      # 预测推理
│       ├── features/       # 特征工程
│       ├── odds/           # Polymarket 集成
│       └── models/         # 训练好的模型文件
├── views/                  # EJS 模板
│   ├── pages/              # 页面模板
│   └── partials/           # 公共组件
├── public/                 # 静态资源
│   ├── css/
│   ├── js/
│   └── images/flags/       # SVG 国旗（48 队）
├── data/                   # 数据文件
│   ├── cache/              # 缓存（自动生成）
│   └── *.json              # 种子数据
├── .github/workflows/      # CI/CD 管线
│   ├── ci.yml              # 持续集成
│   ├── deploy-vps.yml      # VPS 部署
│   └── rollback.yml        # 回滚
├── docs/                   # 文档
├── Dockerfile              # Docker 构建
├── railway.json            # Railway 部署
├── render.yaml             # Render 部署
├── verify.cjs              # 冒烟测试
└── .env.template           # 环境变量模板
```

---

## 最近更新

### Phase 9 — CI/CD 自动化部署（最新）
- GitHub Actions CI 管线（lint + 冒烟测试）
- Docker 容器化（python:3.13-slim + Node.js 24 双层构建）
- Railway / Render / VPS 三种部署方案
- 回滚管线（workflow_dispatch 手动触发）
- 健康检查端点 `GET /api/health`
- 环境变量模板 `.env.template`

### Phase 8 — 淘汰赛完整管线
- 确定性淘汰赛对阵（基于实时小组赛结果）
- 淘汰赛预测引擎（加时 / 点球 / 压力因子）
- 晋级路径分析（单队从小组→冠军的逐轮概率）
- 晋级树可视化升级（CSS Grid + SVG 连线）
- SVG 国旗 + ELO 徽章 + 中文队名

### Phase 7 — 赔率融合与在线学习
- Polymarket 市场数据接入
- Elo + ML + Polymarket 三源融合
- 在线学习仪表盘（动态权重 + 误差反馈）
- 加时 / 点球预测

### Phase 6 — 双引擎与 MC 模拟
- Elo + ML 双引擎独立预测
- Ensemble 集成学习（动态权重分配）
- 蒙特卡洛模拟（5000-20000 次）
- ML 回测 + 降级统计

### 关键 Bug 修复
- ✅ MC 模拟数据源从静态（44场）切换到实时 API（104场）
- ✅ 2026 世界杯最佳第三名从 4 个修正为 8 个
- ✅ 第三方球队 SVG 国旗缺失修复（flagPath 字段注入）
- ✅ 晋级树水平滚动溢出修复
- ✅ 淘汰赛路径字段名不匹配修复
- ✅ 32强 / 第三名竞争页面空数据显示修复
- ✅ 球队名统一显示中文
- ✅ Polymarket 标题自动翻译为中文

---

## 数据可靠性

| 数据源 | 可靠性 | 备选 |
|--------|--------|------|
| football-data.org | ⭐⭐⭐ 实时赛果 | 降级到本地种子数据 |
| Odds-API.io | ⭐⭐ 赔率 | 缓存上次有效数据 |
| Polymarket | ⭐⭐⭐ 预测市场 | 离线模式跳过 |
| ML 模型 | ⭐⭐⭐ 本地推理 | Elo 引擎降级 |

系统在外部 API 不可用时自动降级，不影响核心功能。

---

## 许可证

MIT © 2026
