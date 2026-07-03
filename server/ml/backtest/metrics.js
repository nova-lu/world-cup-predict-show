/**
 * 回测指标计算引擎
 */

function normalizeOutcome(outcome) {
  if (!outcome) return null;
  const u = String(outcome).toUpperCase();
  if (u === 'HOME' || u === 'HOMEWIN') return 'HOME';
  if (u === 'AWAY' || u === 'AWAYWIN') return 'AWAY';
  if (u === 'DRAW') return 'DRAW';
  return null;
}

function computePerMatch(pred, actual, engine) {
  const p = pred.prob || {};
  const actualOutcome = normalizeOutcome(actual.outcome || actual.actualOutcome);
  const score = actual.score || actual.actualScore;
  const o = { homeWin: actualOutcome === 'HOME' ? 1 : 0, draw: actualOutcome === 'DRAW' ? 1 : 0, awayWin: actualOutcome === 'AWAY' ? 1 : 0 };
  const predictedOutcome = maxKeyObj(p);
  // Normalize comparison: 'homeWin' vs 'HOME'
  const predictedNormalized = normalizeOutcome(predictedOutcome);
  const correct = predictedNormalized === actualOutcome;
  const brier = (p.homeWin - o.homeWin) ** 2 + (p.draw - o.draw) ** 2 + (p.awayWin - o.awayWin) ** 2;
  const eps = 1e-10;
  const actualProb = o.homeWin ? p.homeWin : o.draw ? p.draw : p.awayWin;
  const logLoss = -Math.log(Math.max(eps, Math.min(1 - eps, actualProb)));
  const confidence = Math.max(p.homeWin, p.draw, p.awayWin);
  let xgError = null;
  if (pred.xg && score) xgError = Math.abs(pred.xg.home - score.home) + Math.abs(pred.xg.away - score.away);
  return { correct, predictedOutcome: predictedNormalized, probForActual: actualProb, confidence, brier: round(brier, 4), logLoss: round(logLoss, 4), xgError: xgError != null ? round(xgError, 2) : null, topProb: round(confidence, 4) };
}

function computeAggregate(records, engine) {
  const valid = records.filter(r => r.predictions?.[engine]?.prob?.homeWin != null);
  if (valid.length === 0) return { n: 0, available: false };
  const pm = valid.map(r => computePerMatch(r.predictions[engine], r, engine));
  const n = pm.length;
  const correct = pm.filter(x => x.correct).length;
  return {
    n, available: true, correctCount: correct,
    accuracy: round(correct / n, 4),
    brier: round(pm.reduce((s, x) => s + x.brier, 0) / n, 4),
    logLoss: round(pm.reduce((s, x) => s + x.logLoss, 0) / n, 4),
    avgXgError: pm.some(x => x.xgError != null) ? round(pm.filter(x => x.xgError != null).reduce((s, x) => s + x.xgError, 0) / pm.filter(x => x.xgError != null).length, 2) : null,
    calibration: computeCalibration(pm),
    auc: computeAUC(valid, engine),
    roi: computeROI(valid, engine),
    randomBaseline: { accuracy: 1 / 3, brier: 2 / 3 },
    alwaysHomeBaseline: { accuracy: round(valid.filter(r => normalizeOutcome(r.actualOutcome) === 'HOME').length / valid.length, 4), brier: round(computeAlwaysHomeBrier(valid), 4) },
  };
}

function computeCalibration(pm) {
  const BINS = 10;
  const bins = Array.from({ length: BINS }, () => ({ n: 0, correct: 0, totalConf: 0 }));
  for (const x of pm) {
    const idx = Math.min(Math.floor(x.confidence * BINS), BINS - 1);
    bins[idx].n++; bins[idx].correct += x.correct ? 1 : 0; bins[idx].totalConf += x.confidence;
  }
  let ece = 0;
  const out = [];
  for (let i = 0; i < BINS; i++) {
    const b = bins[i];
    const lo = i / BINS, hi = (i + 1) / BINS;
    const label = lo * 100 + '%-' + hi * 100 + '%';
    const freq = b.n > 0 ? b.correct / b.n : 0;
    const avgC = b.n > 0 ? b.totalConf / b.n : lo + 0.05;
    out.push({ label, n: b.n, actualFreq: round(freq, 3), avgConfidence: round(avgC, 3), gap: round(Math.abs(avgC - freq), 3) });
    if (b.n > 0) ece += (b.n / pm.length) * Math.abs(avgC - freq);
  }
  return { ece: round(ece, 4), eceLevel: ece < 0.05 ? '良好' : ece < 0.15 ? '中等' : '较差', bins: out };
}

function computeAUC(records, engine) {
  const byOutcome = ['HOME', 'DRAW', 'AWAY'].map(target => {
    const scores = records.map(r => ({ score: r.predictions[engine].prob[target === 'HOME' ? 'homeWin' : target === 'AWAY' ? 'awayWin' : 'draw'] || 0, actual: normalizeOutcome(r.actualOutcome) === target ? 1 : 0 }));
    return rocAuc(scores);
  });
  return { homeWin: round(byOutcome[0], 4), draw: round(byOutcome[1], 4), awayWin: round(byOutcome[2], 4), macroAvg: round(byOutcome.reduce((a, b) => a + b, 0) / 3, 4) };
}

function rocAuc(scores) {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const nPos = sorted.filter(s => s.actual === 1).length, nNeg = sorted.length - nPos;
  if (nPos === 0 || nNeg === 0) return 0.5;
  let rankSum = 0;
  for (let i = 0; i < sorted.length; i++) if (sorted[i].actual === 1) rankSum += i + 1;
  return (rankSum - nPos * (nPos + 1) / 2) / (nPos * nNeg);
}

function computeROI(records, engine) {
  let bet = 0, ret = 0;
  for (const r of records) {
    const p = r.predictions[engine].prob;
    const pred = maxKeyObj(p);
    const norm = normalizeOutcome(pred);
    const odds = 1 / Math.max(p[pred], 0.01);
    bet += 1;
    if (norm === normalizeOutcome(r.actualOutcome)) ret += odds;
  }
  return bet > 0 ? round((ret / bet - 1) * 100, 2) : 0;
}

function computeAlwaysHomeBrier(records) {
  const n = records.length;
  return n > 0 ? round(records.reduce((s, r) => s + (normalizeOutcome(r.actualOutcome) === 'HOME' ? 0 : 1) ** 2, 0) / n, 4) : 0;
}

function computeByYear(records, engine) {
  const by = {};
  for (const r of records) { const y = r.year || 2026; if (!by[y]) by[y] = []; by[y].push(r); }
  const out = {};
  for (const [y, recs] of Object.entries(by)) out[y] = computeAggregate(recs, engine);
  return out;
}

function computeByStage(records, engine) {
  const by = {};
  for (const r of records) { const s = r.stage || 'UNKNOWN'; if (!by[s]) by[s] = []; by[s].push(r); }
  const out = {};
  for (const [s, recs] of Object.entries(by)) if (recs.length >= 2) out[s] = computeAggregate(recs, engine);
  return out;
}

function computeErrorAnalysis(records, engine) {
  const errors = records.filter(r => {
    if (!r.predictions?.[engine]?.prob) return false;
    const p = r.predictions[engine].prob;
    return normalizeOutcome(maxKeyObj(p)) !== normalizeOutcome(r.actualOutcome);
  });
  const n = records.length;
  return {
    totalErrors: errors.length,
    errorRate: n > 0 ? round(errors.length / n, 4) : 0,
    patterns: {
      upset: errors.filter(r => { const fav = maxKeyObj(r.predictions[engine].prob); return normalizeOutcome(fav) === 'HOME' && normalizeOutcome(r.actualOutcome) === 'DRAW'; }).length,
      drawMiss: errors.filter(r => normalizeOutcome(maxKeyObj(r.predictions[engine].prob)) !== 'DRAW' && normalizeOutcome(r.actualOutcome) === 'DRAW').length,
      homeAwayMiss: errors.filter(r => normalizeOutcome(maxKeyObj(r.predictions[engine].prob)) !== normalizeOutcome(r.actualOutcome) && normalizeOutcome(r.actualOutcome) !== 'DRAW').length,
    },
    avgConfOnError: errors.length > 0 ? round(errors.reduce((s, r) => s + Math.max(r.predictions[engine].prob.homeWin, r.predictions[engine].prob.draw, r.predictions[engine].prob.awayWin), 0) / errors.length, 3) : 0,
    errorList: errors.slice(0, 20).map(r => ({
      match: (r.homeTeamDisplay || r.homeTeam) + ' vs ' + (r.awayTeamDisplay || r.awayTeam),
      date: r.date,
      predicted: normalizeOutcome(maxKeyObj(r.predictions[engine].prob)),
      actual: normalizeOutcome(r.actualOutcome),
      confidence: round(Math.max(r.predictions[engine].prob.homeWin, r.predictions[engine].prob.draw, r.predictions[engine].prob.awayWin), 3),
    })),
  };
}

function maxKeyObj(obj) { if (!obj) return null; return Object.keys(obj).reduce((a, b) => obj[a] > obj[b] ? a : b); }
function round(v, d) { const f = Math.pow(10, d); return Math.round(v * f) / f; }

// =========================================================================
// Phase 17 T5: 场景分析 — Over/Under, BTTS, 比分精度, 加时/点球
// =========================================================================

/**
 * Over/Under 2.5 预测准确率
 * 假设预测 over2_5 ≥ 0.5 视为预测"over"
 */
function computeOverUnderAccuracy(records, engine) {
  const valid = records.filter(r => {
    const pred = r.predictions?.[engine];
    return pred?.prob && pred.xg && r.actualScore?.home != null;
  });
  if (valid.length === 0) return { n: 0, accuracy: 0, brier: 0 };

  let correct = 0, brierSum = 0;
  for (const r of valid) {
    const totalGoals = r.actualScore.home + r.actualScore.away;
    const actualOver = totalGoals > 2.5 ? 1 : 0;
    const predOver = (r.predictions?.[engine]?.overUnder?.over2_5 ?? 0.5);
    const predCorrect = (predOver >= 0.5) === (actualOver === 1);
    if (predCorrect) correct++;
    brierSum += (predOver - actualOver) ** 2;
  }
  return {
    n: valid.length,
    accuracy: round(correct / valid.length, 4),
    brier: round(brierSum / valid.length, 4),
    overCount: valid.filter(r => (r.actualScore.home + r.actualScore.away) > 2.5).length,
    underCount: valid.filter(r => (r.actualScore.home + r.actualScore.away) <= 2.5).length,
  };
}

/**
 * BTTS (Both Teams To Score) 预测准确率
 */
function computeBTTSAccuracy(records, engine) {
  const valid = records.filter(r => {
    const pred = r.predictions?.[engine];
    return pred?.prob && r.actualScore?.home != null;
  });
  if (valid.length === 0) return { n: 0, accuracy: 0, brier: 0 };

  let correct = 0, brierSum = 0;
  for (const r of valid) {
    const actualBTTS = (r.actualScore.home > 0 && r.actualScore.away > 0) ? 1 : 0;
    const predBTTS = (r.predictions?.[engine]?.btts?.yes ?? 0.5);
    const predCorrect = (predBTTS >= 0.5) === (actualBTTS === 1);
    if (predCorrect) correct++;
    brierSum += (predBTTS - actualBTTS) ** 2;
  }
  return {
    n: valid.length,
    accuracy: round(correct / valid.length, 4),
    brier: round(brierSum / valid.length, 4),
    bttsYesCount: valid.filter(r => r.actualScore.home > 0 && r.actualScore.away > 0).length,
    bttsNoCount: valid.filter(r => r.actualScore.home === 0 || r.actualScore.away === 0).length,
  };
}

/**
 * 比分预测精度（xG 误差 + 精确比分命中率）
 */
function computeScoreAccuracy(records, engine) {
  const valid = records.filter(r => {
    const pred = r.predictions?.[engine];
    return pred?.xg && r.actualScore?.home != null;
  });
  if (valid.length === 0) return { n: 0, xgMae: 0, exactHitRate: 0 };

  let xgErrorSum = 0, exactHits = 0;
  const topScoreHits = [0, 0, 0]; // top-1, top-3, top-5
  for (const r of valid) {
    const pred = r.predictions[engine];
    const actualHome = r.actualScore.home;
    const actualAway = r.actualScore.away;
    xgErrorSum += Math.abs((pred.xg?.home || 0) - actualHome) + Math.abs((pred.xg?.away || 0) - actualAway);
    if (pred.topScores) {
      if (pred.topScores[0]?.home === actualHome && pred.topScores[0]?.away === actualAway) {
        exactHits++;
        topScoreHits[0]++;
        topScoreHits[1]++;
        topScoreHits[2]++;
      } else if (pred.topScores.slice(0, 3).some(s => s.home === actualHome && s.away === actualAway)) {
        topScoreHits[1]++;
        topScoreHits[2]++;
      } else if (pred.topScores.slice(0, 5).some(s => s.home === actualHome && s.away === actualAway)) {
        topScoreHits[2]++;
      }
    }
  }
  return {
    n: valid.length,
    xgMae: round(xgErrorSum / valid.length, 2),
    exactHitRate: round(exactHits / valid.length, 4),
    top1HitRate: round(topScoreHits[0] / valid.length, 4),
    top3HitRate: round(topScoreHits[1] / valid.length, 4),
    top5HitRate: round(topScoreHits[2] / valid.length, 4),
  };
}

/**
 * 综合场景分析（T5 聚合）
 */
function computeSceneAnalysis(records, engine) {
  return {
    overUnder: computeOverUnderAccuracy(records, engine),
    btts: computeBTTSAccuracy(records, engine),
    score: computeScoreAccuracy(records, engine),
  };
}

// =========================================================================
// Phase 17 T6: 错误聚类与引擎优势分析
// =========================================================================

/**
 * 按 Elo 差梯度分组的错误率
 * 分组: 悬殊(>200), 大热(100-200), 势均力敌(50-100), 接近(0-50), 逆转(客队更强)
 */
function computeErrorClustering(records, engine) {
  const groups = {
    blowout: { label: '悬殊 (>200)', min: 200, max: Infinity, errors: 0, total: 0 },
    hot: { label: '大热 (100-200)', min: 100, max: 200, errors: 0, total: 0 },
    moderate: { label: '势均力敌 (50-100)', min: 50, max: 100, errors: 0, total: 0 },
    close: { label: '接近 (0-50)', min: 0, max: 50, errors: 0, total: 0 },
    upset: { label: '客队更强 (<0)', min: -Infinity, max: 0, errors: 0, total: 0 },
  };

  for (const r of records) {
    if (!r.predictions?.[engine]?.prob || r.eloRating?.home == null) continue;
    const eloDiff = (r.eloRating.home || 0) - (r.eloRating.away || 0);
    const isCorrect = maxKeyObj(r.predictions[engine].prob) === r.actualOutcome;
    let group;
    if (eloDiff >= 200) group = groups.blowout;
    else if (eloDiff >= 100) group = groups.hot;
    else if (eloDiff >= 50) group = groups.moderate;
    else if (eloDiff >= 0) group = groups.close;
    else group = groups.upset;
    group.total++;
    if (!isCorrect) group.errors++;
  }

  const out = {};
  for (const [key, g] of Object.entries(groups)) {
    out[key] = {
      label: g.label,
      total: g.total,
      errors: g.errors,
      errorRate: g.total > 0 ? round(g.errors / g.total, 4) : 0,
    };
  }
  return out;
}

/**
 * 按比赛阶段分组错误率
 */
function computeStageErrorRates(records, engine) {
  const groups = {};
  for (const r of records) {
    if (!r.predictions?.[engine]?.prob) continue;
    const stage = r.stage || 'UNKNOWN';
    if (!groups[stage]) groups[stage] = { total: 0, errors: 0 };
    groups[stage].total++;
    const isCorrect = normalizeOutcome(maxKeyObj(r.predictions[engine].prob)) === normalizeOutcome(r.actualOutcome);
    if (!isCorrect) groups[stage].errors++;
  }
  const out = {};
  for (const [stage, g] of Object.entries(groups)) {
    out[stage] = { total: g.total, errors: g.errors, errorRate: round(g.errors / g.total, 4) };
  }
  return out;
}

/**
 * 引擎优势分析：ML vs Elo 在不同场景下的表现对比
 */
function computeEngineAdvantage(records) {
  const eloKey = 'elo', mlKey = 'ml';
  const scenarios = {
    all: { total: 0, eloBetter: 0, mlBetter: 0, tie: 0 },
    knockout: { label: '淘汰赛', total: 0, eloBetter: 0, mlBetter: 0, tie: 0 },
    group: { label: '小组赛', total: 0, eloBetter: 0, mlBetter: 0, tie: 0 },
    highConf: { label: '高置信度 (>0.6)', total: 0, eloBetter: 0, mlBetter: 0, tie: 0 },
    lowConf: { label: '低置信度 (≤0.6)', total: 0, eloBetter: 0, mlBetter: 0, tie: 0 },
    eloFavored: { label: 'Elo看好主队', total: 0, eloBetter: 0, mlBetter: 0, tie: 0 },
  };

  for (const r of records) {
    const ep = r.predictions?.[eloKey]?.prob;
    const mp = r.predictions?.[mlKey]?.prob;
    if (!ep || !mp) continue;
    const actual = normalizeOutcome(r.actualOutcome);
    const ePred = normalizeOutcome(maxKeyObj(ep));
    const mPred = normalizeOutcome(maxKeyObj(mp));
    const eCorrect = ePred === actual;
    const mCorrect = mPred === actual;

    const all = scenarios.all;
    all.total++;
    if (eCorrect && !mCorrect) all.eloBetter++;
    else if (!eCorrect && mCorrect) all.mlBetter++;
    else all.tie++;

    // 淘汰赛 vs 小组赛
    const isKO = r.stage && !['GROUP_STAGE'].includes(r.stage);
    const sKey = isKO ? 'knockout' : 'group';
    const s = scenarios[sKey];
    s.total++;
    if (eCorrect && !mCorrect) s.eloBetter++;
    else if (!eCorrect && mCorrect) s.mlBetter++;
    else s.tie++;

    // 置信度
    const eConf = Math.max(ep.homeWin, ep.draw, ep.awayWin);
    const mConf = Math.max(mp.homeWin, mp.draw, mp.awayWin);
    const confKey = mConf > 0.6 ? 'highConf' : 'lowConf';
    const c = scenarios[confKey];
    c.total++;
    if (eCorrect && !mCorrect) c.eloBetter++;
    else if (!eCorrect && mCorrect) c.mlBetter++;
    else c.tie++;

    // Elo 看好主队
    if (ep.homeWin > ep.draw && ep.homeWin > ep.awayWin) {
      const f = scenarios.eloFavored;
      f.total++;
      if (eCorrect && !mCorrect) f.eloBetter++;
      else if (!eCorrect && mCorrect) f.mlBetter++;
      else f.tie++;
    }
  }

  const out = {};
  for (const [key, s] of Object.entries(scenarios)) {
    const label = s.label || '全部';
    out[key] = {
      label,
      total: s.total,
      eloBetter: s.eloBetter,
      mlBetter: s.mlBetter,
      tie: s.tie,
      eloWinRate: s.total > 0 ? round(s.eloBetter / s.total, 4) : 0,
      mlWinRate: s.total > 0 ? round(s.mlBetter / s.total, 4) : 0,
      mlAdvantage: s.total > 0 ? round((s.mlBetter - s.eloBetter) / s.total * 100, 2) : 0,
    };
  }
  return out;
}

export { computePerMatch, computeAggregate, computeByYear, computeByStage, computeErrorAnalysis, computeCalibration, computeOverUnderAccuracy, computeBTTSAccuracy, computeScoreAccuracy, computeSceneAnalysis, computeErrorClustering, computeStageErrorRates, computeEngineAdvantage };
