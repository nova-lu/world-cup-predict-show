# 模型回测报告

**生成时间**: 2026-07-02T16:10:08.029Z

## 1. 执行概要

- 回测范围: 458 场比赛
- 覆盖届次: 2002年(62场)、2006年(63场)、2010年(63场)、2014年(63场)、2018年(63场)、2022年(63场)、2026年(81场)
- 引擎: elo

## 2. 总体指标对比

| 引擎 | 场次 | 准确率 | Brier | LogLoss | ECE | 预期ROI |
|------|------|--------|-------|---------|-----|--------|
| elo | 458 | 0.0% | 0.6574 | 1.0842 | 35.5% | -100% |
| **随机基线** | - | 33.3% | 0.667 | 1.099 | - | - |
| **Always Home** | - | 43.5% | 0.5655 | - | - | - |

## 3. 按届次表现

| 年份 | 场次 | elo 准确率 | elo Brier | 
|------|------|--------|----------|
| 2002 | 62 | 0.0% | 0.6597 | 
| 2006 | 63 | 0.0% | 0.6571 | 
| 2010 | 63 | 0.0% | 0.6592 | 
| 2014 | 63 | 0.0% | 0.653 | 
| 2018 | 63 | 0.0% | 0.653 | 
| 2022 | 63 | 0.0% | 0.6571 | 
| 2026 | 81 | 0.0% | 0.6615 | 

## 4. 校准分析

### elo

- ECE: 35.51% (较差)

| 置信区间 | 样本数 | 实际频率 | 平均置信 | 差距 |
|----------|--------|----------|----------|------|
| ${(lo * 100).toFixed(0)}%-${(hi * 100).toFixed(0)}% | 0 | 0.0% | 5.0% | 5.0% |
| ${(lo * 100).toFixed(0)}%-${(hi * 100).toFixed(0)}% | 0 | 0.0% | 15.0% | 15.0% |
| ${(lo * 100).toFixed(0)}%-${(hi * 100).toFixed(0)}% | 0 | 0.0% | 25.0% | 25.0% |
| ${(lo * 100).toFixed(0)}%-${(hi * 100).toFixed(0)}% | 458 | 0.0% | 35.5% | 35.5% |
| ${(lo * 100).toFixed(0)}%-${(hi * 100).toFixed(0)}% | 0 | 0.0% | 45.0% | 45.0% |
| ${(lo * 100).toFixed(0)}%-${(hi * 100).toFixed(0)}% | 0 | 0.0% | 55.0% | 55.0% |
| ${(lo * 100).toFixed(0)}%-${(hi * 100).toFixed(0)}% | 0 | 0.0% | 65.0% | 65.0% |
| ${(lo * 100).toFixed(0)}%-${(hi * 100).toFixed(0)}% | 0 | 0.0% | 75.0% | 75.0% |
| ${(lo * 100).toFixed(0)}%-${(hi * 100).toFixed(0)}% | 0 | 0.0% | 85.0% | 85.0% |
| ${(lo * 100).toFixed(0)}%-${(hi * 100).toFixed(0)}% | 0 | 0.0% | 95.0% | 95.0% |

## 5. 错误分析

### elo

- 总错误: 458 / 458 (100.0%)
- 错误时平均置信度: 35.5%
- 模式: 爆冷误判 0、平局漏判 110、胜负颠倒 348

前 10 个错误预测:

| 比赛 | 日期 | 预测 | 实际 | 置信度 |
|------|------|------|------|--------|
| ${r.homeTeamDisplay || r.homeTeam} vs ${r.awayTeamDisplay || r.awayTeam} | 2026-06-11 | awayWin | HOME | 35.5% |
| ${r.homeTeamDisplay || r.homeTeam} vs ${r.awayTeamDisplay || r.awayTeam} | 2026-06-11 | awayWin | HOME | 35.5% |
| ${r.homeTeamDisplay || r.homeTeam} vs ${r.awayTeamDisplay || r.awayTeam} | 2026-06-12 | awayWin | DRAW | 35.5% |
| ${r.homeTeamDisplay || r.homeTeam} vs ${r.awayTeamDisplay || r.awayTeam} | 2026-06-12 | awayWin | HOME | 35.5% |
| ${r.homeTeamDisplay || r.homeTeam} vs ${r.awayTeamDisplay || r.awayTeam} | 2026-06-13 | awayWin | DRAW | 35.5% |
| ${r.homeTeamDisplay || r.homeTeam} vs ${r.awayTeamDisplay || r.awayTeam} | 2026-06-13 | awayWin | DRAW | 35.5% |
| ${r.homeTeamDisplay || r.homeTeam} vs ${r.awayTeamDisplay || r.awayTeam} | 2026-06-13 | awayWin | AWAY | 35.5% |
| ${r.homeTeamDisplay || r.homeTeam} vs ${r.awayTeamDisplay || r.awayTeam} | 2026-06-14 | awayWin | HOME | 35.5% |
| ${r.homeTeamDisplay || r.homeTeam} vs ${r.awayTeamDisplay || r.awayTeam} | 2026-06-14 | awayWin | HOME | 35.5% |
| ${r.homeTeamDisplay || r.homeTeam} vs ${r.awayTeamDisplay || r.awayTeam} | 2026-06-14 | awayWin | DRAW | 35.5% |

---
> 报告由回测系统自动生成
