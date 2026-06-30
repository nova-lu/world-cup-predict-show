/**
 * Phase 11 — 运营管理 API 路由
 *
 * 提供 ELO 管理、数据新鲜度、系统监控的 REST API。
 * 所有后台操作通过子进程调用已有脚本。
 */
import { Router } from 'express';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const MANIFESTS_DIR = resolve(PROJECT_ROOT, 'data', 'elo-manifests');
const CHINA_LOTTERY_DIR = resolve(PROJECT_ROOT, 'data', 'odds', 'china-sports-lottery');

const router = Router();

// ========== ELO Manifests ==========

/**
 * GET /api/admin/elo/manifests
 * 读取 data/elo-manifests/ 目录，返回所有 manifest 列表（倒序）
 */
router.get('/elo/manifests', (req, res) => {
  try {
    if (!existsSync(MANIFESTS_DIR)) {
      return res.json({ total: 0, manifests: [] });
    }

    const manifests = [];
    const files = readdirSync(MANIFESTS_DIR);

    for (const file of files) {
      if (!file.endsWith('.json') || file.startsWith('_')) continue;
      const fp = join(MANIFESTS_DIR, file);
      try {
        const raw = readFileSync(fp, 'utf-8');
        const data = JSON.parse(raw);
        manifests.push({
          manifestId: data.manifestId || file.replace('.json', ''),
          generatedAt: data.generatedAt || statSync(fp).mtime.toISOString(),
          matchesApplied: data.matchesApplied || (data.matchDetails ? data.matchDetails.length : 0),
          matchRange: data.matchRange || null,
          topMovers: (data.topMovers || []).slice(0, 3),
          matchDetails: (data.matchDetails || []).slice(0, 5),
          file,
        });
      } catch { /* skip invalid files */ }
    }

    // 按时间倒序
    manifests.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));

    res.json({ total: manifests.length, manifests });
  } catch (e) {
    res.status(500).json({ error: '读取 manifest 失败', message: e.message });
  }
});

/**
 * GET /api/admin/elo/manifests/:id
 * 读取单个 manifest 完整内容
 */
router.get('/elo/manifests/:id', (req, res) => {
  try {
    const { id } = req.params;
    const file = join(MANIFESTS_DIR, id.endsWith('.json') ? id : id + '.json');
    if (!existsSync(file)) {
      // 尝试匹配任何包含此 id 的文件
      const files = readdirSync(MANIFESTS_DIR).filter(f => f.includes(id) && f.endsWith('.json'));
      if (files.length === 0) return res.status(404).json({ error: 'manifest 未找到' });
      const raw = readFileSync(join(MANIFESTS_DIR, files[0]), 'utf-8');
      return res.json(JSON.parse(raw));
    }
    const raw = readFileSync(file, 'utf-8');
    res.json(JSON.parse(raw));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/admin/elo/update
 * 执行 ELO 批量更新
 * Body: { fromDate?: string } — 默认为 "auto"（自动检测上次更新时间）
 */
router.post('/elo/update', (req, res) => {
  try {
    const fromDate = req.body?.fromDate || 'auto';
    const scriptPath = resolve(PROJECT_ROOT, 'server/ml/elo/update_elo_from_results.mjs');

    const cmd = fromDate === 'auto'
      ? `node "${scriptPath}"`
      : `node "${scriptPath}" --from ${fromDate}`;

    console.log(`[admin] 执行 ELO 更新: ${cmd}`);
    const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });

    // 提取结果
    const matchCount = output.match(/匹配到 (\d+) 场|找到 (\d+) 场未处理|matchesApplied: (\d+)/i);
    const applied = matchCount ? parseInt(matchCount[1] || matchCount[2] || matchCount[3], 10) : 0;

    res.json({
      success: true,
      matchesApplied: applied,
      message: applied > 0 ? `成功更新 ${applied} 场比赛的 ELO 评分` : '无新增比赛需要更新',
      log: output.split('\n').filter(l => l.trim()).slice(-10),
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: 'ELO 更新失败',
      message: e.message,
      stderr: e.stderr ? e.stderr.toString().split('\n').slice(-5).join('\n') : '',
    });
  }
});

/**
 * POST /api/admin/elo/rollback
 * 回滚 ELO 到指定 manifest 版本
 * Body: { manifestId: string }
 */
router.post('/elo/rollback', (req, res) => {
  try {
    const { manifestId } = req.body;
    if (!manifestId) return res.status(400).json({ error: '缺少 manifestId 参数' });

    const scriptPath = resolve(PROJECT_ROOT, 'scripts/rollback_elo.mjs');
    const cmd = `node "${scriptPath}" --to "${manifestId}"`;

    console.log(`[admin] 执行 ELO 回滚: ${cmd}`);
    const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });

    res.json({
      success: true,
      rolledBackTo: manifestId,
      message: `已回滚到 ${manifestId}`,
      log: output.split('\n').filter(l => l.trim()).slice(-5),
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: 'ELO 回滚失败',
      message: e.message,
      stderr: e.stderr ? e.stderr.toString().split('\n').slice(-5).join('\n') : '',
    });
  }
});

/**
 * POST /api/admin/elo/shrink
 * 执行 ELO 回缩
 * Body: { rate?: number } — 回缩速率，默认 0.015，范围 0.005~0.05
 */
router.post('/elo/shrink', (req, res) => {
  try {
    let rate = parseFloat(req.body?.rate) || 0.015;
    rate = Math.max(0.005, Math.min(0.05, rate));

    const scriptPath = resolve(PROJECT_ROOT, 'scripts/shrink_elo.mjs');
    const cmd = `node "${scriptPath}" --rate ${rate}`;

    console.log(`[admin] 执行 ELO 回缩: ${cmd}`);
    const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });

    res.json({
      success: true,
      rate,
      message: `ELO 评分已回缩 (速率: ${rate})`,
      log: output.split('\n').filter(l => l.trim()).slice(-5),
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: 'ELO 回缩失败',
      message: e.message,
      stderr: e.stderr ? e.stderr.toString().split('\n').slice(-5).join('\n') : '',
    });
  }
});

// ========== 数据管理 ==========

/**
 * POST /api/admin/data/export-features
 * 一键导出特征数据
 */
router.post('/data/export-features', (req, res) => {
  try {
    const scriptPath = resolve(PROJECT_ROOT, 'scripts/export_features.mjs');
    const cmd = `node "${scriptPath}"`;

    console.log(`[admin] 导出特征: ${cmd}`);
    const output = execSync(cmd, { timeout: 120000, encoding: 'utf-8' });

    res.json({
      success: true,
      message: '特征数据导出完成',
      log: output.split('\n').filter(l => l.trim()).slice(-5),
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: '特征导出失败',
      message: e.message,
      stderr: e.stderr ? e.stderr.toString().split('\\n').slice(-5).join('\\n') : '',
    });
  }
});

// ========== 竞彩数据状态 ==========

/**
 * GET /api/admin/odds/china-lottery/status
 * 返回竞彩离线数据的状态
 */
router.get('/odds/china-lottery/status', (req, res) => {
  try {
    if (!existsSync(CHINA_LOTTERY_DIR)) {
      return res.json({ available: false, files: 0, matchCount: 0, message: '目录不存在' });
    }

    const files = readdirSync(CHINA_LOTTERY_DIR)
      .filter(f => /^\d{8}\.json$/.test(f))
      .sort()
      .reverse();

    if (files.length === 0) {
      return res.json({ available: false, files: 0, matchCount: 0, lastDate: null });
    }

    const latest = join(CHINA_LOTTERY_DIR, files[0]);
    const raw = readFileSync(latest, 'utf-8');
    const data = JSON.parse(raw);
    const matches = Array.isArray(data) ? data : (data.matches || []);

    res.json({
      available: true,
      files: files.length,
      matchCount: matches.length,
      lastDate: files[0].replace(/^(\d{4})(\d{2})(\d{2})\.json$/, '$1-$2-$3'),
      lastFile: files[0],
      lastModified: statSync(latest).mtime.toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: '读取竞彩数据失败', message: e.message });
  }
});

/**
 * POST /api/admin/odds/china-lottery/fetch
 * 触发抓取竞彩网最新赔率
 */
router.post('/odds/china-lottery/fetch', (req, res) => {
  const scriptPath = resolve(PROJECT_ROOT, 'scripts', 'fetch_china_lottery.mjs');
  if (!existsSync(scriptPath)) {
    return res.status(500).json({ success: false, error: '脚本文件不存在' });
  }

  try {
    // execSync on Windows Node.js may crash after script completion (uv assertion bug)
    // so we use try-catch and check stdout for success
    let stdout = '';
    try {
      stdout = execSync(`node "${scriptPath}"`, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        encoding: 'utf-8',
      });
    } catch (e) {
      stdout = e.stdout || '';
    }

    const lines = stdout.split('\n').filter(l => l.includes('[China Lottery]'));
    const hasData = stdout.includes('成功获取');
    const updated = !stdout.includes('数据无变化，跳过');

    if (!hasData) {
      throw new Error(stdout.slice(0, 300) || '脚本无输出');
    }

    res.json({
      success: true,
      message: updated ? '赔率数据已更新' : '数据已是最新，无需更新',
      output: lines.slice(0, 5),
    });
  } catch (e) {
    const errMsg = (e.stderr || e.stdout || e.message || '未知错误').toString().slice(0, 500);
    res.status(500).json({
      success: false,
      error: '抓取失败',
      message: errMsg,
    });
  }
});

export default router;
