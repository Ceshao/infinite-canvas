# MGDB 视频改经 new-api 异步转发

日期：2026-07-08 ｜ 状态：实施中

## 目标

服务端模式下,画布的 MGDB 视频任务从「浏览器 → /api/mgdb → gw.amlig.com 直连」改为
「浏览器 → /api/ai → new-api（有状态异步任务中继）→ video-gateway-shim → gw.amlig.com」,
统一计量计费,全链路异步。

## 关键事实（源码实证,new-api v1.0.0-rc.15）

- new-api 对 **OpenAI 类型（type=1）渠道**的视频任务使用 **Sora TaskAdaptor**
  （`relay/relay_adaptor.go: ChannelTypeSora, ChannelTypeOpenAI → tasksora`）。
- Sora 适配器对上游的调用形状（shim 必须实现）：
  - 提交：`POST {base}/v1/videos`（客户端原始 body 透传,仅替换 model 字段；multipart 会重组）
  - 轮询：`GET {base}/v1/videos/{task_id}`,期望 `{id, status, progress, error?}`,
    status ∈ queued|pending / processing|in_progress / completed / failed|cancelled
  - 取件：`GET {base}/v1/videos/{task_id}/content`（new-api 的 VideoProxy 对 OpenAI 渠道固定拼这个路径,带渠道密钥）
- new-api 面向客户端：
  - `POST /v1/videos`（Sora 兼容,multipart 可带 `input_reference[]` 参考图）
  - `GET /v1/videos/{public_task_id}` / `GET /v1/videos/{public_task_id}/content`（TokenOrUserAuth）
  - new-api 后台轮询上游并记账,客户端轮询的是 new-api 的任务表
- **画布前端的 `createOpenAIVideoTask/pollOpenAIVideoTask` 已经是这套协议**（/videos 提交、
  轮询、/content 取件,参考图 input_reference[]）——前端只需放行,不需要新协议实现。

## 改动清单

### 前端（本仓库,TDD）

1. `web/src/lib/mgdb-video.ts`：新增 `isMgdbServerProxied(baseUrl)`（/api/ai 结尾 = 服务端模式）。
2. `web/src/services/api/video.ts`：`createVideoGenerationTask` 里 MGDB 分支,服务端模式下
   改走 `createOpenAIVideoTask`（provider="openai",自然复用轮询/取件）；直连网关模式保留原
   `createMgdbTask` 私有协议路径（不破坏自部署直连用户）。
3. `readAxiosError` 补充解析 new-api 任务错误格式 `{code: string, message: string}`。
4. `/api/mgdb` 代理保留：直连模式全量使用；服务端模式不再被视频生成使用（参考图经
   /v1/videos multipart 直达 shim 上传,无需单独通道）。

### shim（服务器 /opt/video-gateway-shim,Sora 三端点）

- `POST /v1/videos`：JSON 或 multipart；字段 model/prompt/seconds/size,文件字段视为参考图
  → 上传网关取 md5 → images；mgdb 平台 duration 吸附 {5,10,15} 且加 "s" 后缀；
  返回 `{id, object:"video", model, status:"queued", progress:0, created_at}`。
- `GET /v1/videos/<id>`：网关状态 → Sora 词汇（dispatched/processing→in_progress,
  completed→completed,failed→failed）,progress.percent → int。
- `GET /v1/videos/<id>/content`：查任务拿 result.url（相对 /files/...）→ 从网关流式转发字节。

### new-api（配置核查）

- VideoProxy 对渠道 base_url（http://video-gateway-shim:8080,私网）做 SSRF 校验,
  需确认 fetch 设置 AllowPrivateIp,不通则在后台放行。
- 模型定价：mgdb-seedance-2.0 计费 = ModelPrice × seconds 比率（EstimateBilling）,
  上线前用户需核对（探针实测 4s 预扣 $1.8）。

## 验收

cancanvas /video 用 mgdb-seedance-2.0 真实生成:浏览器仅调 /api/ai/v1/videos*;
new-api 出现 relay 日志与计费记录;shim 收到 /v1/videos 调用;视频可播放/下载。
