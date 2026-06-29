/**
 * 数据新鲜度检查脚本
 *
 * 比较 results.csv 和 features_full.csv 的最新日期，
 * 判断特征是否需要重导出、训练是否需要建议。
 *
 * CLI: node scripts/check_data_freshness.mjs
 * Module: import { checkDataFreshness } from './check_data_freshness.mjs'
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// ---- 路径配置 ----
const RESULTS_CSV = resolve(PROJECT_ROOT, 'histroy-match-data/results.csv');
const FEATURES_CSV = resolve(PROJECT_ROOT, 'data/ml/train/v1/features_full.csv');

// ---- 阈值 (硬编码，后续可配置化) ----
const EXPORT_LAG_THRESHOLD = 0;   // lagDays > 0 → shouldExport
const TRAIN_LAG_THRESHOLD = 1;    // lagDays > 1 → shouldSuggestTrain
const TRAIN_COUNT_THRESHOLD = 20; // newMatchCount > 20 → shouldSuggestTrain

/**
 * 从 CSV 文件中读取最后一行的指定列值
 * @param {string} filePath
 * @param {number} columnIndex - 0-based 列索引
 * @param {boolean} skipHeader
 * @returns {string|null}
 */
function getLastColumnValue(filePath, columnIndex, skipHeader = true) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split(/\r?\n/);
    const dataLines = skipHeader ? lines.slice(1) : lines;
    if (dataLines.length === 0) return null;

    // 取最后一条非空行
    for (let i = dataLines.length - 1; i >= 0; i--) {
      const line = dataLines[i].trim();
      if (line.length === 0) continue;
      const fields = line.split(',');
      if (fields.length > columnIndex) {
        return fields[columnIndex].trim();
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 估算 results.csv 比 features_full.csv 多出多少场比赛
 * （按 _match_id 去重估算，或按日期范围估算行数差）
 * @param {string} lastDataDate
 * @param {string} lastFeatureDate
 * @returns {number}
 */
function estimateNewMatchCount(lastDataDate, lastFeatureDate) {
  if (!lastDataDate || !lastFeatureDate) return 0;
  // 如果两者截止日期相同，表示没有新增比赛
  if (lastDataDate <= lastFeatureDate) return 0;

  try {
    const resultsContent = readFileSync(RESULTS_CSV, 'utf-8');
    const featureContent = readFileSync(FEATURES_CSV, 'utf-8');

    const resultsLines = resultsContent.trim().split(/\r?\n/).slice(1);
    const featureLines = featureContent.trim().split(/\r?\n/).slice(1);

    // 按 _match_id 去重统计 features 中已有的 match_id
    const featureMatchIds = new Set();
    const dateIdx = 29; // _date column index
    const matchIdIdx = 28; // _match_id column index

    for (const line of featureLines) {
      const fields = line.split(',');
      const mid = fields[matchIdIdx]?.trim();
      if (mid && mid !== '_match_id') featureMatchIds.add(mid);
    }

    // 统计 results 中在 feature 截止日期之后且不在 feature 中的 match
    let count = 0;
    for (const line of resultsLines) {
      const fields = line.split(',');
      const d = fields[0]?.trim(); // date column
      if (d > lastFeatureDate) {
        // 构造 match_id 格式: {year}-{home_team}-{away_team}-{row_num}
        // 简单计数，不一一构造ID
        count++;
      }
    }
    return count;
  } catch {
    // fallback: 使用简单的日期区间估算
    const [dY, dM, dD] = lastDataDate.split('-').map(Number);
    const [fY, fM, fD] = lastFeatureDate.split('-').map(Number);
    const dDays = dY * 365 + dM * 30 + dD;
    const fDays = fY * 365 + fM * 30 + fD;
    const dayDiff = dDays - fDays;
    // 世界杯淘汰赛阶段约 4 场/天，小组赛约 4-8 场/天
    return Math.max(0, Math.round(dayDiff * 4));
  }
}

/**
 * 核心检查函数（纯函数，可被模块 import 复用）
 * @returns {{
 *   lastDataDate: string|null,
 *   lastFeatureDate: string|null,
 *   lagDays: number,
 *   newMatchCount: number,
 *   shouldExport: boolean,
 *   shouldSuggestTrain: boolean,
 *   freshness: string,
 *   freshnessLabel: string,
 * }}
 */
export function checkDataFreshness() {
  const lastDataDate = getLastColumnValue(RESULTS_CSV, 0);   // results date → col 0
  const lastFeatureDate = getLastColumnValue(FEATURES_CSV, 29); // features _date → col 29

  let lagDays = 0;
  let newMatchCount = 0;

  if (lastDataDate && lastFeatureDate) {
    const d = new Date(lastDataDate);
    const f = new Date(lastFeatureDate);
    lagDays = Math.max(0, Math.round((d - f) / (1000 * 60 * 60 * 24)));
    newMatchCount = estimateNewMatchCount(lastDataDate, lastFeatureDate);
  } else if (lastDataDate && !lastFeatureDate) {
    lagDays = Infinity;
  }

  const shouldExport = lagDays > EXPORT_LAG_THRESHOLD;
  const shouldSuggestTrain = lagDays > TRAIN_LAG_THRESHOLD || newMatchCount > TRAIN_COUNT_THRESHOLD;

  let freshness;
  let freshnessLabel;
  if (lagDays === 0) {
    freshness = 'current';
    freshnessLabel = '数据已是最新';
  } else if (lagDays <= 3) {
    freshness = 'stale';
    freshnessLabel = `数据滞后 ${lagDays} 天`;
  } else {
    freshness = 'outdated';
    freshnessLabel = `数据滞后 ${lagDays} 天`;
  }

  return {
    lastDataDate,
    lastFeatureDate,
    lagDays,
    newMatchCount,
    shouldExport,
    shouldSuggestTrain,
    freshness,
    freshnessLabel,
    lastCheckAt: new Date().toISOString(),
  };
}

// ---- CLI 入口 ----
if (process.argv[1] === __filename || process.argv[1] === resolve(__filename)) {
  const result = checkDataFreshness();
  console.log(JSON.stringify(result, null, 2));
}
