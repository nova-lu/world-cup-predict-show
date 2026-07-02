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

export { computePerMatch, computeAggregate, computeByYear, computeByStage, computeErrorAnalysis, computeCalibration };
