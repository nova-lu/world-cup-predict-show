# Phase 12 — 赔率信源与展示增强

> 基于 PHASE-INTEGRATION-GAPS.md 3.3 (竞彩网无页面), 4.2 (竞彩位置不当), 4.3 (映射重复), 4.5 (公司明细未暴露) 以及 2 (未用API端点) 的需求扩展。
> 目标: 将竞彩网提升为独立信源，博彩公司明细完全暴露，统一队名映射，让 match.ejs 分歧 Tab 展示更完整的赔率对比。

---

## 1. 目标

- 竞彩网数据从"最后回退"提升为始终参与的独立信源
- 博彩公司明细 (公司名/赔率/margin) 在 API 和页面中完整可见
- Polymarket 原始价格在分歧 Tab 中独立展示
- 队名映射表统一维护，消除重复
- 分歧 Tab 成为真正的"多信源对比中心"

---

## 2. 任务拆解

### 2.1 竞彩网信源提升为独立源

文件: server/ml/odds/sources/unified.js

当前代码:
```
// 3. 竞彩网离线数据（最后回退）
if (sources.length === 0) {
  try { ... china_sports_lottery ... }
}
```

修改后:
```
// 3. 竞彩网离线数据（始终尝试加载）
// 不依赖其他信源是否可用，竞彩作为独立信源始终参与
try {
  const mx = await import("./china_sports_lottery.js");
  const records = mx.loadLatest();
  if (records && records.length > 0) {
    const cnHome = findCnName(t1);
    const cnAway = findCnName(t2);
    if (cnHome && cnAway) {
      const match = mx.getMatch(records, cnHome, cnAway);
      if (match) {
        const normalized = mx.normalizeToUnified(match);
        if (normalized) {
          sources.push({
            source: "china-sports-lottery",
            probabilities: { ... },
            metadata: { _offline: true, matchId: match.matchId, pools: match.pools }
          });
        }
      }
    }
  }
} catch (e) { console.warn(...) }
```

效果: 竞彩网成为始终尝试加载的独立信源。无论 oddsApi 和 Polymarket 是否可用，只要有离线数据就参与融合。

### 2.2 队名映射表统一

问题: CN_NAME_TO_SLUG 存在于 china_sports_lottery.js (~110条) 和 unified.js (~55条) 两处。

方案:

1. china_sports_lottery.js 导出映射表:
```
export { CN_NAME_TO_SLUG };
```

2. unified.js 删除内联的 TEAM_NAME_MAP，改为 import:
```
import { CN_NAME_TO_SLUG } from "./china_sports_lottery.js";
```

3. 同时增加一个反向映射函数 (slug → 中文名):
```
// 在 china_sports_lottery.js 中新增
export function slugToCnName(slug) {
  const entry = Object.entries(CN_NAME_TO_SLUG).find(([, v]) => v === slug);
  return entry ? entry[0] : slug;
}
```

涉及文件:
- server/ml/odds/sources/china_sports_lottery.js — 导出 CN_NAME_TO_SLUG + 新增 slugToCnName
- server/ml/odds/sources/unified.js — 删除内联映射，import 引用

### 2.3 博彩公司明细 API 暴露

文件: server/routes/odds.js 中的 /api/odds/match/:t1/:t2

当前: 仅返回 bookmakers 对象 (公司名→赔率映射)

修改后: 增加 bookmakerDetails 和 divergence 字段

响应结构增强:
```
{
  found: true,
  match: { t1, t2 },
  bookmakers: { "Bet365": { home: 1.5, draw: 3.6, away: 5.0 }, ... },
  // 新增字段:
  bookmakerDetails: [
    {
      name: "Bet365",
      odds: { home: 1.50, draw: 3.60, away: 5.00 },
      fairProb: { home: 0.62, draw: 0.26, away: 0.19 },
      margin: 0.037
    }
  ],
  divergence: {
    maxMinSpread: { home: 0.08, draw: 0.04, away: 0.06 },
    stdDev: { home: 0.035, draw: 0.022, away: 0.028 },
    nSources: 5
  },
  consensus: { home: 0.60, draw: 0.27, away: 0.20, method: "de-vig average", nSources: 5 }
}
```

oddsApi.js 已导出 `calculateDivergence` 和 `buildBookmakerDetails` 函数，odds.js 路由中调用它们并拼接到响应中即可。

涉及文件:
- server/routes/odds.js — 增强 fetchOddsForMatch 响应的组装逻辑
- server/services/oddsApi.js — 确认现有函数的输出结构兼容 (如不兼容则微调)

### 2.4 Polymarket 独立源展示

文件: views/pages/match.ejs 中的分歧 Tab (renderDivergenceContent 函数)

当前: 分歧 Tab 仅展示 fusion 数据 (三源对比表 + 融合结果)

修改后: 增加三个独立的展示区域:

1. **信源对比表** (已有, 增强):
   - 市场(去抽水) — 读取 oddsApi 源的 consensus
   - Polymarket — 读取 polymarket 源的原始概率
   - 模型 — 读取 model 源的原始概率
   - 竞彩网 (新增) — 当 china-sports-lottery 源可用时显示
   - 融合结果 (已有, 高亮)

2. **博彩公司明细表** (新增):
   - 从 bookmakerDetails 数组渲染表格
   - 列: 公司名 | 主胜 | 平局 | 客胜 | Margin
   - Bet365  | 1.50 | 3.60 | 5.00 | 3.7%
   - William Hill | 1.53 | 3.50 | 4.80 | 4.1%

3. **分歧指标详情** (新增):
   - 主胜差: 8.0% (各公司间最大差值)
   - 平局差: 4.0%
   - 客胜差: 6.0%
   - 颜色: 低分歧(绿) / 中分歧(黄) / 高分歧(红)

数据源: 当前懒加载的 `/api/odds/fusion/match/:t1/:t2` 返回结构需增加 `bookmakerDetails` 字段。

涉及文件:
- server/ml/odds/sources/unified.js — fetchAllSources 为 oddsApi 源增加 bookmakerDetails 元数据
- server/routes/odds.js — /api/odds/fusion/match/:t1/:t2 响应增加 marketDivergence
- views/pages/match.ejs — renderDivergenceContent 增加公司明细和分歧详情
- public/css/app.css — 新增分歧详情样式

### 2.5 竞彩网离线数据上传入口

虽然首版竞彩数据是通过文件系统直接放置 JSON 文件，但为了便于操作:

文件: views/pages/admin.ejs (Phase 11 的新建页面) 的 system Tab 下方或独立区段

增加一个"竞彩数据"区段:

- 显示当前加载的竞彩数据日期 (从 data/odds/china-sports-lottery/ 最新文件)
- 显示可用比赛数量
- "刷新缓存" 按钮：重新加载竞彩数据文件
- 说明文字: "将 JSON 数据文件放入 data/odds/china-sports-lottery/ 目录，文件名格式 {YYYYMMDD}.json"

涉及文件:
- views/pages/admin.ejs — 增加竞彩数据状态区块
- server/routes/admin.js — 新增 GET /api/admin/odds/china-lottery/status

---

## 3. 交付物清单

| # | 文件 | 类型 | 说明 |
|---|------|------|------|
| 1 | server/ml/odds/sources/unified.js | 修改 | 竞彩网提升为独立源 + 映射统一 |
| 2 | server/ml/odds/sources/china_sports_lottery.js | 修改 | 导出 CN_NAME_TO_SLUG + 新增 slugToCnName |
| 3 | server/routes/odds.js | 修改 | /api/odds/match/:t1/:t2 增加 bookmakerDetails + divergence |
| 4 | server/routes/odds.js | 修改 | /api/odds/fusion/match/:t1/:t2 增加 marketDivergence + bookmakerDetails |
| 5 | views/pages/match.ejs | 修改 | renderDivergenceContent 增加公司明细表 + 分歧详情 |
| 6 | server/routes/admin.js (Phase 11) | 修改 | 增加竞彩数据状态 API |
| 7 | views/pages/admin.ejs (Phase 11) | 修改 | 增加竞彩数据状态区块 |
| 8 | public/css/app.css | 修改 | 分歧详情表格/指标样式 |
| 9 | docs/PHASE12-ODDS-ENHANCEMENT.md | 当前文档 | Phase 12 文档 |

---

## 4. 验收标准

| 指标 | 目标值 | 验证方式 |
|------|--------|---------|
| 竞彩网独立信源 | fusion 响应中 sources 包含 china-sports-lottery | 放置测试 JSON 后调用 fusion API |
| 映射统一 | unified.js 中无内联 TEAM_NAME_MAP | 代码审查 |
| 公司明细 API | /api/odds/match/:t1/:t2 含 bookmakerDetails 和 divergence | curl 验证 |
| 分歧 Tab 公司表 | 分歧 Tab 可见各公司赔率 + Margin 列 | 打开 match 页面查看分歧 Tab |
| 分歧指标颜色 | 低/中/高 分歧用绿/黄/红标识 | 视觉确认 |
| 映射双向 | slugToCnName 返回正确中文名 | 单元测试 |

---

## 5. 边界约定

- 不修改 fusion.js 核心融合算法 (权重/JSD 计算不变)
- 竞彩网数据仍为离线 JSON 导入，不做实时抓取
- Polymarket 原始价格若不可用，分歧 Tab 对应行显示"数据暂不可用"
- 不修改 match.ejs 的结论 Tab 和数据 Tab (那是 Phase 13 的范围)
- 分歧 Tab 的懒加载逻辑不变 (首次切换 Tab 时才 fetch)

---

## 6. 涉及的数据源汇总

| 数据源 | 类型 | 状态 |
|--------|------|------|
| /api/odds/match/:t1/:t2 (增强) | REST API | ✅ 已有(需增强) |
| /api/odds/fusion/match/:t1/:t2 (增强) | REST API | ✅ 已有(需增强) |
| /api/odds/polymarket/match/:t1/:t2 | REST API | ✅ 已有(未使用) |
| data/odds/china-sports-lottery/*.json | 本地文件 | ✅ 已有目录 |
| CN_NAME_TO_SLUG (export) | JS Module | ✅ 已存在(需 export) |

---

## 7. 分歧 Tab 最终效果预览

最终分歧 Tab 从上到下展示:

```
┌─────────────────────────────────────────────────────┐
│ 信源对比                                             │
│ 信源          主胜     平局     客胜                    │
│ 市场(去抽水)  62.3%   25.1%   12.6%                   │
│ Polymarket   59.8%   27.2%   13.0%                   │
│ 模型         64.1%   22.3%   13.6%                   │
│ 竞彩网       61.0%   26.0%   13.0%   ← 新增           │
│ ──────────────────────────────────────                │
│ 🔬 融合      62.5%   24.8%   12.7%                   │
├─────────────────────────────────────────────────────┤
│ 博彩公司明细                                         │
│ 公司          主胜     平局     客胜     Margin        │
│ Bet365       1.50    3.60    5.00    3.7%            │
│ William Hill 1.53    3.50    4.80    4.1%            │
│ Pinnacle     1.48    3.75    5.20    2.8%  ← 新增    │
├─────────────────────────────────────────────────────┤
│ 市场分歧指标                                         │
│ 主胜差: 8.0% (🟡 中分歧)   平局差: 4.0% (🟢 低分歧)   │
│ 客胜差: 6.0% (🟡 中分歧)   信源数: 4                  │
└─────────────────────────────────────────────────────┘
```
