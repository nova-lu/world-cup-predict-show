/**
 * ELO 回滚脚本
 *
 * CLI: node scripts/rollback_elo.mjs --to <manifestId>
 *       node scripts/rollback_elo.mjs --to elo_update_20260627_120000
 *       node scripts/rollback_elo.mjs --to elo_update_20260627_120000 --force (跳过 30 天限制)
 *
 * 行为:
 *   1. 读取 manifest 中的 ratingsBefore
 *   2. 自动备份当前 elo-calibrated.json
 *   3. 恢复到 manifest 时的状态
 *   4. 归档此 manifest 之后的所有 manifest
 *   5. 生成回滚记录 manifest
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

const ELO_CALIBRATED_PATH = resolve(PROJECT_ROOT, 'data/elo-calibrated.json');
const MANIFESTS_DIR = resolve(PROJECT_ROOT, 'data/elo-manifests');
const ARCHIVE_DIR = resolve(MANIFESTS_DIR, '_archived');
const MAX_ROLLBACK_DAYS = 30;

/**
 * 从 manifestId 中解析日期
 * format: elo_update_YYYYMMDD_HHmmss
 */
function parseManifestDate(manifestId) {
  const match = manifestId.match(/elo_update_(\d{8})_(\d{6})/);
  if (!match) return null;
  return `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`;
}

/**
 * 计算日期差（天数）
 */
function daysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return Math.round(Math.abs((d2 - d1) / (1000 * 60 * 60 * 24)));
}

async function main() {
  const args = process.argv.slice(2);
  let targetManifestId = null;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--to' && args[i + 1]) {
      targetManifestId = args[i + 1];
      i++;
    }
    if (args[i] === '--force') {
      force = true;
    }
  }

  if (!targetManifestId) {
    console.error('用法: node scripts/rollback_elo.mjs --to <manifestId> [--force]');
    console.error('示例: node scripts/rollback_elo.mjs --to elo_update_20260627_120000');
    console.error('');
    console.error('可用 manifest:');
    if (existsSync(MANIFESTS_DIR)) {
      const files = readdirSync(MANIFESTS_DIR)
        .filter(f => f.startsWith('elo_update_') && f.endsWith('.json'))
        .sort()
        .reverse();
      for (const f of files.slice(0, 10)) {
        const id = f.replace('.json', '');
        try {
          const manifest = JSON.parse(readFileSync(resolve(MANIFESTS_DIR, f), 'utf-8'));
          console.error(`  ${id}  (${manifest.matchesApplied} 场, ${manifest.matchRange?.from}~${manifest.matchRange?.to})`);
        } catch {
          console.error(`  ${id}  (无法读取)`);
        }
      }
    }
    process.exit(1);
  }

  // 构建 manifest 路径
  const manifestPath = resolve(MANIFESTS_DIR, `${targetManifestId}.json`);
  if (!existsSync(manifestPath)) {
    console.error(`❌ Manifest 文件不存在: ${manifestPath}`);
    // 尝试在归档目录中查找
    const archivedPath = resolve(ARCHIVE_DIR, `${targetManifestId}.json`);
    if (existsSync(archivedPath)) {
      console.error(`   已归档: ${archivedPath}`);
      console.error('   请先恢复: mv data/elo-manifests/_archived/${targetManifestId}.json data/elo-manifests/');
    }
    process.exit(1);
  }

  // 读取 target manifest
  let targetManifest;
  try {
    targetManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    console.error(`❌ 无法解析 manifest: ${e.message}`);
    process.exit(1);
  }

  // 检查回滚日期限制（防止长时间跨度回滚）
  if (!force && targetManifest.matchRange?.to) {
    const today = new Date().toISOString().slice(0, 10);
    const days = daysBetween(targetManifest.matchRange.to, today);
    if (days > MAX_ROLLBACK_DAYS) {
      console.error(`❌ 回滚跨度 ${days} 天（超过 ${MAX_ROLLBACK_DAYS} 天上限）`);
      console.error('   使用 --force 强制回滚');
      process.exit(1);
    }
  }

  // 检查当前 elo-calibrated.json
  if (!existsSync(ELO_CALIBRATED_PATH)) {
    console.error(`❌ 当前 ELO 文件不存在: ${ELO_CALIBRATED_PATH}`);
    process.exit(1);
  }

  // 1. 备份当前 elo-calibrated.json
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const backupPath = ELO_CALIBRATED_PATH.replace('.json', `.pre_rollback_${ts}.json`);
  const currentContent = readFileSync(ELO_CALIBRATED_PATH, 'utf-8');
  writeFileSync(backupPath, currentContent, 'utf-8');
  console.log(`[rollback] ✅ 已备份当前 ELO: ${backupPath}`);

  // 2. 读取 manifest 中的 ratingsBefore
  const ratingsBefore = targetManifest.ratingsBefore || targetManifest.ratings;
  if (!ratingsBefore || Object.keys(ratingsBefore).length === 0) {
    console.error('❌ Manifest 中无可恢复的 ratings 数据');
    console.log('[rollback] 恢复备份...');
    writeFileSync(ELO_CALIBRATED_PATH, currentContent, 'utf-8');
    process.exit(1);
  }

  // 3. 恢复到 manifest 时的状态
  // 保留 current ratings 中不在 manifest 中的队伍
  const currentRatings = JSON.parse(currentContent).ratings || {};
  const mergedRatings = { ...currentRatings, ...ratingsBefore };

  const restoredData = {
    generatedAt: new Date().toISOString(),
    matchesApplied: targetManifest.matchesApplied,
    ratings: mergedRatings,
    method: `rollback-to-${targetManifestId}`,
  };
  writeFileSync(ELO_CALIBRATED_PATH, JSON.stringify(restoredData, null, 2), 'utf-8');
  console.log(`[rollback] ✅ 已恢复 ELO 到 manifest ${targetManifestId} 时的状态`);

  // 4. 归档此 manifest 之后的所有 manifest
  if (!existsSync(ARCHIVE_DIR)) {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
  }

  const allManifests = readdirSync(MANIFESTS_DIR)
    .filter(f => f.startsWith('elo_update_') && f.endsWith('.json'))
    .sort();

  let archivedCount = 0;
  let foundTarget = false;

  for (const f of allManifests) {
    const id = f.replace('.json', '');
    if (id === targetManifestId) {
      foundTarget = true;
      continue;
    }
    if (foundTarget) {
      // 将后续 manifest 移入归档
      const src = resolve(MANIFESTS_DIR, f);
      const dst = resolve(ARCHIVE_DIR, f);
      try {
        renameSync(src, dst);
        archivedCount++;
      } catch (e) {
        console.warn(`[rollback] ⚠️ 无法归档 ${f}: ${e.message}`);
      }
    }
  }

  if (archivedCount > 0) {
    console.log(`[rollback] ✅ 已归档 ${archivedCount} 个后续 manifest 到 _archived/`);
  }

  // 5. 生成回滚记录 manifest
  const rollbackManifest = {
    manifestId: `elo_rollback_${ts}`,
    generatedAt: new Date().toISOString(),
    rollbackTo: targetManifestId,
    rollbackReason: 'manual-rollback',
    rollbackDate: targetManifest.matchRange?.to,
    previousBackup: `elo-calibrated.json.pre_rollback_${ts}.json`,
    generatedBy: 'rollback_elo.mjs v1',
  };
  const rollbackPath = resolve(MANIFESTS_DIR, `elo_rollback_${ts}.json`);
  writeFileSync(rollbackPath, JSON.stringify(rollbackManifest, null, 2), 'utf-8');
  console.log(`[rollback] ✅ 回滚记录: elo_rollback_${ts}.json`);

  console.log(`\n[rollback] 📋 回滚摘要:`);
  console.log(`   恢复到: ${targetManifestId}`);
  console.log(`   原涉及: ${targetManifest.matchesApplied} 场比赛`);
  console.log(`   日期范围: ${targetManifest.matchRange?.from || '?'} → ${targetManifest.matchRange?.to || '?'}`);
  console.log(`   备份文件: elo-calibrated.json.pre_rollback_${ts}.json`);
  console.log(`   归档 manifest: ${archivedCount} 个`);
}

main().catch(err => {
  console.error('[rollback] ❌ 回滚失败:', err.message);
  process.exit(1);
});
