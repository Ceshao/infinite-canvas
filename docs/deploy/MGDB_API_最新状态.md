# MGDB 视频生成 API

**入口**：`https://gw.amlig.com`

> 更新：2026-06-29。对外 API 契约不变（prompt/ratio/duration/images，按次扣 `counts_mgdb`）。
> 底层已从匿名通路切换为**登录态号池**（用户无感），新增一种"无可用账号"错误，见第 2 节末尾「供给说明」。

## 接口列表

| 方法 | 路径                       | 说明         |
| ---- | -------------------------- | ------------ |
| POST | `/api/v1/file/upload`      | 上传参考图   |
| POST | `/api/v1/generate`         | 提交生成任务 |
| GET  | `/api/v1/task/:taskId`     | 查询任务     |
| GET  | `/api/v1/balance`          | 查询余额     |
| GET  | `/files/:taskId/final.mp4` | 下载视频     |

所有需鉴权的接口：`Authorization: Bearer <API_KEY>`

---

## 1. 上传参考图

```
POST /api/v1/file/upload
Content-Type: multipart/form-data
```

| 字段   | 说明                |
| ------ | ------------------- |
| `file` | 图片文件（jpg/png） |

**响应**

```json
{ "md5": "c43afd39a2182c2088779f335bae1b5b", "filename": "ref1.jpg" }
```

---

## 2. 提交生成任务

```
POST /api/v1/generate
Content-Type: application/json
```

**请求体**

```json
{
  "platform": "mgdb",
  "type": "video",
  "model": "sd_2.0_fast",
  "prompt": "镜头慢慢推近这片山水风景，水面泛起细微波纹",
  "ratio": "16:9",
  "duration": 5,
  "images": ["c43afd39a2182c2088779f335bae1b5b"]
}
```

| 字段       | 必填 | 默认     | 说明                                             |
| ---------- | :--: | -------- | ------------------------------------------------ |
| `platform` |  是  | —        | 固定 `"mgdb"`                                    |
| `type`     |  是  | —        | 固定 `"video"`                                   |
| `model`    |  否  | —        | 固定 `"sd_2.0_fast"`                             |
| `prompt`   |  是  | —        | 视频描述                                         |
| `ratio`    |  否  | `"16:9"` | `1:1` / `3:4` / `4:3` / `16:9` / `9:16` / `21:9` |
| `duration` |  否  | `5`      | `5` / `10` / `15`（秒）                          |
| `images`   |  否  | `[]`     | 参考图 md5 数组，最多 9 张                       |

**ratio → 输出分辨率**

| ratio  |   W × H    |
| :----: | :--------: |
| `1:1`  | 960 × 960  |
| `3:4`  | 834 × 1112 |
| `4:3`  | 1112 × 834 |
| `16:9` | 1280 × 720 |
| `9:16` | 720 × 1280 |
| `21:9` | 1470 × 630 |

> **参考图比例规则**：当 `images` 含高质量主图且其比例 ≠ `ratio` 时，实际产物比例按参考图比例输出，`ratio` 参数对此场景无效。需精确比例输出时，调用方自行裁剪图。

**响应**

```json
{
  "task_id": "gw_7bfdbcd422ad4f53",
  "status": "dispatched",
  "billing_mode": "count",
  "count_bucket": "mgdb",
  "count_amount": 1,
  "bucket_label": "MGDB 次数"
}
```

**错误响应**

|      HTTP      | error                                                                               | 含义                                                                                                       |
| :------------: | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
|      400       | `prompt 必填` / `ratio 只支持 ...` / `duration 只支持 ...` / `图片 md5 不存在: ...` | 参数错                                                                                                     |
|      402       | `计数不足（bucket=mgdb，需要 1，当前 0）`                                           | 余额不够                                                                                                   |
|      503       | `mgdb 并发已满 (N/N)，请稍后重试`                                                   | 服务端满槽，含 `retryAfterSec: 30`                                                                         |
| 503 / 提交失败 | `mgdb 无可用登录态账号：号池空或额度用尽`                                           | **号池暂时无可用账号**（账号每日额度用尽或都在忙），**稍后重试**（含 `retryAfterSec`）。见下方「供给说明」 |

### 供给说明（登录态号池）

- mgdb 现在走**登录态号池**：池里每个账号每天有限额度（约 6 点：`5s=1点 / 10s=2点 / 15s=3点`），北京时间 0 点重置。
- 当全池额度用尽或账号都在忙时，提交会返回**"无可用登录态账号"**（带 `retryAfterSec`）—— 这不是参数错，**等额度恢复或补号后重试即可**。
- 跑量大时建议：① 优先用短时长（5s 最省额度）；② 失败带 `retryAfterSec` 时按提示间隔重试；③ 需要更高产能就补号（联系运维）。

---

## 3. 查询任务

```
GET /api/v1/task/:taskId
```

**响应**

```json
{
  "task_id": "gw_7bfdbcd422ad4f53",
  "platform": "mgdb",
  "type": "video",
  "model": "sd_2.0_fast",
  "status": "completed",
  "prompt": "镜头慢慢推近这片山水风景，水面泛起细微波纹",
  "ratio": "16:9",
  "duration": 5,
  "images": ["c43afd39a2182c2088779f335bae1b5b"],
  "created_at": "2026-06-07 01:02:00",
  "completed_at": "2026-06-07 01:05:21",
  "result": {
    "url": "https://gw.amlig.com/files/gw_7bfdbcd422ad4f53/final.mp4"
  },
  "progress": {
    "stage": "submitting",
    "message": "提交并等待生成（约 2-4 分钟）"
  }
}
```

**status**：`dispatched` / `processing` / `completed` / `failed`

**progress.stage**（仅未完成时返回）：`queued` / `submitting` / `downloading` / `dewing`

轮询建议：5 秒一次。

---

## 4. 查询余额

```
GET /api/v1/balance
```

**响应**

```json
{
  "id": 3,
  "credits": 9919,
  "counts": {
    "mgdb": { "balance": 99, "used": 1, "charged": 100, "label": "MGDB 次数" }
  }
}
```

---

## 5. 下载视频

```
GET /files/:taskId/final.mp4
```

任务详情 `result.url` 即完整地址，无需鉴权。

> ⚠️ 2026-07-07 实测：`result.url` 实际返回的是**相对路径**（如 `/files/gw_xxx/final.mp4`），
> 并非完整地址，且带有额外字段 `type`/`localSize`。调用方需自行拼接网关域名。

---

## e2e 示例

```bash
KEY="<YOUR_API_KEY>"
GW="https://gw.amlig.com"

# 上传
md5=$(curl -s -F "file=@ref.jpg" \
  -H "Authorization: Bearer $KEY" \
  "$GW/api/v1/file/upload" | jq -r .md5)

# 提交
task_id=$(curl -s -X POST "$GW/api/v1/generate" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"platform\":\"mgdb\",\"type\":\"video\",\"model\":\"sd_2.0_fast\",
       \"prompt\":\"镜头推近，水面波纹\",\"ratio\":\"16:9\",\"duration\":5,
       \"images\":[\"$md5\"]}" | jq -r .task_id)

# 轮询
while true; do
  resp=$(curl -s -H "Authorization: Bearer $KEY" "$GW/api/v1/task/$task_id")
  status=$(echo "$resp" | jq -r .status)
  [ "$status" = "completed" ] && url=$(echo "$resp" | jq -r .result.url) && break
  [ "$status" = "failed" ] && exit 1
  sleep 5
done

# 下载
curl -O "$url"
```
