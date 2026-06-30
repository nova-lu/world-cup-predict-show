# Phase 15 — World Cup AI 分析 Skill 设计与实施

> 本文档分析 Phase 14 是否需要配套的 Hermes Skill，以及如果需要的具体设计方案。
> 参考项目: SuFame920/WorldCup-Analysis-Skill

---

## 一、必要性分析

### 1.1 为什么需要 Skill

Phase 14 (AI 智能分析引擎) 的核心是 **Prompt Engineering**——将多源数据通过大模型转化为有深度的比赛分析报告。
这是整个项目中最"软"也最需要迭代的部分。一个 Skill 能带来以下价值:

| 需求 | 问题 | Skill 的解决方式 |
|------|------|----------------|
| Prompt 迭代频繁 | 初始 prompt 需要反复调优，每次都在代码中改 | Skill 集中管理 prompt 模板，Hermes 按 skill 指导修改 |
| 数据源理解 | 8 种数据源各有不同含义和权重 | Skill 包含数据源解释文档，Hermes 知道如何选择/组合 |
| 足球领域知识 | ELO、Poisson、去抽水、隐含概率等概念 | Skill 提供领域知识，Hermes 无需自行推理 |
| 输出 Schema 维护 | JSON schema 复杂，需保持一致 | Skill 定义 Schema 和校验规则 |
| 多模型兼容 | DeepSeek / GPT / Claude 格式略有差异 | Skill 提供适配层指南 |
| 参考集成 | 社区已有类似 skill 可供参考 | Skill 明确自身定位，可吸收外部项目经验 |

### 1.2 Skill 与 Phase 14 的关系

```
Phase 14 (运行时代码)               Phase 15 (Skill 元知识)
──────────────────────────          ──────────────────────────
server/ai/config.js                 SKILL.md + references/
server/ai/data-aggregator.js        → 告诉 Hermes: 各数据源的含义和优先级
server/ai/prompt-builder.js         → 告诉 Hermes: prompt 模板的设计原则
server/ai/llm-client.js             → 告诉 Hermes: 多模型适配的注意事项
server/routes/ai.js                 → 告诉 Hermes: API 设计和错误处理模式
views/pages/ai-analysis.ejs         → 告诉 Hermes: 页面布局和交互规范
```

**Skill 不替代 Phase 14 的代码**，而是教会 Hermes 如何正确地创建、维护和迭代这些代码。

### 1.3 参考项目分析

SuFame920/WorldCup-Analysis-Skill 这个开源 skill 提供了世界杯分析的领域知识和数据处理流程。
本项目的 skill 与其侧重点不同:

| 维度 | 参考 Skill | 本项目 Skill |
|------|-----------|-------------|
| 核心目标 | 通用世界杯分析 | 基于多源数据的 AI 深度分析报告 |
| 数据源 | 单一/有限 | 8 种数据源融合 (Elo+ML+赔率+Polymarket+竞彩) |
| 输出形式 | 通用分析 | 结构化 JSON + 6 屏可视化页面 |
| 场景 | 独立使用 | 集成到现有 Node.js/Express 项目 |

本项目的 Skill 应参考其 **领域知识组织方式** 和 **prompt 设计模式**，但内容完全定制。

### 1.4 结论

**建议创建一个专用的 World Cup AI Analysis Skill**。理由:
- Phase 14 的 prompt engineering 需要反复迭代，Skill 提供中心化的指导
- 领域知识(ELO、Poisson、赔率分析) 适合以 Skill 形式沉淀为可复用的知识
- 社区已有类似项目验证了这一模式的可行性
- Skill 本身独立于运行时代码，升级 Skill 不影响线上服务

---

## 二、Skill 设计

### 2.1 Skill 元信息

```yaml
name: worldcup-ai-analysis
description: >
  World Cup match prediction analysis using AI.
  Guides Hermes to generate deep analytical reports by aggregating 8+
  data sources (Elo, ML, odds, Polymarket, China Lottery, form data)
  and calling LLM APIs with structured prompts.
metadata:
  short-description: AI-powered match analysis for World Cup predictions
```

### 2.2 文件结构

```
Hermes_HOME/skills/worldcup-ai-analysis/
├── SKILL.md                          # 主指令文件 (核心)
├── plugin.json                       # 插件清单
├── references/
│   ├── DATA-SOURCES.md               # 数据源参考 (每个源的含义/格式/优先级)
│   ├── PROMPT-TEMPLATES.md           # Prompt 模板集 (含多个变体)
│   ├── OUTPUT-SCHEMA.md              # JSON Schema 定义与校验规则
│   ├── FOOTBALL-DOMAIN.md            # 足球分析领域知识 (ELO/Poisson/隐含概率)
│   └── MODEL-ADAPTER.md              # 多模型适配 (DeepSeek/GPT/Claude)
├── scripts/
│   ├── validate-prompt.sh            # Prompt 长度估算与校验
│   └── test-output-schema.mjs        # Schema 合规性测试
└── assets/
    └── example-output.json           # 示例输出 (完整分析报告)
```

### 2.3 各文件设计说明

#### SKILL.md — 核心指令

**设计原则** (遵循 skill-creator 指南):
- 简洁: 只写 Hermes 不知道的知识
- 结构化: 用明确的章节和层级
- 可操作: 每条指令都指向具体的动作

**内容大纲 (30-40行)**:

```
# World Cup AI Analysis Skill

## 触发条件
当用户请求涉及以下场景时使用本 Skill:
- AI 比赛分析、深度报告、智能预测
- 修改/扩展 analysis prompt 或输出 schema
- 调试/优化 LLM 调用结果

## 数据源优先级
(从高到低列出了 8 个数据源的优先级说明和解释)

## Prompt 设计原则
1. 结构化优先: 用 Markdown 分层组织
2. 数据优先于指令: 让模型先"看到"数据再推理
3. JSON Schema 必须同时出现在 system 和 user 消息中

## 输出 Schema 校验清单
(列出 LLM 返回后必须检查的 5 个核心字段)

## 多模型适配
(DeepSeek / GPT-4o / Claude 3.5 的格式差异和注意事项)

## 常见陷阱
(列举 3-5 个已知的 prompt 设计陷阱和修复方式)
```

#### references/DATA-SOURCES.md — 数据源参考

```
# AI 分析数据源参考

## 数据源概览
| 源名称 | 类型 | 可用性 | 优先级 | 关键字段 |
|--------|------|--------|--------|---------|
| Elo 模型 | Node Module | 始终 | 1 | homeRating, awayRating, probabilities |
| ML 模型 | Python | 有条件 | 2 | topScores, overUnder, btts |
| 集成模型 | Node Module | 有条件 | 3 | ensembleWeights |
| ... | ... | ... | ... | ... |

## 各数据源详解
(每个源详细说明: 如何获取、数据含义、常见问题)
```

#### references/PROMPT-TEMPLATES.md — Prompt 模板集

```
# Prompt 模板参考

## 模板结构
- 角色设定: "你是顶级的足球比赛数据分析师..."
- 比赛上下文: 赛事/阶段/日期/队伍
- 数据源段落: 按优先级排列
- 输出 Schema: JSON 格式要求

## 模板变体
1. 标准版 (8 源可用) - 完整分析
2. 精简版 (2-4 源) - 数据有限时的降级
3. 赛前分析版 - 未开赛比赛
4. 赛后复盘版 - 已完赛比赛的回顾分析
5. 淘汰赛特化版 - 包含加时/点球深度分析

## 数据截断策略
当 token 预算不足时，按此顺序截断:
1. 竞彩网明细 → 2. 公司级赔率 → 3. Polymarket → 4. 近期状态 → 5. ML TopScores → 6. 集成权重
保留的底线: 比赛信息 + Elo + 赔率共识 + 输出 Schema
```

#### references/OUTPUT-SCHEMA.md — 输出 Schema

```
# AI 分析输出 JSON Schema

## 顶层结构
{
  "probabilities": { "homeWin": 0-1, "draw": 0-1, "awayWin": 0-1 },
  "recommendedPick": "home|draw|away",
  "confidence": 0-1,
  "bestOddsSource": "string",
  "scorePrediction": { "home": int, "away": int },
  "overUnder": { "over2_5": 0-1, "under2_5": 0-1, "recommendation": "over|under" },
  "expectedGoals": { "home": float, "away": float, "total": float },
  "btts": { "yes": 0-1, "no": 0-1 },
  "extraTime": { "probability": 0-1 },
  "penaltyShootout": { "probability": 0-1 },
  "reasoning": "string (中文, 3-5句)",
  "keyFactors": ["string"],
  "riskFactors": ["string"]
}

## 校验规则
1. probabilities.homeWin + draw + awayWin ≈ 1.0 (允许 ±0.02)
2. overUnder.over2_5 + under2_5 ≈ 1.0
3. btts.yes + btts.no ≈ 1.0
4. scorePrediction 为整数, 0-8 范围
5. confidence 0-1 范围
6. reasoning 至少 50 字

## 容错处理
- schema 校验失败时的降级策略
- 字段缺失时的默认值填充
- 数值越界时的 clamp 规则
```

#### references/FOOTBALL-DOMAIN.md — 领域知识

```
# 足球预测分析领域知识

## ELO 评分系统
(ELO 的基础原理、在足球中的修正、K 因子含义)

## 泊松分布 (Poisson)
(为什么用 Poisson 模拟比分、λ 的含义)
注意: 这部分主要参考项目中 server/ml/inference/poisson.js 的实现

## 隐含概率与去抽水
(赔率 → 概率的换算、抽水率的计算、de-vig 方法)
注意: 参考 server/services/oddsApi.js 中的 calculateFairProb 函数

## 市场分歧 (Divergence)
(JSD 分歧、maxMinSpread 的含义、分歧等级划分)

## 融合策略
(log-odds-weighted / bayesian 融合的区别和应用场景)
注意: 参考 server/ml/odds/fusion/fusion.js 的实现
```

#### references/MODEL-ADAPTER.md — 多模型适配

```
# 多模型适配指南

## DeepSeek (默认)
- API Base: https://api.deepseek.com
- 模型: deepseek-chat
- JSON Mode: 支持 response_format: { type: "json_object" }
- 上下文: 32K/64K tokens
- 注意: 系统消息中的指令需要比用户消息更简洁

## OpenAI GPT-4o (可选)
- API Base: https://api.openai.com/v1
- 模型: gpt-4o / gpt-4o-mini
- JSON Mode: 支持
- 注意: 需要不同的 system prompt 风格

## Claude 3.5 (可选)
- API Base: https://api.anthropic.com/v1
- 模型: claude-3-5-sonnet-20241022
- JSON Mode: 通过 "Output must be valid JSON" 指令实现
- 注意: 消息格式为 {role, content}，无 response_format 参数

## 切换步骤
1. 修改 .env 中的 AI_API_BASE, AI_MODEL
2. 根据本适配器调整 llm-client.js 中的消息格式
3. 根据模型能力调整 max_tokens 和 temperature
```

---

## 三、Skill 实施步骤

### 步骤 1: 创建 Skill 目录结构

```bash
# 在 Hermes home 的 skills 目录下创建
mkdir -p $Hermes_HOME/skills/worldcup-ai-analysis/{references,scripts,assets}
```

### 步骤 2: 编写 SKILL.md

核心指令文件，约 30-40 行。遵循 skill-creator 的"简洁优先"原则:
- 使用 concise examples 替代 verbose explanations
- 每个数据源用 1-2 句说明，不展开
- 提示原则用 bullet points 而非段落
- 输出 Schema 指向 references/ 中的详细文件

### 步骤 3: 编写 references/ 各文件

按 2.3 节的描述逐个编写 5 个参考文档。每个文件 30-80 行。

### 步骤 4: 编写 plugin.json

```json
{
  "name": "worldcup-ai-analysis",
  "version": "1.0.0",
  "description": "AI-powered match analysis for World Cup predictions",
  "skills": [
    {
      "name": "worldcup-ai-analysis",
      "description": "Generate deep AI match analysis reports",
      "file": "SKILL.md"
    }
  ]
}
```

### 步骤 5: 编写验证脚本

- `scripts/validate-prompt.sh`: 估算 prompt token 数，检查是否超限
- `scripts/test-output-schema.mjs`: 用 mock data 测试 llm 输出是否符合 schema

### 步骤 6: 安装到 Hermes

```bash
# 链接到 Hermes 的 skills 目录
# 或者通过 skill-installer 安装 (如果发布到 GitHub)
```

---

## 四、Skill 与 Phase 14 的配合

| 场景 | Phase 14 代码 | Phase 15 Skill |
|------|-------------|---------------|
| 第一次开发 | 实现 data-aggregator / prompt-builder / llm-client | 提供设计决策的依据和参考 |
| Prompt 调优 | 修改 prompt-builder.js | 提供 prompt 设计原则和模板变体 |
| 输出字段调整 | 修改 JSON schema + 前端渲染 | 提供 schema 校验规则和容错策略 |
| 新增数据源 | 修改 data-aggregator.js + prompt-builder.js | 提供数据源优先级和格式指南 |
| 切换模型 | 修改 llm-client.js + config.js | 提供 MODEL-ADAPTER.md 参考 |
| 调试 LLM 结果 | 查看 API 日志 | 提供 FOOTBALL-DOMAIN.md 验证逻辑合理性 |

---

## 五、验收标准

| 指标 | 目标值 | 验证方式 |
|------|--------|---------|
| Skill 目录结构 | 包含 SKILL.md + references/ 5 个文件 | ls -la 验证 |
| SKILL.md 可读性 | Hermes 按指令可独立修改 prompt | 模拟场景测试 |
| DATA-SOURCES.md | 覆盖 8 个数据源的完整字段说明 | 对照 Phase 14 的 data-aggregator.js 验证 |
| PROMPT-TEMPLATES.md | 至少 4 个模板变体 | 逐一检查 |
| OUTPUT-SCHEMA.md | Schema 字段完整 + 校验规则明确 | 对照 llm-client.js 的解析逻辑验证 |
| FOOTBALL-DOMAIN.md | 覆盖 ELO/Poisson/隐含概率/分歧/融合 5 个主题 | 对照现有代码验证准确性 |
| MODEL-ADAPTER.md | 覆盖 DeepSeek + GPT + Claude 三种 | 格式差异说明准确 |
| plugin.json | 格式正确, skill 名称与目录一致 | 验证 JSON 合法性 |

---

## 六、边界约定

- Skill 不做运行时代码改造。运行时代码由 Phase 14 负责。
- Skill 不包含实际的 API Key 或敏感信息。
- Skill 的 prompt 模板是`参考`而非`强制`——实际 prompt 可能因模型版本微调。
- 不强制覆盖所有数据源的组合情况，只覆盖最常见的前 3 种场景。
- 与参考项目 SuFame920/WorldCup-Analysis-Skill 不冲突，可共存。
