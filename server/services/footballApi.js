// football-data.org API 集成服务
// 负责：赛程拉取、结果同步、小组积分榜、球队映射

import { getApiKey } from '../config.js';
import { get, set } from '../middleware/cache.js';
import dnsPromises from 'node:dns/promises';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const BASE = 'https://api.football-data.org/v4';
const COMPETITION_ID = 2000;

const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  '';

const proxyDispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

console.log(`[footballApi] Node ${process.version}`);
console.log(`[footballApi] 代理模式: ${proxyUrl ? `ON (${proxyUrl})` : 'OFF (直连)'}`);

// ===== Team Name Mapping (API → Model Slug) =====
const TEAM_NAME_MAP = {
  'Mexico': 'mexico',
  'South Africa': 'south-africa',
  'South Korea': 'south-korea',
  'Czechia': 'czech-republic',
  'Canada': 'canada',
  'Bosnia-Herzegovina': 'bosnia-and-herzegovina',
  'Qatar': 'qatar',
  'Switzerland': 'switzerland',
  'Brazil': 'brazil',
  'Morocco': 'morocco',
  'Haiti': 'haiti',
  'Scotland': 'scotland',
  'United States': 'usa',
  'Paraguay': 'paraguay',
  'Australia': 'australia',
  'Turkey': 'turkey',
  'Germany': 'germany',
  'Curaçao': 'curacao',
  'Ivory Coast': 'ivory-coast',
  'Ecuador': 'ecuador',
  'Netherlands': 'netherlands',
  'Japan': 'japan',
  'Sweden': 'sweden',
  'Tunisia': 'tunisia',
  'Belgium': 'belgium',
  'Egypt': 'egypt',
  'Iran': 'iran',
  'New Zealand': 'new-zealand',
  'Spain': 'spain',
  'Cape Verde Islands': 'cape-verde',
  'Saudi Arabia': 'saudi-arabia',
  'Uruguay': 'uruguay',
  'France': 'france',
  'Senegal': 'senegal',
  'Iraq': 'iraq',
  'Norway': 'norway',
  'Argentina': 'argentina',
  'Algeria': 'algeria',
  'Jordan': 'jordan',
  'Austria': 'austria',
  'England': 'england',
  'Croatia': 'croatia',
  'Uzbekistan': 'uzbekistan',
  'Ghana': 'ghana',
  'Portugal': 'portugal',
  'Congo DR': 'dr-congo',
  'Colombia': 'colombia',
  'Panama': 'panama',
};

// 反向映射 (slug → API name)
const SLUG_TO_API = {};
for (const [api, slug] of Object.entries(TEAM_NAME_MAP)) {
  SLUG_TO_API[slug] = api;
}

export function apiToSlug(apiName) {
  return TEAM_NAME_MAP[apiName] || apiName?.toLowerCase().replace(/\s+/g, '-') || null;
}

export function slugToApi(slug) {
  return SLUG_TO_API[slug] || slug;
}

// ===== API 调用封装（增强诊断） =====
async function apiFetch(path) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('FOOTBALL_API_KEY 未配置');

  const url = `${BASE}${path}`;
  const timeoutMs = Number(process.env.FOOTBALL_API_TIMEOUT_MS || 20000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('HTTPS request timeout')), timeoutMs);

  try {
    console.log(`[footballApi] 请求: ${url}`);
    const resp = await undiciFetch(url, {
      dispatcher: proxyDispatcher,
      headers: { 'X-Auth-Token': apiKey },
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      if (resp.status === 403) {
        console.error('[footballApi] 403: 代理链路可能已通，但 token 无效或套餐权限不足');
      }
      throw new Error(`API ${resp.status}: ${body.slice(0, 300)}`);
    }

    const json = await resp.json();

    const rateRemain = resp.headers.get('x-requests-available') || '?';
    const rateMinute = resp.headers.get('x-requestcounter-minute') || '?';
    console.log(`[footballApi] ✓ ${path} — 剩余:${rateRemain}/分:${rateMinute}`);

    return json;
  } catch (err) {
    console.error(`[footballApi] ✗ 请求失败 ${url}`);
    console.error('[footballApi] name=', err?.name);
    console.error('[footballApi] message=', err?.message);
    console.error('[footballApi] code=', err?.code);
    console.error('[footballApi] errno=', err?.errno);
    console.error('[footballApi] syscall=', err?.syscall);
    console.error('[footballApi] address=', err?.address);
    console.error('[footballApi] port=', err?.port);
    if (err?.cause) {
      console.error('[footballApi] cause=', err.cause);
      console.error('[footballApi] cause.code=', err.cause?.code);
      console.error('[footballApi] cause.message=', err.cause?.message);
    }

    const code = err?.code || err?.cause?.code;
    if (code === 'ENOTFOUND') {
      try {
        const host = new URL(url).hostname;
        const [v4, v6] = await Promise.allSettled([dnsPromises.resolve4(host), dnsPromises.resolve6(host)]);
        console.error('[footballApi] DNS resolve4=', v4.status === 'fulfilled' ? v4.value : v4.reason?.code || v4.reason?.message);
        console.error('[footballApi] DNS resolve6=', v6.status === 'fulfilled' ? v6.value : v6.reason?.code || v6.reason?.message);
      } catch (dnsErr) {
        console.error('[footballApi] DNS diagnostics failed=', dnsErr?.message || dnsErr);
      }
    }

    if (code === 'ETIMEDOUT' || err?.name === 'AbortError') {
      console.error('[footballApi] timeoutMs=', timeoutMs);
      console.error('[footballApi] HTTPS_PROXY=', process.env.HTTPS_PROXY || process.env.https_proxy || '(not set)');
      console.error('[footballApi] HTTP_PROXY=', process.env.HTTP_PROXY || process.env.http_proxy || '(not set)');
      console.error('[footballApi] NO_PROXY=', process.env.NO_PROXY || process.env.no_proxy || '(not set)');
      console.error('[footballApi] Proxy dispatcher=', proxyDispatcher ? 'configured' : 'not configured');
    }

    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ===== Stage 映射 =====
const STAGE_MAP = {
  'GROUP_STAGE': 'group',
  'LAST_32': 'round_32',
  'LAST_16': 'round_16',
  'QUARTER_FINALS': 'quarter',
  'SEMI_FINALS': 'semi',
  'THIRD_PLACE': 'third',
  'FINAL': 'final',
};

// ===== 拉取并标准化所有比赛 =====
export async function fetchAllMatches() {
  const cacheKey = 'api:matches';
  const cached = get(cacheKey);
  if (cached) return cached;

  const data = await apiFetch(`/competitions/${COMPETITION_ID}/matches`);
  const rawMatches = data.matches || [];

  const matches = rawMatches.map(m => {
    const home = apiToSlug(m.homeTeam?.name);
    const away = apiToSlug(m.awayTeam?.name);
    const isFinished = m.status === 'FINISHED';
    const isTimed = m.status === 'TIMED' || m.status === 'SCHEDULED';
    const ft = m.score?.fullTime || {};

    return {
      id: m.id,
      date: m.utcDate ? m.utcDate.slice(0, 10) : null,
      time: m.utcDate ? m.utcDate.slice(11, 16) : null,
      utcDate: m.utcDate,
      group: m.group ? m.group.replace('GROUP_', '') : null,
      round: STAGE_MAP[m.stage] || m.stage,
      matchday: m.matchday,
      stage: m.stage,
      t1: home,
      t2: away,
      team1: m.homeTeam?.name || home,
      team2: m.awayTeam?.name || away,
      g1: isFinished ? ft.home : (ft.home != null ? ft.home : null),
      g2: isFinished ? ft.away : (ft.away != null ? ft.away : null),
      status: isFinished ? 'FT' : (isTimed ? 'TIMED' : m.status),
      winner: m.score?.winner || null,
      // 保留原始数据用于前端展示
      _homeTeam: m.homeTeam,
      _awayTeam: m.awayTeam,
    };
  });

  set(cacheKey, matches, 300_000); // 缓存 5 分钟
  console.log(`[footballApi] 拉取 ${matches.length} 场比赛 (${matches.filter(m=>m.status==='FT').length} 已完赛)`);
  return matches;
}

// ===== 拉取小组积分榜 =====
export async function fetchStandings() {
  const cacheKey = 'api:standings';
  const cached = get(cacheKey);
  if (cached) return cached;

  const data = await apiFetch(`/competitions/${COMPETITION_ID}/standings`);
  const rawStandings = data.standings || [];

  const groups = {};
  for (const s of rawStandings) {
    const groupName = s.group ? s.group.replace('GROUP_', '') : '?';
    const table = (s.table || []).map(t => ({
      slug: apiToSlug(t.team.name),
      teamName: t.team.name,
      position: t.position,
      played: t.playedGames,
      won: t.won,
      draw: t.draw,
      lost: t.lost,
      pts: t.points,
      gf: t.goalsFor,
      ga: t.goalsAgainst,
      gd: t.goalDifference,
    }));
    groups[groupName] = table;
  }

  set(cacheKey, groups, 300_000);
  console.log(`[footballApi] 拉取 ${Object.keys(groups).length} 组积分榜`);
  return groups;
}

// ===== 获取今日比赛 =====
export async function fetchTodayMatches() {
  const all = await fetchAllMatches();
  const today = new Date().toISOString().slice(0, 10);
  return all.filter(m => m.date === today);
}

// ===== 获取未来比赛 =====
export async function fetchUpcomingMatches(days = 7) {
  const all = await fetchAllMatches();
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return all.filter(m => m.date >= today && m.date <= end && m.status !== 'FT');
}

// ===== 获取某场比赛预测所需信息 =====
export async function fetchMatchByTeams(t1, t2) {
  const all = await fetchAllMatches();
  return all.find(m => (m.t1 === t1 && m.t2 === t2) || (m.t1 === t2 && m.t2 === t1)) || null;
}
