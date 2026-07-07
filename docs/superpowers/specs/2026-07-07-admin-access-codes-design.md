# 站长访问码管理后台 设计文档

日期：2026-07-07
状态：已确认（方案 A：JSON 文件 + Docker 卷）
前置：`2026-07-07-server-proxy-design.md`（服务端代理已上线）

## 目标

站长无需 SSH 即可在网页后台自主管理访问码：查看（备注/创建时间/请求数/最后使用）、生成、作废，改动即时生效不重启容器。

## 存储层：`web/src/lib/access-code-store.ts`

- 数据文件 `${AI_PROXY_DATA_DIR:-/data}/access-codes.json`（本地开发可设为 `./data`）
- 条目：`{ code: string, note: string, createdAt: string(ISO), requests: number, lastUsedAt: string(ISO)|"" }`
- **种子迁移**：首次加载文件不存在时，将 `AI_PROXY_ACCESS_CODES` 环境变量各码导入（note="初始导入"），立即写盘；文件存在后环境变量不再参与校验
- 进程内单例缓存；`listCodes/addCode(note)/removeCode(code)/verifyCode(code)/recordUsage(code)`
- `recordUsage`：内存累加 requests、更新 lastUsedAt，**10 秒节流落盘**；`addCode/removeCode` 立即落盘
- 写盘原子性：写 `<file>.tmp` 后 rename；读写失败不崩（log 后维持内存态）
- 生成码：`ic-` + 10 位随机字符（字母数字，剔除 0/O/1/l/I 易混淆字符，crypto 随机）

## 鉴权语义调整（向后兼容）

- 服务端模式开启条件：`AI_PROXY_UPSTREAM_BASE_URL` + `AI_PROXY_API_KEY` 齐备（原来还要求 ACCESS_CODES；现改为码由存储层提供，`AI_PROXY_ACCESS_CODES` 降级为可选种子）
- `/api/ai/[...path]` 与 `/api/ai-config` 的访问码校验改为查存储层
- 代理请求通过校验后调用 `recordUsage`（`/api/ai-config` 的校验不计数）
- 现有部署无缝：三个变量都在，首次启动导入现有两码

## 管理接口：`web/src/app/api/ai-admin/route.ts`

- 鉴权：请求头 `x-admin-password` 与环境变量 `AI_PROXY_ADMIN_PASSWORD` **恒时比较**（crypto.timingSafeEqual）
- 服务端模式未开 或 未设置 `AI_PROXY_ADMIN_PASSWORD` → 所有方法返回 404（不暴露功能存在）
- 口令错误 → 401 `{"error":{"message":"管理口令错误"}}`
- `GET` → `{ codes: AccessCodeEntry[] }`
- `POST` body `{ note }` → 生成新码，返回 `{ code: AccessCodeEntry }`；note 允许为空串
- `DELETE` body `{ code }` → 作废；码不存在返回 404

## 管理页面：`web/src/app/(user)/admin/page.tsx`

- 不出现在导航；直接访问 `/admin`
- 未启用（`GET /api/ai-admin` 返回 404）→ 显示"管理后台未启用"
- 口令输入 → 验证成功后存 sessionStorage（关浏览器失效）→ 管理界面
- 表格列：访问码（点击复制）、备注、创建时间、请求数、最后使用；行操作：作废（Popconfirm 二次确认）
- "生成新访问码"：输入备注 → 生成 → 新码高亮显示并可一键复制
- 401 时清除已存口令回到输入界面

## 部署变更

- 服务器 `docker-compose.server.yml`：新增卷 `canvas-data:/data`；`.env` 新增 `AI_PROXY_ADMIN_PASSWORD`
- 仓库 `docker-compose.yml` 注释、README 服务端模式表格、`docs/deploy/OPERATIONS.md` 同步更新（管码方式从"编辑 .env"改为"/admin 后台"）

## 测试

- 存储层 bun test（指向临时目录）：种子导入、增删、verify、计数与节流落盘（暴露 flushNow 供测试）、原子写、损坏文件容错
- 管理接口纯函数（口令恒时比较）bun test
- 本地 Playwright 冒烟：口令登录 → 生成 → 新码可用（ai-config 校验通过）→ 作废 → 该码 401
- 生产部署后复验

## 明确不做（YAGNI）

- 码的启用/禁用状态（直接删除即作废）
- 每码限额/限流
- 管理操作审计日志
- 多管理员/角色
