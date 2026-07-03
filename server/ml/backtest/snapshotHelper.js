/**
 * 预测快照持久化辅助模块
 *
 * 将预测结果保存到 data/backtest/predictions/ 下的 JSON Lines 文件中，
 * 按月份分文件 (YYYY-MM.jsonl)，每行一条匹配预测记录。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.resolve(__dirname, '../../../data/backtest/predictions');

/**
 * 确保快照目录存在
 */
function ensureDir() {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
}

/**
 * 从匹配日期中提取月份文件名 (YYYY-MM.jsonl)
 */
function monthFile(dateStr) {
  // dateStr 格式: "2026-06-14" 或 "2026-6-14"
  if (!dateStr) return null;
  const parts = String(dateStr).split('-');
  if (parts.length < 2) return null;
  return `${parts[0]}-${String(parts[1]).padStart(2, '0')}.jsonl`;
}

/**
 * 读取一个 .jsonl 文件，返回解析后的对象数组
 */
function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

/**
 * 将对象数组写入 .jsonl 文件
 */
function writeJsonl(filePath, entries) {
  ensureDir();
  const lines = entries.map(e => JSON.stringify(e)).join('\n');
  fs.writeFileSync(filePath, lines + '\n', 'utf-8');
}

/**
 * 保存单场比赛的预测快照。
 * 如果同 matchId 的记录已存在（在同一月份文件中），则更新；否则追加。
 *
 * @param {Object} match - 比赛信息对象，需包含 { matchId, date, homeTeam, awayTeam }
 * @param {Object} predictions - 预测结果，格式 { elo, ml, ensemble }
 */
export function savePredictionSnapshot(match, predictions) {
  const fileName = monthFile(match.date);
  if (!fileName) {
    console.warn(`[snapshotHelper] 无效的日期格式，无法保存: ${match.date}`);
    return;
  }

  ensureDir();
  const filePath = path.join(SNAPSHOT_DIR, fileName);
  const existing = readJsonl(filePath);

  const entry = {
    matchId: match.matchId,
    date: match.date,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    savedAt: new Date().toISOString(),
    predictions: {
      elo: predictions.elo ?? null,
      ml: predictions.ml ?? null,
      ensemble: predictions.ensemble ?? null,
    },
  };

  const idx = existing.findIndex(e => e.matchId === match.matchId);
  if (idx !== -1) {
    existing[idx] = entry;
  } else {
    existing.push(entry);
  }

  writeJsonl(filePath, existing);
}

/**
 * 根据 matchId 加载指定比赛的预测快照。
 * 跨所有 .jsonl 文件搜索。
 *
 * @param {string} matchId - 比赛唯一标识
 * @returns {Object|null} 快照记录或 null
 */
export function loadPredictionSnapshot(matchId) {
  const all = loadAllSnapshots();
  return all.find(e => e.matchId === matchId) || null;
}

/**
 * 加载所有持久化的预测快照。
 *
 * @returns {Array<Object>} 所有预测快照记录
 */
export function loadAllSnapshots() {
  ensureDir();
  const files = fs.readdirSync(SNAPSHOT_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .sort();

  const all = [];
  for (const f of files) {
    const entries = readJsonl(path.join(SNAPSHOT_DIR, f));
    all.push(...entries);
  }
  return all;
}

/**
 * 获取快照统计信息：总数量、月份分布、日期范围
 *
 * @returns {{ total: number, byMonth: Array<{ month: string, count: number }>, dateRange: { earliest: string|null, latest: string|null } }}
 */
export function getSnapshotStats() {
  const all = loadAllSnapshots();
  const byMonth = {};
  let earliest = null;
  let latest = null;

  for (const e of all) {
    const m = monthFile(e.date);
    if (m) {
      const monthKey = m.replace('.jsonl', '');
      byMonth[monthKey] = (byMonth[monthKey] || 0) + 1;
    }

    if (e.date) {
      if (!earliest || e.date < earliest) earliest = e.date;
      if (!latest || e.date > latest) latest = e.date;
    }
  }

  return {
    total: all.length,
    byMonth: Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, count })),
    dateRange: { earliest, latest },
  };
}
