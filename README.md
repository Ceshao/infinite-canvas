<p align="center">
  <img src="web/public/brand-mark.png" width="88" alt="华视锐达 · 无限画布">
</p>

<h1 align="center">华视锐达 · 无限画布</h1>

<p align="center">华视锐达科技 · Huashi Ruida Technology</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-7848F8?style=flat-square" alt="License"></a>
  <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=nextdotjs" alt="Next.js"></a>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
</p>

**无限画布**是一款面向图片与视频创作的 AI 工作台。它把画布编排、AI 图片 / 视频生成、参考图编辑、对话助手和素材沉淀放在同一个界面里，让创作从"单次生成"变成"在画布上连续推演"。

## 核心功能

- **无限画布**：多画布项目、节点拖拽缩放、连线、小地图、撤销重做、导入导出。
- **AI 创作**：文生图、图生图、参考图编辑、文本问答、音频与视频生成，兼容 OpenAI 接口协议。
- **画布助手**：围绕选中节点与上游节点对话、生图，并把结果插回画布。
- **本地 Agent**：通过本机 Canvas Agent 连接 Codex / Claude Code，让 Agent 经 MCP 操作当前画布。
- **服务端代理模式**：站长在服务器统一配置模型密钥，访客凭访问码免配置直接使用，密钥不下发到浏览器。

用户的画布、素材与生成记录默认保存在浏览器本地。

## 技术栈

- 前端：Next.js、React、TypeScript、Tailwind CSS、Ant Design、Zustand、TanStack Query。
- 服务端：Next.js API Route（AI 透传代理、访问码鉴权、模型清单、管理后台）。
- 部署：Docker。

## 快速开始

本地开发：

```bash
git clone https://github.com/Ceshao/infinite-canvas.git
cd infinite-canvas/web
bun install
bun run dev
```

Docker 运行：

```bash
docker build -t infinite-canvas .
docker run --rm -p 3000:3000 infinite-canvas
```

默认端口 3000，访问 `http://localhost:3000`。首次打开后进入右上角配置，填入 OpenAI 兼容的 `Base URL` 与 `API Key`。

## 服务端代理模式（访客免配置）

为容器设置以下环境变量即可开启；任一缺失则回退为用户自配置模式：

| 变量 | 说明 |
| --- | --- |
| `AI_PROXY_UPSTREAM_BASE_URL` | 上游（如 New API）内网地址，例如 `http://new-api:3000` |
| `AI_PROXY_API_KEY` | 上游真密钥，仅存在于服务器，不会下发到浏览器 |
| `AI_PROXY_ACCESS_CODES` | 首次启动导入的种子访问码（逗号分隔）；之后通过 `/admin` 网页后台管理 |
| `AI_PROXY_ADMIN_PASSWORD` | 可选。设置后可访问 `/admin` 管理访问码（生成 / 作废 / 用量），改动即时生效 |

开启后：访客首次打开会弹出"输入访问码"，验证通过即可使用全部生成能力；模型列表自动从上游 `/v1/models` 拉取（5 分钟缓存）。访问码数据保存在容器 `/data/access-codes.json`（请挂载卷持久化，见 `docker-compose.yml` 注释）。反向代理配置参考 `docs/deploy/nginx-infinite-canvas.conf.example`（需关闭 `proxy_buffering` 以支持流式输出）。

完整部署与运维流程见 [运维手册](docs/deploy/OPERATIONS.md)。

## 品牌与定制

全站品牌触点（应用名、Logo、文案、外链）集中在 [`web/src/constant/brand.ts`](web/src/constant/brand.ts)，配合 `web/public/` 下的静态资源，改这一处即可换皮。

## 开源协议

本项目基于 GNU Affero General Public License v3.0 开源，见 [LICENSE](LICENSE)。AGPL 要求：通过网络提供服务时须向使用者开放对应源码，请保持本仓库源码可获取。
