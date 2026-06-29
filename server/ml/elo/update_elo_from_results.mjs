/**
 * ELO 增量更新引擎
 *
 * 根据最新比赛结果更新 ELO ratings，生成审计 manifest。
 *
 * CLI: node server/ml/elo/update_elo_from_results.mjs [--from 2026-06-20]
 * Module: import { updateEloFromMatch, batchUpdateFromResults } from './update_elo_from_results.mjs'
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

// ---- 路径 ----
const ELO_CALIBRATED_PATH = resolve(PROJECT_ROOT, 'data/elo-calibrated.json');
const RESULTS_CSV_PATH = resolve(PROJECT_ROOT, 'histroy-match-data/results.csv');
const MANIFESTS_DIR = resolve(PROJECT_ROOT, 'data/elo-manifests');
const DATA_SERVICE_PATH = resolve(PROJECT_ROOT, 'server/services/dataService.js');

// ---- 常量 ----
const MAX_DELTA = 25;
const UPSET_SPREAD = 250;
const UPSET_FACTOR = 0.8;
const KC_KO_CUTOFF = '2026-06-27'; // 世界杯淘汰赛截止日期

/**
 * 构建 teamName → slug 的映射表
 */
function buildNameToSlugMap() {
  const map = {};
  // 通用规则：小写、空格→连字符、移除非字母数字
  const genericSlugify = (name) =>
    name.toLowerCase()
      .replace(/['']/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  // 从 dataService 读取 TEAMS 对象
  // Team records use nameEn for matching
  // Known special cases where CSV name differs from nameEn
  const overrides = {
    'USA': 'usa',
    'DR Congo': 'dr-congo',
    'South Korea': 'south-korea',
    'Ivory Coast': 'ivory-coast',
    'Cape Verde': 'cape-verde',
    'Czech Republic': 'czech-republic',
    'New Zealand': 'new-zealand',
    'Bosnia & Herzegovina': 'bosnia-and-herzegovina',
    'Saudi Arabia': 'saudi-arabia',
    'South Africa': 'south-africa',
    'Trinidad & Tobago': 'trinidad-and-tobago',
    'Bosnia and Herzegovina': 'bosnia-and-herzegovina',
    'El Salvador': 'el-salvador',
    'Costa Rica': 'costa-rica',
  };

  // Build from dataService's TEAMS
  try {
    const dataServiceContent = readFileSync(DATA_SERVICE_PATH, 'utf-8');
    // Extract TEAMS object keys and nameEn values
    const teamRegex = /'([\w-]+)':\s*\{[^}]*nameEn:\s*'([^']+)'/g;
    let match;
    while ((match = teamRegex.exec(dataServiceContent)) !== null) {
      const slug = match[1];
      const nameEn = match[2];
      map[nameEn.toLowerCase()] = slug;
    }
  } catch {
    // fallback
  }

  // Apply overrides
  for (const [name, slug] of Object.entries(overrides)) {
    map[name.toLowerCase()] = slug;
  }

  return map;
}

const NAME_TO_SLUG = buildNameToSlugMap();

/**
 * 将 CSV 中的队伍名转为 slug
 */
function nameToSlug(name) {
  const key = name.toLowerCase().trim();
  if (NAME_TO_SLUG[key]) return NAME_TO_SLUG[key];
  // Fallback: generic slugify
  return key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * 获取 K 因子（按比赛类型）
 */
function getKFactor(tournament, date) {
  const t = tournament || '';
  const d = date || '';

  if (t === 'Friendly') return 20;
  if (/Qualif/i.test(t)) return 30;
  if (/Copa|Euro|Afcon|Asian|Gold\s*Cup/i.test(t)) return 30;
  if (t === 'FIFA World Cup') {
    // 淘汰赛 vs 小组赛
    if (d > KC_KO_CUTOFF) return 50;
    return 40;
  }
  // 其他（Nations League, Confederations Cup 等）
  return 30;
}

/**
 * 从 elo-calibrated.json 读取当前 ratings
 */
function loadCurrentRatings() {
  if (!existsSync(ELO_CALIBRATED_PATH)) {
    throw new Error(`ELO 校准文件不存在: ${ELO_CALIBRATED_PATH}`);
  }
  const raw = readFileSync(ELO_CALIBRATED_PATH, 'utf-8');
  const data = JSON.parse(raw);
  return data.ratings;
}

/**
 * 将 ratings 写入 elo-calibrated.json
 */
function writeRatings(ratings, summary) {
  const output = {
    generatedAt: new Date().toISOString(),
    matchesApplied: (summary?.totalApplied || 0),
    ratings,
    method: (summary?.method || 'elo-update'),
  };
  writeFileSync(ELO_CALIBRATED_PATH, JSON.stringify(output, null, 2), 'utf-8');
}

/**
 * 计算 Elo 期望值
 */
function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * 截取数值到范围 [-maxVal, +maxVal]
 */
function clamp(val, maxVal) {
  return Math.max(-maxVal, Math.min(maxVal, val));
}

/**
 * 单场 ELO 更新
 *
 * @param {object} ratings - 当前 ratings 对象（会直接修改）
 * @param {object} match - { date, home_team, away_team, home_score, away_score, tournament }
 * @returns {object} { homeSlug, awaySlug, kFactor, expectedHome, expectedAway, actualHome, actualAway, deltaRawHome, deltaRawAway, deltaHome, deltaAway, upsetSuppressed }
 */
export function updateEloFromMatch(ratings, match) {
  const homeSlug = nameToSlug(match.home_team);
  const awaySlug = nameToSlug(match.away_team);

  const homeRating = ratings[homeSlug] || 1500;
  const awayRating = ratings[awaySlug] || 1500;

  const kFactor = getKFactor(match.tournament, match.date);

  // 期望值
  const expHome = expectedScore(homeRating, awayRating);
  const expAway = 1 - expHome;

  // 实际结果: 1=赢, 0.5=平, 0=输
  const homeScore = parseInt(match.home_score, 10) || 0;
  const awayScore = parseInt(match.away_score, 10) || 0;
  let actualHome, actualAway;
  if (homeScore > awayScore) { actualHome = 1; actualAway = 0; }
  else if (homeScore < awayScore) { actualHome = 0; actualAway = 1; }
  else { actualHome = 0.5; actualAway = 0.5; }

  // 原始 delta
  let deltaRawHome = kFactor * (actualHome - expHome);
  let deltaRawAway = kFactor * (actualAway - expAway);

  // delta 符号相反
  deltaRawAway = -deltaRawHome;

  // 冷门抑制：当两队 ELO 差 > 250 时，delta ×= 0.8
  let upsetSuppressed = false;
  if (Math.abs(homeRating - awayRating) > UPSET_SPREAD) {
    deltaRawHome *= UPSET_FACTOR;
    deltaRawAway *= UPSET_FACTOR;
    upsetSuppressed = true;
  }

  // 截断
  const deltaHome = clamp(Math.round(deltaRawHome * 10) / 10, MAX_DELTA);
  const deltaAway = clamp(Math.round(deltaRawAway * 10) / 10, MAX_DELTA);

  // 更新
  ratings[homeSlug] = Math.round((homeRating + deltaHome) * 10) / 10;
  ratings[awaySlug] = Math.round((awayRating + deltaAway) * 10) / 10;

  return {
    homeSlug, awaySlug,
    homeRating, awayRating,
    newHomeRating: ratings[homeSlug],
    newAwayRating: ratings[awaySlug],
    kFactor,
    expectedHome: Math.round(expHome * 1000) / 1000,
    expectedAway: Math.round(expAway * 1000) / 1000,
    actualHome, actualAway,
    deltaRawHome: Math.round(deltaRawHome * 10) / 10,
    deltaRawAway: Math.round(deltaRawAway * 10) / 10,
    deltaHome, deltaAway,
    upsetSuppressed,
  };
}

/**
 * 读取 results.csv 中指定日期之后的比赛
 */
function readResultsFrom(cutoffDate) {
  const content = readFileSync(RESULTS_CSV_PATH, 'utf-8');
  const lines = content.trim().split(/\r?\n/);
  const header = lines[0];
  if (header !== 'date,home_team,away_team,home_score,away_score,tournament,city,country,neutral') {
    console.warn('[elo] results.csv 表头异常，尝试按位置解析');
  }

  const matches = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = line.split(',');
    if (fields.length < 5) continue;

    const match = {
      date: fields[0],
      home_team: fields[1],
      away_team: fields[2],
      home_score: parseInt(fields[3], 10),
      away_score: parseInt(fields[4], 10),
      tournament: fields[5] || '',
    };

    if (cutoffDate && match.date <= cutoffDate) continue;
    matches.push(match);
  }

  // 按日期升序排序
  matches.sort((a, b) => a.date.localeCompare(b.date));
  return matches;
}

/**
 * 查找最新 manifest 的截止日期
 */
function getLastManifestDate() {
  if (!existsSync(MANIFESTS_DIR)) {
    mkdirSync(MANIFESTS_DIR, { recursive: true });
    return null;
  }
  const files = readdirSync(MANIFESTS_DIR)
    .filter(f => f.startsWith('elo_update_') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  // 从 manifest 读取 matchRange.to
  try {
    const manifest = JSON.parse(readFileSync(resolve(MANIFESTS_DIR, files[0]), 'utf-8'));
    return manifest.matchRange?.to || null;
  } catch {
    return null;
  }
}

/**
 * 生成 manifest 文件名
 */
function manifestFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `elo_update_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
}

/**
 * 写入 manifest
 */
function writeManifest(data) {
  if (!existsSync(MANIFESTS_DIR)) {
    mkdirSync(MANIFESTS_DIR, { recursive: true });
  }
  const filename = manifestFilename();
  const filepath = resolve(MANIFESTS_DIR, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[elo] Manifest 已写入: ${filename}`);
  return filename;
}

/**
 * 批量更新入口
 *
 * @param {string|null} cutoffDate - 从该日期之后开始更新，null 则自动从最后一个 manifest 之后开始
 * @returns {object} { matchesApplied, matchDetails, manifestId }
 */
export async function batchUpdateFromResults(cutoffDate) {
  if (!cutoffDate) {
    const lastDate = getLastManifestDate();
    if (lastDate) {
      cutoffDate = lastDate;
      console.log(`[elo] 自动检测到上次更新截止: ${cutoffDate}`);
    } else {
      // 无历史 manifest，默认从结果中获取所有世界杯比赛
      cutoffDate = '2026-06-10'; // 世界杯开始前
      console.log(`[elo] 无历史 manifest，从 ${cutoffDate} 开始`);
    }
  }

  const ratings = loadCurrentRatings();
  const ratingsBefore = { ...ratings };

  const matches = readResultsFrom(cutoffDate);
  console.log(`[elo] 找到 ${matches.length} 场未处理比赛`);

  if (matches.length === 0) {
    console.log('[elo] 无新增比赛需要更新');
    return { matchesApplied: 0, matchDetails: [], manifestId: null };
  }

  const matchDetails = [];
  let firstDate = matches[0].date;
  let lastDate = matches[matches.length - 1].date;

  for (const match of matches) {
    const detail = updateEloFromMatch(ratings, match);
    matchDetails.push({
      date: match.date,
      home: match.home_team,
      away: match.away_team,
      score: `${match.home_score}-${match.away_score}`,
      tournament: match.tournament,
      kFactor: detail.kFactor,
      deltaHome: detail.deltaHome,
      deltaAway: detail.deltaAway,
      upsetSuppressed: detail.upsetSuppressed,
    });
  }

  // 计算 top movers
  const deltas = {};
  for (const d of matchDetails) {
    const hSlug = nameToSlug(d.home);
    const aSlug = nameToSlug(d.away);
    deltas[hSlug] = (deltas[hSlug] || 0) + d.deltaHome;
    deltas[aSlug] = (deltas[aSlug] || 0) + d.deltaAway;
  }
  const topMovers = Object.entries(deltas)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 5)
    .map(([team, delta]) => ({ team, delta: Math.round(delta * 10) / 10 }));

  // 提取有变更的队伍
  const ratingsAfter = {};
  for (const slug of Object.keys(ratings)) {
    if (ratingsBefore[slug] !== ratings[slug]) {
      ratingsAfter[slug] = ratings[slug];
    }
  }
  // 也记录新出现的队伍
  for (const slug of Object.keys(ratings)) {
    if (!ratingsBefore[slug]) {
      ratingsAfter[slug] = ratings[slug];
    }
  }

  // 写入 elo-calibrated.json
  writeRatings(ratings, {
    totalApplied: (ratingsBefore._totalApplied || 0) + matches.length,
    method: `batch-update-${new Date().toISOString().slice(0, 10)}`,
  });

  // 写入 manifest
  const manifestData = {
    manifestId: manifestFilename().replace('.json', ''),
    generatedAt: new Date().toISOString(),
    sourceFile: 'histroy-match-data/results.csv',
    matchRange: { from: firstDate, to: lastDate },
    matchesApplied: matches.length,
    matchDetails,
    topMovers,
    ratingsBefore: extractChangedRatings(ratingsBefore, Object.keys(ratingsAfter)),
    ratingsAfter,
    generatedBy: 'update_elo_from_results.mjs v1',
  };
  const manifestFile = writeManifest(manifestData);

  console.log(`\n[elo] ✅ 批量更新完成: ${matches.length} 场比赛`);
  console.log(`[elo]    日期范围: ${firstDate} → ${lastDate}`);
  console.log(`[elo]    最大变动: ${topMovers[0]?.team || '-'} ${topMovers[0]?.delta > 0 ? '+' : ''}${topMovers[0]?.delta || 0}`);
  console.log(`[elo]    Manifest: ${manifestFile}`);

  return {
    matchesApplied: matches.length,
    matchDetails,
    manifestId: manifestData.manifestId,
  };
}

/**
 * 提取有变更的 ratings（减少 manifest 体积）
 */
function extractChangedRatings(ratingsBefore, changedSlugs) {
  const result = {};
  for (const slug of changedSlugs) {
    if (ratingsBefore[slug] !== undefined) {
      result[slug] = ratingsBefore[slug];
    }
  }
  return result;
}

// ====================================================================
// CLI 入口
// ====================================================================
if (process.argv[1] === __filename || resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  let fromDate = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      fromDate = args[i + 1];
      i++;
    }
  }

  batchUpdateFromResults(fromDate)
    .then(result => {
      if (result.matchesApplied > 0) {
        console.log('\n更新 summary:');
        console.log(JSON.stringify({
          matchesApplied: result.matchesApplied,
          manifestId: result.manifestId,
        }, null, 2));
      }
    })
    .catch(err => {
      console.error('[elo] ❌ 更新失败:', err.message);
      process.exit(1);
    });
}
