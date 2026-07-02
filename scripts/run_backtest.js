#!/usr/bin/env node
/**
 * 一键回测执行脚本
 * 用法: node scripts/run_backtest.js [--force] [--no-ml] [--no-save]
 *
 * --force    跳过缓存，重新收集数据
 * --no-ml    不运行 ML 引擎（仅 Elo）
 * --no-save  不保存报告文件
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, '..'));

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const mlEnabled = !args.includes('--no-ml');
  const saveReport = !args.includes('--no-save');

  console.log('╔════════════════════════════════════════════╗');
  console.log('║     2026 世界杯 · 模型回测系统 v1        ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log();
  console.log(`参数: force=${force}, ml=${mlEnabled}, save=${saveReport}`);
  console.log();

  const { runBacktest } = await import('../server/ml/backtest/engine.js');

  const start = Date.now();
  try {
    const result = await runBacktest({ force, mlEnabled, saveReport });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (!result.success) {
      console.error(`❌ 回测失败: ${result.error}`);
      process.exit(1);
    }

    console.log();
    console.log('✅ 回测完成!');
    console.log(`   耗时: ${elapsed}s`);
    console.log(`   比赛数: ${result.summary.total}`);
    console.log(`   覆盖届次: ${result.summary.byYear.map(y => `${y.year}年(${y.count}场)`).join(', ')}`);
    console.log();

    // 打印各引擎指标
    for (const [eng, data] of Object.entries(result.overall)) {
      if (!data.available) continue;
      console.log(`  [${eng}]  ${data.n}场  准确率: ${(data.accuracy * 100).toFixed(1)}%  Brier: ${data.brier}  LogLoss: ${data.logLoss}  ECE: ${data.calibration?.ece != null ? (data.calibration.ece * 100).toFixed(2) + '%' : '—'}`);
    }

    // 随机基线
    console.log(`  [随机基线] 准确率: 33.3%  Brier: 0.667`);

    console.log();
    console.log(`查看报告: ls -la data/backtest/reports/`);
    console.log(`查看页面: http://localhost:3000/backtest`);

  } catch (e) {
    console.error(`❌ 回测异常:`, e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
