/**
 * 回测引擎主模块
 * 整合 collector → predictor → metrics → reporter
 * 支持单例运行 + 取消
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as collector from './collector.js';
import * as metrics from './metrics.js';
import * as reporter from './reporter.js';
import { computeOddsBaseline } from './oddsBaseline.js';
import mlConfig from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, '../../../data/backtest/reports');

let _lastResult = null;
let _running = false;
let _cancelled = false;

export function isRunning() { return _running; }
export function isCancelled() { return _cancelled; }

export function cancelBacktest() {
  if (!_running) return { cancelled: false, reason: '没有正在运行的回测' };
  _cancelled = true;
  console.log('[backtest/engine] ⛔ 已请求取消回测');
  return { cancelled: true, message: '正在停止...' };
}

export async function runBacktest(opts = {}) {
  if (_running) throw new Error('回测正在运行中，请等待完成或先取消');
  _running = true;
  _cancelled = false;

  const force = opts.force === true || opts.forceRefresh === true;
  const mlEnabled = opts.mlEnabled !== false;
  const saveReport = opts.saveReport !== false;

  try {
    console.log('[backtest/engine] 开始回测...');
    if (_cancelled) throw new BacktestCancelledError();

    const { matches, summary } = await collector.getCached({ force });
    console.log(`[backtest/engine] 收集到 ${matches.length} 场比赛, 覆盖 ${summary.byYear.length} 届`);

    if (_cancelled) throw new BacktestCancelledError();
    if (matches.length === 0) return { success: false, error: '没有可回测的比赛数据', summary };

    const predictor = await import('./predictor.js');
    let records;
    try {
      records = await predictor.predictBatch(matches, { mlEnabled });
    } catch (e) {
      if (e instanceof BacktestCancelledError) throw e;
      console.error('[backtest/engine] 预测生成失败:', e.message);
      return { success: false, error: `预测失败: ${e.message}`, summary };
    }

    if (_cancelled) throw new BacktestCancelledError();

    // Phase 17 T3: 保存 2026 年比赛预测快照
    try {
      const { savePredictionSnapshot } = await import('./snapshotHelper.js');
      for (const rec of records) {
        if (rec.year === 2026 && rec.predictions) {
          savePredictionSnapshot(rec, rec.predictions);
        }
      }
    } catch (e) {
      console.warn('[backtest/engine] 预测快照保存失败:', e.message);
    }

    const engines = ['elo'];
    if (mlEnabled) engines.push('ml', 'ensemble');

    const overall = {}, yearly = {}, stageBreakdown = {}, errorAnalysis = {}, sceneAnalysis = {}, errorClustering = {};
    for (const eng of engines) {
      overall[eng] = metrics.computeAggregate(records, eng);
      yearly[eng] = metrics.computeByYear(records, eng);
      stageBreakdown[eng] = metrics.computeByStage(records, eng);
      errorAnalysis[eng] = metrics.computeErrorAnalysis(records, eng);
      // Phase 17 T5: 场景分析
      sceneAnalysis[eng] = metrics.computeSceneAnalysis(records, eng);
      // Phase 17 T6: 错误聚类
      errorClustering[eng] = metrics.computeErrorClustering(records, eng);
    }

    // Phase 17 T6: 引擎优势分析
    let engineAdvantage = {};
    if (engines.includes('ml') && engines.includes('elo')) {
      engineAdvantage = metrics.computeEngineAdvantage(records);
    }

    // Phase 17 T4: 赔率基线
    const oddsBaseline = computeOddsBaseline(records);

    const result = {
      success: true, summary, overall, yearly, stageBreakdown, errorAnalysis,
      sceneAnalysis, errorClustering, engineAdvantage, oddsBaseline, records,
      // Phase 17 T2: 标注 ML 数据泄露风险
      mlLeakageWarning: true,
    };

    if (saveReport && !_cancelled) {
      try {
        await reporter.generateReport(result);
      } catch (e) {
        console.warn('[backtest/engine] 报告生成失败:', e.message);
      }
    }

    _lastResult = result;
    console.log('[backtest/engine] 回测完成');
    return result;
  } catch (e) {
    if (e instanceof BacktestCancelledError) {
      console.log('[backtest/engine] ⛔ 回测已被用户取消');
      return { success: false, cancelled: true, message: '回测已被用户取消', summary: await getCachedSummary() };
    }
    throw e;
  } finally {
    _running = false;
    _cancelled = false;
  }
}

class BacktestCancelledError extends Error {
  constructor() { super('回测已被用户取消'); this.name = 'BacktestCancelledError'; }
}

async function getCachedSummary() {
  try {
    const { matches, summary } = await collector.getCached({ force: false });
    return summary;
  } catch { return { total: 0, byYear: [] }; }
}

export function getLastResult() { return _lastResult; }

export function getReportList() {
  try {
    if (!fs.existsSync(REPORTS_DIR)) return [];
    return fs.readdirSync(REPORTS_DIR)
      .filter(f => f.endsWith('.json') && !f.includes('detail'))
      .sort().reverse().slice(0, 10)
      .map(f => ({
        filename: f,
        path: path.join(REPORTS_DIR, f),
        size: fs.statSync(path.join(REPORTS_DIR, f)).size,
        generatedAt: fs.statSync(path.join(REPORTS_DIR, f)).mtime.toISOString(),
      }));
  } catch { return []; }
}
