const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const errLog = path.join(__dirname, 'server_err.log');
const outLog = path.join(__dirname, 'server_out.log');
const errFd = fs.openSync(errLog, 'w');
const outFd = fs.openSync(outLog, 'w');

const server = spawn('node', ['server/index.js'], {
  cwd: __dirname,
  stdio: ['ignore', outFd, errFd],
  detached: false,
});

server.on('exit', (code, signal) => {
  fs.closeSync(errFd);
  fs.closeSync(outFd);
  console.log(`Server exited: code=${code} signal=${signal}`);
  process.exit(code || 0);
});

// Keep alive
setInterval(() => {}, 60000);
