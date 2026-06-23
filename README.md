# 🏆 2026 世界杯观赛数据助手 (World Cup 2026 Data Assistant)

基于 **Elo + Dixon-Coles 双变量泊松模型**的赛事数据分析工具，为球迷提供赛前预测、晋级概率与球队数据对比功能。

> ⚠️ **合规声明：** 本站所有预测数据均基于公开数学模型计算，仅供娱乐与数据分析科普参考，**不构成任何投注建议或决策指导**。根据中国法律法规，境内任何网络体育博彩均属于非法活动。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 后端框架 | Node.js + Express (ESM) |
| 模板引擎 | EJS (服务端渲染) |
| 预测模型 | Elo + Dixon-Coles 双变量泊松 + 蒙特卡洛模拟 |
| 缓存 | 内存缓存 (MVP 阶段，可替换为 Redis) |
| 前端 | 纯 CSS (暗色主题，移动端适配) |
| 数据源 | `elo-calibrated.json` + `wc2026-results.json` |

## 快速启动

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 启动生产服务器
npm start
```

访问 `http://localhost:3000`

## 项目结构

```
worldcup_new_2026/
├── server/
│   ├── index.js              # Express 入口 + 页面路由
│   ├── routes/
│   │   ├── matches.js        # 赛事/预测 API
│   │   ├── standings.js      # 积分榜/晋级概率 API
│   │   └── teams.js          # 球队信息 API
│   ├── services/
│   │   ├── elo-model.mjs     # 核心预测模型 (来自 cup26matches)
│   │   ├── dataService.js    # 数据加载 + 球队信息库
│   │   ├── predictionService.js  # 预测服务包装
│   │   └── monteCarloService.js  # 蒙特卡洛模拟
│   └── middleware/
│       └── cache.js          # 内存缓存
├── views/
│   ├── partials/             # 页头/页脚组件
│   └── pages/                # 页面模板
├── public/
│   ├── css/app.css           # 全局样式
│   └── js/app.js             # 前端脚本
├── data/
│   ├── elo-calibrated.json   # 48 支球队 Elo 评分
│   └── wc2026-results.json   # 已完赛结果
└── package.json
```

## API 文档

### 赛程与预测

| 端点 | 说明 |
|---|---|
| `GET /api/matches/today` | 今日赛事列表（含预测） |
| `GET /api/matches/schedule?date=&group=&status=` | 赛程查询（支持筛选） |
| `GET /api/matches/upcoming?limit=10` | 即将开赛的比赛 |
| `GET /api/matches/match/:t1/:t2` | 单场比赛预测详情 |
| `GET /api/matches/compare/:t1/:t2?scores=true` | 两队实力对比 + 比分分布 |

### 积分与晋级

| 端点 | 说明 |
|---|---|
| `GET /api/standings/groups` | 12 小组实时积分榜 |
| `GET /api/standings/groups/:group` | 单组积分榜 |
| `GET /api/standings/advancement?sims=10000` | 蒙特卡洛晋级概率 |

### 球队信息

| 端点 | 说明 |
|---|---|
| `GET /api/teams` | 48 支球队列表（含 Elo 评分） |
| `GET /api/teams/:slug` | 球队详情 |
| `GET /api/teams/:slug/compare/:opponent` | 球队快速对比 |

## 页面路由

| 路径 | 页面 |
|---|---|
| `/` | 今日赛事首页 |
| `/match/:t1/:t2` | 比赛预测详情页 |
| `/standings` | 晋级概率榜 + 小组积分榜 |
| `/teams` | 球队信息库 |
| `/teams/:slug` | 球队详情页 |
| `/methodology` | 预测模型科普说明 |

## 模型说明

核心算法：**Elo 评分 → Dixon-Coles 双变量泊松 → 蒙特卡洛模拟**

1. **Elo 评分**：基于 913 场国际比赛（2023.10 – 2026.06）校准的球队实力评级
2. **Dixon-Coles 泊松**：计算胜平负概率与预期进球，修正低比分偏差
3. **蒙特卡洛模拟**：模拟上万次赛程走向，计算晋级概率

模型回测 62% 准确率，预期校准误差 2.3%。详见 `/methodology` 页面。

## 数据来源

- 灵感模型来源：[world-cup-2026-prediction-model](https://cup26matches.com/) (MIT License)
- 数据：Football-data.org · OpenFootball

## License

MIT
