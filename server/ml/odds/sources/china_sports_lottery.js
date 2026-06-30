/**
 * 竞彩网离线适配器
 *
 * 从 JSON 文件加载竞彩数据，转换为统一概率结构。
 * 首版仅支持 HAD（胜平负）参与融合。
 *
 * 文件路径约定: data/odds/china-sports-lottery/{YYYYMMDD}.json
 *
 * 导入方式:
 *   import { loadFromFile, getMatch, normalizeToUnified } from './china_sports_lottery.js'
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..');
const DATA_DIR = resolve(PROJECT_ROOT, 'data/odds/china-sports-lottery');

/**
 * 中文队名 → 内部 slug 映射表
 * 覆盖 48 支 2026 世界杯参赛队 + 常见历史队伍
 */
const CN_NAME_TO_SLUG = {
  '阿根廷': 'argentina',
  '法国': 'france',
  '西班牙': 'spain',
  '巴西': 'brazil',
  '英格兰': 'england',
  '葡萄牙': 'portugal',
  '荷兰': 'netherlands',
  '德国': 'germany',
  '比利时': 'belgium',
  '意大利': 'italy',
  '哥伦比亚': 'colombia',
  '乌拉圭': 'uruguay',
  '克罗地亚': 'croatia',
  '摩洛哥': 'morocco',
  '瑞士': 'switzerland',
  '美国': 'usa',
  '墨西哥': 'mexico',
  '日本': 'japan',
  '塞内加尔': 'senegal',
  '丹麦': 'denmark',
  '厄瓜多尔': 'ecuador',
  '澳大利亚': 'australia',
  '韩国': 'south-korea',
  '伊朗': 'iran',
  '波兰': 'poland',
  '加拿大': 'canada',
  '塞尔维亚': 'serbia',
  '威尔士': 'wales',
  '加纳': 'ghana',
  '突尼斯': 'tunisia',
  '科特迪瓦': 'ivory-coast',
  '尼日利亚': 'nigeria',
  '沙特': 'saudi-arabia',
  '沙特阿拉伯': 'saudi-arabia',
  '卡塔尔': 'qatar',
  '埃及': 'egypt',
  '阿尔及利亚': 'algeria',
  '苏格兰': 'scotland',
  '喀麦隆': 'cameroon',
  '巴拉圭': 'paraguay',
  '委内瑞拉': 'venezuela',
  '智利': 'chile',
  '秘鲁': 'peru',
  '捷克': 'czech-republic',
  '波黑': 'bosnia-and-herzegovina',
  '南非': 'south-africa',
  '新西兰': 'new-zealand',
  '巴拿马': 'panama',
  '牙买加': 'jamaica',
  '洪都拉斯': 'honduras',
  '约旦': 'jordan',
  '海地': 'haiti',
  '萨尔瓦多': 'el-salvador',
  '危地马拉': 'guatemala',
  '特立尼达和多巴哥': 'trinidad-and-tobago',
  '挪威': 'norway',
  '瑞典': 'sweden',
  '土耳其': 'turkey',
  '奥地利': 'austria',
  '伊拉克': 'iraq',
  '乌兹别克斯坦': 'uzbekistan',
  '佛得角': 'cape-verde',
  '刚果民主共和国': 'dr-congo',
  '刚果金': 'dr-congo',
  '库拉索': 'curacao',
  '哥斯达黎加': 'costa-rica',
  '俄罗斯': 'russia',
  '匈牙利': 'hungary',
  '罗马尼亚': 'romania',
  '希腊': 'greece',
  '爱尔兰': 'ireland',
  '斯洛伐克': 'slovakia',
  '斯洛文尼亚': 'slovenia',
  '乌克兰': 'ukraine',
  '冰岛': 'iceland',
  '北爱尔兰': 'northern-ireland',
  '保加利亚': 'bulgaria',
  '芬兰': 'finland',
  '黑山': 'montenegro',
  '阿尔巴尼亚': 'albania',
  '马其顿': 'north-macedonia',
  '卢森堡': 'luxembourg',
  '亚美尼亚': 'armenia',
  '格鲁吉亚': 'georgia',
  '哈萨克斯坦': 'kazakhstan',
  '阿塞拜疆': 'azerbaijan',
  '法罗群岛': 'faroe-islands',
  '摩尔多瓦': 'moldova',
  '直布罗陀': 'gibraltar',
  '列支敦士登': 'liechtenstein',
  '马耳他': 'malta',
  '安道尔': 'andorra',
  '圣马力诺': 'san-marino',
  '玻利维亚': 'bolivia',
  '塞浦路斯': 'cyprus',
  '爱沙尼亚': 'estonia',
  '拉脱维亚': 'latvia',
  '立陶宛': 'lithuania',
  '白俄罗斯': 'belarus',
  '以色列': 'israel',
  '中国': 'china',
  '泰国': 'thailand',
  '越南': 'vietnam',
  '马来西亚': 'malaysia',
  '印度尼西亚': 'indonesia',
  '阿联酋': 'united-arab-emirates',
  '阿曼': 'oman',
  '巴林': 'bahrain',
  '叙利亚': 'syria',
  '黎巴嫩': 'lebanon',
  '科威特': 'kuwait',
  '吉尔吉斯斯坦': 'kyrgyzstan',
  '巴勒斯坦': 'palestine',
  '印度': 'india',
  '巴基斯坦': 'pakistan',
  '巴布亚新几内亚': 'papua-new-guinea',
  '所罗门群岛': 'solomon-islands',
  '塔希提': 'tahiti',
  '斐济': 'fiji',
  '新喀里多尼亚': 'new-caledonia',
  '瓦努阿图': 'vanuatu',
  '萨摩亚': 'samoa',
  '汤加': 'tonga',
};

/**
 * 星期代码映射
 */
const CN_CODE_TO_TOURNAMENT = {
  '周日': 'sunday',
  '周一': 'monday',
  '周二': 'tuesday',
  '周三': 'wednesday',
  '周四': 'thursday',
  '周五': 'friday',
  '周六': 'saturday',
};

/**
 * 彩池类型对照
 */
const POOL_LABELS = {
  'HAD': '胜平负',
  'HHAD': '让球胜平负',
  'HAFU': '大小球',
  'CRS': '比分',
  'HFT': '半全场',
  'TTG': '总进球数',
};

/**
 * 从 JSON 文件加载竞彩数据
 * @param {string} filePath - JSON 文件路径
 * @returns {Array} 比赛记录数组
 */
export function loadFromFile(filePath) {
  const resolvedPath = resolve(PROJECT_ROOT, filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`竞彩数据文件不存在: ${resolvedPath}`);
  }
  const raw = readFileSync(resolvedPath, 'utf-8');
  const data = JSON.parse(raw);

  // 支持单条或数组格式
  const records = Array.isArray(data) ? data : (data.matches || [data]);
  return records;
}

/**
 * 加载指定日期的数据文件
 * @param {string} dateStr - YYYY-MM-DD 格式日期
 * @returns {Array}
 */
export function loadByDate(dateStr) {
  const filePath = resolve(DATA_DIR, `${dateStr.replace(/-/g, '')}.json`);
  if (!existsSync(filePath)) {
    console.warn(`[china-sports-lottery] 日期 ${dateStr} 无数据文件`);
    return [];
  }
  return loadFromFile(filePath);
}

/**
 * 加载最新可用的竞彩数据
 * @returns {Array}
 */
export function loadLatest() {
  if (!existsSync(DATA_DIR)) {
    return [];
  }
  const files = readdirSync(DATA_DIR)
    .filter(f => /^\d{8}\.json$/.test(f))
    .sort()
    .reverse();

  if (files.length === 0) return [];
  return loadFromFile(resolve(DATA_DIR, files[0]));
}

/**
 * 按队伍查找比赛
 * @param {Array} records - 比赛记录数组
 * @param {string} homeTeam - 主队名（中文/英文均可）
 * @param {string} awayTeam - 客队名
 * @returns {object|null}
 */
export function getMatch(records, homeTeam, awayTeam) {
  if (!records || records.length === 0) return null;

  const homeSlug = teamNameToSlug(homeTeam);
  const awaySlug = teamNameToSlug(awayTeam);

  // 精确匹配
  for (const record of records) {
    const rHomeSlug = teamNameToSlug(record.homeTeam);
    const rAwaySlug = teamNameToSlug(record.awayTeam);
    if (rHomeSlug === homeSlug && rAwaySlug === awaySlug) {
      return record;
    }
  }

  // 交换匹配
  for (const record of records) {
    const rHomeSlug = teamNameToSlug(record.homeTeam);
    const rAwaySlug = teamNameToSlug(record.awayTeam);
    if (rHomeSlug === awaySlug && rAwaySlug === homeSlug) {
      return record;
    }
  }

  return null;
}

/**
 * 将中文/英文队名转为内部 slug
 */
function teamNameToSlug(name) {
  if (!name) return '';
  const key = name.trim();
  // 直接查中文映射
  if (CN_NAME_TO_SLUG[key]) return CN_NAME_TO_SLUG[key];
  // 尝试小写英文转 slug
  return key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * 将竞彩格式转换为统一概率结构
 *
 * @param {object} match - 竞彩比赛记录
 * @returns {object|null} { homeWin, draw, awayWin, source, pool, odds, metadata }
 */
export function normalizeToUnified(match) {
  if (!match || !match.pools || match.pools.length === 0) return null;

  // 查找 HAD（胜平负）彩池
  const had = match.pools.find(p => p.pool === 'HAD');
  if (!had || !had.home || !had.draw || !had.away) return null;

  // 去抽水：将庄家抽水平均摊到三种结果上
  const rawHome = 1 / had.home;
  const rawDraw = 1 / had.draw;
  const rawAway = 1 / had.away;
  const margin = rawHome + rawDraw + rawAway;

  if (margin <= 0) return null;

  const returnRate = match.returnRate || (1 / margin);

  return {
    homeWin: +(rawHome / margin).toFixed(4),
    draw: +(rawDraw / margin).toFixed(4),
    awayWin: +(rawAway / margin).toFixed(4),
    source: 'china-sports-lottery',
    pool: 'HAD',
    odds: { home: had.home, draw: had.draw, away: had.away },
    returnRate,
    metadata: {
      matchId: match.matchId || '',
      date: match.date || '',
      status: match.status || '',
      allPools: match.pools.map(p => ({
        pool: p.pool,
        label: POOL_LABELS[p.pool] || p.pool,
        odds: { ...p },
      })),
    },
  };
}

/**
 * 获取竞彩数据适配器输出（所有可用比赛的统一格式概率）
 * 兼容 fusion.js 的接入接口
 *
 * @returns {Promise<Array<{source: string, probabilities: object, metadata: object}>>}
 */
export async function fetchAllMatches() {
  const records = loadLatest();
  if (records.length === 0) return [];

  const results = [];
  for (const record of records) {
    const normalized = normalizeToUnified(record);
    if (normalized) {
      results.push({
        source: 'china-sports-lottery',
        probabilities: {
          homeWin: normalized.homeWin,
          draw: normalized.draw,
          awayWin: normalized.awayWin,
        },
        metadata: {
          matchId: record.matchId || '',
          date: record.date || '',
          pools: record.pools?.map(p => ({ pool: p.pool, odds: { home: p.home, draw: p.draw, away: p.away } })),
          returnRate: record.returnRate,
          raw: normalized.odds,
        },
      });
    }
  }
  return results;
}

/**
 * 将内部 slug 转为中文队名
 * @param {string} slug - 内部 slug (如 'argentina')
 * @returns {string|null} 中文队名 (如 '阿根廷')，未找到则返回 slug 本身
 */
export function slugToCnName(slug) {
  if (!slug) return null;
  const entry = Object.entries(CN_NAME_TO_SLUG).find(([, v]) => v === slug);
  return entry ? entry[0] : slug;
}

export { CN_NAME_TO_SLUG };

export default {
  loadFromFile,
  loadByDate,
  loadLatest,
  getMatch,
  normalizeToUnified,
  fetchAllMatches,
  CN_NAME_TO_SLUG,
};
