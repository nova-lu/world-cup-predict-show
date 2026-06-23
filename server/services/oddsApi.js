const BASE = 'https://api.odds-api.io/v3';
const WC_LEAGUE = 'international-fifa-world-cup';

// 从 .env 加载 ODDS_API_KEY（如果尚未设置）
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function ensureOddsApiKey() {
  if (process.env.ODDS_API_KEY) return;
  const envPath = path.resolve(__dirname, '..', '..', '.env');
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx > 0 && trimmed.slice(0, idx).trim() === 'ODDS_API_KEY') {
          process.env.ODDS_API_KEY = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
          break;
        }
      }
    } catch {}
  }
}
ensureOddsApiKey();

// Odds-API team name → model slug 映射
// Odds-API 使用更自然的队名，部分与 football-data.org 不同
const ODDS_TO_MODEL = {
  'Congo DR': 'dr-congo',
  'Bosnia and Herzegovina': 'bosnia-and-herzegovina',
  'Korea Republic': 'korea-republic',
  'Turkiye': 'türkiye',
  'Ivory Coast': 'ivory-coast',
  'Czechia': 'czech-republic',
  'Cape Verde': 'cape-verde',
  'New Zealand': 'new-zealand',
  'Saudi Arabia': 'saudi-arabia',
  'South Africa': 'south-africa',
  'USA': 'usa',
};

// 推荐使用的博彩公司
const DEFAULT_BOOKMAKERS = [
  'Bet365', 'Unibet', 'William Hill', 'Pinnacle',
  'Bwin ES', 'DafaBet', '10BET', 'Betfair ES'
];

let cachedEvents = null;
let cachedEventsAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

/**
 * 获取 API Key
 */
function getApiKey() {
  return process.env.ODDS_API_KEY || '';
}

/**
 * Team name → model slug 转换
 */
function teamToSlug(oddsName) {
  if (ODDS_TO_MODEL[oddsName]) return ODDS_TO_MODEL[oddsName];
  // 默认：小写、空格转连字符
  return oddsName.toLowerCase().replace(/\s+/g, '-');
}

/**
 * 通用 API 请求
 */
const RATE_LIMIT_CACHE = new Map(); // path -> { data, at }
async function request(path) {
  const key = getApiKey();
  if (!key) throw new Error('ODDS_API_KEY 未配置');
  
  // 检查速率限制缓存（30秒内不重试）
  const cached = RATE_LIMIT_CACHE.get(path);
  if (cached && (Date.now() - cached.at) < 30000) {
    throw new Error(`速率限制中，请稍后重试 (上次 429 于 ${Math.round((Date.now()-cached.at)/1000)}s 前)`);
  }
  
  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}${path}${sep}apiKey=${key}`;

  const res = await fetch(url, { timeout: 10000 });
  
  // 处理 429 速率限制
  if (res.status === 429) {
    RATE_LIMIT_CACHE.set(path, { at: Date.now() });
    const body = await res.text().catch(() => '');
    throw new Error(`Odds-API 429 (速率限制，免费层 100 次/小时): ${body.slice(0, 100)}`);
  }
  
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Odds-API ${res.status}: ${body.slice(0, 150)}`);
  }
  return res.json();
}

/**
 * 获取所有世界杯事件（含缓存）
 */
async function fetchWcEvents(force = false) {
  const now = Date.now();
  if (!force && cachedEvents && (now - cachedEventsAt) < CACHE_TTL) {
    return cachedEvents;
  }
  
  const events = await request(`/events?sport=football&league=${WC_LEAGUE}&limit=100`);
  // 筛选 pending 且有真实队名的赛事（排除占位符事件如 "W73 vs W75"）
  const realEvents = events.filter(e => {
    if (e.status !== 'pending') return false;
    const home = e.home || '';
    const away = e.away || '';
    // 排除占位符：如 "2A", "W73", "RU101", "3A/3B/3C"
    return /^[A-Za-zÀ-ÿ\s'-]+$/.test(home) && /^[A-Za-zÀ-ÿ\s'-]+$/.test(away)
      && !/^\d/.test(home) && !/^\d/.test(away);
  });

  // 添加 slug 字段
  realEvents.forEach(e => {
    e.homeSlug = teamToSlug(e.home);
    e.awaySlug = teamToSlug(e.away);
  });

  cachedEvents = realEvents;
  cachedEventsAt = now;
  return realEvents;
}

/**
 * 根据球队 slug 查找对应的事件 ID
 */
async function findEventId(homeSlug, awaySlug) {
  const events = await fetchWcEvents();
  
  // 尝试精确匹配
  const match = events.find(e =>
    e.homeSlug === homeSlug && e.awaySlug === awaySlug
  );
  if (match) return match.id;
  
  // 尝试交换匹配
  const swapped = events.find(e =>
    e.homeSlug === awaySlug && e.awaySlug === homeSlug
  );
  if (swapped) return swapped.id;
  
  return null;
}

/**
 * 获取某场比赛的赔率
 */
async function fetchOddsForMatch(homeSlug, awaySlug) {
  const eventId = await findEventId(homeSlug, awaySlug);
  if (!eventId) return null;

  const bm = DEFAULT_BOOKMAKERS[0]; // 先只用 Bet365 减少请求
  const data = await request(`/odds?eventId=${eventId}&bookmakers=${encodeURIComponent(bm)}`);
  if (!data || !data.bookmakers) return null;

  const odds = extractOdds(data);
  if (!odds) return null;

  return {
    eventId,
    home: data.home,
    away: data.away,
    status: data.status,
    date: data.date,
    bookmakers: odds,
    // 最佳赔率（多博彩公司时取最优）
    best: calculateBest(odds),
  };
}

/**
 * 批量获取所有可赔率的世界杯比赛
 */
async function fetchAllAvailableOdds() {
  const events = await fetchWcEvents();
  const results = [];

  // 分批获取，每批最多3个并发
  for (let i = 0; i < events.length; i += 3) {
    const batch = events.slice(i, i + 3);
    const promises = batch.map(async (e) => {
      try {
        const data = await request(`/odds?eventId=${e.id}&bookmakers=Bet365`);
        if (!data || !data.bookmakers) return null;
        const r = extractSimpleOdds(data, e);
        if (!r) console.log('[oddsApi] extractSimpleOdds returned null for', e.home, 'vs', e.away);
        return r;
      } catch (err) {
        console.log('[oddsApi] fetch failed for', e.home, 'vs', e.away, ':', err.message.slice(0,80));
        return null;
      }
    });
    const batchResults = await Promise.all(promises);
    results.push(...batchResults.filter(Boolean));
    // 限速：每批间隔 500ms
    if (i + 3 < events.length) await new Promise(r => setTimeout(r, 500));
  }

  return results;
}

/**
 * 从 Odds-API 响应中提取 ML 赔率
 */
function extractOdds(data) {
  const result = {};
  for (const [bmName, markets] of Object.entries(data.bookmakers || {})) {
    for (const market of markets) {
      if (market.name === 'ML' && market.odds && market.odds[0]) {
        const o = market.odds[0];
        result[bmName] = {
          home: parseFloat(o.home) || 0,
          draw: parseFloat(o.draw) || 0,
          away: parseFloat(o.away) || 0,
          // 隐含概率（含庄家抽水）
          probHome: +(1 / parseFloat(o.home) * 100).toFixed(1) || 0,
          probDraw: +(1 / parseFloat(o.draw) * 100).toFixed(1) || 0,
          probAway: +(1 / parseFloat(o.away) * 100).toFixed(1) || 0,
          updatedAt: market.updatedAt,
        };
      }
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * 简化的批量赔率提取
 */
function extractSimpleOdds(data, event) {
  const odds = extractOdds(data);
  if (!odds) return null;

  // 计算平均赔率
  let homeSum = 0, drawSum = 0, awaySum = 0, count = 0;
  for (const o of Object.values(odds)) {
    homeSum += o.home;
    drawSum += o.draw;
    awaySum += o.away;
    count++;
  }

  const avg = {
    home: +(homeSum / count).toFixed(3),
    draw: +(drawSum / count).toFixed(3),
    away: +(awaySum / count).toFixed(3),
  };

  // 最佳赔率
  let bestHome = 0, bestDraw = 0, bestAway = 0;
  let bestHomeBm = '', bestDrawBm = '', bestAwayBm = '';
  for (const [bm, o] of Object.entries(odds)) {
    if (o.home > bestHome) { bestHome = o.home; bestHomeBm = bm; }
    if (o.draw > bestDraw) { bestDraw = o.draw; bestDrawBm = bm; }
    if (o.away > bestAway) { bestAway = o.away; bestAwayBm = bm; }
  }

  return {
    eventId: event.id,
    homeSlug: event.homeSlug,
    awaySlug: event.awaySlug,
    homeTeam: event.home,
    awayTeam: event.away,
    date: event.date,
    dateStr: event.date ? event.date.slice(0, 10) : '',
    timeStr: event.date ? event.date.slice(11, 16) : '',
    bookmakers: Object.keys(odds).length,
    avg,
    best: { home: bestHome, draw: bestDraw, away: bestAway },
    bestBm: { home: bestHomeBm, draw: bestDrawBm, away: bestAwayBm },
    // 去抽水后的隐含概率
    fairProb: calculateFairProb(avg),
  };
}

/**
 * 计算多博彩公司最佳赔率
 */
function calculateBest(odds) {
  if (!odds || Object.keys(odds).length === 0) return {};
  let bestHome = 0, bestDraw = 0, bestAway = 0;
  let bestHomeBm = '', bestDrawBm = '', bestAwayBm = '';
  for (const [bm, o] of Object.entries(odds)) {
    if (o.home > bestHome) { bestHome = o.home; bestHomeBm = bm; }
    if (o.draw > bestDraw) { bestDraw = o.draw; bestDrawBm = bm; }
    if (o.away > bestAway) { bestAway = o.away; bestAwayBm = bm; }
  }
  return { home: bestHome, draw: bestDraw, away: bestAway, homeBm: bestHomeBm, drawBm: bestDrawBm, awayBm: bestAwayBm };
}

/**
 * 去抽水隐含概率计算（将博彩公司抽水均摊）
 */
function calculateFairProb(odds) {
  if (!odds || !odds.home || !odds.draw || !odds.away) return null;
  const rawHome = 1 / odds.home;
  const rawDraw = 1 / odds.draw;
  const rawAway = 1 / odds.away;
  const margin = rawHome + rawDraw + rawAway;

  return {
    winHome: +((rawHome / margin) * 100).toFixed(1),
    draw: +((rawDraw / margin) * 100).toFixed(1),
    winAway: +((rawAway / margin) * 100).toFixed(1),
    margin: +((margin - 1) * 100).toFixed(2),
  };
}

/**
 * Odds → 隐含概率（简易，不含去抽水）
 */
function oddsToProb(decimalOdds) {
  if (!decimalOdds || decimalOdds <= 1) return null;
  return +(1 / decimalOdds * 100).toFixed(1);
}

/**
 * 多条赔率平均
 */
function averageOdds(oddsList) {
  if (!oddsList || oddsList.length === 0) return null;
  const clean = oddsList.filter(o => o && o > 1);
  if (clean.length === 0) return null;
  const sum = clean.reduce((a, b) => a + b, 0);
  return +(sum / clean.length).toFixed(2);
}

/**
 * 清除缓存
 */
function clearCache() {
  cachedEvents = null;
  cachedEventsAt = 0;
}

export {
  fetchWcEvents,
  fetchOddsForMatch,
  fetchAllAvailableOdds,
  findEventId,
  extractOdds,
  extractSimpleOdds,
  calculateFairProb,
  oddsToProb,
  averageOdds,
  teamToSlug,
  clearCache,
  DEFAULT_BOOKMAKERS,
};
