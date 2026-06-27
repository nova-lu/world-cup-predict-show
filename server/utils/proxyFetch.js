/**
 * proxyFetch — 代理感知的 Node.js fetch 封装
 *
 * 解决 Node 18+ 原生 fetch() 不读 HTTPS_PROXY 环境变量的问题。
 * 使用 undici ProxyAgent 实现代理支持。
 *
 * 用法:
 *   import { proxyFetch, proxyGet, proxyPost } from '../utils/proxyFetch.js';
 *   const data = await proxyGet('https://api.example.com/data');
 *
 * 环境变量: HTTPS_PROXY / https_proxy / HTTP_PROXY / http_proxy
 */

import { fetch as undiciFetch, ProxyAgent } from 'undici';

// 读取代理设置 (支持大小写)
const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  '';

const proxyDispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

if (proxyUrl) {
  console.log(`[proxyFetch] 代理模式: ON (${proxyUrl})`);
} else {
  console.log('[proxyFetch] 代理模式: OFF (直连)');
}

/**
 * 带超时的代理感知 fetch
 * @param {string} url - 请求地址
 * @param {object} [opts={}] - 额外选项 (signal, headers, method, body...)
 * @param {number} [timeoutMs=10000] - 超时毫秒, 0=不超时
 * @returns {Promise<Response>}
 */
export async function proxyFetch(url, opts = {}, timeoutMs = 10000) {
  let c, t;
  if (timeoutMs > 0) {
    c = new AbortController();
    t = setTimeout(() => c.abort(), timeoutMs);
  }
  try {
    const merged = { ...opts };
    if (timeoutMs > 0) merged.signal = c.signal;
    if (proxyDispatcher) merged.dispatcher = proxyDispatcher;
    return await undiciFetch(url, merged);
  } finally {
    if (t) clearTimeout(t);
  }
}

/**
 * 快捷 GET（自动解析 JSON）
 * @param {string} url
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<any>}
 */
export async function proxyGet(url, timeoutMs = 10000) {
  const r = await proxyFetch(url, { method: 'GET' }, timeoutMs);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

/**
 * 快捷 POST JSON
 * @param {string} url
 * @param {object} body
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<any>}
 */
export async function proxyPost(url, body, timeoutMs = 10000) {
  const r = await proxyFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}
