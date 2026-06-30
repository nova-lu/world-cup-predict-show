/**
 * 冒烟测试 — 用于 CI 管线验证服务器和 API 是否正常工作
 * 启动服务器 → 检查关键端点 → 关闭服务器
 *
 * 用法: node verify.cjs
 * 退出码: 0 = 通过, 1 = 失败
 */
const { spawn } = require('child_process');
const http = require('http');

const PORT = 3000;
const BASE = `http://localhost:${PORT}`;

const ENDPOINTS = [
  { path: '/',            desc: '首页' },
  { path: '/standings',   desc: '积分榜' },
  { path: '/knockout',    desc: '淘汰赛' },
  { path: '/bracket',     desc: '晋级树' },
  { path: '/simulator',   desc: '模拟' },
  { path: '/api/teams',   desc: '球队 API' },
  { path: '/api/standings/groups',  desc: '小组积分 API' },
  { path: '/api/knockout/qualifiers', desc: '出线球队 API' },
  { path: '/api/knockout/third-rank', desc: '第三名 API' },
  { path: '/api/health',  desc: '健康检查 API' },
  { path: '/api/ai/status',  desc: 'AI 分析状态 API' },
];

async function fetch(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  console.log('🌍 冒烟测试启动...\n');

  // 启动服务器
  const server = spawn('node', ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // 等待服务器就绪
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('服务器启动超时')), 30000);
    server.stdout.on('data', (data) => {
      const line = data.toString();
      if (line.includes('启动') || line.includes('localhost')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.stderr.on('data', (data) => {
      if (data.toString().includes('启动') || data.toString().includes('localhost')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });

  // 等待几秒让 API 数据加载
  await new Promise(r => setTimeout(r, 5000));

  let passed = 0, failed = 0;
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetch(ep.path);
      if (res.status === 200 || res.status === 302) {
        console.log(`  ✅ ${ep.desc} (${ep.path}) — ${res.status}`);
        passed++;
      } else {
        console.log(`  ❌ ${ep.desc} (${ep.path}) — ${res.status}`);
        failed++;
      }
    } catch (e) {
      console.log(`  ❌ ${ep.desc} (${ep.path}) — ${e.message}`);
      failed++;
    }
  }

  // 关闭服务器
  server.kill();

  console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败, 共 ${ENDPOINTS.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('❌ 冒烟测试异常:', err.message);
  process.exit(1);
});
