// 轻量级内存缓存（MVP阶段，后续可替换为Redis）
const store = new Map();
const timers = new Map();

export function set(key, value, ttlMs = 300_000) {
  store.set(key, { value, ts: Date.now() });
  if (timers.has(key)) clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { store.delete(key); timers.delete(key); }, ttlMs));
}

export function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > 300_000) { store.delete(key); return null; }
  return entry.value;
}

export function del(key) { store.delete(key); if (timers.has(key)) { clearTimeout(timers.get(key)); timers.delete(key); } }
export function flush() { store.clear(); timers.forEach(t => clearTimeout(t)); timers.clear(); }
export function stats() { return { size: store.size, keys: [...store.keys()] }; }
