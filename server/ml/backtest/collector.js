/**
 * 回测数据收集器
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = path.resolve(__dirname, '../../../data/wc2026-results.json');

export function load2026Matches() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf-8')); }
  catch { return []; }
  const matches = (raw.matches || []).filter(m => m.status === 'FT' && m.g1 != null && m.g2 != null);
  return matches.map(m => ({
    matchId: `wc2026-${m.t1}-${m.t2}`,
    date: m.date,
    year: 2026,
    stage: m.group || 'Round of 32',
    round: m.round,
    homeTeam: m.t1,
    awayTeam: m.t2,
    homeTeamDisplay: m.team1,
    awayTeamDisplay: m.team2,
    actualOutcome: getOutcome(m.g1, m.g2),
    actualScore: { home: m.g1, away: m.g2 },
    dataSource: 'wc2026',
  }));
}

export async function loadHistoricalMatches(years) {
  const yearList = Array.isArray(years) ? years : [years];
  const loaderUrl = pathToFileURL(path.resolve(__dirname, '../data/loader.js')).href;
  let loadMatches;
  try { loadMatches = (await import(loaderUrl)).loadMatches; }
  catch (e) { console.warn('[backtest/collector] loader.js:', e.message); return []; }

  const csvPath = path.resolve(__dirname, '../../../world-cup-data/matches_1930_2022.csv');
  let allMatches;
  try {
    allMatches = loadMatches(csvPath, { filterLevel: 'P0', minYear: Math.min(...yearList), maxYear: Math.max(...yearList) });
  } catch (e) { console.warn('[backtest/collector] CSV:', e.message); return []; }

  return allMatches.filter(m =>
    m.tournament === 'FIFA World Cup' && yearList.includes(m.year) && m.home_score != null && m.away_score != null
  ).map(m => ({
    matchId: `wc${m.year}-${slugify(m.home_team)}-${slugify(m.away_team)}`,
    date: m.date, year: m.year, stage: getStageFromRound(m.round), round: m.round,
    homeTeam: slugify(m.home_team), awayTeam: slugify(m.away_team),
    homeTeamDisplay: m.home_team, awayTeamDisplay: m.away_team,
    actualOutcome: getOutcome(m.home_score, m.away_score),
    actualScore: { home: m.home_score, away: m.away_score },
    dataSource: 'historical',
  }));
}

export async function collectAll(opts = {}) {
  const historicalYears = opts.historicalYears || [2002, 2006, 2010, 2014, 2018, 2022];
  const allMatches = [...load2026Matches()];
  for (const year of historicalYears) {
    const m = await loadHistoricalMatches(year);
    allMatches.push(...m);
  }
  const seen = new Set();
  const unique = allMatches.filter(m => { if (seen.has(m.matchId)) return false; seen.add(m.matchId); return true; });
  const byYear = {};
  for (const m of unique) { if (!byYear[m.year]) byYear[m.year] = []; byYear[m.year].push(m); }
  console.log(`[backtest/collector] 收集: ${unique.length} 场, ${Object.keys(byYear).length} 届`);
  return { matches: unique, summary: { total: unique.length, byYear: Object.keys(byYear).sort().map(y => ({ year: parseInt(y), count: byYear[y].length })) } };
}

let _cache = null;
export async function getCached(opts = {}) { if (!_cache || opts.force) _cache = await collectAll(opts); return _cache; }
export function clearCache() { _cache = null; }

function getOutcome(h, a) { return h > a ? 'HOME' : h < a ? 'AWAY' : 'DRAW'; }
function slugify(name) { return String(name || '').toLowerCase().replace(/[']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function getStageFromRound(round) {
  if (!round) return 'UNKNOWN';
  const r = String(round).toLowerCase();
  if (r.includes('group')) return 'GROUP_STAGE';
  if (r.includes('round of 32') || r.includes('last 32')) return 'LAST_32';
  if (r.includes('round of 16') || r.includes('last 16')) return 'LAST_16';
  if (r.includes('quarter')) return 'QUARTER_FINAL';
  if (r.includes('semi')) return 'SEMI_FINAL';
  if (r.includes('final')) return 'FINAL';
  if (r.includes('third') || r.includes('3rd')) return 'THIRD_PLACE';
  return 'KO';
}
