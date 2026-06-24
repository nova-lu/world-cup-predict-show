// ===== 统一缓存中间件 (L1 内存 + L2 文件) =====
// 功能：两级持久缓存、雪崩防护（stampede）、force 强制刷新、过期降级

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '..', '..', 'data', 'cache');
const DEFAULT_TTL = 30 * 60 * 1000; // 30 分钟

// ===== L1: 内存存储 =====
const L1 = new Map();               // key -> { value, meta }
const locks = new Map();            // key -> Promise (stampede 保护)

// ===== 工具函数 =====

function safeKey(key) {
  return key.replace(/[:/]/g, '_').replace(/[^a-zA-Z0-9_\-.]/g, '_');
}

function filePath(key) {
  return path.join(CACHE_DIR, safeKey(key) + '.json');
}

function now() {
  return new Date().toISOString();
}

// ===== 核心 API =====

/**
 * 从缓存获取数据
 * @param {string} key - 缓存键
 * @param {object} [options]
 * @param {boolean} [options.force] - 强制跳过缓存直接返回未命中
 * @param {number} [options.ttlMs] - TTL（仅用于判断过期，默认 30min）
 * @param {boolean} [options.skipL2] - 跳过 L2 文件读取（只查 L1）
 * @returns {{ value: any, meta: object|null, hit: boolean }}
 */
export function get(key, options = {}) {
  const { force = false, ttlMs = DEFAULT_TTL } = options;

  if (force) {
    return { value: null, meta: null, hit: false };
  }

  // L1 内存查询
  const l1 = L1.get(key);
  if (l1) {
    const age = Date.now() - new Date(l1.meta.createdAt).getTime();
    if (age < ttlMs) {
      l1.meta.updatedAt = now();
      return { value: l1.value, meta: l1.meta, hit: true };
    }
    // L1 过期，删除
    L1.delete(key);
  }

  return { value: null, meta: null, hit: false };
}

/**
 * 写入缓存
 * @param {string} key
 * @param {any} value
 * @param {object} [meta]
 * @param {string} [meta.source='manual'] - 数据来源（'api' | 'computed' | 'manual'）
 * @param {number} [meta.ttlMs] - 自定义 TTL，默认 DEFAULT_TTL
 */
export function set(key, value, meta = {}) {
  const entryMeta = {
    createdAt: meta.createdAt || now(),
    updatedAt: now(),
    ttlMs: meta.ttlMs || DEFAULT_TTL,
    source: meta.source || 'manual',
  };

  const entry = { value, meta: entryMeta };

  // 写入 L1
  L1.set(key, entry);

  // 异步写入 L2 文件（不阻塞返回）
  writeL2(key, entry).catch(err => {
    console.warn(`[Cache] L2 写入失败 ${key}:`, err.message);
  });

  return entry;
}

/**
 * 异步写入 L2 文件
 */
async function writeL2(key, entry) {
  const fp = filePath(key);
  const data = JSON.stringify(entry, null, 2);
  await fsp.mkdir(path.dirname(fp), { recursive: true });
  // 原子写入：先写临时文件再 rename
  const tmp = fp + '.tmp';
  await fsp.writeFile(tmp, data, 'utf-8');
  await fsp.rename(tmp, fp);
}

/**
 * 从 L2 文件读取（主要用于 initCache 初始化）
 */
async function readL2(key) {
  const fp = filePath(key);
  try {
    const raw = await fsp.readFile(fp, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.value || !parsed.meta) return null;
    const age = Date.now() - new Date(parsed.meta.createdAt).getTime();
    if (age > (parsed.meta.ttlMs || DEFAULT_TTL)) {
      // 过期，删除文件
      await fsp.unlink(fp).catch(() => {});
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 缓存雪崩防护：获取或生成，同一键并发只穿透一次
 * @param {string} key
 * @param {function} fetcher - 异步函数，负责从远程获取数据
 * @param {object} [options]
 * @param {boolean} [options.force]
 * @param {number} [options.ttlMs]
 * @param {object} [options.meta]
 * @returns {Promise<{ value: any, meta: object, hit: boolean }>}
 */
export async function getOrFetch(key, fetcher, options = {}) {
  const { force = false, ttlMs = DEFAULT_TTL, meta = {} } = options;

  // 非强制刷新时检查缓存
  if (!force) {
    const cached = get(key, { ttlMs });
    if (cached.hit) return cached;
  }

  // stampede 保护：同一键正在获取中则等待
  const existingLock = locks.get(key);
  if (existingLock && !force) {
    try {
      const result = await existingLock;
      return { value: result.value, meta: result.meta, hit: true };
    } catch {
      // 锁中的请求失败了，继续尝试新请求
    }
  }

  // 创建新锁
  const promise = (async () => {
    try {
      const value = await fetcher();
      const resultMeta = {
        createdAt: now(),
        updatedAt: now(),
        ttlMs,
        source: meta.source || 'fetcher',
      };
      L1.set(key, { value, meta: resultMeta });
      writeL2(key, { value, meta: resultMeta }).catch(err => {
        console.warn(`[Cache] L2 写入失败 ${key}:`, err.message);
      });
      return { value, meta: resultMeta };
    } finally {
      locks.delete(key);
    }
  })();

  locks.set(key, promise);
  return { value: (await promise).value, meta: (await promise).meta, hit: false };
}

/**
 * 删除单个键
 */
export function del(key) {
  L1.delete(key);
  locks.delete(key);
  const fp = filePath(key);
  fsp.unlink(fp).catch(() => {});
}

/**
 * 按模式删除键（支持 glob 风格的 * 通配符）
 */
export function delPattern(pattern) {
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  const matched = [];
  for (const key of L1.keys()) {
    if (regex.test(key)) {
      matched.push(key);
    }
  }
  for (const key of matched) {
    del(key);
  }

  // 也扫描 L2 文件删除匹配的
  try {
    const files = fs.readdirSync(CACHE_DIR);
    const patternSafe = safeKey(pattern).replace(/_/g, '[_]').replace(/\*/g, '.*');
    const fileRegex = new RegExp('^' + patternSafe + '\\.json$');
    for (const f of files) {
      if (fileRegex.test(f)) {
        fsp.unlink(path.join(CACHE_DIR, f)).catch(() => {});
      }
    }
  } catch {}
}

/**
 * 清空所有缓存
 */
export function flush() {
  L1.clear();
  locks.clear();
  try {
    const files = fs.readdirSync(CACHE_DIR);
    for (const f of files) {
      if (f.endsWith('.json')) {
        fsp.unlink(path.join(CACHE_DIR, f)).catch(() => {});
      }
    }
  } catch {}
}

/**
 * 缓存统计
 */
export function stats() {
  const entries = [];
  let totalDiskSize = 0;
  let diskFileCount = 0;

  try {
    if (fs.existsSync(CACHE_DIR)) {
      const files = fs.readdirSync(CACHE_DIR);
      for (const f of files) {
        if (f.endsWith('.json')) {
          diskFileCount++;
          try {
            const stat = fs.statSync(path.join(CACHE_DIR, f));
            totalDiskSize += stat.size;
          } catch {}
        }
      }
    }
  } catch {}

  for (const [key, entry] of L1.entries()) {
    const age = Date.now() - new Date(entry.meta.createdAt).getTime();
    entries.push({
      key,
      age,
      ttl: entry.meta.ttlMs,
      remaining: Math.max(0, entry.meta.ttlMs - age),
      source: entry.meta.source,
      createdAt: entry.meta.createdAt,
    });
  }

  return {
    status: 'ok',
    memory: {
      size: L1.size,
      entries,
    },
    disk: {
      path: CACHE_DIR,
      fileCount: diskFileCount,
      totalSize: totalDiskSize,
    },
  };
}

/**
 * 判断缓存是否过期
 */
export function isStale(key) {
  const l1 = L1.get(key);
  if (!l1) return true;
  const age = Date.now() - new Date(l1.meta.createdAt).getTime();
  return age > (l1.meta.ttlMs || DEFAULT_TTL);
}

/**
 * 构建 _cache 元信息对象
 * @param {string} key
 * @param {boolean} hit
 * @param {object|null} meta
 * @param {boolean} [degraded]
 * @param {boolean} [forceFailed]
 * @returns {object}
 */
export function buildCacheMeta(key, hit, meta, { degraded = false, forceFailed = false } = {}) {
  if (!meta) {
    return { hit: false, key };
  }
  const age = Date.now() - new Date(meta.createdAt).getTime();
  return {
    hit,
    key,
    age,
    ttl: meta.ttlMs,
    remaining: Math.max(0, meta.ttlMs - age),
    staleAfter: new Date(new Date(meta.createdAt).getTime() + meta.ttlMs).toISOString(),
    createdAt: meta.createdAt,
    source: meta.source,
    _degraded: degraded || undefined,
    _forceFailed: forceFailed || undefined,
  };
}

// ===== 初始化：扫描 L2 加载到 L1 =====
export async function initCache() {
  console.log('[Cache] 初始化缓存...');
  try {
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    const files = await fsp.readdir(CACHE_DIR);
    let loaded = 0;
    for (const f of files) {
      if (!f.endsWith('.json') || f.endsWith('.tmp')) continue;
      const keyRaw = f.replace(/\.json$/, '');
      // 逆 safeKey：查找 L1 键
      // 由于 safeKey 是单向变换，我们直接读文件内容获取原始 key
      try {
        const fp = path.join(CACHE_DIR, f);
        const raw = await fsp.readFile(fp, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.meta || !parsed.meta.createdAt) continue;
        const age = Date.now() - new Date(parsed.meta.createdAt).getTime();
        if (age > (parsed.meta.ttlMs || DEFAULT_TTL)) {
          // 过期删除
          await fsp.unlink(fp).catch(() => {});
          continue;
        }
        // 直接从文件内容提取 key，或者从文件名推断
        const entryKey = parsed.meta._originalKey || parsed.key || keyRaw;
        L1.set(entryKey, { value: parsed.value, meta: parsed.meta });
        loaded++;
      } catch (e) {
        // 文件损坏，删除
        try { await fsp.unlink(path.join(CACHE_DIR, f)); } catch {}
      }
    }
    console.log(`[Cache] 初始化完成，从磁盘加载 ${loaded} 项缓存到 L1`);
  } catch (err) {
    console.warn('[Cache] 初始化异常:', err.message);
  }
}

// 启动时自动初始化（异步非阻塞）
initCache().catch(err => {
  console.warn('[Cache] 自动初始化失败:', err.message);
});
