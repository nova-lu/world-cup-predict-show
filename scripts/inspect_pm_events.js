#!/usr/bin/env node
/**
 * 验证 Polymarket API 的事件和市场类型分布
 * 用途: 查看世界杯 tag 下有哪些不同类型的事件
 *
 * $env:HTTPS_PROXY="http://127.0.0.1:7890"; node scripts/inspect_pm_events.js
 */
import { proxyGet } from '../server/utils/proxyFetch.js';

async function main() {
  console.log('=== Polymarket 事件类型分布 ===\n');

  // 不加 closed 和 slug 过滤，拉全部事件看类型
  const data = await proxyGet(
    'https://gamma-api.polymarket.com/events?tag_id=102232&limit=100&offset=0',
    20000
  );

  console.log(`总事件数 (第一批100): ${data.length}\n`);

  // 按 slug 模式分组
  const bySlugPattern = {};
  const byMarketType = {};

  for (const e of data) {
    // slug 模式
    const slugPrefix = (e.slug || '').split('-').slice(0, 2).join('-');
    const slugEnd = (e.slug || '').match(/\d{4}-\d{2}-\d{2}$/) ? 'DATE_SUFFIX' : 'NO_DATE';
    const slugKey = `${slugPrefix}_${slugEnd}`;
    bySlugPattern[slugKey] = (bySlugPattern[slugKey] || 0) + 1;

    // 市场的 sportsMarketType 分布
    const mktTypes = new Set();
    for (const m of (e.markets || [])) {
      if (m.sportsMarketType) mktTypes.add(m.sportsMarketType);
    }
    for (const t of mktTypes) {
      byMarketType[t] = (byMarketType[t] || 0) + 1;
    }

    // 显示前5个事件的详细信息
  }

  console.log('按 slug 模式分组:');
  for (const [k, v] of Object.entries(bySlugPattern).sort((a, b) => b[1] - a[1])) {
    const samples = data.filter(e => {
      const p = (e.slug || '').split('-').slice(0, 2).join('-');
      const end = (e.slug || '').match(/\d{4}-\d{2}-\d{2}$/) ? 'DATE_SUFFIX' : 'NO_DATE';
      return `${p}_${end}` === k;
    }).slice(0, 3).map(e => `  ${e.slug} → ${e.title}`).join('\n');
    console.log(`  ${k}: ${v} 个事件`);
    console.log(samples);
    console.log();
  }

  console.log('\n按 sportsMarketType 分组:');
  for (const [k, v] of Object.entries(byMarketType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v} 个事件包含此类型市场`);
  }

  // 显示每个事件的详情
  console.log('\n=== 前8个事件完整详情 ===');
  for (const e of data.slice(0, 8)) {
    console.log(`\n--- ${e.slug} ---`);
    console.log(`  title: ${e.title}`);
    console.log(`  closed: ${e.closed}`);
    console.log(`  endDate: ${e.endDate}`);
    const mktTypes = [...new Set((e.markets || []).map(m => m.sportsMarketType).filter(Boolean))];
    console.log(`  sportsMarketTypes: [${mktTypes.join(', ')}]`);
    for (const m of (e.markets || []).slice(0, 4)) {
      console.log(`    market: ${m.sportsMarketType} | groupItemTitle: ${m.groupItemTitle} | outcomes: ${(m.outcomes || '').substring(0, 60)}`);
    }
  }
}

main().catch(e => { console.error('Fatal:', e.message, e.cause?.message || ''); process.exit(1); });
