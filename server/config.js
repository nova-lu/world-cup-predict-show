// 足球数据 API 配置
// 从 .env 文件加载 API Key，如未配置则返回 null（降级到本地数据）
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 项目根目录
export const ROOT_DIR = path.resolve(__dirname, '..');
// 数据目录
export const DATA_DIR = path.join(ROOT_DIR, 'data');
// ML 模块目录
export const ML_DIR = path.join(ROOT_DIR, 'server', 'ml');
const envPath = path.resolve(__dirname, '..', '.env');

function parseEnvFile(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    out[key] = val;
  }
  return out;
}

function loadDotEnvIntoProcess() {
  console.log(`[config] 尝试读取 .env: ${envPath}`);
  if (!existsSync(envPath)) {
    console.log(`[config] .env 文件不存在（预期行为，使用环境变量）: ${envPath}`);
    return;
  }

  try {
    const content = readFileSync(envPath, 'utf-8');
    const envMap = parseEnvFile(content);
    for (const [k, v] of Object.entries(envMap)) {
      if (process.env[k] == null || process.env[k] === '') {
        process.env[k] = v;
      }
    }
    console.log(`[config] ✓ .env 已加载 ${Object.keys(envMap).length} 项`);
  } catch (err) {
    console.error('[config] ✗ 读取 .env 失败:', err.message);
  }
}

function loadApiKey() {
  // 从环境变量获取（包含 .env 已注入的变量）
  if (process.env.FOOTBALL_API_KEY) {
    console.log('[config] ✓ 从环境变量获取 FOOTBALL_API_KEY');
    return process.env.FOOTBALL_API_KEY;
  }

  console.warn('[config] ✗ 未找到 FOOTBALL_API_KEY，将使用本地数据降级');
  return null;
}

loadDotEnvIntoProcess();
const key = loadApiKey();
if (!key) {
  console.warn('[config] ⚠️  FOOTBALL_API_KEY 未配置，将使用本地数据降级');
}

export function getApiKey() { return key; }
export function hasApiKey() { return !!key; }