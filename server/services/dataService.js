import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');

// ---------- 球队专属颜色 ----------
const TEAM_COLORS = {
  'mexico':            { primary:'#006847', secondary:'#ce1126', text:'#ffffff' },
  'south-africa':      { primary:'#007a4d', secondary:'#ffb612', text:'#ffffff' },
  'south-korea':       { primary:'#e60000', secondary:'#003478', text:'#ffffff' },
  'czech-republic':    { primary:'#11457e', secondary:'#d7141a', text:'#ffffff' },
  'canada':            { primary:'#e00000', secondary:'#ffffff', text:'#ffffff' },
  'bosnia-and-herzegovina': { primary:'#002395', secondary:'#fedb00', text:'#ffffff' },
  'qatar':             { primary:'#8c1b1b', secondary:'#ffffff', text:'#ffffff' },
  'switzerland':       { primary:'#da291c', secondary:'#ffffff', text:'#ffffff' },
  'brazil':            { primary:'#f7c622', secondary:'#009739', text:'#003f87' },
  'morocco':           { primary:'#c1272d', secondary:'#006233', text:'#ffffff' },
  'haiti':             { primary:'#00209f', secondary:'#d21034', text:'#ffffff' },
  'scotland':          { primary:'#003876', secondary:'#ffffff', text:'#ffffff' },
  'usa':               { primary:'#ffffff', secondary:'#002868', text:'#bf0a30' },
  'paraguay':          { primary:'#003f87', secondary:'#d52b1e', text:'#ffffff' },
  'australia':         { primary:'#fcd116', secondary:'#008751', text:'#003f87' },
  'turkey':            { primary:'#e30a17', secondary:'#ffffff', text:'#ffffff' },
  'germany':           { primary:'#ffffff', secondary:'#dd0000', text:'#000000' },
  'curacao':           { primary:'#003ca3', secondary:'#ffd100', text:'#ffffff' },
  'ivory-coast':       { primary:'#f77f00', secondary:'#009e60', text:'#ffffff' },
  'ecuador':           { primary:'#fcd116', secondary:'#003893', text:'#ed1c24' },
  'netherlands':       { primary:'#ff6600', secondary:'#ffffff', text:'#ffffff' },
  'japan':             { primary:'#bc002d', secondary:'#ffffff', text:'#ffffff' },
  'sweden':            { primary:'#fecd00', secondary:'#005b9f', text:'#005b9f' },
  'tunisia':           { primary:'#e70013', secondary:'#ffffff', text:'#ffffff' },
  'belgium':           { primary:'#e00000', secondary:'#ffcd00', text:'#000000' },
  'egypt':             { primary:'#ce1126', secondary:'#ffffff', text:'#000000' },
  'iran':              { primary:'#da0000', secondary:'#239f40', text:'#ffffff' },
  'new-zealand':       { primary:'#00247d', secondary:'#cc142b', text:'#ffffff' },
  'spain':             { primary:'#c60b1e', secondary:'#ffc400', text:'#ffffff' },
  'cape-verde':        { primary:'#003893', secondary:'#ce1126', text:'#ffffff' },
  'saudi-arabia':      { primary:'#006c35', secondary:'#ffffff', text:'#ffffff' },
  'uruguay':           { primary:'#003da5', secondary:'#ffffff', text:'#fcd116' },
  'france':            { primary:'#002395', secondary:'#ffffff', text:'#ed2939' },
  'senegal':           { primary:'#00853f', secondary:'#fdce12', text:'#e31b23' },
  'iraq':              { primary:'#ce1126', secondary:'#000000', text:'#007a3d' },
  'norway':            { primary:'#ba0c2f', secondary:'#ffffff', text:'#003087' },
  'argentina':         { primary:'#75aadb', secondary:'#ffffff', text:'#fcbf49' },
  'algeria':           { primary:'#006233', secondary:'#ffffff', text:'#d21034' },
  'jordan':            { primary:'#ce1126', secondary:'#000000', text:'#ffffff' },
  'austria':           { primary:'#ed2939', secondary:'#ffffff', text:'#ffffff' },
  'england':           { primary:'#ffffff', secondary:'#ce1124', text:'#1d2b64' },
  'croatia':           { primary:'#171796', secondary:'#ffffff', text:'#ed1c24' },
  'uzbekistan':        { primary:'#0099b5', secondary:'#1eb53a', text:'#ffffff' },
  'ghana':             { primary:'#ce1126', secondary:'#fcd116', text:'#006b3f' },
  'portugal':          { primary:'#006600', secondary:'#ff0000', text:'#ffffff' },
  'dr-congo':          { primary:'#007fff', secondary:'#f7d618', text:'#ce1021' },
  'colombia':          { primary:'#fcd116', secondary:'#003893', text:'#ce1126' },
  'panama':            { primary:'#005293', secondary:'#d21034', text:'#ffffff' },
};
const TEAM_INFO = {
  'mexico':            { name: '墨西哥', nameEn: 'Mexico', slug: 'mexico', flag: '🇲🇽', group: 'A', confederation: 'CONCACAF' },
  'south-africa':      { name: '南非', nameEn: 'South Africa', slug: 'south-africa', flag: '🇿🇦', group: 'A', confederation: 'CAF' },
  'south-korea':       { name: '韩国', nameEn: 'South Korea', slug: 'south-korea', flag: '🇰🇷', group: 'A', confederation: 'AFC' },
  'czech-republic':    { name: '捷克', nameEn: 'Czech Republic', slug: 'czech-republic', flag: '🇨🇿', group: 'A', confederation: 'UEFA' },
  'canada':            { name: '加拿大', nameEn: 'Canada', slug: 'canada', flag: '🇨🇦', group: 'B', confederation: 'CONCACAF' },
  'bosnia-and-herzegovina': { name: '波黑', nameEn: 'Bosnia & Herzegovina', slug: 'bosnia-and-herzegovina', flag: '🇧🇦', group: 'B', confederation: 'UEFA' },
  'qatar':             { name: '卡塔尔', nameEn: 'Qatar', slug: 'qatar', flag: '🇶🇦', group: 'B', confederation: 'AFC' },
  'switzerland':       { name: '瑞士', nameEn: 'Switzerland', slug: 'switzerland', flag: '🇨🇭', group: 'B', confederation: 'UEFA' },
  'brazil':            { name: '巴西', nameEn: 'Brazil', slug: 'brazil', flag: '🇧🇷', group: 'C', confederation: 'CONMEBOL' },
  'morocco':           { name: '摩洛哥', nameEn: 'Morocco', slug: 'morocco', flag: '🇲🇦', group: 'C', confederation: 'CAF' },
  'haiti':             { name: '海地', nameEn: 'Haiti', slug: 'haiti', flag: '🇭🇹', group: 'C', confederation: 'CONCACAF' },
  'scotland':          { name: '苏格兰', nameEn: 'Scotland', slug: 'scotland', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', group: 'C', confederation: 'UEFA' },
  'usa':               { name: '美国', nameEn: 'USA', slug: 'usa', flag: '🇺🇸', group: 'D', confederation: 'CONCACAF' },
  'paraguay':          { name: '巴拉圭', nameEn: 'Paraguay', slug: 'paraguay', flag: '🇵🇾', group: 'D', confederation: 'CONMEBOL' },
  'australia':         { name: '澳大利亚', nameEn: 'Australia', slug: 'australia', flag: '🇦🇺', group: 'D', confederation: 'AFC' },
  'turkey':            { name: '土耳其', nameEn: 'Turkey', slug: 'turkey', flag: '🇹🇷', group: 'D', confederation: 'UEFA' },
  'germany':           { name: '德国', nameEn: 'Germany', slug: 'germany', flag: '🇩🇪', group: 'E', confederation: 'UEFA' },
  'curacao':           { name: '库拉索', nameEn: 'Curaçao', slug: 'curacao', flag: '🇨🇼', group: 'E', confederation: 'CONCACAF' },
  'ivory-coast':       { name: '科特迪瓦', nameEn: 'Ivory Coast', slug: 'ivory-coast', flag: '🇨🇮', group: 'E', confederation: 'CAF' },
  'ecuador':           { name: '厄瓜多尔', nameEn: 'Ecuador', slug: 'ecuador', flag: '🇪🇨', group: 'E', confederation: 'CONMEBOL' },
  'netherlands':       { name: '荷兰', nameEn: 'Netherlands', slug: 'netherlands', flag: '🇳🇱', group: 'F', confederation: 'UEFA' },
  'japan':             { name: '日本', nameEn: 'Japan', slug: 'japan', flag: '🇯🇵', group: 'F', confederation: 'AFC' },
  'sweden':            { name: '瑞典', nameEn: 'Sweden', slug: 'sweden', flag: '🇸🇪', group: 'F', confederation: 'UEFA' },
  'tunisia':           { name: '突尼斯', nameEn: 'Tunisia', slug: 'tunisia', flag: '🇹🇳', group: 'F', confederation: 'CAF' },
  'belgium':           { name: '比利时', nameEn: 'Belgium', slug: 'belgium', flag: '🇧🇪', group: 'G', confederation: 'UEFA' },
  'egypt':             { name: '埃及', nameEn: 'Egypt', slug: 'egypt', flag: '🇪🇬', group: 'G', confederation: 'CAF' },
  'iran':              { name: '伊朗', nameEn: 'Iran', slug: 'iran', flag: '🇮🇷', group: 'G', confederation: 'AFC' },
  'new-zealand':       { name: '新西兰', nameEn: 'New Zealand', slug: 'new-zealand', flag: '🇳🇿', group: 'G', confederation: 'OFC' },
  'spain':             { name: '西班牙', nameEn: 'Spain', slug: 'spain', flag: '🇪🇸', group: 'H', confederation: 'UEFA' },
  'cape-verde':        { name: '佛得角', nameEn: 'Cape Verde', slug: 'cape-verde', flag: '🇨🇻', group: 'H', confederation: 'CAF' },
  'saudi-arabia':      { name: '沙特', nameEn: 'Saudi Arabia', slug: 'saudi-arabia', flag: '🇸🇦', group: 'H', confederation: 'AFC' },
  'uruguay':           { name: '乌拉圭', nameEn: 'Uruguay', slug: 'uruguay', flag: '🇺🇾', group: 'H', confederation: 'CONMEBOL' },
  'france':            { name: '法国', nameEn: 'France', slug: 'france', flag: '🇫🇷', group: 'I', confederation: 'UEFA' },
  'senegal':           { name: '塞内加尔', nameEn: 'Senegal', slug: 'senegal', flag: '🇸🇳', group: 'I', confederation: 'CAF' },
  'iraq':              { name: '伊拉克', nameEn: 'Iraq', slug: 'iraq', flag: '🇮🇶', group: 'I', confederation: 'AFC' },
  'norway':            { name: '挪威', nameEn: 'Norway', slug: 'norway', flag: '🇳🇴', group: 'I', confederation: 'UEFA' },
  'argentina':         { name: '阿根廷', nameEn: 'Argentina', slug: 'argentina', flag: '🇦🇷', group: 'J', confederation: 'CONMEBOL' },
  'algeria':           { name: '阿尔及利亚', nameEn: 'Algeria', slug: 'algeria', flag: '🇩🇿', group: 'J', confederation: 'CAF' },
  'jordan':            { name: '约旦', nameEn: 'Jordan', slug: 'jordan', flag: '🇯🇴', group: 'J', confederation: 'AFC' },
  'austria':           { name: '奥地利', nameEn: 'Austria', slug: 'austria', flag: '🇦🇹', group: 'J', confederation: 'UEFA' },
  'england':           { name: '英格兰', nameEn: 'England', slug: 'england', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', group: 'K', confederation: 'UEFA' },
  'croatia':           { name: '克罗地亚', nameEn: 'Croatia', slug: 'croatia', flag: '🇭🇷', group: 'K', confederation: 'UEFA' },
  'uzbekistan':        { name: '乌兹别克斯坦', nameEn: 'Uzbekistan', slug: 'uzbekistan', flag: '🇺🇿', group: 'K', confederation: 'AFC' },
  'ghana':             { name: '加纳', nameEn: 'Ghana', slug: 'ghana', flag: '🇬🇭', group: 'K', confederation: 'CAF' },
  'portugal':          { name: '葡萄牙', nameEn: 'Portugal', slug: 'portugal', flag: '🇵🇹', group: 'L', confederation: 'UEFA' },
  'dr-congo':          { name: '刚果民主共和国', nameEn: 'DR Congo', slug: 'dr-congo', flag: '🇨🇩', group: 'L', confederation: 'CAF' },
  'colombia':          { name: '哥伦比亚', nameEn: 'Colombia', slug: 'colombia', flag: '🇨🇴', group: 'L', confederation: 'CONMEBOL' },
  'panama':            { name: '巴拿马', nameEn: 'Panama', slug: 'panama', flag: '🇵🇦', group: 'L', confederation: 'CONCACAF' },
};
// 补充球队全名映射（来自模型数据的 slug → 正式名称）
const SLUG_TO_NAME = {
  'argentina': 'Argentina', 'france': 'France', 'spain': 'Spain', 'brazil': 'Brazil',
  'england': 'England', 'portugal': 'Portugal', 'netherlands': 'Netherlands', 'germany': 'Germany',
  'belgium': 'Belgium', 'italy': 'Italy', 'colombia': 'Colombia', 'uruguay': 'Uruguay',
  'croatia': 'Croatia', 'morocco': 'Morocco', 'switzerland': 'Switzerland', 'usa': 'USA',
  'mexico': 'Mexico', 'japan': 'Japan', 'senegal': 'Senegal', 'denmark': 'Denmark',
  'ecuador': 'Ecuador', 'australia': 'Australia', 'south-korea': 'South Korea', 'iran': 'Iran',
  'poland': 'Poland', 'canada': 'Canada', 'serbia': 'Serbia', 'wales': 'Wales',
  'ghana': 'Ghana', 'tunisia': 'Tunisia', 'ivory-coast': 'Ivory Coast', 'nigeria': 'Nigeria',
  'saudi-arabia': 'Saudi Arabia', 'qatar': 'Qatar', 'egypt': 'Egypt', 'algeria': 'Algeria',
  'scotland': 'Scotland', 'cameroon': 'Cameroon', 'paraguay': 'Paraguay', 'venezuela': 'Venezuela',
  'chile': 'Chile', 'peru': 'Peru', 'czech-republic': 'Czech Republic', 'bosnia-and-herzegovina': 'Bosnia & Herzegovina',
  'south-africa': 'South Africa', 'new-zealand': 'New Zealand', 'panama': 'Panama',
  'jamaica': 'Jamaica', 'honduras': 'Honduras', 'jordan': 'Jordan', 'haiti': 'Haiti',
  'el-salvador': 'El Salvador', 'trinidad-and-tobago': 'Trinidad & Tobago', 'guatemala': 'Guatemala',
  'norway': 'Norway', 'sweden': 'Sweden', 'turkey': 'Turkey', 'austria': 'Austria',
  'iraq': 'Iraq', 'uzbekistan': 'Uzbekistan', 'cape-verde': 'Cape Verde', 'dr-congo': 'DR Congo',
  'curacao': 'Curaçao',
};

export function getTeamInfo(slug) {
  if (!slug) return null;
  const info = TEAM_INFO[slug];
  if (info) {
    const colors = TEAM_COLORS[slug] || { primary:'#333', secondary:'#555', text:'#fff' };
    return {
      ...info,
      flagPath: `/images/flags/${slug}.svg`,
      color: colors,
    };
  }
  // 如果 slug 不在 TEAM_INFO 中，用自动生成的基本信息
  return {
    name: SLUG_TO_NAME[slug] || slug,
    nameEn: SLUG_TO_NAME[slug] || slug,
    slug,
    flag: '⚽',
    flagPath: null,
    color: { primary:'#333', secondary:'#555', text:'#fff' },
    group: null,
    confederation: null,
  };
}

export function getAllTeams() {
  return Object.entries(TEAM_INFO).map(([slug]) => {
    const info = getTeamInfo(slug);
    const rating = (getRatings())[slug] || 1500;
    return { ...info, elo: rating };
  });
}

export function getTeamsByGroup(group) {
  return Object.entries(TEAM_INFO)
    .filter(([, info]) => info.group === group)
    .map(([slug, info]) => ({ ...info, nameEn: SLUG_TO_NAME[slug] || info.nameEn }));
}

// ---------- 数据文件加载 ----------
function loadJSON(filename) {
  const p = path.join(DATA_DIR, filename);
  if (!existsSync(p)) {
    console.warn(`[DataService] 数据文件不存在: ${filename}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch (e) {
    console.error(`[DataService] 读取失败 ${filename}:`, e.message);
    return null;
  }
}

let _ratings = null;
export function getRatings() {
  if (_ratings) return _ratings;
  const data = loadJSON('elo-calibrated.json');
  _ratings = data?.ratings || {};
  return _ratings;
}

let _matches = null;
export function getMatches(forceRefresh = false) {
  if (!forceRefresh && _matches) return _matches;
  const data = loadJSON('wc2026-results.json');
  _matches = data?.matches || [];
  return _matches;
}

export function getTodayMatches() {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  return getMatches().filter(m => m.date === todayStr);
}

export function getUpcomingMatches(limit = 10) {
  const today = new Date().toISOString().slice(0, 10);
  return getMatches()
    .filter(m => m.date >= today && m.status !== 'FT')
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
    .slice(0, limit);
}

export function getFinishedMatches() {
  return getMatches().filter(m => m.status === 'FT' || (m.g1 != null && m.g2 != null));
}

export function getMatchById(t1, t2, date) {
  return getMatches().find(m => m.t1 === t1 && m.t2 === t2 && m.date === date) || null;
}

// 分组信息
export const GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L'];

export function getGroupTeams() {
  const groups = {};
  for (const g of GROUPS) {
    groups[g] = Object.entries(TEAM_INFO)
      .filter(([, info]) => info.group === g)
      .map(([slug]) => slug);
  }
  return groups;
}
