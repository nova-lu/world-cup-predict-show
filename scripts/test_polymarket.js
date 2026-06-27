#!/usr/bin/env node
/**
 * Polymarket API 验证脚本
 * 测试: GAMMA API 连接、事件获取、slug 过滤、标题切分、价格拉取
 *
 * 使用方法:
 *   cd worldcup_new_2026
 *   $env:HTTPS_PROXY="http://127.0.0.1:7890"; node scripts/test_polymarket.js
 */
import { proxyFetch, proxyGet } from '../server/utils/proxyFetch.js';
import { fetch as undiciFetch } from 'undici';

async function main() {
  console.log('========================================');
  console.log('Polymarket API 验证脚本');
  console.log('========================================\n');

  // ---- Step 1: 测试 GAMMA API (closed=true) ----
  console.log('【Step 1】GAMMA API 连接测试 (closed=true)');
  try {
    const url = 'https://gamma-api.polymarket.com/events?tag_id=102232&closed=true&end_date_min=2026-06-01&limit=10&offset=0';
    const r = await proxyFetch(url, {}, 15000);
    console.log(`  Status: ${r.status} ${r.ok ? '✅' : '❌'}`);
    if (!r.ok) { console.log(`  Error: ${r.status}`); process.exit(1); }
    const events = await r.json();
    console.log(`  事件数: ${events.length}`);

    const fifwc = events.filter(e => /^fifwc/.test(e.slug));
    console.log(`  fifwc 事件: ${fifwc.length}/${events.length}`);
    if (fifwc.length > 0) {
      console.log(`  第一个: ${fifwc[0].slug} | ${fifwc[0].title}`);
    }
  } catch(e) {
    console.log(`  ❌ 失败: ${e.message}`);
    console.log('\n  ⚠️ 代理配置需通过 HTTPS_PROXY 环境变量。在 PowerShell 中:');
    console.log('  $env:HTTPS_PROXY="http://127.0.0.1:7890"');
    console.log('  node scripts/test_polymarket.js');
    process.exit(1);
  }

  // ---- Step 2: 不加 closed 参数 ----
  console.log('\n【Step 2】不加 closed 参数（全部事件）');
  try {
    const data = await proxyGet('https://gamma-api.polymarket.com/events?tag_id=102232&end_date_min=2026-06-01&limit=10&offset=0', 15000);
    console.log(`  事件数: ${data.length}`);
    const closedCnt = data.filter(e => e.closed === true).length;
    const openCnt = data.filter(e => !e.closed).length;
    console.log(`  已结算: ${closedCnt} | 活跃: ${openCnt}`);

    const fifwc = data.filter(e => /^fifwc/.test(e.slug));
    console.log(`  fifwc 事件: ${fifwc.length}/${data.length}`);
    if (fifwc.length > 0) {
      const e = fifwc[0];
      console.log(`  详情:`);
      console.log(`    slug: ${e.slug}`);
      console.log(`    title: ${e.title}`);
      console.log(`    endDate: ${e.endDate}`);
      console.log(`    closed: ${e.closed}`);
      const parts = (e.title || '').split(/\s+vs\.?\s+/i);
      console.log(`    splitTitle: [${parts.join(' | ')}]`);

      const ml = (e.markets || []).filter(m => m.sportsMarketType === 'moneyline');
      console.log(`    moneyline 市场: ${ml.length}`);
      ml.forEach((m, i) => {
        console.log(`    --- ML ${i} ---`);
        console.log(`      groupItemTitle: ${m.groupItemTitle}`);
        try {
          const outcomes = JSON.parse(m.outcomes);
          const outcomePrices = JSON.parse(m.outcomePrices);
          console.log(`      outcomes: [${outcomes.join(', ')}]`);
          console.log(`      prices: [${outcomePrices.join(', ')}]`);
        } catch(e2) {
          console.log(`      parse error: ${e2.message}`);
        }
      });
    }
  } catch(e) {
    console.log(`  ❌ 失败: ${e.message}`);
  }

  // ---- Step 3: CLOB 价格历史 ----
  console.log('\n【Step 3】CLOB 价格历史');
  try {
    const data = await proxyGet('https://gamma-api.polymarket.com/events?tag_id=102232&end_date_min=2026-06-01&limit=10&offset=0', 15000);
    const fifwc = data.filter(e => /^fifwc/.test(e.slug));
    if (fifwc.length > 0) {
      const e = fifwc[0];
      const ml = (e.markets || []).filter(m => m.sportsMarketType === 'moneyline');
      if (ml.length > 0) {
        const tokenIds = JSON.parse(ml[0].clobTokenIds || '[]');
        const outcomes = JSON.parse(ml[0].outcomes || '[]');
        const yesIdx = outcomes.indexOf('Yes');
        if (yesIdx >= 0 && tokenIds[yesIdx]) {
          console.log(`  事件: ${e.slug}`);
          console.log(`  tokenId: ${tokenIds[yesIdx]}`);
          const cUrl = `https://clob.polymarket.com/prices-history?market=${tokenIds[yesIdx]}&interval=max&fidelity=3600`;
          const r = await proxyFetch(cUrl, {}, 15000);
          if (r.ok) {
            const hist = await r.json();
            const history = hist.history || [];
            console.log(`  价格历史点数: ${history.length}`);
            if (history.length > 0) {
              console.log(`  最新价格: ${history[history.length-1].p}`);
              console.log(`  最早价格: ${history[0].p}`);
            }
          } else {
            console.log(`  CLOB 返回: ${r.status}`);
          }
        }
      }
    }
  } catch(e) {
    console.log(`  ❌ 失败: ${e.message}`);
  }

  console.log('\n========================================');
  console.log('验证完成');
  console.log('========================================');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
