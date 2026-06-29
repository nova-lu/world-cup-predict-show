# Phase 10 - 任务 A: 赛果驱动数据新鲜度联动

> 对应原 PHASE10.md 10.1 的细化与边界约定。
> 依赖：无（独立交付）

---

## 1. 目标

`results.csv` 更新后，特征导出与训练状态自动感知，不依赖人工记忆。

- 数据滞后时间（results 最新日期到 features_full.csv 最新日期）在手动触发模式下 <= 10 分钟。
- 训练建议有明确阈值，触发后由人工确认再执行。

---

## 2. 任务拆解

### 2.1 数据新鲜度检查脚本

文件: `scripts/check_data_freshness.mjs`

输入:
- `histroy-match-data/results.csv`（源数据）
- `data/ml/train/v1/features_full.csv`（特征导出结果）

输出:
- `lastDataDate`: results.csv 中最后一条记录的 date 字段
- `lastFeatureDate`: features_full.csv 中最后一条记录的 _date 字段
- `lagDays`: 两者相差天数（整数）
- `newMatchCount`: results.csv 比 features_full.csv 多出的记录估算
- `shouldExport`: lagDays > 0 时标记为 true
- `shouldSuggestTrain`: lagDays > 1 || newMatchCount > 20 时标记为 true

调用方式:
- CLI: `node scripts/check_data_freshness.mjs` → 打印状态 JSON 到 stdout
- API: `GET /api/ml/freshness` → 返回相同结构的 JSON

对比逻辑:
- 两文件均按 date / _date 降序排序后取第一行的日期字符串做比较。
- 日期格式为 YYYY-MM-DD，直接做字符串比较（字典序等价于时间序）。

### 2.2 特征重导出脚本

文件: `scripts/update_training_data.mjs`

行为:
- 先调用 check_data_freshness 检查状态
- 若 shouldExport === true，执行 export_features.mjs 的等效逻辑（可直接复用现有的 export_features.mjs 作为子进程或动态 import）
- 若 shouldSuggestTrain === true，打印训练建议信息并返回 trainingSuggested: true，不自动执行训练
- 若 lagDays === 0，直接返回"数据已是最新，无需更新"

调用方式:
- CLI: `node scripts/update_training_data.mjs [--yes]`（加 --yes 跳过人工确认）
- 注意：默认不加 --yes 时，若有训练建议，打印提示后需阻塞等待用户输入 y/N

### 2.3 API 扩展

路径: `server/routes/ml.js` 或 `server/routes/matches.js`，取决于 /api/ml/status 当前所在位置

当前 /api/ml/status 需扩展的字段:
```
{
  "lastDataDate": "2026-06-28",
  "lastFeatureDate": "2026-06-26",
  "lagDays": 2,
  "freshness": "stale",
  "freshnessLabel": "数据滞后 2 天",
  "trainingSuggested": true,
  "lastCheckAt": "2026-06-29T12:00:00Z"
}
```

freshness 枚举值: current (lag=0)、stale (lag<=3)、outdated (lag>3)

---

## 3. 交付物清单

| # | 文件 | 类型 | 说明 |
|---|------|------|------|
| 1 | scripts/check_data_freshness.mjs | 新文件 | 数据新鲜度检查脚本 |
| 2 | scripts/update_training_data.mjs | 新文件 | 特征重导出 + 训练建议触发器 |
| 3 | server/routes/ml.js（或对应路由文件） | 修改 | /api/ml/status 扩展字段 + 新增 /api/ml/freshness 端点 |
| 4 | docs/PHASE10-TASK-A.md | 当前文档 | 任务文档 |

---

## 4. 验收标准

| 指标 | 目标值 | 验证方式 |
|------|--------|---------|
| 滞后检测精度 | lagDays 与人工核对一致 | 修改 results.csv 中最新的日期后运行脚本，检查输出的 lagDays |
| 特征重导出触发 | results 有新增记录时，--yes 后 features 被更新 | 运行 node scripts/update_training_data.mjs --yes，检查特征文件时间戳和行数 |
| 训练建议阈值 | lagDays>1 或新增>20 场时触发建议 | 分别构造两种条件验证 |
| API 响应 | /api/ml/freshness 返回正确的 JSON 结构 | 直接 curl 验证 |
| 无副作用 | 数据滞后为 0 时不做任何写操作 | 运行脚本，确认特征文件未改变 |

---

## 5. 边界约定

- 不做自动化训练触发。训练始终由人工确认。
- 不修改 export_features.mjs 本身，仅从 update_training_data.mjs 中调用它。
- 不涉及 ELO 更新（那是任务 B 的范围）。
- features_full.csv 的列结构不在本文档范围内修改。
- 检查脚本可被其他任务（如任务 B 的 ELO 更新）作为模块 import 复用。
- lagDays 的阈值（>0 导出，>1 或 >20 建议训练）硬编码在脚本中，后续可配置化。

---

## 6. 关键技术决策

- 日期比较基于 CSV 文件中的字符串日期字段，不依赖文件系统 mtime。
- check_data_freshness 设计为纯函数式模块，既可以被 CLI 调用，也可以被 API 路由 import。
- 训练建议输出到 stdout 的同时，也在 /api/ml/freshness 中暴露 trainingSuggested 字段，供前端展示。
