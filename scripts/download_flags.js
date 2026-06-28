#!/usr/bin/env node
/**
 * SVG 旗帜下载脚本
 * Phase 8.5 — 从 flagcdn.com 下载 48 个参赛国的 SVG 旗帜
 *
 * 用法: node scripts/download_flags.js
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLAGS_DIR = path.resolve(__dirname, '../public/images/flags');

// slug → ISO 3166-1 alpha-2 国家代码映射
const SLUG_TO_ISO = {
  'mexico': 'mx', 'south-africa': 'za', 'south-korea': 'kr', 'czech-republic': 'cz',
  'canada': 'ca', 'bosnia-and-herzegovina': 'ba', 'qatar': 'qa', 'switzerland': 'ch',
  'brazil': 'br', 'morocco': 'ma', 'haiti': 'ht', 'scotland': 'gb-sct',
  'usa': 'us', 'paraguay': 'py', 'australia': 'au', 'turkey': 'tr',
  'germany': 'de', 'curacao': 'cw', 'ivory-coast': 'ci', 'ecuador': 'ec',
  'netherlands': 'nl', 'japan': 'jp', 'sweden': 'se', 'tunisia': 'tn',
  'belgium': 'be', 'egypt': 'eg', 'iran': 'ir', 'new-zealand': 'nz',
  'spain': 'es', 'cape-verde': 'cv', 'saudi-arabia': 'sa', 'uruguay': 'uy',
  'france': 'fr', 'senegal': 'sn', 'iraq': 'iq', 'norway': 'no',
  'argentina': 'ar', 'algeria': 'dz', 'jordan': 'jo', 'austria': 'at',
  'england': 'gb-eng', 'croatia': 'hr', 'uzbekistan': 'uz', 'ghana': 'gh',
  'portugal': 'pt', 'dr-congo': 'cd', 'colombia': 'co', 'panama': 'pa',
};

// 代理支持
const HTTPS_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.http_proxy || '';
const proxyFlag = HTTPS_PROXY ? `-x "${HTTPS_PROXY}"` : '';

async function downloadFlag(slug, isoCode) {
  // Ubuntu/Debian flag icons: https://raw.githubusercontent.com/Templarian/WindowsIcons/master/WindowsPhone/Flags/svg/{ISO}.svg
  // Or flagcdn: https://flagcdn.com/{iso2}.svg
  // For subnational flags (england, scotland), use alternative source
  let url;
  if (isoCode.includes('-')) {
    // Subnational (england, scotland)
    url = `https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/${isoCode}.svg`;
  } else {
    url = `https://flagcdn.com/${isoCode}.svg`;
  }

  const dest = path.join(FLAGS_DIR, `${slug}.svg`);

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      // Fallback: try flagcdn with uppercase
      const fallbackUrl = `https://flagcdn.com/${isoCode.toUpperCase()}.svg`;
      const resp2 = await fetch(fallbackUrl);
      if (!resp2.ok) {
        console.error(`  ✗ ${slug}: both sources failed (${resp.status}, ${resp2.status})`);
        return false;
      }
      const svg = await resp2.text();
      writeFileSync(dest, svg, 'utf-8');
      console.log(`  ✓ ${slug} (${isoCode}) — ${(svg.length / 1024).toFixed(1)}KB [fallback]`);
      return true;
    }
    const svg = await resp.text();
    writeFileSync(dest, svg, 'utf-8');
    console.log(`  ✓ ${slug} (${isoCode}) — ${(svg.length / 1024).toFixed(1)}KB`);
    return true;
  } catch (e) {
    console.error(`  ✗ ${slug}: ${e.message}`);
    return false;
  }
}

async function main() {
  mkdirSync(FLAGS_DIR, { recursive: true });
  console.log(`📁 旗帜目录: ${FLAGS_DIR}`);
  console.log(`🌐 下载 ${Object.keys(SLUG_TO_ISO).length} 面 SVG 旗帜...\n`);

  const results = await Promise.all(
    Object.entries(SLUG_TO_ISO).map(([slug, iso]) => downloadFlag(slug, iso))
  );

  const success = results.filter(Boolean).length;
  const failed = results.filter(r => !r).length;
  console.log(`\n✅ 完成: ${success} 成功, ${failed} 失败`);
}

main().catch(console.error);
