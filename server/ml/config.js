/**
 * ML 模块配置
 * Phase 5 — 机器学习预测引擎
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, ML_DIR } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mlConfig = {
  enabled: true,
  engine: 'xgboost',          // xgboost | randomforest | poisson
  version: 'v1',
  useOnnx: false,              // 默认为 false，使用纯 Node.js Poisson 推理
  cacheTtlMs: 30 * 60 * 1000,

  // 数据路径
  data: {
    matchesCsv: path.join(DATA_DIR, '..', 'world-cup-data', 'matches_1930_2022.csv'),
    resultsCsv: path.join(DATA_DIR, '..', 'histroy-match-data', 'results.csv'),
    ranking2022: path.join(DATA_DIR, '..', 'world-cup-data', 'fifa_ranking_2022-10-06.csv'),
    ranking2026: path.join(DATA_DIR, '..', 'world-cup-data', 'fifa_ranking_2026-06-08.csv'),
    schedule2026: path.join(DATA_DIR, '..', 'world-cup-data', 'schedule_2026.csv'),
    eloCalibrated: path.join(DATA_DIR, 'elo-calibrated.json'),
    datasetDir: path.join(DATA_DIR, 'ml', 'train'),
  },

  // 模型路径
  models: {
    dir: path.join(ML_DIR, 'models'),
    current: path.join(ML_DIR, 'models', 'current'),
  },

  // 特征配置
  features: {
    recentMatchWindow: 5,      // 最近 N 场滚动窗口
    minRankingYear: 2002,      // 排名的起始年份
    eloFallback: true,         // 排名缺失时用 Elo 填充
  },

  // 训练配置
  training: {
    trainCutoff: 2018,
    valStart: 2019,
    valEnd: 2022,
    testStart: 2023,
    randomSeed: 42,
  },

  // 赔率源
  oddsSources: [
    { name: 'football-data', enabled: true },
    { name: 'the-odds-api', enabled: false },
  ],

  // 回测
  backtest: {
    enabled: true,
    tournaments: [2002, 2006, 2010, 2014, 2018, 2022],
  },

  // 集成权重
  ensemble: {
    eloWeight: 0.3,
    mlWeight: 0.7,
    // 动态权重
    dynamic: {
      enabled: true,
      confidenceThreshold: 0.55,    // ML 置信度低于此值时降低 ML 权重
      disagreementThreshold: 0.15,  // Elo 与 ML 概率差超过此值时触发动态调整
      minMlWeight: 0.4,            // 动态调整时 ML 最低权重
      maxMlWeight: 0.8,            // 动态调整时 ML 最高权重
    },
  },

  // 降级
  degradeToElo: true,
};

export default mlConfig;
