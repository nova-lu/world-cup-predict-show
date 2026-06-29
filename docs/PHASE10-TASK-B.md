# Phase 10 - 任务 B: ELO 在线校准、审计与回滚

> 对应原 PHASE10.md 10.2 的细化与边界约定。
> 依赖：任务 A 的数据新鲜度脚本（作为前置条件调用入口），但逻辑上独立可单独交付。

---

## 1. 目标

允许 ELO 根据最新赛果更新，但有幅度约束、回滚机制和审计记录。

- 单场 ELO 变化 delta <= 25 分。
- 周级漂移可通过回缩脚本和二阶段审计解释。
- 每次更新可回滚到任意历史 manifest。

---

## 2. 任务拆解

### 2.1 ELO 更新引擎

文件: `server/ml/elo/update_elo_from_results.mjs`

核心逻辑:

**K 因子策略（按比赛类型）:**

| 比赛类型 | K 因子 | 判定方式 |
|----------|--------|---------|
| 友谊赛 (Friendly) | 20 | tournament == "Friendly" |
| 预选赛 (Qualification) | 30 | tournament 包含 "Qualif" |
| 世界杯小组赛 | 40 | tournament == "FIFA World Cup" 且日期 <= 2026-06-27 |
| 世界杯淘汰赛 | 50 | tournament == "FIFA World Cup" 且日期 > 2026-06-27 |
| 洲际赛事 (Confederation) | 30 | tournament 包含 "Copa", "Euro", "Afcon", "Asian", "Gold" 等 |

**单场更新约束:**
- 原始 delta = K × (实际结果 - 期望结果)
- 上限截断: delta = clamp(delta, -25, +25)
- 冷门抑制: 当两队 ELO 差 > 250 时，delta ×= 0.8
- 期望结果计算复用 `server/services/elo-model.mjs` 中的 `expectedScore()` 函数

**输入输出:**
- 输入: 单条比赛记录 `{ date, home_team, away_team, home_score, away_score, tournament }`
- 读取当前 ratings: `data/elo-calibrated.json`
- 输出: 更新后的 ratings 对象
- 同时返回本次更新的 delta 明细（每队的变更值）

### 2.2 批量更新入口

在 `update_elo_from_results.mjs` 中暴露 `batchUpdateFromResults(cutoffDate)` 函数:

- 从 `results.csv` 读取 cutoffDate 之后且尚未处理的比赛
- 按日期升序逐场应用 ELO 更新（依赖上一场的结果）
- 确定"已处理"的依据：比较 `data/elo-manifests/` 下已有 manifest 中记录的最后处理日期
- 每批更新完成后写入一份新的 manifest

CLI 入口: `node server/ml/elo/update_elo_from_results.mjs` [--from 2026-06-20]

### 2.3 审计 Manifest

目录: `data/elo-manifests/`

文件名格式: `elo_update_{YYYYMMDD}_{HHmmss}.json`

Manifest 结构:
```json
{
  "manifestId": "elo_update_20260628_143000",
  "generatedAt": "2026-06-28T14:30:00Z",
  "sourceFile": "histroy-match-data/results.csv",
  "matchRange": { "from": "2026-06-27", "to": "2026-06-28" },
  "matchesApplied": 4,
  "matchDetails": [
    {
      "date": "2026-06-27",
      "home": "Colombia", "away": "Portugal",
      "score": "0-0",
      "tournament": "FIFA World Cup",
      "kFactor": 40,
      "deltaHome": -3.2,
      "deltaAway": 3.2
    }
  ],
  "topMovers": [
    { "team": "DR Congo", "delta": 8.5 },
    { "team": "Uzbekistan", "delta": -8.5 }
  ],
  "ratingsBefore": { "argentina": 1976, ... },
  "ratingsAfter": { "argentina": 1978, ... },
  "generatedBy": "update_elo_from_results.mjs v1"
}
```

注意: `ratingsBefore` 和 `ratingsAfter` 只记录有变更的队伍，减少文件体积。

### 2.4 回滚脚本

文件: `scripts/rollback_elo.mjs`

CLI: `node scripts/rollback_elo.mjs --to elo_update_20260627_120000`

行为:
- 读取 `data/elo-manifests/{manifestId}.json`
- 将 `data/elo-calibrated.json` 恢复为该 manifest 中 `ratingsBefore` 的状态
- 删除该 manifest 之后的所有 manifest 文件（或移入 `_archived` 子目录）
- 打印回滚摘要：恢复到哪次更新、涉及多少场比赛

安全措施:
- 执行前自动备份当前的 elo-calibrated.json 为 `elo-calibrated.json.pre_rollback_{timestamp}`
- 回滚后重新生成一份 `elo_rollback_{timestamp}.json` 记录回滚操作

### 2.5 周期性回缩脚本

文件: `scripts/shrink_elo.mjs`

CLI: `node scripts/shrink_elo.mjs` [--rate 0.015]

行为:
- 读取当前 `data/elo-calibrated.json`
- 对每支队伍的 rating 执行: `newRating = 1500 + (oldRating - 1500) * (1 - rate)`
- 默认 rate = 0.015（即 1.5% 回缩）
- 写入更新后的 elo-calibrated.json
- 同时生成一份简化的 manifest 记录回缩操作

触发方式:
- 建议通过 cron 每周一 06:00 UTC 执行一次
- CRON 表达式示例: `0 6 * * 1 cd /path/to/project && node scripts/shrink_elo.mjs >> logs/shrink_elo.log 2>&1`

---

## 3. 交付物清单

| # | 文件 | 类型 | 说明 |
|---|------|------|------|
| 1 | server/ml/elo/update_elo_from_results.mjs | 新文件 | ELO 增量更新引擎 + 批量入口 |
| 2 | data/elo-manifests/ | 新建目录 | manifest 存放目录（含 .gitkeep） |
| 3 | scripts/rollback_elo.mjs | 新文件 | ELO 回滚脚本 |
| 4 | scripts/shrink_elo.mjs | 新文件 | 周期性回缩脚本 |
| 5 | docs/PHASE10-TASK-B.md | 当前文档 | 任务文档 |

---

## 4. 验收标准

| 指标 | 目标值 | 验证方式 |
|------|--------|---------|
| 单场 delta 上限 | 所有队伍的 delta 绝对值 <= 25 | 对已知爆冷比赛运行更新，检查 delta |
| 冷门抑制 | ELO 差 >250 时 delta 乘 0.8 | 构造极端场景验证 |
| Manifest 完整性 | 每次更新生成一个完整 manifest | 运行批量更新后检查 data/elo-manifests/ |
| 回滚准确性 | 回滚后 ELO 值与回滚前一致 | 运行更新→回滚→对比前后 ratings |
| 回缩幅度 | 默认 1.5%，可配置 | 运行 shrink_elo.mjs 检查 top mover 变化 |
| 回缩定时执行 | cron 配置后每周自动运行 | （手动验证 cron 配置） |

---

## 5. 边界约定

- 2026 世界杯淘汰赛的判定以 2026-06-27 为硬编码截止日期。后续世界杯需更新此日期或改用其他判定方式。
- 回缩脚本不做"跳过已被回缩队伍"的逻辑——每周回缩应用在全体队伍上。
- 不支持并行更新。连续两次更新之间必须等待前一次写入完成。
- 不涉及 ML 模型训练触发（那是任务 A 的范围）。
- elo-calibrated.json 的字段结构保持不变（向下兼容）。

---

## 6. 关键技术决策

- K 因子按 tournament 字符串 + 日期窗口判定，不引入外部轮次数据源（如 schedule_2026.csv），避免跨文件依赖。
- Manifest 同时保存更新前后状态，使回滚不依赖外部快照。
- elo-calibrated.json 始终指向当前最新版本，历史版本通过 manifest 追溯。
- 回滚是幂等的：多次回滚到同一 manifest 结果一致。
- 默认不回滚超过 30 天前的更新（防止长时间跨度回滚导致数据不一致），可通过 `--force` 覆盖。
