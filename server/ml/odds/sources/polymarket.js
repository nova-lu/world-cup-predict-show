/**
 * Polymarket GAMMA API 封装
 * Phase 7.1 — 接入预测市场数据
 *
 * 参考实现: scripts/odds/markets.py
 * GAMMA API: 公开, 无需 API Key
 * CLOB API: 价格历史, 公开
 */
import mlConfig from '../../config.js';
import { get as cacheGet, set as cacheSet } from '../../../middleware/cache.js';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

// 代理支持: 读 HTTPS_PROXY / HTTP_PROXY 环境变量
const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  '';
const proxyDispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
if (proxyUrl) console.log('[polymarket] 代理模式:', proxyUrl);

// Node.js 原生 fetch 不支持 timeout 参数，且不读 HTTPS_PROXY
// 使用 undici fetch + ProxyAgent 实现代理感知超时请求
async function fetchWithTimeout(url, ms = 8000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const opts = { signal: c.signal };
    if (proxyDispatcher) opts.dispatcher = proxyDispatcher;
    return await undiciFetch(url, opts);
  } finally {
    clearTimeout(t);
  }
}

const GAMMA_API = mlConfig.polymarket.gammaApiBase;
const CLOB_API = mlConfig.polymarket.clobApiBase;
const WC_TAG_ID = mlConfig.polymarket.worldCupTagId;

// 队名映射: Polymarket 原始名 → 内部 slug
// 参考 markets.py _PM_NAMES (反向映射)
const PM_NAME_TO_SLUG = {
  'South Korea': 'korea-republic',
  'Korea Republic': 'korea-republic',
  'Czech Republic': 'czech-republic',
  'Czechia': 'czech-republic',
  'Bosnia and Herzegovina': 'bosnia-and-herzegovina',
  'USA': 'usa',
  'United States': 'usa',
  'Turkey': 'türkiye',
  'Türkiye': 'türkiye',
  'Cape Verde': 'cape-verde',
  'Cabo Verde': 'cape-verde',
  'Curaçao': 'curacao',
  'Curacao': 'curacao',
  'Ivory Coast': 'ivory-coast',
  "Côte d'Ivoire": 'ivory-coast',
  'DR Congo': 'dr-congo',
  'Congo DR': 'dr-congo',
};

function nameToSlug(name) {
  return PM_NAME_TO_SLUG[name] || (name || '').toLowerCase().replace(/\s+/g, '-');
}

// 同一球队的不同别名 (内部 slug → 展示名映射)
const SLUG_TO_LABEL = {
  'korea-republic': 'South Korea',
  'czech-republic': 'Czechia',
  'usa': 'USA',
  'türkiye': 'Turkey',
  'cape-verde': 'Cape Verde',
  'curacao': 'Curaçao',
  'ivory-coast': 'Ivory Coast',
  'dr-congo': 'DR Congo',
};

function slugLabel(slug) {
  return SLUG_TO_LABEL[slug] || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function devig(pHome, pDraw, pAway) {
  const s = pHome + pDraw + pAway;
  if (s <= 0.5 || s >= 2.0) return null;
  return { home: pHome / s, draw: pDraw / s, away: pAway / s };
}

// 比赛slug正则 (参考 markets.py GAME_SLUG_RE) — 仅用于判断是否为vs比赛
const GAME_SLUG_RE = /^fifwc-.+-\d{4}-\d{2}-\d{2}$/;
const PM_CACHE_PREFIX = 'pm:';

/**
 * 根据事件的市场类型判断事件分类
 * @param {object} event - GAMMA API 返回的完整事件对象
 * @returns {string} 'match' | 'champion' | 'group' | 'special'
 */
function categorizeEvent(event) {
  if (!event.markets || event.markets.length === 0) return 'special';
  const types = new Set(event.markets.map(m => m.sportsMarketType).filter(Boolean));
  // 胜负赛: 有 moneyline 市场 且标题含 vs
  if (types.has('moneyline') && /vs\.?/i.test(event.title || '')) return 'match';
  // 冠军: 有 champion 类型
  if (types.has('champion') || /winner|champion|cup/i.test(event.title || '')) return 'champion';
  // 小组出线: 有 group 类型 或标题含 group/qualify/advance
  if (types.has('group') || /group|advance|qualify|round/i.test(event.title || '')) return 'group';
  return 'special';
}

/**
 * 拆分比赛标题为球队名 (参考 markets.py _pm_split_title)
 */
function splitTitle(title) {
  const parts = (title || '').split(/\s+vs\.?\s+/i);
  if (parts.length === 2) return [parts[0].trim(), parts[1].trim()];
  return [null, null];
}

/**
 * 获取世界杯所有预测市场事件 (分页处理, 参考 markets.py polymarket_finished_games)
 * @param {string} endDateMin - 开始日期 (默认今天)
 * @param {string} endDateMax - 结束日期 (默认 48小时后)
 * @param {boolean} onlyClosed - 是否只返回已结算事件 (默认 false)
 * @param {number} hoursAhead - 向前看的小时数 (默认 48)
 */
export async function fetchWorldCupEvents(endDateMin = null, endDateMax = null, onlyClosed = false, hoursAhead = 48) {
  const now = new Date();
  if (!endDateMin) endDateMin = now.toISOString().split('.')[0] + 'Z';
  if (!endDateMax) {
    const future = new Date(now.getTime() + hoursAhead * 3600000);
    endDateMax = future.toISOString().split('.')[0] + 'Z';
  }
  const cacheKey = PM_CACHE_PREFIX + 'events:' + (onlyClosed ? 'c' : 'a') + ':' + endDateMin + ':' + endDateMax;
  const cached = cacheGet(cacheKey);
  if (cached.hit) return cached.value;

  const games = [];
  let offset = 0;
  while (true) {
    const params = {
      tag_id: String(WC_TAG_ID),
      end_date_min: endDateMin,
      end_date_max: endDateMax,
      limit: '100', offset: String(offset),
    };
    if (!onlyClosed) params.closed = 'false'; // 明确只拉活跃+未结算事件
    const url = GAMMA_API + '/events?' + new URLSearchParams(params);
    const r = await fetchWithTimeout(url, 15000);
    if (!r.ok) throw new Error('Polymarket API error: ' + r.status);
    const batch = await r.json();
    for (const e of batch) {
      const mtype = categorizeEvent(e);
      games.push({
        slug: e.slug,
        title: e.title,
        kickoff: e.endDate,
        closed: !!e.closed,
        marketType: mtype,
        hasMarkets: (e.markets || []).length > 0,
      });
    }
    if (batch.length < 100) break;
    offset += 100;
  }

  games.sort((a, b) => (a.kickoff || '').localeCompare(b.kickoff || ''));
  cacheSet(cacheKey, games, { source: 'polymarket', ttlMs: mlConfig.polymarket.marketListCacheMs });
  console.log(`[polymarket] 加载 ${games.length} 个事件 (${endDateMin} → ${endDateMax})`);
  return games;
}

/**
 * 获取某场比赛的实际结果 (参考 markets.py polymarket_outcome)
 */
export async function getMatchOutcome(slug) {
  const r = await fetchWithTimeout(GAMMA_API + '/events?' + new URLSearchParams({ slug }), 15000);
  if (!r.ok) return null;
  const events = await r.json();
  if (!events.length) return null;

  const event = events[0];
  const ml = (event.markets || []).filter(m => m.sportsMarketType === 'moneyline');
  const [home, away] = splitTitle(event.title);

  for (const m of ml) {
    const outcomes = JSON.parse(m.outcomes);
    const prices = JSON.parse(m.outcomePrices);
    const yesIdx = outcomes.indexOf('Yes');
    if (yesIdx >= 0 && parseFloat(prices[yesIdx]) > 0.99) {
      const winner = m.groupItemTitle || '';
      if (winner.match(/^draw/i)) {
        return { outcome: 'draw', winner: null, homeTeam: nameToSlug(home), awayTeam: nameToSlug(away) };
      }
      const w = nameToSlug(winner);
      return { outcome: w === nameToSlug(home) ? 'home' : 'away', winner: w, homeTeam: nameToSlug(home), awayTeam: nameToSlug(away) };
    }
  }
  return null;
}

/**
 * 从 CLOB 获取赛前价格 (参考 markets.py _clob_price_before)
 */
async function _clobPriceBefore(tokenId, kickoffTs, fidelity = 3600) {
  const cacheKey = PM_CACHE_PREFIX + 'price:' + tokenId + ':' + kickoffTs;
  const cached = cacheGet(cacheKey);
  if (cached.hit) return cached.value;

  try {
    const url = CLOB_API + '/prices-history?' + new URLSearchParams({
      market: String(tokenId), interval: 'max', fidelity: String(fidelity),
    });
    const r = await fetchWithTimeout(url, 15000);
    if (!r.ok) return null;
    const data = await r.json();
    const history = data.history || [];
    // 只取开赛前的价格点
    const eligible = history.filter(p => parseFloat(p.t) < kickoffTs / 1000);
    if (!eligible.length) return null;
    // 取最接近开赛的 ticks (max timestamp)
    const best = eligible.reduce((a, b) => parseFloat(a.t) > parseFloat(b.t) ? a : b);
    const val = parseFloat(best.p);
    if (val != null) cacheSet(cacheKey, val, { source: 'polymarket', ttlMs: 300000 });
    return val;
  } catch {
    return null;
  }
}

/**
 * 获取赛前隐含 1X2 概率 (去抽水后, 参考 markets.py polymarket_prematch_1x2)
 */
export async function getPrematch1X2(slug, fidelity = 3600) {
  const r = await fetchWithTimeout(GAMMA_API + '/events?' + new URLSearchParams({ slug }), 15000);
  if (!r.ok) return null;
  const events = await r.json();
  if (!events.length) return null;

  const event = events[0];
  const ml = (event.markets || []).filter(m => m.sportsMarketType === 'moneyline');
  if (ml.length !== 3) return null;

  const [home, away] = splitTitle(event.title);
  if (!home || !away) return null;

  const kickoffTs = new Date(event.endDate).getTime();

  const px = {};
  for (const m of ml) {
    const outcomes = JSON.parse(m.outcomes);
    const tokenIds = JSON.parse(m.clobTokenIds);
    const yesIdx = outcomes.indexOf('Yes');
    if (yesIdx < 0) continue;
    const tokenId = tokenIds[yesIdx];
    const price = await _clobPriceBefore(tokenId, kickoffTs, fidelity);
    const name = m.groupItemTitle || '';
    if (name.match(/^draw/i)) {
      px.draw = price;
    } else {
      px[name.trim()] = price;
    }
  }

  if (px[home] == null || px.draw == null || px[away] == null) return null;

  const dv = devig(px[home], px.draw, px[away]);
  if (!dv) return null;

  return {
    home: dv.home,
    draw: dv.draw,
    away: dv.away,
    homeTeam: nameToSlug(home),
    awayTeam: nameToSlug(away),
    rawHome: px[home],
    rawDraw: px.draw,
    rawAway: px[away],
    overround: px[home] + px.draw + px[away],
  };
}

/**
 * 批量获取所有 1X2 事件的价格 (供页面一次性渲染), 并行处理
 * @param {string[]} slugs - 事件 slug 列表
 * @param {number} concurrency - 并发数 (默认 4, 防止 CLOB 限流)
 */
export async function batchPrematchPrices(slugs, fidelity = 3600, concurrency = 4) {
  const results = [];
  // 分块处理以控制并发
  for (let i = 0; i < slugs.length; i += concurrency) {
    const chunk = slugs.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(
      chunk.map(slug => getPrematch1X2(slug, fidelity))
    );
    for (let j = 0; j < chunk.length; j++) {
      const prob = chunkResults[j].value || chunkResults[j].reason;
      if (prob && prob.home != null) {
        results.push({ slug: chunk[j], ...prob });
      }
    }
  }
  return results;
}

/**
 * 获取一个 market 的 24h 成交量 (USDC)
 */
export async function getMarketVolume(slug) {
  const r = await fetchWithTimeout(GAMMA_API + '/events?' + new URLSearchParams({ slug }), 15000);
  if (!r.ok) return null;
  const events = await r.json();
  if (!events.length) return null;
  let totalVolume = 0;
  for (const m of events[0].markets || []) {
    totalVolume += parseFloat(m.volume || 0);
  }
  return totalVolume;
}

/**
 * 更新: matches API中的球队名 → Polymarket 事件匹配
 * 使用 nameToSlug 映射 (支持 USA→usa, South Korea→korea-republic 等)
 */
export function findMatchingEvent(events, t1Slug, t2Slug) {
  for (const ev of events) {
    const parts = splitTitle(ev.title);
    if (parts.length === 2) {
      const e1 = nameToSlug(parts[0]);
      const e2 = nameToSlug(parts[1]);
      if ((e1 === t1Slug && e2 === t2Slug) || (e1 === t2Slug && e2 === t1Slug)) {
        return ev;
      }
    }
  }
  return null;
}
