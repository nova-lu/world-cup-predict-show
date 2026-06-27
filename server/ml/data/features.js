/**
 * 特征工程管线
 * server/ml/data/features.js
 */
import fs from 'node:fs';
import path from 'node:path';
import mlConfig from '../config.js';
import * as rankings from './rankings.js';

/**
 * 为单场比赛构建特征向量
 */
export async function buildMatchFeatures(homeTeam, awayTeam, matchDate, context = {}) {
  const eloData = rankings.loadEloRatings();
  const homeRank = rankings.getRankingAtDate(homeTeam, matchDate, eloData);
  const awayRank = rankings.getRankingAtDate(awayTeam, matchDate, eloData);

  const rankDiff = (awayRank.rank !== null && homeRank.rank !== null) ? awayRank.rank - homeRank.rank : null;
  const pointsDiff = (homeRank.points !== null && awayRank.points !== null) ? homeRank.points - awayRank.points : null;
  const sameConfed = (homeRank.association && awayRank.association) ? (homeRank.association === awayRank.association ? 1 : 0) : 0;
  const hosts2026 = ['United States', 'Mexico', 'Canada'];
  const isHome = context.isHome ?? 0;
  const isHost = context.isHost ?? (hosts2026.includes(homeTeam) ? 1 : 0);
  const homeElo = eloData?.[homeTeam]?.rating ?? null;
  const awayElo = eloData?.[awayTeam]?.rating ?? null;
  const eloDiff = (homeElo !== null && awayElo !== null) ? homeElo - awayElo : null;

  return {
    features: {
      team_rank: homeRank.rank,
      team_points: homeRank.points,
      opponent_rank: awayRank.rank,
      opponent_points: awayRank.points,
      rank_diff: rankDiff,
      points_diff: pointsDiff,
      is_home: isHome,
      is_host: isHost,
      is_knockout: context.isKnockout ?? 0,
      same_confed: sameConfed,
      host_points_diff: isHost && pointsDiff !== null ? pointsDiff : 0,
      elo_rating_team: homeElo,
      elo_rating_opponent: awayElo,
      elo_diff: eloDiff,
      team_recent_goals: context.homeRecentGoals ?? 0,
      opponent_recent_goals: context.awayRecentGoals ?? 0,
      team_recent_conceded: context.homeRecentConceded ?? 0,
      opponent_recent_conceded: context.awayRecentConceded ?? 0,
      team_recent_form: context.homeRecentForm ?? 0.5,
      opponent_recent_form: context.awayRecentForm ?? 0.5,
      tournament_weight: context.tournamentWeight ?? 0.8,
      days_since_last_match_team: context.homeDaysSinceLast ?? 7,
      days_since_last_match_opponent: context.awayDaysSinceLast ?? 7,
    },
    metadata: {
      homeTeam, awayTeam, matchDate,
      missingFeatures: [],
    },
  };
}

/**
 * 批量构建特征
 */
export async function buildFeatureBatch(matches) {
  const windowSize = mlConfig.features.recentMatchWindow;
  const eloData = rankings.loadEloRatings();

  // 球队比赛索引
  const teamMatches = {};
  for (const m of matches) {
    for (const team of [m.home_team, m.away_team]) {
      if (!teamMatches[team]) teamMatches[team] = [];
      teamMatches[team].push({ date: m.date, match: m, isHome: team === m.home_team });
    }
  }
  for (const team of Object.keys(teamMatches)) {
    teamMatches[team].sort((a, b) => a.date.localeCompare(b.date));
  }

  const results = [];
  for (const m of matches) {
    try {
      const homeRank = rankings.getRankingAtDate(m.home_team, m.date, eloData);
      const awayRank = rankings.getRankingAtDate(m.away_team, m.date, eloData);
      const rankDiff = (awayRank.rank !== null && homeRank.rank !== null) ? awayRank.rank - homeRank.rank : null;
      const pointsDiff = (homeRank.points !== null && awayRank.points !== null) ? homeRank.points - awayRank.points : null;
      const sameConfed = (homeRank.association && awayRank.association) ? (homeRank.association === awayRank.association ? 1 : 0) : 0;
      const hosts = m.host ? [m.host] : [];
      const isHost = hosts.includes(m.home_team) ? 1 : 0;

      const homeWindow = getRecentMatches(teamMatches[m.home_team], m.date, windowSize);
      const awayWindow = getRecentMatches(teamMatches[m.away_team], m.date, windowSize);
      const homeRecentAvg = calcRecentAvg(homeWindow);
      const awayRecentAvg = calcRecentAvg(awayWindow);
      const homeForm = encodeForm(homeWindow);
      const awayForm = encodeForm(awayWindow);
      const homeElo = eloData?.[m.home_team]?.rating ?? null;
      const awayElo = eloData?.[m.away_team]?.rating ?? null;
      const eloDiff = (homeElo !== null && awayElo !== null) ? homeElo - awayElo : null;
      const tournamentWeight = getTournamentWeight(m.tournament);
      const isKnockout = !/group/i.test(m.round) ? 1 : 0;
      const homeDaysSince = homeWindow.length > 0 ? daysBetween(homeWindow[homeWindow.length - 1].date, m.date) : 7;
      const awayDaysSince = awayWindow.length > 0 ? daysBetween(awayWindow[awayWindow.length - 1].date, m.date) : 7;

      results.push({
        team_rank: homeRank.rank,
        team_points: homeRank.points,
        opponent_rank: awayRank.rank,
        opponent_points: awayRank.points,
        rank_diff: rankDiff,
        points_diff: pointsDiff,
        is_home: m.neutral ? 0 : 1,
        is_host: isHost,
        is_knockout: isKnockout,
        same_confed: sameConfed,
        host_points_diff: isHost && pointsDiff !== null ? pointsDiff : 0,
        elo_rating_team: homeElo,
        elo_rating_opponent: awayElo,
        elo_diff: eloDiff,
        team_recent_goals: homeRecentAvg.goals,
        opponent_recent_goals: awayRecentAvg.goals,
        team_recent_conceded: homeRecentAvg.conceded,
        opponent_recent_conceded: awayRecentAvg.conceded,
        team_recent_form: homeForm,
        opponent_recent_form: awayForm,
        tournament_weight: tournamentWeight,
        days_since_last_match_team: homeDaysSince,
        days_since_last_match_opponent: awayDaysSince,
        home_score: m.home_score,
        away_score: m.away_score,
        result: m.home_score > m.away_score ? 'W' : (m.home_score < m.away_score ? 'L' : 'D'),
        total_goals: m.home_score + m.away_score,
        both_scored: (m.home_score > 0 && m.away_score > 0) ? 1 : 0,
        _match_id: m.match_id,
        _date: m.date,
        _year: m.year,
        _home_team: m.home_team,
        _away_team: m.away_team,
        _tournament: m.tournament,
        _round: m.round,
      });
    } catch (e) {
      continue;
    }
  }
  return results;
}

/**
 * 数据集划分
 */
export function splitDataset(featureRows) {
  const { trainCutoff, valStart, valEnd, testStart } = mlConfig.training;

  const train = featureRows.filter(r => r._year <= trainCutoff);
  const val = featureRows.filter(r => r._year >= valStart && r._year <= valEnd);
  const test = featureRows.filter(r => r._year >= testStart);

  const X_columns = [
    'team_rank', 'team_points', 'opponent_rank', 'opponent_points',
    'rank_diff', 'points_diff', 'is_home', 'is_host', 'is_knockout',
    'same_confed', 'host_points_diff', 'elo_rating_team', 'elo_rating_opponent',
    'elo_diff', 'team_recent_goals', 'opponent_recent_goals',
    'team_recent_conceded', 'opponent_recent_conceded',
    'team_recent_form', 'opponent_recent_form',
    'tournament_weight', 'days_since_last_match_team', 'days_since_last_match_opponent',
  ];

  function extractX(rows) {
    return rows.map(r => {
      const row = {};
      for (const col of X_columns) row[col] = r[col] !== null && r[col] !== undefined ? r[col] : 0;
      return row;
    });
  }

  function extractMeta(rows) {
    return rows.map(r => ({
      match_id: r._match_id, date: r._date, year: r._year,
      home: r._home_team, away: r._away_team,
    }));
  }

  return {
    train: {
      X: extractX(train),
      y_home: train.map(r => r.home_score),
      y_away: train.map(r => r.away_score),
      y_result: train.map(r => r.result),
      y_total: train.map(r => r.total_goals),
      y_btts: train.map(r => r.both_scored),
      _meta: extractMeta(train),
    },
    val: {
      X: extractX(val),
      y_home: val.map(r => r.home_score),
      y_away: val.map(r => r.away_score),
      y_result: val.map(r => r.result),
      y_total: val.map(r => r.total_goals),
      y_btts: val.map(r => r.both_scored),
      _meta: extractMeta(val),
    },
    test: {
      X: extractX(test),
      y_home: test.map(r => r.home_score),
      y_away: test.map(r => r.away_score),
      y_result: test.map(r => r.result),
      y_total: test.map(r => r.total_goals),
      y_btts: test.map(r => r.both_scored),
      _meta: extractMeta(test),
    },
    stats: {
      total: featureRows.length, train: train.length, val: val.length, test: test.length,
      features: X_columns, featureCount: X_columns.length,
      timeRange: `<=${trainCutoff} / ${valStart}-${valEnd} / >=${testStart}`,
    },
  };
}

/**
 * 导出 CSV
 */
export function exportToCSV(featureRows, outputPath) {
  if (featureRows.length === 0) return null;
  const columns = Object.keys(featureRows[0]);
  const metaCols = columns.filter(c => c.startsWith('_'));
  const dataCols = columns.filter(c => !c.startsWith('_'));
  const ordered = [...dataCols, ...metaCols];

  let csv = ordered.join(',') + '\n';
  for (const row of featureRows) {
    const values = ordered.map(col => {
      const v = row[col];
      if (v === null || v === undefined) return '';
      if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) return `"${v.replace(/"/g, '""')}"`;
      return v;
    });
    csv += values.join(',') + '\n';
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, csv, 'utf-8');
  return outputPath;
}

// ---------- 辅助 ----------
function getRecentMatches(teamHistory, beforeDate, windowSize) {
  if (!teamHistory) return [];
  return teamHistory.filter(e => e.date < beforeDate).slice(-windowSize);
}

function calcRecentAvg(matches) {
  if (matches.length === 0) return { goals: 0, conceded: 0 };
  let totalGoals = 0, totalConceded = 0;
  for (const m of matches) {
    if (m.isHome) { totalGoals += m.match.home_score; totalConceded += m.match.away_score; }
    else { totalGoals += m.match.away_score; totalConceded += m.match.home_score; }
  }
  return {
    goals: Math.round((totalGoals / matches.length) * 100) / 100,
    conceded: Math.round((totalConceded / matches.length) * 100) / 100,
  };
}

function encodeForm(matches) {
  if (matches.length === 0) return 0.5;
  let score = 0;
  for (const m of matches) {
    if (m.isHome) score += m.match.home_score > m.match.away_score ? 2 : (m.match.home_score === m.match.away_score ? 1 : 0);
    else score += m.match.away_score > m.match.home_score ? 2 : (m.match.away_score === m.match.home_score ? 1 : 0);
  }
  return score / (matches.length * 2);
}

function getTournamentWeight(tournament) {
  const weights = { 'FIFA World Cup': 1.0, Qualification: 0.8, 'Confederation Tournament': 0.6, Friendly: 0.4, Other: 0.3 };
  return weights[tournament] || 0.5;
}

function daysBetween(d1, d2) {
  return Math.round((new Date(d2) - new Date(d1)) / (1000 * 60 * 60 * 24));
}
