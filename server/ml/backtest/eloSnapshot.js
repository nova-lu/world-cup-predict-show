/**
 * Elo 时间点快照系统
 *
 * 从 Elo manifests 中查找指定日期前的球队评分快照。
 * 确保历史回测使用当时真实的 Elo 评分，而非当前最新评分。
 *
 * Manifests 由 server/ml/elo/update_elo_from_results.mjs 生成，
 * 存储在 data/elo-manifests/ 目录下，每个文件包含 ratingsBefore / ratingsAfter。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const MANIFESTS_DIR = path.resolve(PROJECT_ROOT, 'data/elo-manifests');
const ELO_CALIBRATED_PATH = path.resolve(PROJECT_ROOT, 'data/elo-calibrated.json');

// 快照缓存
let _manifestCache = null;

/**
 * 加载并解析所有 Elo manifests，按 matchRange.to 降序排列
 */
function loadManifests() {
  if (_manifestCache) return _manifestCache;

  try {
    if (!fs.existsSync(MANIFESTS_DIR)) {
      _manifestCache = [];
      return _manifestCache;
    }

    const files = fs.readdirSync(MANIFESTS_DIR)
      .filter(f => f.endsWith('.json') && f.startsWith('elo_'))
      .sort()
      .reverse(); // 最新的在前

    const manifests = [];
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(MANIFESTS_DIR, file), 'utf-8'));
        if (data.ratingsBefore && data.matchRange?.to) {
          manifests.push({
            file,
            date: data.matchRange.to,
            ratingsBefore: data.ratingsBefore,
            ratingsAfter: data.ratingsAfter || data.ratingsBefore,
            matchRange: data.matchRange,
            generatedAt: data.generatedAt,
          });
        }
      } catch (e) {
        // skip corrupt manifest
      }
    }

    _manifestCache = manifests;
    return manifests;
  } catch {
    _manifestCache = [];
    return _manifestCache;
  }
}

/**
 * 加载当前 Elo 评分（最新校准值）
 */
function loadCurrentRatings() {
  try {
    if (!fs.existsSync(ELO_CALIBRATED_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(ELO_CALIBRATED_PATH, 'utf-8'));
    return data.ratings || null;
  } catch {
    return null;
  }
}

/**
 * 查找指定日期前的 Elo 快照
 *
 * 策略：
 * 1. 遍历 manifests（按日期降序），找第一个 matchRange.to < targetDate 的 manifest
 * 2. 如果找到：使用该 manifest 的 ratingsAfter（该更新后的评分）
 * 3. 如果找不到：回退到当前 elo-calibrated.json 的值
 *
 * @param {string|Date} targetDate - 目标日期（如 '2002-05-31'）
 * @returns {{ ratings: object, source: string, manifestDate: string|null }}
 */
export function loadEloSnapshot(targetDate) {
  const dateStr = targetDate instanceof Date
    ? targetDate.toISOString().slice(0, 10)
    : String(targetDate).slice(0, 10);

  const manifests = loadManifests();

  // 找最新（最接近）在该日期前的 manifest
  // manifests 已按 date 降序排列，所以从头部（最新）往后找
  let best = null;
  for (let i = 0; i < manifests.length; i++) {
    const m = manifests[i];
    if (m.date < dateStr) {
      best = m;
      break;
    }
  }

  if (best) {
    return {
      ratings: { ...best.ratingsAfter },
      source: `manifest:${best.file}`,
      manifestDate: best.date,
      generatedAt: best.generatedAt,
    };
  }

  // 回退到当前 Elo 校准值
  const current = loadCurrentRatings();
  if (current) {
    return {
      ratings: { ...current },
      source: 'elo-calibrated.json (fallback)',
      manifestDate: null,
      generatedAt: null,
    };
  }

  return {
    ratings: {},
    source: 'none',
    manifestDate: null,
    generatedAt: null,
  };
}

/**
 * 获取球队在指定日期的 Elo 评分
 * @param {string} teamSlug - 球队 slug
 * @param {string|Date} date - 日期
 * @param {number} defaultRating - 找不到时的默认值
 * @returns {number}
 */
export function getEloForTeamAtDate(teamSlug, date, defaultRating = 1500) {
  const snapshot = loadEloSnapshot(date);
  if (!snapshot.ratings || Object.keys(snapshot.ratings).length === 0) {
    return defaultRating;
  }

  // 直接匹配 slug
  if (snapshot.ratings[teamSlug] != null) {
    return snapshot.ratings[teamSlug];
  }

  // 模糊匹配（驼峰 vs 连字符 等变体）
  for (const [key, val] of Object.entries(snapshot.ratings)) {
    if (key.toLowerCase().replace(/[^a-z0-9]/g, '-') === teamSlug) {
      return val;
    }
  }

  return defaultRating;
}

/**
 * 获取快照源信息（用于报告标注）
 * @param {string|Date} date
 * @returns {string}
 */
export function getSnapshotInfo(date) {
  const snap = loadEloSnapshot(date);
  if (snap.source.startsWith('manifest')) {
    return `Elo 快照 (${snap.manifestDate})`;
  }
  if (snap.source.startsWith('elo-calibrated')) {
    return `当前 Elo (无历史快照)`;
  }
  return '无 Elo 数据';
}

/**
 * 获取所有可用快照日期列表（用于调试/报告）
 */
export function listAvailableSnapshots() {
  return loadManifests().map(m => ({
    date: m.date,
    file: m.file,
    teamCount: Object.keys(m.ratingsAfter).length,
  }));
}

/**
 * 清除内部缓存（测试用）
 */
export function clearSnapshotCache() {
  _manifestCache = null;
}
