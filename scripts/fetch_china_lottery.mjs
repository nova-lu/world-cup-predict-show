/**
 * 竞彩网赔率抓取脚本
 *
 * 通过调用 webapi.sporttery.cn 的官方 JSON 接口获取胜平负和让球胜平负赔率
 * 数据直接来自中国体育彩票官方，无需浏览器模拟
 *
 * 用法: node scripts/fetch_china_lottery.mjs
 * 输出: data/odds/china-sports-lottery/{YYYYMMDD}.json
 */

import { writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(PROJECT_ROOT, 'data', 'odds', 'china-sports-lottery');

const API_URL = 'https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c';

// 竞彩网缩写 → 项目标准名
const TEAM_NAME_FIX = {
  '刚果金': '刚果民主共和国',
  '阿尔及利': '阿尔及利亚',
};

/**
 * 从所有 matchInfoList 的 subMatchList 中提取全部比赛
 */
async function fetchMatches() {
  const res = await fetch(API_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.sporttery.cn/jc/jsq/zqspf/',
      'Accept': 'application/json, text/plain, */*',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const raw = await res.json();

  // 该 API 即使成功也返回 success=false, errorCode=0/字符串"0"
  if (String(raw.errorCode) !== '0') {
    throw new Error(`API 错误: [${raw.errorCode}] ${raw.errorMessage || ''}`);
  }

  const data = raw.value || raw.data || raw;
  const dateGroups = data.matchInfoList;
  if (!dateGroups || !dateGroups.length) throw new Error('API 返回空数据 (matchInfoList 为空)');

  // 展平所有日期的比赛
  const allMatches = [];
  for (const group of dateGroups) {
    for (const m of group.subMatchList || []) {
      // 跳过已隐藏的比赛
      if (m.isHide) continue;
      if (m.matchStatus === 'NotOpen' || m.matchStatus === 'Cancel') continue;

      // 队名归一化
      let home = (m.homeTeamAbbName || '').trim();
      let away = (m.awayTeamAbbName || '').trim();
      if (TEAM_NAME_FIX[home]) home = TEAM_NAME_FIX[home];
      if (TEAM_NAME_FIX[away]) away = TEAM_NAME_FIX[away];

      const pools = [];

      // 胜平负 (HAD)
      const had = m.had || {};
      const hadH = parseFloat(had.h);
      const hadD = parseFloat(had.d);
      const hadA = parseFloat(had.a);
      if (hadH > 0 && hadD > 0 && hadA > 0) {
        pools.push({ pool: 'HAD', home: hadH, draw: hadD, away: hadA });
      }

      // 让球胜平负 (HHAD)
      const hhad = m.hhad || {};
      const hhadH = parseFloat(hhad.h);
      const hhadD = parseFloat(hhad.d);
      const hhadA = parseFloat(hhad.a);
      let goalLine = 0;
      if (hhad.goalLine) {
        goalLine = parseInt(String(hhad.goalLine)) || 0;
      }
      if (hhadH > 0 && hhadD > 0 && hhadA > 0) {
        pools.push({
          pool: 'HHAD',
          home: hhadH,
          draw: hhadD,
          away: hhadA,
          goalLine,
        });
      }

      if (!pools.length) continue;

      allMatches.push({
        matchId: m.matchNumStr || '',
        homeTeam: home,
        awayTeam: away,
        date: (m.matchDate || '').split(' ')[0],
        kickoff: (m.matchTime || '').slice(0, 5),
        status: m.matchStatus === 'Selling' ? 'open' : 'closed',
        pools,
        returnRate: 0.89,
      });
    }
  }

  if (!allMatches.length) throw new Error('没有有效的比赛数据');
  return allMatches;
}

function saveMatches(matches) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const dateStr = matches[0].date.replace(/-/g, '');
  const filePath = resolve(DATA_DIR, `${dateStr}.json`);

  if (existsSync(filePath)) {
    try {
      const old = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (JSON.stringify(old) === JSON.stringify(matches)) {
        return { path: filePath, matchCount: matches.length, changed: false };
      }
    } catch { /* 覆盖损坏文件 */ }
  }

  writeFileSync(filePath, JSON.stringify(matches, null, 2), 'utf-8');
  console.log(`  已保存 ${matches.length} 场比赛 → ${filePath}`);
  return { path: filePath, matchCount: matches.length, changed: true };
}

function cleanExpired() {
  const files = readdirSync(DATA_DIR)
    .filter(f => /^\d{8}\.json$/.test(f))
    .sort()
    .reverse();
  if (files.length > 7) {
    for (const f of files.slice(7)) {
      unlinkSync(resolve(DATA_DIR, f));
      console.log(`  清理过期: ${f}`);
    }
  }
}

// ===== 主入口 =====
console.log('[China Lottery] 正在从竞彩网获取实时赔率...');
try {
  const matches = await fetchMatches();
  console.log(`[China Lottery] 成功获取 ${matches.length} 场比赛`);

  const result = saveMatches(matches);
  if (!result.changed) console.log('[China Lottery] 数据无变化，跳过');

  cleanExpired();
  console.log('[China Lottery] 完成 ✓');
  process.exit(0);
} catch (e) {
  console.error(`[China Lottery] 抓取失败: ${e.message}`);
  process.exit(1);
}
