/**
 * 比赛数据加载与清洗模块
 * server/ml/data/loader.js
 *
 * 从 CSV 文件加载历史比赛记录，执行清洗和过滤，
 * 输出标准化比赛记录数组。
 */
import fs from 'node:fs';
import mlConfig from '../config.js';

/**
 * 从 CSV 文件加载比赛记录
 * @param {string} csvPath - CSV 文件路径
 * @param {object} options
 * @param {string} options.filterLevel - 'P0' 世界杯+预选赛 | 'P1' A级赛事 | 'P2' 全部
 * @param {number} options.minYear - 最小年份过滤
 * @param {number} options.maxYear - 最大年份过滤
 * @returns {Array<object>} 标准化的比赛记录数组
 */
export function loadMatches(csvPath, options = {}) {
  const { filterLevel = 'P0', minYear = 2002, maxYear = 2026 } = options;

  if (!fs.existsSync(csvPath)) {
    console.warn(`[ml:loader] CSV 文件不存在: ${csvPath}`);
    return [];
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = parseCSVLine(lines[0]);
  const colMap = buildColumnMap(header);
  const matches = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      const row = parseCSVLine(lines[i]);
      if (row.length < 6) continue;

      const homeTeam = row[colMap.home_team] || '';
      const awayTeam = row[colMap.away_team] || '';
      const homeScore = parseInt(row[colMap.home_score], 10);
      const awayScore = parseInt(row[colMap.away_score], 10);

      if (!homeTeam || !awayTeam) continue;
      if (isNaN(homeScore) || isNaN(awayScore)) continue;

      const dateStr = row[colMap.Date] || row[colMap.date] || '';
      const year = dateStr ? parseInt(dateStr.substring(0, 4), 10) : 0;
      if (year < minYear || year > maxYear) continue;

      const tournament = (row[colMap.tournament] || row[colMap.Round] || 'Unknown').trim();
      const host = (row[colMap.Host] || row[colMap.host] || '').trim();

      // 赛事层级过滤
      if (filterLevel === 'P0') {
        const isWC = /world\s*cup/i.test(tournament) || /group|final|round|quarter|semi/i.test(tournament);
        const isQualifier = /qualif/i.test(tournament);
        if (!isWC && !isQualifier) continue;
      } else if (filterLevel === 'P1') {
        if (/u\d{2}|b\s*team|reserve|youth/i.test(homeTeam) || /u\d{2}|b\s*team|reserve|youth/i.test(awayTeam)) continue;
      }

      const match = {
        match_id: `${year}-${homeTeam.replace(/[^a-zA-Z0-9]/g, '')}-${awayTeam.replace(/[^a-zA-Z0-9]/g, '')}-${i}`,
        date: dateStr,
        year,
        tournament: normalizeTournament(tournament),
        round: tournament,
        home_team: homeTeam,
        away_team: awayTeam,
        home_score: homeScore,
        away_score: awayScore,
        neutral: host ? (homeTeam !== host && awayTeam !== host) : true,
        host,
      };

      if (colMap.home_xg !== undefined && row[colMap.home_xg]) match.home_xg = parseFloat(row[colMap.home_xg]);
      if (colMap.away_xg !== undefined && row[colMap.away_xg]) match.away_xg = parseFloat(row[colMap.away_xg]);
      if (colMap.Attendance !== undefined && row[colMap.Attendance]) match.attendance = parseInt(row[colMap.Attendance].replace(/,/g, ''), 10) || 0;

      matches.push(match);
    } catch (e) {
      continue;
    }
  }

  matches.sort((a, b) => a.date.localeCompare(b.date));
  return matches;
}

/**
 * 加载 2026 世界杯赛程
 */
export function loadSchedule2026() {
  const csvPath = mlConfig.data.schedule2026;
  if (!fs.existsSync(csvPath)) return [];

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = parseCSVLine(lines[0]);
  const colMap = buildColumnMap(header);
  const matches = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      const row = parseCSVLine(lines[i]);
      if (row.length < 4) continue;
      const homeTeam = row[colMap.home_team] || row[0] || '';
      const awayTeam = row[colMap.away_team] || row[1] || '';
      if (!homeTeam || !awayTeam) continue;
      const homeScore = row[colMap.home_score] !== undefined ? parseInt(row[colMap.home_score], 10) : null;
      const awayScore = row[colMap.away_score] !== undefined ? parseInt(row[colMap.away_score], 10) : null;
      const dateStr = row[colMap.Date] || row[colMap.date] || '';
      const round = row[colMap.Round] || row[colMap.round] || 'Group Stage';
      const group = row[colMap.group] || row[colMap.Group] || '';

      matches.push({
        match_id: `wc2026-${homeTeam.replace(/[^a-zA-Z0-9]/g, '')}-${awayTeam.replace(/[^a-zA-Z0-9]/g, '')}`,
        date: dateStr, year: 2026, tournament: 'FIFA World Cup',
        round, group, home_team: homeTeam, away_team: awayTeam,
        home_score: homeScore, away_score: awayScore,
        neutral: true, host: 'United States', played: homeScore !== null,
      });
    } catch (e) { continue; }
  }
  return matches;
}

/**
 * 获取整体训练数据集
 */
export function getTrainingData(options = {}) {
  const { filterLevel = 'P1', minYear = 2002 } = options;

  const wcMatches = loadMatches(mlConfig.data.matchesCsv, {
    filterLevel, minYear: Math.max(minYear, 1930), maxYear: 2022,
  });
  const allMatches = loadMatches(mlConfig.data.resultsCsv, {
    filterLevel: 'P2', minYear, maxYear: 2026,
  });

  const seen = new Set();
  const merged = [];
  for (const m of [...wcMatches, ...allMatches]) {
    const key = `${m.date}|${m.home_team}|${m.away_team}`;
    if (!seen.has(key)) { seen.add(key); merged.push(m); }
  }
  merged.sort((a, b) => a.date.localeCompare(b.date));
  return merged;
}

// ---------- 辅助函数 ----------

function normalizeTournament(t) {
  if (/world\s*cup/i.test(t) || /group|final|round|quarter|semi|third/i.test(t)) return 'FIFA World Cup';
  if (/qualif/i.test(t)) return 'Qualification';
  if (/friendly/i.test(t) || /friendlies/i.test(t)) return 'Friendly';
  if (/confed|copa america|euro|afcon|asian|gold cup|nations/i.test(t)) return 'Confederation Tournament';
  return 'Other';
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

function buildColumnMap(header) {
  const map = {};
  header.forEach((col, idx) => {
    const key = col.trim();
    map[key] = idx;
    map[key.toLowerCase()] = idx;
  });
  map.home_team = map.home_team ?? map['home team'];
  map.away_team = map.away_team ?? map['away team'];
  map.home_score = map.home_score ?? map['home score'];
  map.away_score = map.away_score ?? map['away score'];
  map.Date = map.Date ?? map.date;
  map.Host = map.Host ?? map.host;
  return map;
}
