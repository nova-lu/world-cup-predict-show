#!/usr/bin/env node
/**
 * validate-results.mjs — 验证 wc2026-results.json 的数据完整性
 *
 * 功能：
 *   1. 校验 JSON 结构是否完整
 *   2. 检测每组每队的完赛场次（4队单循环应各3场）
 *   3. 报告缺失场次
 *   4. 检测得分一致性（胜者得分 > 败者）
 *   5. 检测重复场次
 *   6. 输出补全建议（可选 --fix）
 *
 * 用法：
 *   node scripts/validate-results.mjs
 *   node scripts/validate-results.mjs --fix   （输出缺失场次JSON模板）
 *   node scripts/validate-results.mjs --json   （JSON格式输出）
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = resolve(__dirname, '..', 'data', 'wc2026-results.json');

const args = process.argv.slice(2);
const FLAG_FIX = args.includes('--fix');
const FLAG_JSON = args.includes('--json');

// ========== 加载数据 ==========

if (!existsSync(DATA_FILE)) {
  console.error(`❌ 数据文件不存在: ${DATA_FILE}`);
  process.exit(1);
}

const raw = readFileSync(DATA_FILE, 'utf-8');
let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error(`❌ JSON 解析失败: ${e.message}`);
  process.exit(1);
}

const { matches = [], updated } = data;

// ========== 校验 ==========

const errors = [];
const warnings = [];

// 1. 基础结构
if (!updated) warnings.push('缺少 "updated" 时间戳');
if (!Array.isArray(matches)) errors.push('"matches" 不是数组');
if (matches.length === 0) warnings.push('"matches" 为空');

// 2. 校验每条比赛记录
const seen = new Set();
const teamGroupMap = new Map(); // teamSlug -> Set<group>
const groupTeams = new Map();   // groupSlug -> Set<teamSlug>
const teamMatches = new Map();  // teamSlug -> { group, matches: [], opponents: Set }

for (const m of matches) {
  // 必填字段
  const required = ['date', 'round', 't1', 't2', 'status'];
  for (const f of required) {
    if (m[f] == null) errors.push(`比赛 ${m.t1} vs ${m.t2} 缺少字段: ${f}`);
  }

  // 比赛唯一性（同一两队不能出现两次）
  const key = [m.t1, m.t2].sort().join(':');
  if (seen.has(key)) errors.push(`重复比赛: ${m.t1} vs ${m.t2} (${m.round})`);
  seen.add(key);

  // 检查 group 字段
  const g = m.group;
  if (!g) {
    errors.push(`${m.t1} vs ${m.t2} 缺少 group 字段`);
  } else {
    if (!groupTeams.has(g)) groupTeams.set(g, new Set());
    groupTeams.get(g).add(m.t1);
    groupTeams.get(g).add(m.t2);
  }

  // 跟踪每队的组
  for (const t of [m.t1, m.t2]) {
    if (!teamGroupMap.has(t)) teamGroupMap.set(t, new Set());
    if (g) teamGroupMap.get(t).add(g);
    if (!teamMatches.has(t)) teamMatches.set(t, { matches: [], opponents: new Set() });
    teamMatches.get(t).matches.push(m);
    teamMatches.get(t).opponents.add(m.t1 === t ? m.t2 : m.t1);
  }

  // 已完成比赛的得分校验
  if (m.status === 'FT' && m.g1 != null && m.g2 != null) {
    if (m.g1 < 0 || m.g2 < 0) errors.push(`${m.t1} vs ${m.t2}: 得分不能为负数`);
    if (m.pens1 != null && m.pens2 != null && m.g1 !== m.g2)
      warnings.push(`${m.t1} vs ${m.t2}: 有点球但常规时间分出了胜负？`);
  }
}

// 3. 跨组校验
for (const [team, groups] of teamGroupMap) {
  if (groups.size > 1) errors.push(`球队 ${team} 出现在多个小组: ${[...groups].join(', ')}`);
}

// 4. 每组完整性
const groupIssues = [];
for (const [g, teams] of groupTeams) {
  const n = teams.size;
  const groupMatchCount = matches.filter(m => m.group === g).length;
  const expected = n * (n - 1) / 2;

  if (n !== 4) {
    groupIssues.push(`⚠️  小组 ${g}: 有 ${n} 队（期望 4 队）`);
  }

  if (groupMatchCount < expected) {
    const missing = expected - groupMatchCount;
    groupIssues.push(`❌  小组 ${g}: 只有 ${groupMatchCount}/${expected} 场（缺 ${missing} 场）`);

    // 列出缺失的对阵
    const existingPairs = new Set(
      matches.filter(m => m.group === g).map(m => [m.t1, m.t2].sort().join(':'))
    );
    const teamList = [...teams];
    for (let i = 0; i < teamList.length; i++) {
      for (let j = i + 1; j < teamList.length; j++) {
        const pair = [teamList[i], teamList[j]].sort().join(':');
        if (!existingPairs.has(pair)) {
          const tmpl = FLAG_FIX ? `    补全模板: { "date": "2026-06-XX", "round": "Matchday N", "group": "${g}", "team1": "${teamList[i]}", "team2": "${teamList[j]}", "t1": "${teamList[i]}", "t2": "${teamList[j]}", "g1": null, "g2": null, "pens1": null, "pens2": null, "status": "Scheduled" }` : '';
          groupIssues.push(`    缺少对阵: ${teamList[i]} vs ${teamList[j]}${tmpl}`);
        }
      }
    }
  } else if (groupMatchCount > expected) {
    groupIssues.push(`❌  小组 ${g}: 有 ${groupMatchCount}/${expected} 场（多了 ${groupMatchCount - expected} 场）`);
  }
}

// ========== 汇总报告 ==========

if (FLAG_JSON) {
  console.log(JSON.stringify({
    valid: errors.length === 0,
    totalMatches: matches.length,
    totalGroups: groupTeams.size,
    updated,
    errors: errors.map(e => ({ severity: 'error', message: e })),
    warnings: warnings.map(w => ({ severity: 'warning', message: w })),
    groupIssues: groupIssues.map(i => {
      const sev = i.startsWith('❌') ? 'error' : 'warning';
      return { severity: sev, message: i.replace(/^[✅❌⚠️]\s*/, '') };
    }),
    groupSummary: [...groupTeams.entries()].map(([g, teams]) => {
      const cnt = matches.filter(m => m.group === g).length;
      const expected = teams.size * (teams.size - 1) / 2;
      return { group: g, teams: teams.size, matches: `${cnt}/${expected}`, complete: cnt >= expected };
    }),
    perTeam: [...teamMatches.entries()].map(([t, info]) => ({
      team: t,
      group: [...(teamGroupMap.get(t) || [])][0],
      matchesPlayed: info.matches.length,
      opponents: info.opponents.size,
    })),
  }, null, 2));
  process.exit(errors.length > 0 ? 1 : 0);
}

// ========== 控制台输出 ==========

console.log('═══════════════════════════════════════');
console.log('  wc2026-results.json 数据完整性检查');
console.log(`  更新时间: ${updated || 'N/A'}`);
console.log(`  总比赛数: ${matches.length}`);
console.log('═══════════════════════════════════════');

if (errors.length > 0 || warnings.length > 0 || groupIssues.length > 0) {
  if (errors.length > 0) {
    console.log('\n❌ 错误:');
    errors.forEach(e => console.log(`  • ${e}`));
  }
  if (warnings.length > 0) {
    console.log('\n⚡ 警告:');
    warnings.forEach(w => console.log(`  • ${w}`));
  }
  if (groupIssues.length > 0) {
    console.log('\n📊 小组完整性:');
    groupIssues.forEach(i => console.log(`  ${i}`));
  }
} else {
  console.log('\n✅ 全部通过，无问题');
}

console.log('\n📋 各小组概览:');
for (const [g, teams] of [...groupTeams.entries()].sort()) {
  const cnt = matches.filter(m => m.group === g).length;
  const expected = teams.size * (teams.size - 1) / 2;
  const ok = cnt >= expected;
  console.log(`  ${g}: ${[...teams].join(', ')} → ${cnt}/${expected} ${ok ? '✅' : '❌'}`);
}

console.log('\n📋 各球队完赛场次:');
for (const [t, info] of [...teamMatches.entries()].sort()) {
  const grp = [...(teamGroupMap.get(t) || [])][0] || 'N/A';
  const opps = info.matches.length === 3 ? '✅' : '⚠️';
  console.log(`  ${t.padEnd(25)} ${grp.padEnd(8)} ${info.matches.length}场 ${opps}`);
}

if (FLAG_FIX && groupIssues.some(i => i.includes('缺少对阵'))) {
  console.log('\n💡 使用 --fix 模式已输出补全模板（见上方缺失对阵行）');
}

console.log(`\n${errors.length > 0 ? '❌ 发现 ' + errors.length + ' 个错误' : '✅ 无错误'}`);
console.log(`${warnings.length > 0 ? '⚡ ' + warnings.length + ' 个警告' : '✅ 无警告'}`);
