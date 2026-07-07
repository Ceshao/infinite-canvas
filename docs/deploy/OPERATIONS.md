# 运维手册：cancanvas.shaolabs.xyz

> 本文档记录 2026-07-07 首次部署的完整过程、架构与踩坑记录。
> ⚠️ 本仓库公开，文档内所有敏感信息（密码/密钥/访问码/IP）均为占位符，真实值只保存在服务器上和密码管理器中，**严禁写入任何 git 文件**。

## 1. 架构总览

```
访客浏览器
   │  https（输入访问码，一次后 localStorage 记住）
   ▼
宝塔 Nginx（443/SSL，宿主机）
   │  proxy_pass → 127.0.0.1:3001（proxy_buffering off 支持 SSE）
   ▼
infinite-canvas 容器（Next.js standalone）
   │  /api/ai/[...path] 代理：校验访问码 → 换真密钥 → 流式转发
   │  /api/ai-config：模式探测 / 访问码校验 / 模型清单（缓存 5 分钟）
   ▼  docker 内网 new-api_default（http://new-api:3000）
New API 容器（宿主机 3000 端口）
   ▼
各上游模型供应商
```

**安全模型**：New API 真密钥只存在于服务器 `/opt/infinite-canvas/.env`（chmod 600）；
浏览器里只有低价值访问码，可随时作废。未设置代理环境变量时应用退回原版行为（用户自配置直连）。

## 2. 关键位置清单

### 服务器（阿里云 Ubuntu + 宝塔面板，IP 见密码管理器）

| 路径                                                        | 用途                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/opt/infinite-canvas/`                                     | 部署目录（git clone 的仓库副本）                                                              |
| `/opt/infinite-canvas/docker-compose.server.yml`            | 服务器专用 compose（**只拉镜像，无 build**）                                                  |
| `/opt/infinite-canvas/.env`                                 | `AI_PROXY_API_KEY` + `AI_PROXY_ACCESS_CODES` + `AI_PROXY_MGDB_API_KEY`（chmod 600，不进 git） |
| `/www/server/panel/vhost/nginx/cancanvas.shaolabs.xyz.conf` | 宝塔 Nginx 站点配置                                                                           |
| `/www/server/panel/vhost/cert/cancanvas.shaolabs.xyz/`      | SSL 证书（fullchain.pem / privkey.pem）                                                       |
| `/www/wwwlogs/cancanvas.shaolabs.xyz.log`                   | 访问日志（.error.log 为错误日志）                                                             |

### 仓库

| 路径                                                       | 用途                                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `.github/workflows/deploy-image.yml`                       | **fork 专用** CI：push main → 构建 → `ghcr.io/ceshao/infinite-canvas:latest` |
| `web/src/app/api/ai/[...path]/route.ts`                    | 透传代理路由（→ new-api）                                                    |
| `web/src/app/api/mgdb/[...path]/route.ts`                  | MGDB 视频网关代理路由（→ gw.amlig.com，协议见 `MGDB_API_最新状态.md`）       |
| `web/src/app/api/ai-config/route.ts`                       | 配置/模型清单接口                                                            |
| `web/src/stores/use-server-mode-store.ts`                  | 前端服务端模式逻辑                                                           |
| `docs/deploy/nginx-infinite-canvas.conf.example`           | Nginx 配置模板                                                               |
| `docs/superpowers/specs/2026-07-07-server-proxy-design.md` | 设计文档                                                                     |

### 容器与网络

- `infinite-canvas`：`127.0.0.1:3001 → 3000`，接入 `default` + `new-api_default` 两个网络
- `new-api`：宿主机 `0.0.0.0:3000`（**因此本应用不能再用宿主 3000 端口**）
- 上游地址走内网：`AI_PROXY_UPSTREAM_BASE_URL=http://new-api:3000`（不绕公网）

## 3. 日常操作

### 更新版本（标准流程）

```bash
# 1. 本地：改代码 → 提交 → 推送（自动触发 Actions 构建镜像，约 5-8 分钟）
git push origin main

# 2. 确认 Actions 成功后，服务器上执行：
cd /opt/infinite-canvas
docker compose -f docker-compose.server.yml pull
docker compose -f docker-compose.server.yml up -d
```

### 增删访问码（推荐：网页后台）

打开 https://cancanvas.shaolabs.xyz/admin，输入管理口令（存于服务器 `.env` 的 `AI_PROXY_ADMIN_PASSWORD`）。
生成/作废**即时生效，无需重启**；后台可查看每个码的备注、创建时间、请求数和最后使用时间。
数据存于 docker 卷 `canvas-data`（容器内 `/data/access-codes.json`）。

备用手段（后台不可用时）：进入卷编辑或删除 `access-codes.json`；删除该文件并重启容器会重新从 `.env` 的
`AI_PROXY_ACCESS_CODES` 种子导入。`.env` 里的码仅在数据文件不存在时才会导入。

### 启用 MGDB 视频通道（amlig 网关）

前端对模型名含 `mgdb` 的视频模型走专用代理 `/api/mgdb`（网关协议与 new-api 不兼容，不经过 new-api）：

1. `/opt/infinite-canvas/.env` 加 `AI_PROXY_MGDB_API_KEY=<gw.amlig.com 的 API Key>`
   （上游默认 `https://gw.amlig.com`，可用 `AI_PROXY_MGDB_UPSTREAM_BASE_URL` 覆盖）
2. `docker compose -f docker-compose.server.yml up -d`
3. new-api 侧只需让 `/v1/models` 返回 `mgdb-seedance-2.0`（渠道里挂上该模型名即可），
   实际视频请求不会打到 new-api；访问码鉴权与用量记录与 `/api/ai` 共用同一套

### 轮换 New API 密钥

1. New API 后台生成新令牌
2. 更新 `/opt/infinite-canvas/.env` 的 `AI_PROXY_API_KEY`
3. `docker compose -f docker-compose.server.yml up -d`
4. 在 New API 后台作废旧令牌

### 更换 SSL 证书（到期时）

```bash
# 新证书覆盖到（命名固定为 fullchain.pem / privkey.pem）：
/www/server/panel/vhost/cert/cancanvas.shaolabs.xyz/
chmod 600 /www/server/panel/vhost/cert/cancanvas.shaolabs.xyz/privkey.pem
/www/server/nginx/sbin/nginx -t && /etc/init.d/nginx reload
```

## 4. 部署后验证清单（每次变更后跑）

```bash
# 在服务器上执行（或任意外网机器）：
curl -s https://cancanvas.shaolabs.xyz/api/ai-config
# 预期 {"serverMode":true}

curl -s -w ' [%{http_code}]' -H 'Authorization: Bearer 错误的码' https://cancanvas.shaolabs.xyz/api/ai-config
# 预期 {"error":{"message":"访问码无效或已停用"}} [401]

curl -s -H 'Authorization: Bearer <真实访问码>' https://cancanvas.shaolabs.xyz/api/ai-config | head -c 200
# 预期 {"serverMode":true,"valid":true,"models":[...]}（模型清单非空）

# 流式生成（约消耗几个 token）：
curl -s -m 60 -X POST -H 'Authorization: Bearer <真实访问码>' -H 'Content-Type: application/json' \
  -d '{"model":"<模型名>","stream":true,"max_tokens":16,"messages":[{"role":"user","content":"说你好"}]}' \
  https://cancanvas.shaolabs.xyz/api/ai/v1/chat/completions | head -c 300
# 预期 data: {...delta...} SSE 逐块输出
```

浏览器侧：无痕窗口打开站点 → 自动弹"输入访问码" → 输码 → 模型选择器出现分类模型 → 生成正常 → 刷新免重输。

## 5. 踩坑记录（重要，避免重蹈覆辙）

### 🔴 坑 1：服务器只有 1.6GB 内存，严禁 `docker build`

首次部署时在服务器上执行 `docker build`，bun install + next build 吃光内存导致**整机假死约 20 分钟**
（SSH 超时、New API 无响应、Nginx TLS 握手被重置），最终靠阿里云控制台重启实例恢复。

**规矩**：镜像永远由 GitHub Actions 构建（`deploy-image.yml`，push main 自动触发），服务器只 `docker pull`。
compose 文件里刻意不写 `build:`，杜绝误操作。GHCR（ghcr.io）从该服务器可直接匿名拉取（包是公开的）。

### 🟡 坑 2：服务器上有两套 Nginx，别配错

- **生效的是宝塔的**：二进制 `/www/server/nginx/sbin/nginx`，站点配置在 `/www/server/panel/vhost/nginx/*.conf`，reload 用 `/etc/init.d/nginx reload`
- systemd 的 `nginx.service` 是 **inactive** 的摆设，往 `/etc/nginx/` 写配置不会生效

### 🟡 坑 3：宿主 3000 端口被 New API 占用

本应用容器映射为 `127.0.0.1:3001->3000`（只绑本地回环，公网入口只有 Nginx）。仓库默认 compose 的 `3000:3000` 在这台服务器上**不可用**。

### 🟡 坑 4：SSE 流式必须关闭 Nginx 缓冲

站点配置里 `proxy_buffering off;` 缺了它文本生成会整段卡住不逐字输出。同时 `client_max_body_size 100m`（参考图 dataUrl 大）、`proxy_read_timeout 3600s`（长任务）。

### 🟡 坑 5：服务器高负载时 SSH 的表现

假死期间 SSH 依次出现：`Error reading SSH protocol banner` → `Timeout opening channel` → 完全连不上。
遇到这组症状先查负载（大概率内存耗尽），不要反复重连（阿里云还会限速新连接）。ping 通但服务全挂 = 用户态饿死，等待或重启实例。

### 🟢 坑 6：上游代码 `next build` 本来就是坏的

上游 `/canvas` 页 `useSearchParams` 缺 Suspense 边界导致 `next build` 失败，已在本 fork 修复
（`web/src/app/(user)/canvas/page.tsx` 包了 `<Suspense>`）。同步上游时若该文件冲突，记得保住这个修复。

### 🟢 坑 7：仓库不是 prettier-clean

全量 `bun run format` 会改 100+ 个无关文件（行尾符），污染 diff 且加剧上游同步冲突。**只对自己改动的文件跑 prettier**。

### 附：Windows 本地开发坑

- bun 用 `npm install -g bun` 安装；本机 3000 端口被占，dev 用 `bunx next dev --webpack -p 3100`
- 杀 dev server：`netstat -ano | grep :3100` 找 PID 后 `taskkill //F //PID <pid>`（后台任务停止杀不掉子进程）
- Git Bash 调用远程命令时 `/www/...` 这类参数会被误转成本地路径，加 `MSYS2_ARG_CONV_EXCL="*"`
- 本机代理是 fake-IP DNS（198.18.x），对自有域名的 curl 验证不可靠，**验证一律在服务器侧做**
- Playwright 测 next dev：用 `wait_until="domcontentloaded"`（HMR 长连接使 networkidle 永不触发）；antd 两字按钮文字带自动空格（"确 认"），选择器别用 `has_text="确认"`；antd message 3 秒消失，用 `wait_for_selector` 及时断言

## 6. 故障速查

| 症状                     | 先查                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| 网站打不开               | `docker ps`（容器在吗）→ `curl 127.0.0.1:3001/api/ai-config`（应用活着吗）→ `/etc/init.d/nginx status` |
| 弹"访问码无效"但码是对的 | `.env` 是否被改动 / 容器是否重启加载了新 env：`docker exec infinite-canvas printenv                    | grep AI_PROXY_ACCESS`                                                                                              |
| 模型列表为空             | `docker exec infinite-canvas printenv                                                                  | grep UPSTREAM`；容器内连 New API：`docker exec infinite-canvas sh -c "wget -qO- http://new-api:3000/v1/models 2>&1 | head -c 100"` |
| 生成 401/429             | New API 后台看令牌额度与渠道状态                                                                       |
| 文本不逐字输出           | Nginx 站点配置 `proxy_buffering off` 是否还在                                                          |
| 整机无响应但 ping 通     | 大概率内存耗尽（是不是有人在服务器上 build 了？）→ 阿里云控制台重启                                    |
