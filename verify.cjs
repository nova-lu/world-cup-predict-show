const http = require('http');
const { spawn } = require('child_process');

const s = spawn('node', ['server/index.js'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
let err = '';
s.stderr.on('data', d => err += d);

function fetch(p) {
  return new Promise(r => {
    http.get('http://localhost:3000' + p, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => r({ status: res.statusCode, body: b }));
    }).on('error', e => r({ status: 0, body: e.message }));
  });
}

async function main() {
  await new Promise(r => setTimeout(r, 3000));

  const pages = ['/', '/schedule', '/standings', '/bracket', '/simulator', '/teams', '/demo', '/blog', '/backtest', '/methodology'];
  let ok = 0, fail = 0;

  for (const p of pages) {
    const d = await fetch(p);
    const isHTML = d.body.includes('<html') || d.body.includes('<!DOCTYPE');
    const isJSON = d.body.startsWith('{') && (d.body.includes('error') || d.body.includes('"teams"') || d.body.includes('"groups"'));
    const pass = d.status === 200 && isHTML;
    console.log((pass ? '✅' : '❌') + ' ' + p + ' → ' + d.status + ' ' + d.body.length + 'B ' + (isHTML ? 'HTML' : isJSON ? 'JSON!' : d.body.slice(0, 50)));
    if (pass) ok++;
    else fail++;
  }

  // Also test the bracket API returns JSON correctly
  const api = await fetch('/api/bracket');
  const apiOK = api.status === 200 && api.body.includes('"rounds"');
  console.log((apiOK ? '✅' : '❌') + ' /api/bracket → ' + api.status + ' ' + api.body.length + 'B ' + (apiOK ? 'JSON' : api.body.slice(0, 60)));

  console.log('\n结果: ' + ok + '/' + (pages.length + 1) + ' 通过, ' + fail + ' 失败');
  if (err) console.log('stderr:', err.slice(0, 500));
  s.kill();
  process.exit(fail > 0 ? 1 : 0);
}

main();
