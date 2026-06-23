// 足球数据 API 配置
// 从 .env 文件加载 API Key，如未配置则返回 null（降级到本地数据）
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadApiKey() {
  // 1. 优先环境变量
  if (process.env.FOOTBALL_API_KEY) return process.env.FOOTBALL_API_KEY;

  // 2. 尝试 .env 文件
  const envPath = path.resolve(__dirname, '..', '.env');
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx > 0 && trimmed.slice(0, idx).trim() === 'FOOTBALL_API_KEY') {
          const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
          return val || null;
        }
      }
    } catch {}
  }

  return null;
}

const key = loadApiKey();
if (!key) {
  console.warn('[config] FOOTBALL_API_KEY 未配置，将使用本地数据降级');
}

export function getApiKey() { return key; }
export function hasApiKey() { return !!key; }
