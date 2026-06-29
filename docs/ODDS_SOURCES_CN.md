# 赔率数据源规范与映射参考

## 1. 统一协议

所有赔率源在融合引擎中使用如下统一结构：

```json
{
  "source": "<source-name>",
  "probabilities": {
    "homeWin": 0.60,
    "draw": 0.27,
    "awayWin": 0.13
  },
  "metadata": {
    "nBookmakers": 5,
    "overround": 0.037,
    "bookmakerDetails": [],
    "divergence": {}
  }
}
```

## 2. 当前支持的信源

| 信源 | source 值 | 数据来源 | 实时/离线 | 覆盖范围 |
|------|-----------|---------|-----------|---------|
| Odds-API | `oddsApi` | api.odds-api.io | 实时 | 世界杯 + 主流联赛 |
| Polymarket | `polymarket` | polymarket.com | 实时 | 世界杯比赛预测市场 |
| ML/ELO 模型 | `model` | 本地推理 | 离线 | 所有比赛 |
| 竞彩网 | `china-sports-lottery` | JSON 文件 | 离线 | 竞彩开售比赛 |

## 3. 赔率公司明细字段

从 `/api/odds/match/:t1/:t2` 返回的 bookmakers 数组：

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 博彩公司名 |
| odds.home | number | 主胜赔率（十进制） |
| odds.draw | number | 平局赔率 |
| odds.away | number | 客胜赔率 |
| fairProb.home | number | 去抽水后主胜概率 (0~1) |
| fairProb.draw | number | 去抽水后平局概率 |
| fairProb.away | number | 去抽水后客胜概率 |
| margin | number | 抽水比例 (overround) |

## 4. 共识概率与分歧指标

### consensus（共识）

去抽水平均概率（de-vig average），将每家公司去除抽水后的隐含概率做等权平均。

| 字段 | 类型 | 说明 |
|------|------|------|
| home | number | 去抽水平均主胜概率 |
| draw | number | 去抽水平均平局概率 |
| away | number | 去抽水平均客胜概率 |
| overround | number | 平均抽水率 |

### divergence（分歧）

| 字段 | 类型 | 说明 |
|------|------|------|
| maxMinSpread.home | number | 各家公司去抽水后主胜概率的最大差值 |
| maxMinSpread.draw | number | 平局最大差值 |
| maxMinSpread.away | number | 客胜最大差值 |
| stdDev.home | number | 主胜概率标准差 |
| stdDev.draw | number | 平局概率标准差 |
| stdDev.away | number | 客胜概率标准差 |
| nSources | number | 参与计算的博彩公司数量 |

## 5. 竞彩网适配器

### 5.1 文件格式

JSON 文件放置在 `data/odds/china-sports-lottery/` 下，文件名 `{YYYYMMDD}.json`。

```json
{
  "matchId": "周一001",
  "homeTeam": "阿根廷",
  "awayTeam": "法国",
  "date": "2026-06-29",
  "status": "open",
  "pools": [
    {
      "pool": "HAD",
      "home": 1.50,
      "draw": 3.60,
      "away": 5.00
    },
    {
      "pool": "HHAD",
      "home": 2.20,
      "draw": 3.40,
      "away": 2.60,
      "goalLine": -1
    },
    {
      "pool": "HAFU",
      "over": 1.80,
      "under": 1.90,
      "goalLine": 2.5
    }
  ],
  "returnRate": 0.89
}
```

### 5.2 彩池代码说明

| 代码 | 玩法 | 参与融合 | 说明 |
|------|------|---------|------|
| HAD | 胜平负 | ✅ | 标准 1X2 赔率，用于概率计算 |
| HHAD | 让球胜平负 | ⬜ | 需 goalLine，暂不融合 |
| HAFU | 大小球 | ⬜ | 需 goalLine，暂不融合 |
| CRS | 波胆 | ⬜ | 仅展示 |
| HFT | 半全场 | ⬜ | 仅展示 |
| TTG | 总进球数 | ⬜ | 仅展示 |

### 5.3 核函数说明

- `loadFromFile(filePath)`: 从 JSON 文件加载
- `loadByDate(dateStr)`: 按日期加载
- `getMatch(records, homeTeam, awayTeam)`: 按队伍查找
- `normalizeToUnified(match)`: 转换为统一概率结构
- `fetchAllMatches()`: 返回所有可用比赛的融合兼容格式

### 5.4 映射表

#### 5.4.1 中文队名 → 内部 slug（节选）

完整映射表见 `server/ml/odds/sources/china_sports_lottery.js` 中的 `CN_NAME_TO_SLUG` 对象。

| 中文 | Slug |
|------|------|
| 阿根廷 | argentina |
| 法国 | france |
| 西班牙 | spain |
| 巴西 | brazil |
| 韩国 | south-korea |
| 南非 | south-africa |
| 美国 | usa |
| —— 共约 90+ 条映射 —— | —— |

#### 5.4.2 星期代码映射

| 代码 | 说明 |
|------|------|
| 周日 | Sunday |
| 周一 | Monday |
| 周二 | Tuesday |
| 周三 | Wednesday |
| 周四 | Thursday |
| 周五 | Friday |
| 周六 | Saturday |

## 6. 数据文件目录结构

```
data/odds/
├── china-sports-lottery/
│   ├── 20260629.json          # 竞彩数据按日期命名
│   └── .gitkeep
└── polymarket/
    └── ...                    # Polymarket 缓存（如有）
```

## 7. 融合降级策略

| 条件 | 行为 | degraded 标记 |
|------|------|-------------|
| 可用赔率源 >= 2 (oddsApi + polymarket + 竞彩) | 正常融合 | false |
| 仅 1 个赔率源可用 | 使用该源 + 模型，标记降级 | true |
| 0 个赔率源可用 | 仅使用模型预测 | true |
| 模型也不可用 | 返回错误 | — |

## 8. 合规说明

⚠️ **以下内容仅供参考，不构成法律意见。**

### 竞彩数据使用
- 竞彩数据仅供个人研究和学习使用
- 不得用于商业目的或大规模分发
- 数据来源为中国体育彩票官方公布信息
- 建议获取频率不超过每小时 1 次

### Odds-API.io
- 免费层限制为 100 次请求/小时
- 需要注册并获取 API Key
- 数据来源为各博彩公司公开赔率

### Polymarket
- 基于区块链的预测市场数据
- 免费访问，无需 API Key
- 数据来源于链上智能合约

### 版权与责任
- 各数据源版权归原始提供方所有
- 本站不存储、缓存原始数据超过 30 分钟
- 预测结果仅供参考，不构成投注建议
- 根据中国法律法规，境内网络体育博彩属于非法活动

---

*文档版本: v1.0 — 2026-06-29*
*对应代码: Phase 10 Task C — 赔率多源扩展与竞彩网接口标准化*
