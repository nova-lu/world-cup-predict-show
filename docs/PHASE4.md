# Phase 4 — 持久化缓存机制与手动刷新

## 现状分析（Phase 1-3 已完成）

当前项目在服务器端仅有一个**简易内存缓存** server/middleware/cache.js，用 Map 存储 + setTimeout 自动过期。此方案存在以下问题：

| 问题 | 影响 |
|---|---|
| 服务器重启即丢失缓存 | 重启后所有数据需要从远程 API 重新拉取，首页/赛程页出现白屏期 |
| 各模块各自定义 TTL | footballApi.js 用 5min、monteCarloService.js 用 10min、predictionService.js 用 1min、oddsApi.js 用 5min——没有统一策略 |
| 无持久化文件存储 | 没有磁盘级缓存，无法满足"数据能暂时缓存在一个地方能读取"的需求 |
| 无"强制刷新"入口 | 所有 API 调用共享同一个缓存键，前端没有任何办法触发手动更新 |
| 无缓存雪崩保护 | 并发请求同一个过期缓存键时，所有请求都会穿透到远程 API |
| 无缓存状态监控 | 前端无法获知当前数据是否为缓存、何时过期、是否正在刷新 |

**当前数据流（简化）：**

`	ext
浏览器 fetch(/api/...)
    -> Express 路由
        -> 服务函数调用 cache.get(key)
            -> 命中 -> 直接返回缓存数据
            -> 未命中 -> 调用远程 API -> cache.set(key, data, ttl) -> 返回数据
`

**各 API 端点当前缓存情况：**

| 端点 | 缓存键 | TTL | 是否可强制刷新 |
|---|---|---|---|
| GET /api/matches/today | api:matches (footballApi.js) | 5min | 否 |
| GET /api/matches/schedule | api:matches (共用) | 5min | 否 |
| GET /api/matches/upcoming | api:matches (共用) | 5min | 否 |
| GET /api/matches/match/:t1/:t2 | pred:home:away: (predictionService.js) | 1min | 否 |
| GET /api/standings/groups | api:standings (footballApi.js) | 5min | 否 |
| GET /api/standings/advancement | mc:full:5000 (monteCarloService.js) | 10min | 否 |
| GET /api/bracket | 无缓存（每次重建） | - | - |
| GET /api/odds/available | cachedEvents (oddsApi.js 内存变量) | 5min | 有 force=1 |
| GET /api/odds/match/:t1/:t2 | 无（由 fetchWcEvents 间接缓存） | - | - |

## 一、设计目标

1. **文件级持久缓存**：服务器重启后缓存不丢失，数据可从磁盘直接恢复
2. **30分钟自动过期**：缓存超过 30 分钟后，下一次请求自动触发远程 API 拉取新数据
3. **手动"更新"按钮**：前端所有数据页提供一个更新按钮，点击后强制刷新该页所有关联缓存
4. **缓存雪崩防护**：同一个缓存键并发请求时，只穿透一次远程 API，其余等待第一个结果
5. **缓存状态可感知**：API 响应中携带 _cache 元信息（是否命中、生成时间、过期倒计时），前端据此展示状态指示
6. **统一缓存层**：所有服务模块使用同一个增强后的 cache.js 接口，消除 TTL 碎片化
7. **数据稳定展示**：旧的缓存数据在后台刷新完成前始终保持可用，用户永远看不到空数据

## 二、架构设计

### 2.1 两级缓存模型

`	ext
                +-------------------------+
                |     浏览器 (前端)        |
                |  fetch() + 更新按钮      |
                +----------+--------------+
                           | force=1
                +----------v--------------+
                |    Express 路由层        |
                |  读取 req.query.force    |
                +----------+--------------+
                           |
                +----------v--------------+
                |  cache.js (统一缓存入口) |
                |                        |
                | +------------------+   |
                | |   L1: 内存 Map   |   |  <- 微秒级读取
                | +--------+---------+   |
                |          | 持久化          |
                | +--------v---------+   |
                | |  L2: 文件 JSON   |   |  <- 毫秒级读取，重启不丢
                | |  (data/cache/)   |   |
                | +------------------+   |
                +----------+--------------+
                           | 未命中 / 已过期 / force=1
                +----------v--------------+
                |  远程 API 调用层         |
                |  footballApi.js          |
                |  oddsApi.js              |
                +-------------------------+
`

**读路径：** L1 内存 -> 命中返回 -> L2 文件 -> 命中返回并回填 L1 -> 远程 API -> 回填 L1+L2

**写路径：** 远程 API 返回 -> 写入 L1 内存 -> 异步写入 L2 文件

**强制刷新：** 收到 force=1 -> 跳过 L1/L2 -> 直接调用远程 API -> 回填 L1+L2

### 2.2 缓存条目结构

`json
{
  "key": "api:matches",
  "value": {},
  "meta": {
    "createdAt": "2026-06-24T10:00:00.000Z",
    "updatedAt": "2026-06-24T10:00:00.000Z",
    "ttlMs": 1800000,
    "source": "api"
  }
}
`

### 2.3 统一缓存键规范

删除模块各自独立的 TTL 定义，统一在 cache.js 中维护：

| 缓存键 | 数据内容 | TTL | 来源 |
|---|---|---|---|
| api:matches | API 拉取的所有比赛数据 | 30min | football-data.org |
| api:standings | API 拉取的小组积分榜 | 30min | football-data.org |
| pred:{t1}:{t2}:{homeOverride} | 单场预测结果 | 30min | 模型计算 |
| scores:{t1}:{t2}:{homeOverride}:{n} | 比分分布 TOP N | 30min | 模型计算 |
| mc:full:{numSims} | 蒙特卡洛模拟结果 | 30min | 模型计算 |
| odds:events | Odds-API 赛事列表 | 30min | odds-api.io |
| odds:match:{t1}:{t2} | 单场赔率 | 30min | odds-api.io |
| bracket:full | 淘汰赛树数据 | 30min | 基于 mc 生成 |

## 三、任务分解

### 任务 1：重构 cache.js -> 统一缓存中间件

**文件：** server/middleware/cache.js

需要完成的功能：

`javascript
// get(key, options?)
//   options.force: boolean -> 强制跳过缓存
//   options.ttlMs: number  -> 该次操作的 TTL（默认 1800000）
//   返回值: { value, meta, hit: boolean }

// set(key, value, meta?)
//   写入 L1 内存
//   异步写入 L2 文件（不阻塞返回）
//   记录 meta.createdAt / meta.updatedAt / meta.ttlMs

// del(key) / delPattern(pattern)
//   del(key) 删除单个键
//   delPattern('api:*') 删除所有 api: 前缀的键

// flush() -> 清空所有缓存（L1 + L2 文件）

// stats() -> 返回 { size, keys, entries: [{ key, age, ttl, source }] }

// isStale(key) -> 判断是否过期（超 30min）
`

**L2 文件存储规则：**
- 目录：data/cache/
- 文件名：{缓存键的 safe 版本}.json（将 : 替换为 _，/ 替换为 _）
- 写文件使用流式写入，运行时不阻塞
- 启动时扫描 data/cache/ 目录，加载所有有效缓存到 L1
- 加载时检查 meta.createdAt + meta.ttlMs，已过期的跳过

**L2 加载时序：**
`	ext
1. 服务器启动
2. cache.js 初始化 -> 扫描 data/cache/*.json
3. 对每个文件：读 -> 解析 -> 检查是否过期 -> 过期则删除文件 -> 未过期则加载到 L1
4. 后续请求：走 L1 -> L2 -> API 的路径
`

### 任务 2：移除各模块中的独立缓存逻辑

涉及文件：
- server/services/footballApi.js
- server/services/predictionService.js
- server/services/monteCarloService.js
- server/services/oddsApi.js
- server/routes/bracket.js

**footballApi.js 示例改动：**
`javascript
// 旧：模块内自行调用 get/set
// const cached = get(cacheKey);
// if (cached) return cached;
// set(cacheKey, matches, 300_000);

// 新：由 cache.js 统一管理，函数只负责"获取数据"
export async function fetchAllMatches(force = false) {
  const cacheKey = 'api:matches';
  const cached = cache.get(cacheKey, { force });
  if (cached.hit) return cached.value;

  const data = await apiFetch(/competitions//matches);
  const matches = normalizeMatches(data);

  cache.set(cacheKey, matches, { source: 'api' });
  return matches;
}
`

**monteCarloService.js 示例改动：**
`javascript
// 旧：内部自己管理缓存
// const cached = get(cacheKey);
// if (cached) return cached;
// 模拟...
// set(cacheKey, output, 600_000);

// 新：依赖统一缓存
export function runMonteCarlo(numSims = 5000, force = false) {
  const cacheKey = mc:full:;
  const cached = cache.get(cacheKey, { force });
  if (cached.hit) return cached.value;
  // ... 模拟 ...
  cache.set(cacheKey, output, { source: 'computed' });
  return output;
}
`

**oddsApi.js 示例改动：**
`javascript
// 旧：独立的 cachedEvents 内存变量
// let cachedEvents = null;
// let cachedEventsAt = 0;

// 新：统一缓存
async function fetchWcEvents(force = false) {
  const cached = cache.get('odds:events', { force });
  if (cached.hit) return cached.value;
  const events = await request(/events?...);
  cache.set('odds:events', realEvents, { source: 'api' });
  return realEvents;
}
`

**bracket.js 示例改动：**
`javascript
// 旧：每次调用都重新跑 Monte Carlo
// 新：在 router 层直接利用 monteCarloService 的缓存结果
// bracket 本身不需要独立缓存，它的数据完全来自 Monte Carlo 结果
// 只要 mc:full:10000 有缓存，bracket 就是热数据
`

### 任务 3：Express 路由层添加 force=1 支持

**3a. 新增通用中间件** parseForceParam

`javascript
// server/middleware/parseForce.js
export function parseForceParam(req, res, next) {
  req.forceRefresh = req.query.force === '1' || req.query.force === 'true';
  next();
}
`

在 server/index.js 中全局注册：
`javascript
import { parseForceParam } from './middleware/parseForce.js';
app.use('/api', parseForceParam);
`

**3b. 修改所有 API 路由，将 req.forceRefresh 传递给服务层**

| 文件 | 端点 | 改动点 |
|---|---|---|
| routes/matches.js | GET /today | fetchAllMatches(req.forceRefresh) |
| routes/matches.js | GET /schedule | fetchAllMatches(req.forceRefresh) |
| routes/matches.js | GET /upcoming | fetchAllMatches(req.forceRefresh) |
| routes/matches.js | GET /match/:t1/:t2 | predictMatch(t1, t2, null, req.forceRefresh) |
| routes/standings.js | GET /groups | fetchStandings(req.forceRefresh) |
| routes/standings.js | GET /advancement | runMonteCarlo(sims, req.forceRefresh) |
| routes/bracket.js | GET /api/bracket | buildBracketData(req.forceRefresh) |

**3c. 每个 API 响应添加缓存元信息**

route 层在每个 API 返回前嵌入 _cache 字段：
`json
{
  "_cache": {
    "hit": true,
    "age": 300000,
    "ttl": 1800000,
    "staleAfter": "2026-06-24T10:30:00.000Z",
    "source": "api"
  }
}
`

### 任务 4：前端"更新"按钮

**4a. 新建公共 JS 模块** public/js/cache-ui.js

`javascript
// 所有页面共享的缓存状态 UI 组件

class CacheUI {
  constructor() {
    this.bar = null;
    this.init();
  }

  init() {
    this.bar = document.createElement('div');
    this.bar.id = 'cache-status-bar';
    this.bar.innerHTML = [
      '<span class="cache-indicator" id="cache-indicator"></span>',
      '<span class="cache-text" id="cache-text"></span>',
      '<button class="cache-refresh-btn" id="cache-refresh-btn">Update Data</button>'
    ].join('');
    document.body.appendChild(this.bar);
    this.bindEvents();
  }

  bindEvents() {
    document.getElementById('cache-refresh-btn').addEventListener('click', () => {
      this.refresh();
    });
  }

  setStatus(meta) {
    const indicator = document.getElementById('cache-indicator');
    const text = document.getElementById('cache-text');
    if (!meta) {
      indicator.className = 'cache-indicator cache-unknown';
      text.textContent = 'Status unknown';
      return;
    }
    const age = Date.now() - new Date(meta.createdAt).getTime();
    const remaining = meta.ttl - age;
    if (remaining <= 0) {
      indicator.className = 'cache-indicator cache-stale';
      text.textContent = 'Data expired, click to refresh';
    } else if (remaining < 300000) {
      indicator.className = 'cache-indicator cache-expiring';
      text.textContent = 'Expiring in ' + Math.round(remaining/60000) + 'min';
    } else {
      indicator.className = 'cache-indicator cache-fresh';
      text.textContent = 'Fresh / Updated ' + Math.round(age/60000) + 'min ago';
    }
  }

  startRefreshing() {
    const btn = document.getElementById('cache-refresh-btn');
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
  }

  finishRefreshing() {
    const btn = document.getElementById('cache-refresh-btn');
    btn.disabled = false;
    btn.textContent = 'Update Data';
  }

  async refresh() {
    this.startRefreshing();
    await this.doRefresh();
    this.finishRefreshing();
  }
}

window.cacheUI = new CacheUI();
`

**4b. 缓存状态栏样式** - 添加至 public/css/app.css

**4c. 每个页面的数据加载函数需要改造：**

当前每个页面在 <script> 中直接 etch(/api/...)，需要抽离成可重用的函数：

`javascript
// 在 app.js 中定义
async function cachedFetch(url, options = {}) {
  const separator = url.includes('?') ? '&' : '?';
  const forceUrl = options.force ? url + separator + 'force=1' : url;
  const resp = await fetch(forceUrl);
  const data = await resp.json();
  if (window.cacheUI && data._cache) {
    window.cacheUI.setStatus(data._cache);
  }
  return data;
}
`

**4d. 逐页面集成 (每个 .ejs 视图)**

| 页面 | 模板 | 操作 |
|---|---|---|
| 首页 | views/pages/index.ejs | fetch -> cachedFetch, 添加 force 参数 |
| 赛程页 | views/pages/schedule.ejs | 同上 |
| 晋级页 | views/pages/standings.ejs | 两个 fetch 都改造 |
| 淘汰赛树页 | views/pages/bracket.ejs | 同上 |
| 预测详情页 | views/pages/match.ejs | 同上 |
| 球队详情页 | views/pages/team-detail.ejs | 同上 |

### 任务 5：缓存预热与初始化

**5a. 服务器启动时自动加载文件缓存**

在 server/index.js 启动前：
`javascript
import { initCache } from './middleware/cache.js';
await initCache();  // 扫描 data/cache/ 目录加载到内存
`

**5b. 定时预刷新（可选优化）**

`javascript
// server/services/cacheWarmer.js
// 每 25 分钟执行一次，在 30 分钟过期前预刷新
const PRE_REFRESH_KEYS = ['api:matches', 'api:standings', 'odds:events'];
setInterval(async () => {
  for (const key of PRE_REFRESH_KEYS) {
    const entry = get(key);
    if (entry && !isStale(key)) continue;
    console.log('[CacheWarmer] 预刷新 ' + key);
  }
}, 25 * 60 * 1000);
`

### 任务 6：增强缓存监控端点

增强 GET /api/cache/stats 返回：

`json
{
  "status": "ok",
  "memory": {
    "size": 12,
    "entries": [
      {
        "key": "api:matches",
        "age": 600000,
        "ttl": 1800000,
        "remaining": 1200000,
        "source": "api"
      }
    ]
  },
  "disk": {
    "path": "data/cache/",
    "fileCount": 12,
    "totalSize": 156000
  }
}
`

## 四、实施顺序与依赖关系

`	ext
第1步: Task 1 -> 重写 cache.js（L1+L2 + force + stampede 保护）
第2步: Task 5 -> 初始化加载 + server/index.js 集成
第3步: Task 2 -> 逐个模块迁移到新 cache.js
   3a. footballApi.js（api:matches, api:standings）
   3b. predictionService.js（pred:*）
   3c. monteCarloService.js（mc:*）
   3d. oddsApi.js（odds:*）
   3e. bracket.js（由 routes 层直接使用 mc 缓存）
第4步: Task 3 -> 路由层 + 缓存元信息
第5步: Task 4 -> 前端更新按钮
第6步: Task 6 -> 监控端点
第7步: 全面测试 + 文档更新
`

## 五、边界情况与降级策略

| 场景 | 行为 |
|---|---|
| L1 命中，L2 未命中 | 正常返回，L2 不需要同步 |
| L1 未命中，L2 命中且未过期 | 从 L2 读，回填 L1，返回 |
| L2 命中但已过期 | 删除 L2 文件，走远程 API |
| 远程 API 超时/403 | 使用 L2 数据（即使已过期），响应标记 _degraded: true, _cache.stale: true |
| 远程 API 和 L2 都无数据 | 返回 503，前端展示"暂无数据" |
| 并发请求同一键 | 加锁在内存中，只穿透一次，其余等待 |
| force=1 但远程 API 失败 | 保留现有缓存不变，响应标记 _forceFailed: true |
| 写入 L2 文件失败 | 不抛出异常，仅 console.warn，L1 正常返回 |
| 服务器 SIGTERM | 已写入 L2 的数据不受影响 |

## 六、文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| **重写** | server/middleware/cache.js | L1+L2 统一缓存，stampede 保护，force 支持 |
| **新增** | server/middleware/parseForce.js | 解析 force=1 的 Express 中间件 |
| **新增** | data/cache/.gitkeep | 缓存目录占位 |
| **修改** | .gitignore | 添加 data/cache/*.json |
| **修改** | server/index.js | 启动时调用 initCache()，注册 parseForceParam |
| **修改** | server/services/footballApi.js | 移除内部 cache，统一使用 cache.* |
| **修改** | server/services/predictionService.js | 同上 |
| **修改** | server/services/monteCarloService.js | 同上 |
| **修改** | server/services/oddsApi.js | 同上 |
| **修改** | server/routes/bracket.js | 添加 force 参数传递 |
| **修改** | server/routes/matches.js | 传递 req.forceRefresh |
| **修改** | server/routes/standings.js | 同上 |
| **修改** | server/routes/odds.js | 统一使用新的 cache.js |
| **新增** | public/js/cache-ui.js | 缓存状态 UI 组件 |
| **修改** | public/js/app.js | 添加 cachedFetch() 工具函数 |
| **修改** | public/css/app.css | 添加缓存状态栏样式 |
| **修改** | views/partials/footer.ejs | 引入 cache-ui.js |
| **修改** | views/pages/index.ejs | 集成刷新逻辑 |
| **修改** | views/pages/schedule.ejs | 同上 |
| **修改** | views/pages/standings.ejs | 同上 |
| **修改** | views/pages/bracket.ejs | 同上 |
| **修改** | views/pages/match.ejs | 同上 |
| **修改** | views/pages/team-detail.ejs | 同上 |
| **修改** | views/pages/simulator.ejs | 同上 |
| **新增** | docs/PHASE4.md | 本文档 |

## 七、验收标准

1. [ ] 服务器重启后，API 数据仍然可用（无需重新调用远程 API）
2. [ ] 30 分钟内重复请求同一端点，不会触发远程 API 调用（缓存命中）
3. [ ] 30 分钟后首次请求，自动触发远程 API 拉取新数据
4. [ ] 点击任意页面的"更新数据"按钮，所有关联缓存强制刷新，页面数据同步更新
5. [ ] 远程 API 不可用时，系统自动降级使用 L2 文件缓存（即使数据已过期），页面不白屏
6. [ ] 所有 API 响应携带 _cache 元信息，前端状态栏正确显示
7. [ ] 并发请求同一缓存键时，只穿透一次远程 API
8. [ ] 更新过程中按钮显示 loading 状态，不可重复点击
