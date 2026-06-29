# Phase 10 - 任务 C: 赔率多源扩展与竞彩网接口标准化

> 对应原 PHASE10.md 10.4 + 10.5 的细化与边界约定。
> 依赖：无（独立交付，与现有 oddsApi.js / fusion.js 接口兼容）

---

## 1. 目标

将赔率从单源扩展到多公司对比，并为竞彩网接入预留标准化接口。

- 每场可用比赛至少覆盖 3 家博彩公司数据。
- 输出公司级明细 + 去抽水共识概率 + 市场分歧指标。
- 竞彩网离线适配器支持 JSON 格式导入，字段覆盖多种玩法。

---

## 2. 任务拆解

### 2.1 多公司赔率抓取增强

文件: `server/services/oddsApi.js`

当前已存在 `DEFAULT_BOOKMAKERS` 列表（Bet365, William Hill, Ladbrokes, Unibet, Pinnacle, Bwin ES, DafaBet, 10BET, Betfair ES），数据均来自同一外部 API（`api.odds-api.io`）。本任务需要:

a. **确认抓取链路**：验证现有 `fetchOddsForMatch()` 函数是否已经返回多公司明细。如果是，则只需要在 API 响应中暴露更多层级；如果不是，增加 bookmaker-level 的遍历输出。

b. **响应结构增强**（`/api/odds/match/:t1/:t2`）:
```json
{
  "found": true,
  "match": { "t1": "...", "t2": "..." },
  "bookmakers": [
    {
      "name": "Bet365",
      "odds": { "home": 1.5, "draw": 3.6, "away": 5.0 },
      "fairProb": { "home": 0.62, "draw": 0.26, "away": 0.19 },
      "margin": 0.037
    }
  ],
  "consensus": {
    "home": 0.60, "draw": 0.27, "away": 0.20,
    "method": "de-vig average",
    "nSources": 5
  },
  "divergence": {
    "maxMinSpread": { "home": 0.08, "draw": 0.04, "away": 0.06 },
    "stdDev": { "home": 0.035, "draw": 0.022, "away": 0.028 },
    "vsModelDeviation": { "home": 0.05, "draw": 0.03, "away": 0.04 }
  },
  "sourceMetadata": {
    "totalBookmakers": 5,
    "availableBookmakers": 5,
    "missingBookmakers": []
  }
}
```

增强现有 `extractOdds()` 和 `calculateFairProb()` 的层级输出。

### 2.2 共识概率接入融合引擎

文件: `server/routes/odds.js`（fusion 路由）

当前 `/api/odds/fusion/match/:t1/:t2` 已使用 `fuse()` 引擎进行三源融合。本任务修改:

- 在 fusion 路由中，将 `oddsApi` 源的 `probabilities` 替换为 2.1 节输出的 `consensus`（去抽水平均概率）
- 保留公司级明细作为 `metadata.bookmakerDetails` 字段
- 在分歧指标中加入 `marketDivergence`，对比各公司之间的最大分歧
- 当可用公司数不足 3 时，融合引擎降级为使用已有的公司信息，并标记 `degraded: true`

### 2.3 竞彩网离线适配器

文件: `server/ml/odds/sources/china_sports_lottery.js`

首版实现为离线适配器，支持导入 JSON 文件。

**数据格式（参考官方 JSON 结构设计）:**

每条记录表示一场比赛的一个或多个玩法:
```json
{
  "matchId": "周一001",
  "homeTeam": "主队名称",
  "awayTeam": "客队名称",
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

核心函数:
- `loadFromFile(filePath)`: 从 JSON 文件加载竞彩数据
- `getMatch(homeTeam, awayTeam)`: 按队伍查找
- `normalizeToUnified(match)`: 将竞彩格式转换为统一概率结构 `{ homeWin, draw, awayWin, source: 'china-sports-lottery' }`
- team name mapping: 内部调用映射表将竞彩网队名转为内部 slug

**池类型对照表:**

| pool 代码 | 玩法 | 映射到统一格式 |
|-----------|------|--------------|
| HAD | 胜平负 | homeWin / draw / awayWin |
| HHAD | 让球胜平负 | 需传入 goalLine，暂不用于融合 |
| HAFU | 大小球 | over / under，暂不用于融合 |

首版仅使用 HAD（胜平负）参与融合，其他玩法保留在 metadata 中供展示。

### 2.4 映射表（代码 + 文档）

**代码映射表**（`china_sports_lottery.js` 内）:

```js
const CN_NAME_TO_SLUG = {
  '阿根廷': 'argentina',
  '法国': 'france',
  '西班牙': 'spain',
  '巴西': 'brazil',
  '英格兰': 'england',
  '葡萄牙': 'portugal',
  '荷兰': 'netherlands',
  '德国': 'germany',
  // ... 覆盖所有 48 支参赛队
};

const CN_CODE_TO_TOURNAMENT = {
  '周日': 'sunday',
  '周一': 'monday',
  // 映射参考
};
```

**文档映射表**（`docs/ODDS_SOURCES_CN.md`）:

包含:
- 字段定义与统一协议对照表
- 队伍名称映射参考（中文→英文 slug）
- 彩池代码说明
- 合规说明（抓取许可、频率限制、版权声明）
- 离线数据文件的放置路径约定: `data/odds/china-sports-lottery/`

---

## 3. 交付物清单

| # | 文件 | 类型 | 说明 |
|---|------|------|------|
| 1 | server/services/oddsApi.js | 修改 | 多公司赔率明细 + consensus + divergence 输出 |
| 2 | server/routes/odds.js | 修改 | fusion 路由读取 consensus、降级逻辑 |
| 3 | server/ml/odds/sources/china_sports_lottery.js | 新文件 | 竞彩网离线适配器 |
| 4 | docs/ODDS_SOURCES_CN.md | 新文件 | 字段规范、映射表、合规说明 |
| 5 | data/odds/china-sports-lottery/ | 新建目录 | 离线数据文件目录 |
| 6 | docs/PHASE10-TASK-C.md | 当前文档 | 任务文档 |

---

## 4. 验收标准

| 指标 | 目标值 | 验证方式 |
|------|--------|---------|
| 赔率覆盖 | 每场可用比赛 >= 3 家公司 | 调用 /api/odds/match/:t1/:t2，检查 bookmakers 数组长度 |
| 共识概率 | 输出去抽水共识，nSources 准确 | 检查 consensus 字段的数值合理性 |
| 分歧指标 | 包含 maxMinSpread 和 stdDev | 检查 API 响应中的 divergence 字段 |
| 竞彩导入 | JSON 文件导入后能输出统一格式概率 | 构造测试 JSON，调用 normalizeToUnified 验证输出 |
| 映射覆盖 | 参赛队覆盖 >= 40 支 | 检查 CN_NAME_TO_SLUG 表长度 |
| 降级 | 公司数 <3 时标记 degraded | 构造场景验证 |

---

## 5. 边界约定

- 多公司赔率数据目前全部来自 `api.odds-api.io`。如果该 API 不支持某公司，则标记为缺失。
- 竞彩网首版不做线上实时抓取，只做离线文件导入。线上抓取留作后续阶段。
- HAD（胜平负）以外玩法暂不参与融合引擎计算，仅保留在 metadata 中。
- 不修改 `fusion.js` 核心引擎的融合算法，仅调整输入层的数据结构。
- 竞彩数据的队名映射覆盖 48 支参赛队 + 常见历史队伍即可。
- 合规文档 `docs/ODDS_SOURCES_CN.md` 不提供法律意见，仅记录已知的合规边界和风险。

---

## 6. 关键技术决策

- 共识概率采用"去抽水平均"（de-vig average）方法，将每家公司去除抽水后的隐含概率做等权平均。
- 分歧指标直接比较去抽水后的概率值，而非原始赔率。
- 离线适配器设计为类同一接口（与 polymarket.js 和 oddsApi 信源适配器一致的 `{ source, probabilities, metadata }` 输出结构），使融合引擎可无缝接入。
- 映射表同时存在于代码和文档，代码映射是运行时真实使用的，文档映射参考用于人工核对和运维。
- 竞彩 JSON 文件放置在 `data/odds/china-sports-lottery/` 下，文件名格式为 `{YYYYMMDD}.json`，按日期管理。
