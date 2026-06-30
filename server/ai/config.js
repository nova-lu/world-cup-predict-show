// ===== AI 分析引擎配置 =====
// 仅从 .env 和 process.env 读取配置，不依赖任何外部文件

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedConfig = null;

function loadConfig() {
  return {
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'deepseek-v4-flash',
    apiBase: (process.env.AI_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, ''),
    maxTokens: parseInt(process.env.AI_MAX_TOKENS) || 4096,
    temperature: parseFloat(process.env.AI_TEMPERATURE) || 0.3,
    cacheTtl: parseInt(process.env.AI_CACHE_TTL) || 3600,
    timeout: parseInt(process.env.AI_TIMEOUT) || 30000,
  };
}

export default {
  get() {
    if (!cachedConfig) cachedConfig = loadConfig();
    return cachedConfig;
  },
  reload() {
    cachedConfig = loadConfig();
    return cachedConfig;
  },
  enabled() {
    const c = cachedConfig || loadConfig();
    return !!c.apiKey;
  },
};
