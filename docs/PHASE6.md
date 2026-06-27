# Phase 6 — 集成引擎后期优化路线（权重、校准、评估与稳定性）

## 背景

Phase 5 已完成 ML 引擎接入与训练产物发布，当前系统具备：

- `elo | ml | ensemble` 三引擎切换
- `rf_1x2_calibrated.pkl` 概率校准工件
- 预测输出可视化归一化（1X2 概率和为 1）

在最近联调中暴露出两个关键现实问题：

1. 集成阶段存在历史/新结构兼容风险（Elo `prob.*` 与 ML `probabilities.*`）
2. 集成权重并非固定 30/70，而会被动态门限覆盖（低置信度时自动降权 ML）

因此，Phase 6 的核心目标不是新增功能，而是把集成引擎做成“可解释、可调优、可回滚、可持续迭代”的生产级系统。

---

## Phase 6 完成状态

| 任务 | 状态 | 说明 |
|---|---|---|
| 6.1 概率协议统一 | ✅ 完成 | `utils/probability.js` 创建, 路由层统一 normalize, 前端简化 |
| 6.2 权重参数化 | ✅ 完成 | `config.js` 添加 dynamic 子节, predictor.js 读取参数 |
| 6.3 网格搜索 | ✅ 完成 | `scripts/grid_search.py` 含网格搜索 + 分层评估 + ECE 校准报告 |
| 6.4 校准评估 | ✅ 完成 | predict.py 已使用 calibrated 模型, ECE 计算在 grid_search.py 中 |
| 6.5 可观测性 | ✅ 完成 | status 扩展权重/校准/降级, prob_sum_error 监控, degradeCount |


### 目标 G1：集成概率可信且可解释

- 胜平负概率严格满足概率约束（和为 1，且非负）
- 任一比赛可追溯：Elo 原始概率、ML 原始概率、最终权重、融合后概率

### 目标 G2：集成权重从经验值升级为数据驱动

- 从固定权重/硬门限，升级到基于回测最优的参数
- 关键参数可配置、可灰度、可回滚

### 目标 G3：上线过程有监控与止损

- 指标异常时自动降级到 Elo 或固定权重方案
- 明确的回滚与重训发布流程

### Phase 6 验收 KPI（建议）

- `log_loss(ensemble)` 相对当前基线下降 >= 2%
- `brier_1x2(ensemble)` 相对当前基线下降 >= 2%
- 线上 `prob_sum_error`（|p_home+p_draw+p_away-1|）P99 <= 1e-6
- 动态权重触发后，线上错误降级率可解释且低于阈值（例如 < 3%）

---

## 二、优化方向总览

| 方向 | 当前状态 | Phase 6 优化重点 |
|---|---|---|
| 概率结构统一 | 已兼容 `prob.*`/`probabilities.*` | 统一输出协议与契约测试 |
| 权重策略 | 30/70 + 动态门限 | 参数网格搜索 + 分场景权重 |
| 概率校准 | `rf_1x2` 已做 Platt | 加入可靠性评估与再校准门槛 |
| 评估体系 | 有训练指标 | 增加回测指标看板与版本对比 |
| 线上可观测 | 基础日志 | 增加融合解释日志、告警与降级统计 |
| 发布流程 | 可重训可发布 | 建立标准化“训练-验收-灰度-回滚”流程 |

---

## 三、任务分解

### 任务 6.1：统一概率协议与契约校验

目标：彻底消除字段漂移导致的融合偏差。

实施项：

- 定义统一 1X2 协议：
  - 输入统一为 `{ homeWin, draw, awayWin }`（0~1）
  - 兼容层仅存在于一个函数中（单点适配）
- 为以下场景加契约测试：
  - Elo 百分比输入（`prob.winHome`）
  - ML 小数输入（`probabilities.homeWin`）
  - 混合异常输入（空值/NaN/和不为 1）
- 输出强约束：
  - 非负
  - 和为 1
  - 精度固定到 4 位（展示层）

交付物：

- 概率协议说明（文档）
- 契约测试用例（自动化）

---

### 任务 6.2：集成权重参数化（替代硬编码门限）

目标：把“为什么 50/50、为什么 30/70”变成可审计的配置行为。

建议新增配置项（`server/ml/config.js`）：

- `ensemble.baseEloWeight`
- `ensemble.baseMlWeight`
- `ensemble.dynamic.enabled`
- `ensemble.dynamic.confidenceThreshold`
- `ensemble.dynamic.disagreementThreshold`
- `ensemble.dynamic.minMlWeight`
- `ensemble.dynamic.maxMlWeight`

实施原则：

- 默认值保持当前线上行为
- 每次调整都记录到 manifest/部署日志
- 禁止“代码内魔法数字”

交付物：

- 参数化配置
- 参数说明与推荐区间

---

### 任务 6.3：权重优化实验（离线回测）

目标：用数据找到最优融合策略，而不是拍脑袋。

实验设计：

- 网格搜索：
  - `baseMlWeight`: 0.40~0.80（步长 0.05）
  - `confidenceThreshold`: 0.50~0.70（步长 0.02）
  - `disagreementThreshold`: 0.10~0.30（步长 0.02）
- 分层评估：
  - 小组赛 vs 淘汰赛
  - 强弱分明对阵 vs 实力接近对阵
- 目标函数：
  - 主目标：`log_loss_1x2`
  - 次目标：`brier_1x2`
  - 约束：校准误差不可显著恶化

交付物：

- 实验报告（Top-N 参数组合）
- 推荐线上参数与保底参数（回滚用）

---

### 任务 6.4：校准质量持续评估

目标：确保 `platt-v1` 长期有效，而不是一次性改进。

实施项：

- 增加校准质量指标：
  - ECE（Expected Calibration Error）
  - Reliability Diagram（可靠性曲线）
- 对比版本：
  - `rf_1x2` vs `rf_1x2_calibrated`
- 设定再训练触发条件：
  - 连续 N 周 ECE 超阈值
  - 回测 log loss 退化超过阈值

交付物：

- 校准评估报告模板
- 再校准触发规则

---

### 任务 6.5：线上可观测性与止损

目标：出现异常时第一时间发现，并自动降级。

建议新增监控字段：

- `ensemble.weights.elo/ml`
- `ensemble.input.elo_prob/ml_prob`
- `ensemble.output.prob`
- `ensemble.dynamic.trigger_reason`
- `prob_sum_error`
- `degrade_to_elo_count`

建议告警条件：

- `prob_sum_error` 超阈值
- 动态权重触发率异常飙升
- ML 推理失败率上升

交付物：

- `/api/ml/status` 扩展字段（包含权重策略与校准版本）
- 线上告警规则文档

---

## 四、推荐迭代节奏（两周）

### Week 1（稳定性与可解释）

1. 概率协议统一 + 契约测试
2. 集成参数外置化
3. `/api/ml/status` 暴露权重与校准信息

### Week 2（效果优化）

1. 网格搜索 + 分层回测
2. 产出推荐参数并灰度发布
3. 监控与回滚演练

---

## 五、发布与回滚策略

### 发布前检查

- 新参数在离线回测优于基线
- 概率协议测试全部通过
- 单场对照样例通过（elo/ml/ensemble 三者均可解释）

### 灰度策略

- 先 10% 请求启用新参数
- 观察 24h 指标（log loss proxy、失败率、降级率）
- 无异常再全量

### 回滚策略

- 配置回滚到上一个参数集
- 必要时切换 `ensemble.dynamic.enabled = false`
- 极端情况下全局降级到 `elo`

---

## 六、结论

Phase 6 的重点不是“再加一个模型”，而是把现有双引擎系统打磨为生产可运营能力：

- 结构一致（不再被字段差异影响）
- 决策可解释（为什么这场是 50/50 有证据）
- 参数可优化（基于回测而非经验）
- 风险可控（可监控、可降级、可回滚）

完成 Phase 6 后，再进入下一阶段（如赔率融合、分联赛迁移学习、在线学习）会更稳健。