# Skill: Node.js 原生 fetch 代理适配 (undici ProxyAgent)

## 触发条件

Node.js 项目中使用 `fetch()` 请求墙外 API（如 Polymarket、OpenAI 等），
明明设置了 `HTTPS_PROXY` 环境变量且 curl 能通，但 Node 请求报 `ECONNRESET` 或超时。

## 根因

Node 18+ 原生 `fetch()` 不读 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量。
这是它与 curl、PowerShell 等工具的关键区别。

## 方案

用 `undici` 的 `ProxyAgent` 替换全局 `fetch`。

### 1. 安装 undici（如果未安装）

```bash
npm install undici
```

### 2. 替换 fetch

在需要代理的文件中：

```javascript
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const proxyUrl = process.env.HTTPS_PROXY ||
  process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
const proxyDispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

async function myFetch(url, ms = 8000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await undiciFetch(url, { signal: c.signal, dispatcher: proxyDispatcher });
  } finally { clearTimeout(t); }
}
```

### 3. 可复用模块

本项目已创建的模块：`server/utils/proxyFetch.js`

```javascript
import { proxyFetch, proxyGet, proxyPost } from '../utils/proxyFetch.js';
const data = await proxyGet('https://api.example.com/endpoint', 15000);
```

## 环境变量设置

```bash
# PowerShell
$env:HTTPS_PROXY="http://127.0.0.1:7890"
node server/index.js

# bash
export HTTPS_PROXY=http://127.0.0.1:7890
node server/index.js
```

启动日志会打印 `[proxyFetch] 代理模式: ON (http://...)`。

## Pitfalls

- **`{timeout:N}` 参数被静默忽略** — 必须用 `AbortController` 实现超时
- **`ProxyAgent` 只支持 HTTP/HTTPS 代理**，不支持 SOCKS
- **全局替换 `globalThis.fetch`** 会污染所有 fetch 行为，推荐按文件导入
- **Windows 上 `process.env` 不区分大小写**，但建议同时设 `HTTPS_PROXY` 和 `https_proxy`
