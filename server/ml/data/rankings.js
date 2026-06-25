/**
 * FIFA 排名时间线查询
 * server/ml/data/rankings.js
 */
import fs from 'node:fs';
import mlConfig from '../config.js';

let rankingTimeline = null;

function parseRankingsCSV(csvPath, snapshotDate) {
  if (!fs.existsSync(csvPath)) return null;
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;

  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const colMap = {};
  header.forEach((h, i) => { colMap[h] = i; });

  const rankings = {};
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length < 4) continue;
    const team = row[colMap['team']] || '';
    const rank = parseInt(row[colMap['rank']], 10);
    const points = parseInt(row[colMap['points']], 10);
    const association = row[colMap['association']] || '';
    if (team && !isNaN(rank) && !isNaN(points)) {
      rankings[team] = { team, rank, points, association, snapshotDate };
    }
  }
  return rankings;
}

function buildRankingTimeline() {
  if (rankingTimeline) return rankingTimeline;
  const snapshots = [];
  const r2022 = parseRankingsCSV(mlConfig.data.ranking2022, '2022-10-06');
  if (r2022) snapshots.push({ date: '2022-10-06', rankings: r2022, source: '2022' });
  const r2026 = parseRankingsCSV(mlConfig.data.ranking2026, '2026-06-08');
  if (r2026) snapshots.push({ date: '2026-06-08', rankings: r2026, source: '2026' });
  snapshots.sort((a, b) => a.date.localeCompare(b.date));
  rankingTimeline = snapshots;
  return snapshots;
}

export function getRankingAtDate(teamName, dateStr, eloRatings = null) {
  if (!teamName) return { rank: null, points: null, association: null, source: 'none' };
  const timeline = buildRankingTimeline();
  if (timeline.length === 0) return { rank: null, points: null, association: null, source: 'none' };

  const normalizedName = normalizeTeamName(teamName);
  let bestSnapshot = null;
  for (const snap of timeline) {
    if (snap.date <= dateStr) bestSnapshot = snap;
    else break;
  }
  if (!bestSnapshot) bestSnapshot = timeline[0];

  let ranking = bestSnapshot.rankings[normalizedName];
  if (!ranking) ranking = findTeamFuzzy(normalizedName, bestSnapshot.rankings);

  if (ranking) {
    return { rank: ranking.rank, points: ranking.points, association: ranking.association || null, source: `fifa-${bestSnapshot.source}` };
  }

  // Elo 降级
  if (eloRatings && mlConfig.features.eloFallback) {
    const elo = eloRatings[normalizedName] || eloRatings[teamName];
    if (elo && elo.rating) {
      const estimatedRank = Math.max(1, Math.round(2200 - elo.rating * 0.5));
      return { rank: estimatedRank, points: Math.round(elo.rating * 0.8), association: null, source: 'elo-fallback' };
    }
  }
  return { rank: null, points: null, association: null, source: 'none' };
}

export function getRankingsBatch(teamNames, dateStr, eloRatings = null) {
  const results = {};
  for (const name of teamNames) results[name] = getRankingAtDate(name, dateStr, eloRatings);
  return results;
}

export function loadEloRatings() {
  try {
    if (fs.existsSync(mlConfig.data.eloCalibrated)) {
      return JSON.parse(fs.readFileSync(mlConfig.data.eloCalibrated, 'utf-8'));
    }
  } catch (e) {
    console.warn('[ml:rankings] Elo 评分加载失败:', e.message);
  }
  return null;
}

export function getAllTeams() {
  const timeline = buildRankingTimeline();
  const teams = new Set();
  for (const snap of timeline) Object.keys(snap.rankings).forEach(t => teams.add(t));
  return [...teams].sort();
}

export function getAssociation(teamName) {
  const info = getRankingAtDate(teamName, '2026-06-01');
  return info.association;
}

export { buildRankingTimeline };

// ---------- 辅助 ----------
function normalizeTeamName(name) {
  const map = {
    'USA': 'United States', 'US': 'United States', 'U.S.A.': 'United States',
    'South Korea': 'Korea Republic', 'North Korea': 'Korea DPR',
    'Korea Republic': 'Korea Republic', 'Korea DPR': 'Korea DPR',
    'Ivory Coast': "Côte d'Ivoire", "Côte d'Ivoire": "Côte d'Ivoire",
    'IR Iran': 'Iran',
  };
  return map[name] || name;
}

function findTeamFuzzy(name, rankings) {
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(rankings)) {
    if (key.toLowerCase() === lower) return val;
  }
  for (const [key, val] of Object.entries(rankings)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) return val;
  }
  return null;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else current += ch;
  }
  result.push(current.trim());
  return result;
}
