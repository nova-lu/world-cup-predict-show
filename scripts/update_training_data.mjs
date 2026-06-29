/**
 * 特征重导出 + 训练建议触发器
 *
 * CLI: node scripts/update_training_data.mjs [--yes]
 *   --yes: 跳过人工确认，自动执行
 *   不加 --yes: 有训练建议时阻塞等待用户 y/N 输入
 *
 * 行为:
 *   1. 先调用 check_data_freshness 检查状态
 *   2. 若 shouldExport === true，执行特征重导出
 *   3. 若 shouldSuggestTrain === true，打印训练建议（不自动训练）
 *   4. 若 lagDays === 0，直接返回"数据已是最新"
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// 导入新鲜度检查模块
import { checkDataFreshness } from './check_data_freshness.mjs';

/**
 * 运行特征重导出（等效于 export_features.mjs 的逻辑）
 * 直接 import server ML 模块，避免 export_features.mjs 的路径问题
 */
async function runFeatureExport() {
  console.log('[update] 开始特征重导出...');
  const start = Date.now();

  const { getTrainingData } = await import('../server/ml/data/loader.js');
  const { buildFeatureBatch, exportToCSV, splitDataset } = await import('../server/ml/data/features.js');

  const matches = getTrainingData({ minYear: 1950, filterLevel: 'P2' });
  console.log(`[update] 加载 ${matches.length} 场比赛`);

  const features = await buildFeatureBatch(matches);
  console.log(`[update] 生成 ${features.length} 行特征`);

  const outPath = resolve(PROJECT_ROOT, 'data/ml/train/v1/features_full.csv');
  exportToCSV(features, outPath);
  console.log(`[update] 特征已导出到: ${outPath}`);

  const split = splitDataset(features);
  console.log(`[update] 数据集划分: 训练 ${split.stats.train} / 验证 ${split.stats.val} / 测试 ${split.stats.test}`);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[update] 导出完成，耗时 ${elapsed}s`);
  return { featureCount: features.length, stats: split.stats };
}

/**
 * CLI 入口
 */
async function main() {
  const args = process.argv.slice(2);
  const autoConfirm = args.includes('--yes');

  // 1. 检查新鲜度
  const freshness = checkDataFreshness();
  console.log(`[update] 数据新鲜度检查:`);
  console.log(`  results 最新日期: ${freshness.lastDataDate}`);
  console.log(`  features 最新日期: ${freshness.lastFeatureDate}`);
  console.log(`  滞后天数: ${freshness.lagDays}`);
  console.log(`  新增比赛估算: ${freshness.newMatchCount}`);

  // 2. 判断是否需要操作
  if (freshness.lagDays === 0) {
    console.log('\n✅ 数据已是最新，无需更新');
    process.exit(0);
  }

  if (!freshness.shouldExport) {
    console.log('\n✅ 无需重新导出特征');
    process.exit(0);
  }

  // 3. 需要导出特征
  console.log(`\n⚠️  数据滞后 ${freshness.lagDays} 天，需要重新导出特征`);

  if (freshness.shouldSuggestTrain) {
    console.log(`\n💡 训练建议：滞后天数 > ${1} 或新增 > ${20} 场`);
    console.log(`   当前: lagDays=${freshness.lagDays}, newMatchCount=${freshness.newMatchCount}`);
    console.log(`   建议手动执行: node scripts/train_model.mjs`);
  }

  // 4. 确认/自动执行
  if (!autoConfirm) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
      rl.question('\n是否重新导出特征? (y/N): ', resolve);
    });
    rl.close();
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('已取消');
      process.exit(0);
    }
  }

  // 5. 执行导出
  try {
    const result = await runFeatureExport();
    console.log(`\n✅ 特征导出完成: ${result.featureCount} 行`);
    if (freshness.shouldSuggestTrain) {
      console.log(`\n📋 注意: 数据有显著更新，建议执行训练`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ 特征导出失败: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
