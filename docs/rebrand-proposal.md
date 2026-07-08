# 前端换皮（品牌重塑）方案

日期：2026-07-07（2026-07-08 实施第 0/1/2 层）
状态：✅ 第 0/1/2 层已完成并本地验证；⏳ README 与第 3 层（结构内容）待定；未部署
原则：**只换皮，不动任何核心业务逻辑与数据格式**

## 已定品牌三要素（2026-07-08）

- 产品名：**华视锐达 · 无限画布**（公司名 + 产品子名）；产品子名 `无限画布` / `Infinite Canvas`
- 公司：华视锐达科技 / Huashi Ruida Technology
- 主色：**华视锐达紫 `#7848F8`**（作主强调色，整体保持简洁；深色模式用 `#8B66FF`）
- Logo：`logo/logo.png`（公司横版）→ 裁出紫色 h 图标 `web/public/brand-mark.png` + favicon `web/src/app/icon.png`
- 外链：GitHub 角标 / 文档入口 / 版本检查**全部移除**（不再拉上游 CHANGELOG）

集中配置落在 `web/src/constant/brand.ts`，以后换皮只改这一个文件 + 静态资源。

## ⚠️ 协议边界（AGPL-3.0，先读这个）

- ✅ 允许：改名、换 Logo、换配色、改文案、商用、深度个性化
- ❌ 禁止：删除 LICENSE 文件、闭源发布
- AGPL 网络条款：通过网站向他人提供服务 = 必须向使用者开放源码。
  **当前已合规**（fork 公开于 GitHub），保持仓库公开即可；页面上无需展示原项目名。

## 分层方案

### 第 0 层：品牌集中配置（先做，技术底座）

新建 `web/src/constant/brand.ts`：

```ts
export const BRAND = {
    name: "<产品名>",
    description: "<一句话简介>",
    logo: "/logo.svg",
    githubUrl: "https://github.com/Ceshao/infinite-canvas", // 或隐藏
    docsUrl: "",                                            // 无文档则空并隐藏入口
};
```

全站品牌触点统一引用它 → 以后换皮只改这一个文件 + 静态资源；同步上游时 diff 集中、冲突最小。

### 第 1 层：品牌标识（零业务风险，收益最大）

| 触点 | 文件 | 现状 → 改法 |
|---|---|---|
| 应用名与元数据 | `web/src/app/layout.tsx`（title/description） | "无限画布" → 新名 |
| 顶部导航名+Logo | `web/src/components/layout/app-top-nav.tsx` | 文案 + `/logo.svg`（mask 渲染，单色 SVG） |
| 首页大标题 | `web/src/app/(user)/page.tsx`（`ai-title-aurora`） | 新名 + 新 slogan |
| 移动端抽屉 | `web/src/components/layout/mobile-nav-drawer.tsx` | 同步改名 |
| Logo 文件 | `web/public/logo.svg` | 替换（保持单色可 mask） |
| favicon | `web/src/app/favicon.ico` | 替换 |
| GitHub 角标 | `web/src/components/layout/github-link.tsx` | **硬链原作者仓库** → 改指自己仓库或移除 |
| 版本更新检查 | `web/src/hooks/use-version-check.ts` | **拉原作者仓库 VERSION/CHANGELOG**（用户会收到上游发版弹窗）→ 改指自己 fork（**必改**，最明显的残留行为） |
| 文档链接 | `web/src/constant/env.ts`（`DOCS_URL` → docs.canvas.best） | 改/移除 |
| README | 仓库根 | 重写为自己的产品说明（保留部署章节） |

### 第 2 层：视觉主题（低风险）

- `web/src/lib/app-theme.ts`：antd token 表（当前极简黑白 neutral），换品牌色只改一处色值表（light/dark 两套）
- `web/src/app/globals.css` + Tailwind 色板：背景/前景/圆角
- 字体：`layout.tsx` 内联 fontFamily（当前苹果系字体栈）
- 首页 Hero 视觉（光晕标题效果、按钮样式）

### 第 3 层：结构内容（中风险，选做；做得越多上游同步越痛）

- 首页重新设计、导航项取舍
- "灵感库"页（`/prompts`）：内容拉取自上游作者与第三方 GitHub 提示词仓库（`web/src/app/api/prompts/route.ts`）→ 保留 / 换自己的源 / 下架
- 更新日志页：内容来自上游 CHANGELOG → 维护自己的 CHANGELOG

## 🚫 绝对不动清单（动了 = 丢数据/坏功能）

1. **localStorage 键名**（`infinite-canvas:ai_config_store`、`infinite-canvas:admin_password` 等）
   —— 改了 = 所有现有用户（含已发访问码的朋友）的配置、画布、访问码记忆全部清零
2. IndexedDB 库名 / `storageKey` 前缀（`services/image-storage.ts`、`file-storage.ts`、`localforage-storage.ts`）
3. 画布导出文件格式标识（`canvas-export.ts`、`export-types.ts`、`asset-transfer.ts`）—— 影响老文件导入
4. `web/public/icons/*.svg`（openai/claude/gemini 等）—— 模型渠道的功能性图标，非品牌资产
5. `services/`、`stores/` 业务逻辑；服务端代理层（`/api/ai`、`/api/ai-config`、`/api/ai-admin`）与管理后台

## 实施顺序建议

1. 收集素材：产品名（中英）、Logo SVG（可先用文字型占位）、品牌主色（或保持黑白）
2. 第 0 层 brand.ts → 第 1 层全部（一次提交）→ 验证构建与页面
3. 第 2 层主题色（一次提交）→ 深浅两模式目检
4. 第 3 层按需逐项
5. 每层完成后跑：`bun test`、`bun run build`、本地 Playwright 冒烟（首页/画布/生成流程）
6. push main → Actions 构建 → 服务器 pull + up（参照 docs/deploy/OPERATIONS.md，勿在服务器 build）

## 待用户提供

- [ ] 新产品名（中文 + 英文/域名呼应，域名现为 cancanvas.shaolabs.xyz）
- [ ] Logo SVG（无则先做文字型占位）
- [ ] 品牌主色（色值/方向，或维持极简黑白）
