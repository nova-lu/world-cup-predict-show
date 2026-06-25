/**
 * ML 推理服务入口
 * server/ml/inference/predictor.js
 *
 * 作为 Node.js 到 Python 模型的桥梁：
 * 1. 从 features.js 构建特征向量
 * 2. 通过 Python 子进程运行模型推理
 * 3. 计算泊松比分矩阵、大小球、BTTS、风险评估等
 * 4. 输出标准化预测结构
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mlConfig from '../config.js';
import { buildMatchFeatures } from '../data/features.js';
import {
  computePoissonMatrix, computeProbabilities, computeTopScores,
  computeOverUnder, computeBTTS, computeRisk, computeCoverage,
} from './poisson.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREDICT_SCRIPT = path.join(__dirname, 'predict.py');
const MODEL_DIR = path.join(__dirname, '..', 'models', 'v1');

// 缓存状态
let modelsAvailable = null;

/**
 * 检查模型是否可加载
 */
export async function checkModels() {
  if (modelsAvailable !== null) return modelsAvailable;

  const fs = await import('node:fs');
  try {
    const files = ['xgb_home.pkl', 'xgb_away.pkl', 'rf_1x2.pkl', 'xgb_btts.pkl', 'xgb_over_under.pkl'];
    for (const f of files) {
      if (!fs.existsSync(path.join(MODEL_DIR, f))) {
        console.warn(`[ml:predictor] 模型文件缺失: ${f}`);
        modelsAvailable = false;
        return false;
      }
    }
    modelsAvailable = true;
    return true;
  } catch (e) {
    modelsAvailable = false;
    return false;
  }
}

/**
 * 对一场比赛运行 ML 推理
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {string} matchDate - YYYY-MM-DD
 * @param {object} options
 * @returns {Promise<object>} 标准化预测结果
 */
export async function predictMatch(homeTeam, awayTeam, matchDate, options = {}) {
  const {
    engine = 'ml',
    context = {},
  } = options;

  // 1. 检查模型可用性
  const modelsOk = await checkModels();
  if (!modelsOk) {
    throw new DegradeError('ML 模型不可用，需降级到 Elo 引擎');
  }

  // 2. 构建特征向量
  const { features } = await buildMatchFeatures(homeTeam, awayTeam, matchDate, context);

  // 3. Python 推理
  let mlResult;
  try {
    mlResult = await runPythonInference([features]);
  } catch (e) {
    throw new DegradeError(`ML 推理失败: ${e.message}`);
  }

  // 4. 泊松比分矩阵 & 衍生概率
  const lambdaHome = mlResult.lambda_home || 1.5;
  const lambdaAway = mlResult.lambda_away || 1.0;

  const scoreMatrix = computePoissonMatrix(lambdaHome, lambdaAway);
  const probabilities = computeProbabilities(scoreMatrix);
  const topScores = computeTopScores(scoreMatrix, 5);
  const overUnder = computeOverUnder(scoreMatrix);
  const btts = computeBTTS(scoreMatrix);

  // 校准：混合模型概率与泊松概率
  const blendedProbs = blendProbabilities(probabilities, mlResult.probabilities);

  // 风险评估
  const risk = computeRisk(blendedProbs, mlResult.confidence);

  // 覆盖度
  const coverage = computeCoverage(scoreMatrix, 3);

  return {
    engine: `ml-${mlConfig.version}`,
    engineVersion: mlConfig.version,
    homeTeam,
    awayTeam,
    matchDate,
    expectedGoals: {
      home: Math.round(lambdaHome * 100) / 100,
      away: Math.round(lambdaAway * 100) / 100,
    },
    probabilities: blendedProbs,
    scoreDistribution: scoreMatrix.map(row => row.map(p => Math.round(p * 10000) / 10000)),
    topScores,
    overUnder,
    btts,
    risk,
    coverage,
    market: null,
    metadata: {
      modelVersion: mlConfig.version,
      confidence: mlResult.confidence,
      calibrated: true,
      features: Object.keys(features),
    },
  };
}

/**
 * 混合模型直接分类概率与泊松派生概率
 * 取加权平均：modelWeight × 模型概率 + (1-modelWeight) × 泊松概率
 */
function blendProbabilities(poissonProbs, modelProbs, modelWeight = 0.5) {
  const raw = {
    homeWin: modelWeight * modelProbs.homeWin + (1 - modelWeight) * poissonProbs.homeWin,
    draw: modelWeight * modelProbs.draw + (1 - modelWeight) * poissonProbs.draw,
    awayWin: modelWeight * modelProbs.awayWin + (1 - modelWeight) * poissonProbs.awayWin,
  };
  // 归一化确保总和为 1
  const total = raw.homeWin + raw.draw + raw.awayWin;
  if (total <= 0) return { homeWin: 0.34, draw: 0.33, awayWin: 0.33 };
  return {
    homeWin: Math.round((raw.homeWin / total) * 10000) / 10000,
    draw: Math.round((raw.draw / total) * 10000) / 10000,
    awayWin: Math.round((raw.awayWin / total) * 10000) / 10000,
  };
}

/**
 * 调用 Python 推理子进程
 */
function runPythonInference(featuresList) {
  return new Promise((resolve, reject) => {
    const inputJson = JSON.stringify(featuresList.length === 1 ? featuresList[0] : featuresList);
    const proc = spawn('python', [PREDICT_SCRIPT], {
      cwd: path.join(__dirname, '..'),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 || !stdout) {
        reject(new Error(`Python 进程退出 (${code}): ${stderr.slice(0, 200)}`));
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch (e) {
        reject(new Error(`解析推理结果失败: ${e.message}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`无法启动 Python 进程: ${err.message}`));
    });

    proc.stdin.write(inputJson);
    proc.stdin.end();
  });
}

/**
 * 集成预测（Elo + ML 加权平均）
 */
export function ensemblePrediction(eloPrediction, mlPrediction, options = {}) {
  const { eloWeight = mlConfig.ensemble.eloWeight, mlWeight = mlConfig.ensemble.mlWeight } = options;

  const totalWeight = eloWeight + mlWeight;
  const wElo = eloWeight / totalWeight;
  const wML = mlWeight / totalWeight;

  return {
    engine: 'ensemble',
    engineVersion: `${mlConfig.version}+elo`,
    homeTeam: eloPrediction.homeTeam || mlPrediction.homeTeam,
    awayTeam: eloPrediction.awayTeam || mlPrediction.awayTeam,
    expectedGoals: {
      home: Math.round((wElo * (eloPrediction.expectedGoals?.home || 0) + wML * (mlPrediction.expectedGoals?.home || 0)) * 100) / 100,
      away: Math.round((wElo * (eloPrediction.expectedGoals?.away || 0) + wML * (mlPrediction.expectedGoals?.away || 0)) * 100) / 100,
    },
    probabilities: {
      homeWin: Math.round((wElo * (eloPrediction.probabilities?.homeWin || 0) + wML * (mlPrediction.probabilities?.homeWin || 0)) * 10000) / 10000,
      draw: Math.round((wElo * (eloPrediction.probabilities?.draw || 0) + wML * (mlPrediction.probabilities?.draw || 0)) * 10000) / 10000,
      awayWin: Math.round((wElo * (eloPrediction.probabilities?.awayWin || 0) + wML * (mlPrediction.probabilities?.awayWin || 0)) * 10000) / 10000,
    },
    overUnder: mlPrediction.overUnder || eloPrediction.overUnder,
    btts: mlPrediction.btts || eloPrediction.btts,
    risk: mlPrediction.risk || eloPrediction.risk,
    coverage: mlPrediction.coverage || eloPrediction.coverage,
    metadata: {
      ensembleWeights: { elo: wElo, ml: wML },
      eloVersion: eloPrediction.engine,
      mlVersion: mlPrediction.engine,
    },
  };
}

/**
 * 自定义降级错误类
 */
class DegradeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DegradeError';
    this.degrade = true;
  }
}

export { DegradeError };
