// Starts server and keeps it alive
const { spawn } = require('child_process');

const server = spawn('node', ['server/index.js'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});

process.on('SIGTERM', () => server.kill());
process.on('SIGINT', () => server.kill());
