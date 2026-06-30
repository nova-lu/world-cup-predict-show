# PHASE14 可拆分性分析与补充缺口

> 本文档是对 PHASE14-AI-ANALYSIS.md 的补充分析。
> 结论: 可以拆分为 3 个子阶段，并有 8 个未覆盖的缺口需要补充文档。

---

## 一、任务拆分建议

PHASE14 的 12 项交付物按"依赖链"可拆为 3 个阶段:

### Phase 14.1 — AI 后端流水线 (无外部依赖)

| 交付物 | 内容 | 可独立测试方式 |
|--------|------|--------------|
| server/ai/config.js | 配置读取与校验 | node -e "import cfg from './config.js'; console.log(cfg)" |
| server/ai/data-aggregator.js | 聚合 8 个数据源为统一结构 | node -e "import { agg } from './data-aggregator.js'; agg("argentina","france").then(console.log)" |
| .env.template (修改) | 新增 7 个 AI 配置变量 | 无 |

**可交付验证**: 调用 `aggregateMatchData(t1, t2)` 控制台输出完整的聚合数据结构。

**风险**: 低。纯数据搬移，不涉及外部 API。

---

### Phase 14.2 — Prompt 工程 + LLM 集成 (依赖 14.1)

| 交付物 | 内容 | 可独立测试方式 |
|--------|------|--------------|
| server/ai/prompt-builder.js | 聚合数据 → Prompt 字符串 | 传入 mock 数据验证 prompt 输出 |
| server/ai/llm-client.js | DeepSeek API 调用 + JSON 解析 | curl 验证 /api/ai/analyze |
| server/routes/ai.js | POST /api/ai/analyze + GET /api/ai/status | curl 验证两端点 |
| server/index.js (修改) | 注册 /api/ai 路由 | 验证路由挂载 |

**可交付验证**: `POST /api/ai/analyze/:t1/:t2` 返回包含 `analysis.{probabilities, scorePrediction, reasoning, ...}` 的结构化 JSON。

**风险**: 中。Prompt 质量需要迭代调优。LLM API 依赖外部服务可用性。

---

### Phase 14.3 — AI 分析页面 + 入口集成 (依赖 14.2)

| 交付物 | 内容 | 可独立测试方式 |
|--------|------|--------------|
| views/pages/ai-analysis.ejs | 6 屏 AI 分析页面 | 前端渲染验证 |
| views/pages/match.ejs (修改) | 悬浮按钮(FAB) + 条件显示 | 配置/移除 KEY 验证显示 |
| public/css/app.css (修改) | AI 页面 + FAB 样式 | 视觉验证 |
| public/js/ai-analysis.js | 页面交互(展开/刷新/轮询) | 交互验证 |
| server/index.js (修改) | /ai-analysis/:t1/:t2 页面路由 | 打开页面验证 |

**可交付验证**: 打开 `/ai-analysis/:t1/:t2` 页面，6 屏内容正常渲染，FAB 按钮条件显示。

**风险**: 低。主要是 UI 工作，API 由 Phase 14.2 提供。

---

### 拆分后的依赖关系

```
Phase 14.1 (数据流水线)
    │
    ▼
Phase 14.2 (Prompt + LLM + API)
    │
    ▼
Phase 14.3 (页面 + 入口)
```

Phase 14.1 和 14.2 可在一个迭代中顺次执行(后端端到端贯通)。
Phase 14.3 可在 14.2 稳定后再开始。

---

## 二、未覆盖的缺口与风险

### 缺口 1: 调用频率控制 (Rate Limiting)

**问题**: LLM 调用按 token 计费。用户连续刷新页面 10 次 = 10 次 API 调用 = 不必要的花费。
当前文档中仅依赖缓存，但缓存只防重复内容，不防高频刷新。

**建议**: 在 `routes/ai.js` 对 POST 端点加上频控:
- 每场比赛每 5 分钟最多 1 次分析 (用内存 Map 或 Redis)
- 超出时返回 `429 Too Many Requests`
- 响应: `{ success: false, error: "请求过于频繁, 请 5 分钟后重试", retryAfter: 300 }`

### 缺口 2: Token 预算管理 (Context Window)

**问题**: 聚合数据 + Prompt 可能超过模型上下文窗口 (DeepSeek 通常 32K/64K tokens)。
当前文档没有预估 prompt 长度或做截断。

**建议**: 在 `prompt-builder.js` 中:
- 加入 `estimateTokens(text)` 函数 (粗略估算: 中文字符数 + 英文 token 数)
- 当估算超过 `maxTokens * 0.8` 时，按优先级截断:
  优先级: matchInfo > consensus > elo > ensemble > polymarket > form > bookmakerDetails > chinaLottery
- 截断策略: 先移除竞彩网和单个公司明细，保留共识概率

### 缺口 3: JSON 解析鲁棒性 (Parse Resilience)

**问题**: 即使使用 JSON mode，LLM 偶尔会返回:
- Markdown fence 包裹: ```json ... ```
- 末尾多余逗号
- 字段名多空格
- 纯文本 + JSON 混合

**建议**: 在 `llm-client.js` 中增加 `parseLLMResponse(raw)` 函数:
1. 尝试 `JSON.parse(content)`
2. 失败 → 尝试移除 Markdown fences
3. 失败 → 尝试 `eval` (仅限已知安全 schema)
4. 失败 → 返回 `{ success: false, raw: content }`，由前端展示原始文本

### 缺口 4: 缓存失效触发器 (Cache Invalidation)

**问题**: 当前缓存仅基于 TTL (1小时)。但比赛数据可能在 TTL 内变化:
- 赔率更新 (Odds-API 每分钟都可能变)
- 比赛结果更新 (FT 后概率无意义)
- Polymarket 价格变化

**建议**: 增加事件驱动的缓存失效:
- 当某比赛状态变为 FT 时，清除该比赛的 AI 分析缓存
- 当数据新鲜度脚本检测到新比赛结果时，清除所有关联缓存
- 页面显示 `updateAge` (距上次生成时长)
- 当 updateAge > 实际数据变更时间时，标注 "stale"

### 缺口 5: 前端加载状态精细化 (Loading UX)

**问题**: LLM 调用 10-30 秒。当前文档只说"轮询等待"，不够精细。

**建议**: 前端加载分为 3 个阶段，每个阶段展示具体进度:

```
阶段 1: "正在收集比赛数据..." (0-2s)
        进度条 0-30%  (聚合 OK)
阶段 2: "正在调用 AI 分析引擎..." (2-15s)
        进度条 30-80% (LLM 调用中)
阶段 3: "正在生成分析报告..." (15-18s)
        进度条 80-95% (解析 + 渲染)
阶段 4: 完成 (18-20s)
        进度条 100%   (展示页面)
```

具体实现: 前端在 POST 后轮询 `/api/ai/analyze/:t1/:t2?poll=true`，
后端在处理过程中不断写入缓存中间状态 (`{ status: "aggregating" }` → `{ status: "generating" }` → 完整结果)。

### 缺口 6: 数据聚合器的边界情况

**问题**: data-aggregator.js 调用了 8 种不同的数据源，各有不同的失败模式。

**建议补充的 try/catch 边界**:

| 数据源 | 可能的失败 | 降级策略 |
|--------|-----------|---------|
| predictionService.predictMatch | 队伍 slug 不存在 | 返回默认 ELO 1500，标记 degraded |
| mlPredictor.predictMatch | ML 模型未训练/不可用 | 跳过，标记 available: false |
| fetchOddsForMatch | API Key 未配置/请求超时 | 跳过，标记 available: false |
| fetchWorldCupEvents | Polymarket 网络不通 | 跳过，标记 available: false |
| china_sports_lottery.getMatch | 无离线数据文件 | 跳过，标记 available: false |
| buildRecentContext | match.js 中函数需导入 allMatches | 若无 allMatches，跳过 |
| knockoutMatchProb | 非淘汰赛阶段 | 跳过，标记 knockout: false |
| getTeamInfo | slug 在 TEAM_INFO 中不存在 | 返回 { name: slug } 降级 |

### 缺口 7: 安全事项

**问题**: `/api/ai/status` 不应泄露 API Key。
当前文档的示例响应中包含:
```
{ enabled: true, model: "...", apiBase: "...", reachable: true }
```
这没问题。但要确保:
- `config.js` 的 `enabled()` 只返回 `!!process.env.AI_API_KEY`，不返回 key 本身
- 错误日志中不记录完整 API Key (记录前 4 位即可)
- `llm-client.js` 的错误消息不包含 key

**建议**: 在 `config.js` 中增加 `maskedKey()` 方法仅用于日志: `return process.env.AI_API_KEY.slice(0, 4) + "..."`

### 缺口 8: Prompt 动态生成 (数据源条件化)

**问题**: 当前 Prompt 模板是固定的 8 个数据源段落。但实际上某些源不可用时应从 prompt 中移除该段，而不是写"数据源 X: 不可用"。

**建议**: `prompt-builder.js` 的 `buildPrompt()` 函数应:
- 只包含 available: true 的数据源段落
- 在 prompt 底部注明 `基于 N 个可用数据源中的 M 个生成分析`
- 根据可用源数量动态调整 "综合分析" 的措辞
  - >=5 源: "以下是基于多个数据源的全面分析"
  - 1-4 源: "以下是基于有限数据源的分析，仅供参考"
  - 0 源: 直接报错 "没有可用的数据源"

---

## 三、是否还需创建新 Phase 文档

**建议: 创建一个补充文档 `PHASE14-SUPPLEMENT.md`**

包含:
- 上述 8 个缺口的详细设计和实现方案
- Prompt 调优指南 (如何调试/迭代 prompt)
- 成本估算 (每场比赛分析约消耗的 token 数和费用)
- 测试策略 (mock 数据 / 单元测试 / 集成测试)

**同时更新 `PHASE14-AI-ANALYSIS.md`**:

在文档开头增加"任务依赖结构"章节，明确 3 个子阶段的依赖关系
将交付物清单按子阶段分组
在各验收标准中标记所属子阶段

**不需要创建 Phase 15**。这些补充内容都是 Phase 14 内部的精化，不足以独立成新 Phase。

---

## 四、建议的执行顺序

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | 先实现 Phase 14.1 (数据聚合器) + 编写单元测试 | 无 |
| 2 | 实现 Phase 14.2 (Prompt + LLM + API) + 用 Mock 数据调试 Prompt | Step 1 |
| 3 | 补充: 实现 JSON 解析鲁棒性 + Token 预算管理 + 频率控制 | Step 2 |
| 4 | 实现 Phase 14.3 (AI 分析页面 + FAB) | Step 2 |
| 5 | 补充: 实现缓存失效触发器 + 前端细化加载状态 | Step 4 |
