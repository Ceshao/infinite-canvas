# 服务端代理 + 访问码免配置访问 设计文档

日期：2026-07-07
状态：已确认（方案 A）

## 背景与问题

当前 fork 的 AI 请求（图像/文本/视频/音频）全部由浏览器直连上游接口：

- API Key 持久化在浏览器 localStorage（`use-config-store.ts` zustand persist）
- 请求头 `Authorization: Bearer <apiKey>` 由浏览器直接发出（`services/api/image.ts:237` 等）

若把站长的 New API 密钥预填给访客共用，密钥会暴露给每一个访客（DevTools 可见），可被绕过网站直接刷额度。

## 目标

1. 访客打开网站输入一次**访问码**即可使用，无需配置 Base URL / API Key / 模型
2. New API 真密钥只存在于服务器环境变量，全程不落浏览器
3. 支持**多个访问码**，可单独作废
4. 模型列表自动从 New API `/v1/models` 拉取，按现有名称启发式分类（图/视频/文/音）
5. 不做每码限流（额度管控交给 New API 自身）
6. 上游同步友好：代码上保留原"本地直连"模式，通过环境变量隐藏（不设变量时行为与原版完全一致）
7. 部署到用户自己的 Linux 服务器（Docker，与 New API 同机，已有 Nginx 反代 + SSL 证书）

## 总体架构

```
浏览器 ──Bearer <访问码>──▶ Nginx（SSL）──▶ Next.js /api/ai/[...path]
                                              │ 校验访问码 → 换真密钥
                                              ▼ 内网
                                          New API 容器
```

前端注入一个虚拟"服务器渠道"：`{ id: "server", baseUrl: "/api/ai", apiKey: <访问码>, apiFormat: "openai", models: [...] }`，
现有请求层（buildApiUrl / aiHeaders / SSE 流式 / 视频轮询 / 音频 blob）**零改动**复用；
访问码作为渠道 apiKey 被现有 persist 机制自动记住。

## 服务端环境变量

| 变量 | 示例 | 说明 |
|---|---|---|
| `AI_PROXY_UPSTREAM_BASE_URL` | `http://new-api:3000` | New API 内网地址（尾部斜杠自动去除） |
| `AI_PROXY_API_KEY` | `sk-xxxx` | New API 真密钥 |
| `AI_PROXY_ACCESS_CODES` | `alice-x7k2,bob-m9q4` | 逗号分隔访问码，空白项忽略 |

三者齐备 = 服务端模式开启；任一缺失 = 行为与原版一致（隐藏开关）。

## 组件设计

### 新增：`web/src/app/api/ai/[...path]/route.ts`（透传代理）

- `runtime = "nodejs"`、`dynamic = "force-dynamic"`
- 支持 GET / POST（覆盖 models 拉取、生成、视频轮询与下载）
- 鉴权：从 `Authorization: Bearer <code>` 或 `x-goog-api-key: <code>` 读访问码，与
  `AI_PROXY_ACCESS_CODES` 名单比对；失败返回 `401 {"error":{"message":"访问码无效或已停用"}}`
  （该格式被前端现有 `readAxiosError` 正确解析展示）
- 转发：`/api/ai/<path>?<query>` → `<UPSTREAM>/<path>?<query>`；
  请求体以流透传（`duplex: "half"`，multipart/FormData 原样通过）；
  请求头只保留 `content-type`、`accept`，注入真实 `Authorization: Bearer <AI_PROXY_API_KEY>`
  （请求为 gemini 头时注入 `x-goog-api-key`）；
  响应体以流透传（SSE、blob 天然支持），透传响应 `content-type` 与状态码
- 上游不可达：返回 `502 {"error":{"message":"上游接口连接失败"}}`
- 服务端模式未开启时：返回 404

### 新增：`web/src/app/api/ai-config/route.ts`（服务端配置接口）

- `GET` 无鉴权 → `{ serverMode: boolean }`（前端据此决定 UI 形态）
- `GET` 带访问码且有效 → `{ serverMode: true, valid: true, models: string[] }`；
  models 来自 New API `/v1/models`（服务端内存缓存 5 分钟，拉取失败返回空数组并附 `modelsError`）
- 带访问码但无效 → `401`（前端用于校验访问码输入）

### 新增：`web/src/stores/use-server-mode-store.ts`（前端状态）

- `status: "unknown" | "off" | "on"`、`models: string[]`
- `initServerMode()`：应用加载时调用一次 `GET /api/ai-config`
- `verifyAccessCode(code)`：带码调用配置接口，成功后把服务器渠道写入
  `useConfigStore`（`channels = [serverChannel]`，按能力启发式填充
  `imageModels/videoModels/textModels/audioModels` 与默认选中模型）

### 新增：`web/src/components/layout/access-code-modal.tsx`

- 简单弹窗：一个输入框 + 确认按钮；校验失败提示"访问码无效"
- 首次访问（无有效访问码）自动弹出；之后可从原"配置"入口再次打开（换码）

### 修改（少量插入，控制冲突面）

| 文件 | 改动 |
|---|---|
| `app-config-modal.tsx` | 组件顶部分支：服务端模式 → 渲染 `AccessCodeModal` 代替原配置 UI（所有 `openConfigDialog` 调用点无需改动） |
| `client-root-init.tsx` | 服务端模式下忽略 `?baseurl=&apikey=` URL 导入；挂载时触发 `initServerMode()` |
| `docker-compose.yml` | 增加 `environment:` 三个变量的注释示例 |
| `README.md` | 增加服务端模式部署说明 |

### 能力分类复用

模型能力分类复用 `use-config-store.ts` 已导出的
`filterModelsByCapability / modelMatchesCapability`（名称启发式），不新写分类逻辑。

## 数据流

1. 访客首次打开 → `initServerMode()` → `{serverMode:true}` → 弹访问码窗
2. 输入访问码 → `verifyAccessCode` → 有效 → 写入服务器渠道（含模型清单）→ persist 记住
3. 生成请求 → 现有请求层 → `/api/ai/v1/...` + `Bearer <访问码>` → 代理换真密钥 → New API
4. 再次访问 → persist 恢复渠道 → `initServerMode()` 顺带刷新模型清单（码已失效则 401 → 重新弹窗）
5. 视频：创建/轮询/下载均走代理；Seedance CDN 结果 URL 由浏览器直接下载（无需鉴权）

## 错误处理

| 场景 | 行为 |
|---|---|
| 访问码无效/被作废 | 代理 401 + 中文消息；前端捕获后重新弹访问码窗 |
| 上游不可达 | 502 + "上游接口连接失败"；前端 toast 展示 |
| models 拉取失败 | 服务端模式仍开启，模型列表为空 + 错误提示，可重试 |
| 服务端模式未配置 | 一切行为与原版一致 |

## 部署

- 服务器上 `git clone` 本 fork → `docker compose build`（或复用 GHCR 镜像 + env 覆盖）
- compose 中将容器接入 New API 所在 docker 网络（或用宿主内网地址）
- 已有 Nginx 新增站点：`proxy_pass http://127.0.0.1:3000`；
  关键项：`proxy_buffering off`（SSE）、`client_max_body_size 100m`（dataUrl 参考图/视频）、
  `proxy_read_timeout 600s`（长生成任务）、挂用户提供的 SSL 证书

## 测试

项目无现有测试基建（仅 prettier）。采用：

1. **单元测试（bun test，零新依赖）**：代理的纯函数——访问码解析校验、路径映射、
   转发头构造；`ai-config` 的模型缓存逻辑
2. **本地手动 E2E 清单**：`bun dev` + 环境变量指向真实 New API，逐项验证
   文本（流式）/ 图像 / 音频 / 视频（轮询+停止）/ 错码 401 / 未配置回退原版行为
3. 部署后在服务器上用生产域名复验同一清单

## 明确不做（YAGNI）

- 每访问码限流/配额（交给 New API 令牌管理）
- 用户注册体系
- 服务端媒体存储（生成结果仍存浏览器 IndexedDB）
- WebDAV 同步改动（保持原样）
