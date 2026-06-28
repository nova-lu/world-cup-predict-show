# Phase 9 — GitHub CI/CD 自动化部署与域名管理体系

## 背景

2026 世界杯已进入淘汰赛阶段，系统具备完整的双引擎预测、赔率融合、淘汰赛仪表盘和在线学习能力。但目前仅在本地服务器运行，缺乏自动化部署、持续集成和自动域名管理。

当前状态：
- 代码已存在 GitHub 仓库
- 服务器本地启动：node server/index.js（端口 3000）
- ML 引擎依赖 Python 子进程（scikit-learn / xgboost / joblib）
- 模型文件约 55MB（rf_1x2_calibrated.pkl 约 80MB）
- 依赖外部 API（football-data.org / Odds-API.io / Polymarket）
- .env 文件存储 API Key
部署难点：
- Node.js + Python 双语言环境
- 大型模型文件的分发和加载
- 外部 API Key 的安全管理
- 有限的免费部署资源（Railway / Render 免费层）
- 动态内存和 CPU 资源限制
- 自动域名申请和 SSL 管理

---

## Phase 9 完成状态

| 任务 | 状态 | 说明 |
|------|------|------|
| 9.1 GitHub Actions 基础管线 | ✅ 完成 | CI 管线：Node 24 + Python 3.11 + 冒烟测试 |
| 9.2 Docker 容器化构建 | ✅ 完成 | 双层 Dockerfile + .dockerignore |
| 9.3 多平台部署支持 | ✅ 完成 | Railway / Render / VPS 三种方案 |
| 9.4 域名与 SSL 管理 | ⬜ 待做 | 自动申请域名 + Let's Encrypt |
| 9.5 环境变量与秘钥管理 | ✅ 完成 | .env.template + GitHub Secrets 指南 |
| 9.6 监控与告警 | ✅ 完成 | /api/health 端点 + 冒烟测试 |
| 9.7 回滚与版本管理 | ✅ 完成 | rollback.yml 回滚管线 |

---

## 一、架构总览

`
GitHub Repo (git push)
    |
    v
+----------------------+
| GitHub Actions CI/CD |
|   .github/workflows/ |
+----------+-----------+
    |
    +-- [Job 1: Lint & Test] --------+
    |    - npm ci                     |
    |    - node verify.cjs            |
    +--------------------------------+
    |
    +-- [Job 2: Build & Package] ----+
    |    - Build Docker image         |
    |    - Push to registry           |
    +--------------------------------+
    |
    +-- [Job 3: Deploy] -------------+
    |    - Select target platform     |
    |    - Deploy container/service   |
    |    - Provision domain           |
    |    - Health check               |
    +--------------------------------+
`
### 设计原则
- 一键部署：git push 后全自动完成构建、测试、部署、域名申请
- 可选择性：同时支持 Railway / Render / VPS / Docker 四种方案
- 安全第一：API Key 通过 GitHub Secrets 管理，从不写入代码
- 成本可控：先使用免费层部署，必要时升级到付费方案
- 可回滚：每次部署畸新版本，发现问题时一键回滚到上一个稳定版本

---

## 二、任务分解

---

### 任务 9.1：GitHub Actions 基础管线

目标：构建最小可行的 CI 管线，确保每次提交都经过自动校验。

实施项：
1. 新建 .github/workflows/ci.yml 文件
2. 触发条件：push 到 main 分支或 pull request
3. 构建环境：Node.js 24 + Python 3.13 + Ubuntu latest
4. 构建步骤：
   - 安装 Node.js 依赖（npm ci）
   - 安装 Python 依赖（pip install scikit-learn xgboost joblib）
   - 运行 verify.cjs 校验所有页面和 API
   - 运行 ESLint 代码格式校验（可选）
5. 输出与通知：构建结果发送到 GitHub 提交状态

交付物：
- .github/workflows/ci.yml — CI 管线配置
---

### 任务 9.2：Docker 容器化构建

目标：将应用封装为 Docker 镜像，确保环境一致性和可移植性。

实施项：
1. 新建 Dockerfile（双层构建）
   - 基础层：python:3.13-slim 加 Node.js 24
   - 安装 Python 依赖（scikit-learn / xgboost / joblib / numpy / pandas）
   - 复制模型文件和数据文件
   - 配置启动命令为 CMD node server/index.js
2. 新建 .dockerignore，排除不必要的文件
3. 新建 docker-compose.yml（可选），支持多服务协调
4. 镜像优化：多阶段构建减小体积

交付物：
- Dockerfile — 双层 Docker 构建
- .dockerignore — Docker 排除配置
- docker-compose.yml — 服务协调配置（可选）

---

### 任务 9.3：多平台部署支持

目标：提供多种部署方案，根据需求自由选择。

方案 A——Railway（推荐）
- Railway 支持 Node.js + Python 双语言环境
- GitHub 仓库连接后自动部署
- 免费层提供每月  信用额度，足够应对日均几十次 API 调用
- 支持自定义域名（可选）
- 配置文件：railway.json 和 Nixpacks 自动检测

方案 B——Render
- Render Web Service 支持 Node.js + 自定义启动命令
- 免费层提供 750 小时/月运行时间
- 支持内置域名（*.onrender.com）和自定义域名
- Python 依赖需通过 build 脚本在 render.yaml 中安装

方案 C——VPS 服务器
- 支持任何具备 Docker 的云服务器（DigitalOcean / 陿途 / 腾讯云）
- 通过 GitHub Actions SSH 推送 Docker 镜像并启动
- 需手动配置 Nginx / Caddy 反向代理
- 最灵活但维护成本最高

交付物：
- railway.json — Railway 配置
- render.yaml — Render 配置
- .github/workflows/deploy-vps.yml — VPS 部署管线
---

### 任务 9.4：域名与 SSL 管理

目标：自动申请域名并配置 HTTPS，确保网站可通过自定义域名访问。

实施项：
1. 方案 A：使用部署平台内置域名
   - Railway: *.railway.app 或自定义域名
   - Render: *.onrender.com 内置 SSL
   - 无需额外配置，平台自动管理 SSL
2. 方案 B：自定义域名（推荐）
   - 在域名注册商购买域名（如 worldcup2026-predict.com）
   - 配置 DNS A/CNAME 记录指向部署平台
   - 在 Railway / Render 控制台添加自定义域名
   - 平台自动申请 Let Encrypt SSL 证书
3. 方案 C：VPS + Caddy
   - Caddy 服务器自动管理 SSL
   - 配置 Caddyfile 反向代理到应用端口

交付物：
- 域名 DNS 配置指南（文档）
- VPS Caddyfile 配置（可选）

---

### 任务 9.5：环境变量与秘钥管理

目标：安全管理 API Key 和环境变量，确保秘钥从不写入代码。

实施项：
1. GitHub Secrets 配置
   - FOOTBALL_API_KEY: football-data.org API Key
   - ODDS_API_KEY: Odds-API.io API Key
   - DEPLOY_TOKEN: 部署平台的 API Token
2. .env.template 文件
   - 新建 .env.template 作为参考
   - 包含所有必要的环境变量列表和说明
3. 部署平台环境变量配置
   - Railway: 在控制台或通过 railway 命令行设置
   - Render: 在 Dashboard 中设置 Environment Variables
   - VPS: 通过 .env 文件或管理器设置

交付物：
- .env.template — 环境变量模板
- 秘钥管理文档（说明如何获取 API Key）
---

### 任务 9.6：监控与告警

目标：确保部署后系统健康可观测，出现问题时及时告知。

实施项：
1. 健康检查端点
   - 新增 GET /api/health 端点，返回服务器状态、内存使用、uptime
   - 检查 ML 模型是否可加载
   - 检查缓存是否正常工作
   - 检查 .env 秘钥是否配置完整
2. 平台内置监控
   - Railway/Render 提供日志流查看
   - 查看部署历史和构建日志
3. 外部监控（可选）
   - UptimeRobot 免费层监控网站可用性
   - 设置每 5 分钟检查一次
   - 下线时通过邮件 / 微信通知

交付物：
- server/index.js 扩展—新增 /api/health 端点
- 监控配置文档

---

### 任务 9.7：回滚与版本管理

目标：确保每次部署可回滚，降低部署风险。

实施项：
1. Railway / Render 内置回滚
   - 支持一键回滚到上一个成功部署
   - 在控制台查看版本历史
2. Docker 镜像版本管理
   - 使用 git commit SHA 作为镜像标签
   - 保留最近 5 个版本，删除过早的镜像
3. GitHub Actions 回滚管线
   - 新建 .github/workflows/rollback.yml
   - 可通过 GitHub 控制台触发回滚

交付物：
- .github/workflows/rollback.yml — 回滚管线
- 回滚操作手册（文档）
---

## 三、验收 KPI

| 指标 | 目标 | 说明 |
|------|------|------|
| CI 管线执行时间 | < 5 分钟 | 包含安装依赖 + 测试 |
| Docker 镜像体积 | < 2GB | 包含 Node.js 依赖 + Python 依赖 + 模型文件 |
| 部署时间（平台部署） | < 10 分钟 | 从 push 到网站可访问 |
| 部署时间（Docker） | < 3 分钟 | 不包含镜像构建时间 |
| 域名可访问时间 | < 30 分钟 | 从 DNS 配置到可访问 |
| 网站可用性 | > 99.5% | 不包含平台维护时间 |
| 日志保留 | > 7 天 | 供排查日志使用 |
| 回滚响应时间 | < 5 分钟 | 从触发回滚到恢复 |

---

## 四、推荐迭代节奏

由于 2026 世界杯已进入淘汰赛，时间紧迫，建议 3-5 天内完成部署：

| 阶段 | 时间 | 任务 |
|------|------|------|
| Day 1 | 6-8 小时 | Docker 容器化 + CI 管线 |
| Day 2 | 4-6 小时 | 部署到 Railway/Render + 域名配置 |
| Day 3 | 2-4 小时 | 健康检查 + 监控 + 回滚机制 |
| Day 4 | 可选 | 回滚演练 + 文档完善 |

---

## 五、项目文件变更清单

### 新增文件（9 个）

.github/workflows/ci.yml          # CI 管线
.github/workflows/deploy-vps.yml  # VPS 部署管线
.github/workflows/rollback.yml    # 回滚管线
Dockerfile                         # Docker 构建文件
.dockerignore                      # Docker 排除配置
docker-compose.yml                 # Docker 服务协调
railway.json                       # Railway 配置
render.yaml                        # Render 配置
.env.template                      # 环境变量模板

### 修改文件（2 个）

server/index.js                    # 新增 /api/health 健康检查端点
docs/DEPLOY.md                     # 更新部署文档
---

## 六、回滚与应急策略

| 问题 | 自动处理 | 手动处理 |
|------|---------|---------|
| GitHub Actions 构建失败 | 通知提交者，不影响当前部署 | 检查构建日志修复问题 |
| 部署后服务器不可用 | 自动回滚到上一版本 | 在控制台手动回滚 |
| 外部 API 不可用 | 系统自动降级到本地数据 | 检查 API Key 有效性 |
| ML 模型加载失败 | Elo 引擎降级 | 检查模型文件是否完整 |
| 域名无法访问 | 检查 DNS 解析状态 | 重新配置 DNS 记录 |
| SSL 证书过期 | 平台自动更新 | 手动刷新证书 |

---

## 七、结论

Phase 9 不是增加新的预测能力，而是将整个项目从“本地工具”升级为“云端服务”。它解决的核心问题是：

1. 从本地到生产：git push 即可得到可访问的网站
2. Node.js + Python 双语言环境的 Docker 容器化解决方案
3. 多种部署方案的自由选择（免费 / 付费 / 自管）
4. 自动域名和 SSL 管理，无需手动配置
5. 完整的监控、告警和回滚机制

建议优先使用 Railway 免费层部署，取得域名后可在最短时间内让网站上线。如果需要更高的性能和灵活性，可以随时迁移到 VPS + Docker 方案。

部署上线后，任何人都可以通过浏览器访问网站，查看实时比赛预测、普级概率、淘汰赛树和赔率融合，而不再受限于本地开发环境。