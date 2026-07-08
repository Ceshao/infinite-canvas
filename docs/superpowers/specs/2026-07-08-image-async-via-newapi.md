# 图像生成异步化：经 new-api 任务中继（消除假同步）

日期：2026-07-08 ｜ 状态：✅ 已完成并验收 ｜ 前置：`2026-07-08-mgdb-via-newapi.md`（视频链路，已验收）

## 问题

图像链路是"假同步"：gw2.amlig.com 网关本身是异步任务制，但 image-gateway-shim 把它
包装成阻塞的 OpenAI Images API（内部 3 秒轮询、最长 240 秒持连），导致四层连接挂起、
断连丢图但已扣费、无进度、超时天花板 240s。

## 方案

复用视频链路验证过的 new-api Sora 任务外壳（type=1 渠道唯一可中继的异步任务形状）：

```
浏览器 → /api/ai → new-api（Sora 任务适配器，有状态中继+计费）
   → image-gateway-shim /v1/videos*（名为 videos，承载图像）→ gw2 异步任务接口
```

- 候选方案对比：Midjourney 方言是 new-api 唯一的原生异步图像中继，但协议无 model 字段
  （多模型需 prompt 附加标记），且需改渠道类型；Sora 外壳模型路由天然工作、渠道零改动、
  前端有视频模板——选 Sora 外壳，接受"路径名叫 videos"的命名代价（代码注释已说明）。
- 同步 /v1/images/* 保留为兼容路径（第三方 OpenAI 客户端仍可用）。

## 改动清单

### 前端（TDD）

1. `lib/ai-proxy.ts`：`parseAsyncImageModels(env)` 读 `AI_PROXY_ASYNC_IMAGE_MODELS`
   （逗号分隔，未配置=功能关闭，行为与原版一致）。
2. `/api/ai-config` 响应新增 `asyncImageModels`；`use-server-mode-store` 存入
   `AiConfig.asyncImageModels`（新字段，默认 []）。
3. `lib/server-proxy.ts`：通用 `isServerProxiedBaseUrl`（mgdb-video 的判定委托到此）。
4. `services/api/image.ts`：`requestGeneration`/`requestEdit` 在服务端模式且模型在清单内时
   走异步客户端（提交 /videos → 2.5s 轮询 → /content 取件 blob→dataUrl）；n>1 并行提交
   n 个任务（对比同步路径的串行 generate_one 还是性能改进）；蒙版参数与同步路径一致地
   不传给 gw2（网关不支持）。

### 图像 shim（/opt/image-gateway-shim/app.py）

- `POST /v1/videos`（JSON 或 multipart，首个文件=改图输入）→ gw2 `/v1/generate`，立即返回
  `{id, status:"queued"}`；`GET /v1/videos/<id>` 单次查询（含 401 刷新令牌重试）；
  `GET /v1/videos/<id>/content` 取 image_url（回退 `/img/<task_id>`）流式转发字节。
- 同步端点原样保留。

### 服务器配置

- `/opt/infinite-canvas/.env` 增加 `AI_PROXY_ASYNC_IMAGE_MODELS=nano-pro,nano-2,gpt-img2`
  （compose 需透传该变量）。
- 渠道 #2 密钥已与 shim `SHIM_API_KEY` 对齐（实测相等，无需变更）。
- new-api `fetch_setting.allow_private_ip=true` 已在视频改造时设置（取件代理依赖）。
- 计费：任务计费 = ModelPrice × seconds(默认 4) × group_ratio(1.5)，需为 nano-pro/nano-2/
  gpt-img2 配置 ModelPrice（图像无 seconds 概念，4 是固定乘数，定价时除回去即可）。

## 验收

cancanvas /image 用清单内模型生成：浏览器调 /api/ai/v1/videos*（不再长挂
/images/generations）；new-api 出现任务计费日志；图像可显示；断开重连后任务在
new-api 任务表中可查（结果不因客户端断连而丢失）。

## 验收结果（2026-07-08）

- curl 全链路：提交→轮询→取件，下载 1MB 真实 PNG（gw2 生成），new-api 计费日志
  `channel_id:2, model:nano-2, request_path:/v1/videos, model_price:0.02, is_task:true` ✅
- 浏览器真实 UI（Playwright）：/image 选 nano-2 生成，只出现
  POST /api/ai/v1/videos → GET .../videos/{id} → GET .../content，零同步长挂；
  赛博朋克城市图 1024×1024 正常显示 ✅

## 踩坑记录

- **能力分类器误判**（已修，commit beaadb1）：nano-2/nano-pro/gpt-img2 名字不含
  image/dall-e/flux 等关键词，`isImageModelName` 把它们判成文本模型，导致图像模型
  选择器里根本选不中。修法：`buildServerConfigUpdates` 里把 asyncImageModels 强制
  归入图像类并从文本/视频/音频类排除。
- 命名代价：异步图像走的是 new-api 的 /v1/videos 任务外壳（承载图像不是视频），
  这是 type=1 渠道唯一能中继的异步任务形状，代码注释已说明，勿误改。
