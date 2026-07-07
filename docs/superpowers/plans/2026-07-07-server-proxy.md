# 服务端代理 + 访问码免配置访问 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Next.js 应用内新增透传代理，使访客凭访问码免配置使用站长的 New API，真密钥不出服务器。

**Architecture:** 新增 `/api/ai/[...path]` 透传代理路由（校验访问码→换真密钥→流式转发）与 `/api/ai-config` 配置接口；前端注入虚拟"服务器渠道"（`baseUrl=/api/ai`、`apiKey=访问码`）复用现有请求层；通过三个环境变量作为总开关，未配置时行为与原版一致。

**Tech Stack:** Next.js 16 route handlers（nodejs runtime）、zustand、antd、bun test（纯函数单测）。

**Spec:** `docs/superpowers/specs/2026-07-07-server-proxy-design.md`

---

### Task 1: 代理纯函数库 `ai-proxy.ts`（TDD）

**Files:**
- Modify: `web/package.json`（新增 devDependency `@types/bun`）
- Create: `web/src/lib/ai-proxy.ts`
- Test: `web/src/lib/ai-proxy.test.ts`

- [ ] **Step 1: 安装 @types/bun**

```bash
cd web && bun add -d @types/bun
```

预期：package.json devDependencies 出现 `@types/bun`（让 `bun:test` 的类型在 next build 类型检查下可解析）。

- [ ] **Step 2: 写失败的测试**

创建 `web/src/lib/ai-proxy.test.ts`：

```ts
import { describe, expect, test } from "bun:test";

import { buildForwardHeaders, buildUpstreamUrl, parseAccessCodes, readAccessCode, readServerProxyConfig } from "@/lib/ai-proxy";

describe("parseAccessCodes", () => {
    test("按逗号分隔并去除空白项", () => {
        expect(parseAccessCodes(" alice-x7k2, bob-m9q4,,  ")).toEqual(new Set(["alice-x7k2", "bob-m9q4"]));
    });

    test("空值返回空集合", () => {
        expect(parseAccessCodes(undefined)).toEqual(new Set());
        expect(parseAccessCodes("")).toEqual(new Set());
    });
});

describe("readServerProxyConfig", () => {
    const env = { AI_PROXY_UPSTREAM_BASE_URL: "http://new-api:3000/", AI_PROXY_API_KEY: "sk-test", AI_PROXY_ACCESS_CODES: "code-1" };

    test("三个变量齐备时返回配置并去除尾斜杠", () => {
        expect(readServerProxyConfig(env)).toEqual({ upstreamBaseUrl: "http://new-api:3000", apiKey: "sk-test", accessCodes: new Set(["code-1"]) });
    });

    test("任一变量缺失返回 null", () => {
        expect(readServerProxyConfig({ ...env, AI_PROXY_UPSTREAM_BASE_URL: "" })).toBeNull();
        expect(readServerProxyConfig({ ...env, AI_PROXY_API_KEY: undefined })).toBeNull();
        expect(readServerProxyConfig({ ...env, AI_PROXY_ACCESS_CODES: " , " })).toBeNull();
    });
});

describe("readAccessCode", () => {
    test("从 Bearer 头读取（大小写不敏感）", () => {
        expect(readAccessCode(new Headers({ authorization: "Bearer code-1" }))).toEqual({ code: "code-1", style: "bearer" });
        expect(readAccessCode(new Headers({ authorization: "bearer code-1" }))).toEqual({ code: "code-1", style: "bearer" });
    });

    test("从 x-goog-api-key 头读取", () => {
        expect(readAccessCode(new Headers({ "x-goog-api-key": "code-2" }))).toEqual({ code: "code-2", style: "gemini" });
    });

    test("无凭证返回 null", () => {
        expect(readAccessCode(new Headers())).toBeNull();
        expect(readAccessCode(new Headers({ authorization: "Bearer   " }))).toBeNull();
    });
});

describe("buildUpstreamUrl", () => {
    test("拼接路径段并保留查询串", () => {
        expect(buildUpstreamUrl("http://new-api:3000", ["v1", "images", "generations"], "")).toBe("http://new-api:3000/v1/images/generations");
        expect(buildUpstreamUrl("http://new-api:3000", ["v1", "models"], "?page=1")).toBe("http://new-api:3000/v1/models?page=1");
    });

    test("对路径段做 URL 编码", () => {
        expect(buildUpstreamUrl("http://new-api:3000", ["v1", "videos", "task id/1"], "")).toBe("http://new-api:3000/v1/videos/task%20id%2F1");
    });
});

describe("buildForwardHeaders", () => {
    test("仅保留 content-type/accept 并注入 Bearer 真密钥", () => {
        const headers = buildForwardHeaders(new Headers({ "content-type": "application/json", accept: "text/event-stream", cookie: "secret", host: "canvas.example.com" }), "sk-real", "bearer");
        expect(headers.get("content-type")).toBe("application/json");
        expect(headers.get("accept")).toBe("text/event-stream");
        expect(headers.get("authorization")).toBe("Bearer sk-real");
        expect(headers.get("cookie")).toBeNull();
        expect(headers.get("host")).toBeNull();
    });

    test("gemini 风格注入 x-goog-api-key", () => {
        const headers = buildForwardHeaders(new Headers(), "sk-real", "gemini");
        expect(headers.get("x-goog-api-key")).toBe("sk-real");
        expect(headers.get("authorization")).toBeNull();
    });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
cd web && bun test src/lib/ai-proxy.test.ts
```

预期：FAIL（模块 `@/lib/ai-proxy` 不存在）。

- [ ] **Step 4: 最小实现**

创建 `web/src/lib/ai-proxy.ts`：

```ts
export type AccessCodeStyle = "bearer" | "gemini";

export type ServerProxyConfig = {
    upstreamBaseUrl: string;
    apiKey: string;
    accessCodes: Set<string>;
};

export function readServerProxyConfig(env: Record<string, string | undefined> = process.env): ServerProxyConfig | null {
    const upstreamBaseUrl = (env.AI_PROXY_UPSTREAM_BASE_URL || "").trim().replace(/\/+$/, "");
    const apiKey = (env.AI_PROXY_API_KEY || "").trim();
    const accessCodes = parseAccessCodes(env.AI_PROXY_ACCESS_CODES);
    if (!upstreamBaseUrl || !apiKey || !accessCodes.size) return null;
    return { upstreamBaseUrl, apiKey, accessCodes };
}

export function parseAccessCodes(value: string | undefined): Set<string> {
    return new Set(
        (value || "")
            .split(",")
            .map((code) => code.trim())
            .filter(Boolean),
    );
}

export function readAccessCode(headers: Headers): { code: string; style: AccessCodeStyle } | null {
    const authorization = (headers.get("authorization") || "").trim();
    if (/^bearer\s/i.test(authorization)) {
        const code = authorization.replace(/^bearer\s+/i, "").trim();
        if (code) return { code, style: "bearer" };
    }
    const geminiKey = (headers.get("x-goog-api-key") || "").trim();
    if (geminiKey) return { code: geminiKey, style: "gemini" };
    return null;
}

export function buildUpstreamUrl(upstreamBaseUrl: string, path: string[], search: string) {
    return `${upstreamBaseUrl}/${path.map(encodeURIComponent).join("/")}${search}`;
}

export function buildForwardHeaders(requestHeaders: Headers, apiKey: string, style: AccessCodeStyle) {
    const headers = new Headers();
    const contentType = requestHeaders.get("content-type");
    const accept = requestHeaders.get("accept");
    if (contentType) headers.set("content-type", contentType);
    if (accept) headers.set("accept", accept);
    if (style === "gemini") headers.set("x-goog-api-key", apiKey);
    else headers.set("authorization", `Bearer ${apiKey}`);
    return headers;
}

export function parseModelsPayload(payload: unknown): string[] {
    const data = (payload as { data?: Array<{ id?: unknown }> } | null)?.data;
    if (!Array.isArray(data)) return [];
    return Array.from(new Set(data.map((item) => String(item?.id ?? "").trim()).filter(Boolean)));
}

export function proxyErrorResponse(status: number, message: string) {
    return Response.json({ error: { message } }, { status });
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd web && bun test src/lib/ai-proxy.test.ts
```

预期：全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/bun.lock web/src/lib/ai-proxy.ts web/src/lib/ai-proxy.test.ts
git commit -m "feat(proxy): 服务端代理纯函数库（访问码解析/路径映射/转发头）"
```

---

### Task 2: 透传代理路由 `/api/ai/[...path]`

**Files:**
- Create: `web/src/app/api/ai/[...path]/route.ts`

- [ ] **Step 1: 实现路由**

创建 `web/src/app/api/ai/[...path]/route.ts`：

```ts
import type { NextRequest } from "next/server";

import { buildForwardHeaders, buildUpstreamUrl, proxyErrorResponse, readAccessCode, readServerProxyConfig } from "@/lib/ai-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
    return proxyRequest(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
    return proxyRequest(request, context);
}

async function proxyRequest(request: NextRequest, context: RouteContext) {
    const config = readServerProxyConfig();
    if (!config) return proxyErrorResponse(404, "服务端代理未启用");
    const access = readAccessCode(request.headers);
    if (!access || !config.accessCodes.has(access.code)) return proxyErrorResponse(401, "访问码无效或已停用");
    const { path } = await context.params;
    const url = buildUpstreamUrl(config.upstreamBaseUrl, path || [], request.nextUrl.search);
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : request.body;
    const init: RequestInit & { duplex?: "half" } = {
        method: request.method,
        headers: buildForwardHeaders(request.headers, config.apiKey, access.style),
        body,
        cache: "no-store",
    };
    if (body) init.duplex = "half";
    try {
        const upstream = await fetch(url, init);
        const headers = new Headers();
        const contentType = upstream.headers.get("content-type");
        if (contentType) headers.set("content-type", contentType);
        return new Response(upstream.body, { status: upstream.status, headers });
    } catch {
        return proxyErrorResponse(502, "上游接口连接失败");
    }
}
```

要点：请求体/响应体均以流透传（SSE、blob、multipart 天然支持）；只透传 `content-type` 响应头避免 `content-length` 与实际流不一致。

- [ ] **Step 2: 本地验证鉴权行为（不依赖真实上游）**

PowerShell 启动 dev（环境变量指向一个不存在的上游即可验证鉴权层）：

```powershell
cd web
$env:AI_PROXY_UPSTREAM_BASE_URL="http://127.0.0.1:59999"; $env:AI_PROXY_API_KEY="sk-test"; $env:AI_PROXY_ACCESS_CODES="test-code"; bun dev
```

另开终端逐项 curl：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/ai/v1/models                                   # 预期 401
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer wrong" http://localhost:3000/api/ai/v1/models  # 预期 401
curl -s -w "\n%{http_code}\n" -H "Authorization: Bearer test-code" http://localhost:3000/api/ai/v1/models         # 预期 502 + {"error":{"message":"上游接口连接失败"}}
```

不设环境变量重启 dev 后：`curl -s -w "%{http_code}"  http://localhost:3000/api/ai/v1/models` 预期 404。

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/ai/[...path]/route.ts
git commit -m "feat(proxy): /api/ai 透传代理路由（访问码换真密钥，流式转发）"
```

---

### Task 3: 服务端配置接口 `/api/ai-config`（TDD：parseModelsPayload）

**Files:**
- Create: `web/src/app/api/ai-config/route.ts`
- Test: 追加到 `web/src/lib/ai-proxy.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `web/src/lib/ai-proxy.test.ts` 追加（import 行加入 `parseModelsPayload`）：

```ts
describe("parseModelsPayload", () => {
    test("提取 data[].id 并去重去空", () => {
        expect(parseModelsPayload({ data: [{ id: "gpt-image-2" }, { id: "gpt-5.5" }, { id: "gpt-image-2" }, { id: "  " }, {}] })).toEqual(["gpt-image-2", "gpt-5.5"]);
    });

    test("非法负载返回空数组", () => {
        expect(parseModelsPayload(null)).toEqual([]);
        expect(parseModelsPayload({})).toEqual([]);
        expect(parseModelsPayload({ data: "x" })).toEqual([]);
    });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd web && bun test src/lib/ai-proxy.test.ts
```

预期：PASS（Task 1 已实现 `parseModelsPayload`；若失败则修实现）。

- [ ] **Step 3: 实现配置接口**

创建 `web/src/app/api/ai-config/route.ts`：

```ts
import type { NextRequest } from "next/server";

import { parseModelsPayload, proxyErrorResponse, readAccessCode, readServerProxyConfig } from "@/lib/ai-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const modelsCacheTtlMs = 1000 * 60 * 5;
let modelsCache: { models: string[]; fetchedAt: number } | null = null;

export async function GET(request: NextRequest) {
    const config = readServerProxyConfig();
    if (!config) return Response.json({ serverMode: false });
    const access = readAccessCode(request.headers);
    if (!access) return Response.json({ serverMode: true });
    if (!config.accessCodes.has(access.code)) return proxyErrorResponse(401, "访问码无效或已停用");
    const { models, modelsError } = await loadUpstreamModels(config.upstreamBaseUrl, config.apiKey);
    return Response.json({ serverMode: true, valid: true, models, ...(modelsError ? { modelsError } : {}) });
}

async function loadUpstreamModels(upstreamBaseUrl: string, apiKey: string) {
    if (modelsCache && Date.now() - modelsCache.fetchedAt < modelsCacheTtlMs) return { models: modelsCache.models };
    try {
        const response = await fetch(`${upstreamBaseUrl}/v1/models`, { headers: { authorization: `Bearer ${apiKey}` }, cache: "no-store" });
        if (!response.ok) throw new Error(`模型列表拉取失败（上游返回 ${response.status}）`);
        const models = parseModelsPayload(await response.json());
        modelsCache = { models, fetchedAt: Date.now() };
        return { models };
    } catch (error) {
        return { models: modelsCache?.models || [], modelsError: error instanceof Error ? error.message : "模型列表拉取失败" };
    }
}
```

- [ ] **Step 4: 本地验证**

沿用 Task 2 的 dev 环境变量：

```bash
curl -s http://localhost:3000/api/ai-config                                        # 预期 {"serverMode":true}
curl -s -H "Authorization: Bearer wrong" http://localhost:3000/api/ai-config       # 预期 401
curl -s -H "Authorization: Bearer test-code" http://localhost:3000/api/ai-config   # 预期 {"serverMode":true,"valid":true,"models":[],"modelsError":"..."}
```

不设环境变量时：`curl -s http://localhost:3000/api/ai-config` 预期 `{"serverMode":false}`。

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/ai-config/route.ts web/src/lib/ai-proxy.test.ts
git commit -m "feat(proxy): /api/ai-config 配置接口（服务端模式探测+访问码校验+模型清单）"
```

---

### Task 4: 前端服务端模式 store（TDD：buildServerConfigUpdates）

**Files:**
- Create: `web/src/stores/use-server-mode-store.ts`
- Test: `web/src/stores/use-server-mode-store.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `web/src/stores/use-server-mode-store.test.ts`（注意：先 stub localStorage 再动态 import，避免 zustand persist 在 bun 环境告警）：

```ts
import { describe, expect, test } from "bun:test";

const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
};

const { SERVER_CHANNEL_ID, buildServerConfigUpdates } = await import("@/stores/use-server-mode-store");
const { defaultConfig } = await import("@/stores/use-config-store");

const models = ["gpt-image-2", "seedance-pro", "gpt-5.5", "gpt-4o-mini-tts"];

describe("buildServerConfigUpdates", () => {
    test("生成唯一的服务器渠道，访问码作为 apiKey", () => {
        const updates = buildServerConfigUpdates(defaultConfig, "test-code", models);
        expect(updates.channels).toEqual([{ id: SERVER_CHANNEL_ID, name: "服务器渠道", baseUrl: "/api/ai", apiKey: "test-code", apiFormat: "openai", models }]);
        expect(updates.baseUrl).toBe("/api/ai");
        expect(updates.apiKey).toBe("test-code");
    });

    test("模型按能力分类并编码渠道前缀", () => {
        const updates = buildServerConfigUpdates(defaultConfig, "test-code", models);
        expect(updates.models).toEqual(["server::gpt-image-2", "server::seedance-pro", "server::gpt-5.5", "server::gpt-4o-mini-tts"]);
        expect(updates.imageModels).toEqual(["server::gpt-image-2"]);
        expect(updates.videoModels).toEqual(["server::seedance-pro"]);
        expect(updates.textModels).toEqual(["server::gpt-5.5"]);
        expect(updates.audioModels).toEqual(["server::gpt-4o-mini-tts"]);
    });

    test("当前选中模型不在清单内时回退到各能力第一项", () => {
        const updates = buildServerConfigUpdates(defaultConfig, "test-code", models);
        expect(updates.imageModel).toBe("server::gpt-image-2");
        expect(updates.videoModel).toBe("server::seedance-pro");
        expect(updates.textModel).toBe("server::gpt-5.5");
        expect(updates.audioModel).toBe("server::gpt-4o-mini-tts");
    });

    test("当前选中模型仍在清单内时保持不变", () => {
        const config = { ...defaultConfig, imageModel: "server::gpt-image-2" };
        const updates = buildServerConfigUpdates(config, "test-code", models);
        expect(updates.imageModel).toBe("server::gpt-image-2");
    });

    test("空模型清单时选中项为空字符串", () => {
        const updates = buildServerConfigUpdates(defaultConfig, "test-code", []);
        expect(updates.imageModel).toBe("");
        expect(updates.models).toEqual([]);
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd web && bun test src/stores/use-server-mode-store.test.ts
```

预期：FAIL（模块不存在）。

- [ ] **Step 3: 实现 store**

创建 `web/src/stores/use-server-mode-store.ts`：

```ts
"use client";

import { create } from "zustand";

import { encodeChannelModel, filterModelsByCapability, useConfigStore, type AiConfig, type ModelChannel } from "@/stores/use-config-store";

export const SERVER_CHANNEL_ID = "server";

export type ServerModeStatus = "unknown" | "off" | "on";

type ServerConfigResponse = { serverMode?: boolean; valid?: boolean; models?: string[]; modelsError?: string; error?: { message?: string } };

type ServerModeStore = {
    status: ServerModeStatus;
    initServerMode: () => Promise<void>;
    verifyAccessCode: (code: string) => Promise<{ ok: boolean; message?: string }>;
};

export const useServerModeStore = create<ServerModeStore>()((set, get) => ({
    status: "unknown",
    initServerMode: async () => {
        try {
            const response = await fetch("/api/ai-config", { cache: "no-store" });
            const payload = (await response.json()) as ServerConfigResponse;
            if (!payload.serverMode) {
                set({ status: "off" });
                return;
            }
            set({ status: "on" });
            const code = storedAccessCode();
            if (!code) {
                useConfigStore.getState().openConfigDialog(false);
                return;
            }
            const result = await get().verifyAccessCode(code);
            if (!result.ok) useConfigStore.getState().openConfigDialog(false);
        } catch {
            set({ status: "off" });
        }
    },
    verifyAccessCode: async (code) => {
        const trimmed = code.trim();
        if (!trimmed) return { ok: false, message: "请输入访问码" };
        try {
            const response = await fetch("/api/ai-config", { headers: { authorization: `Bearer ${trimmed}` }, cache: "no-store" });
            const payload = (await response.json()) as ServerConfigResponse;
            if (!response.ok || !payload.valid) return { ok: false, message: payload.error?.message || "访问码无效或已停用" };
            applyServerConfig(trimmed, payload.models || []);
            return { ok: true, message: payload.modelsError };
        } catch {
            return { ok: false, message: "网络错误，请稍后重试" };
        }
    },
}));

function storedAccessCode() {
    const channel = useConfigStore.getState().config.channels.find((item) => item.id === SERVER_CHANNEL_ID);
    return channel?.apiKey?.trim() || "";
}

export function applyServerConfig(code: string, models: string[]) {
    const { config, updateConfig } = useConfigStore.getState();
    const updates = buildServerConfigUpdates(config, code, models);
    for (const [key, value] of Object.entries(updates)) updateConfig(key as keyof AiConfig, value as never);
}

export function buildServerConfigUpdates(config: AiConfig, code: string, models: string[]): Partial<AiConfig> {
    const channel: ModelChannel = { id: SERVER_CHANNEL_ID, name: "服务器渠道", baseUrl: "/api/ai", apiKey: code, apiFormat: "openai", models };
    const encoded = models.map((model) => encodeChannelModel(SERVER_CHANNEL_ID, model));
    const imageModels = filterModelsByCapability(encoded, "image");
    const videoModels = filterModelsByCapability(encoded, "video");
    const textModels = filterModelsByCapability(encoded, "text");
    const audioModels = filterModelsByCapability(encoded, "audio");
    const pick = (current: string, list: string[]) => (list.includes(current) ? current : list[0] || "");
    return {
        channels: [channel],
        models: encoded,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel: pick(config.imageModel, imageModels),
        videoModel: pick(config.videoModel, videoModels),
        textModel: pick(config.textModel, textModels),
        audioModel: pick(config.audioModel, audioModels),
        model: pick(config.model, imageModels.length ? imageModels : encoded),
        baseUrl: "/api/ai",
        apiKey: code,
    };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd web && bun test src/stores/use-server-mode-store.test.ts
```

预期：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/stores/use-server-mode-store.ts web/src/stores/use-server-mode-store.test.ts
git commit -m "feat(proxy): 前端服务端模式 store（访问码校验+服务器渠道注入）"
```

---

### Task 5: 访问码弹窗 + 顶部导航接线

**Files:**
- Create: `web/src/components/layout/access-code-modal.tsx`
- Modify: `web/src/components/layout/app-top-nav.tsx:8,79`

- [ ] **Step 1: 实现访问码弹窗**

创建 `web/src/components/layout/access-code-modal.tsx`：

```tsx
"use client";

import { useState } from "react";
import { App, Input, Modal } from "antd";

import { useConfigStore } from "@/stores/use-config-store";
import { useServerModeStore } from "@/stores/use-server-mode-store";

export function AccessCodeModal() {
    const { message } = App.useApp();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const verifyAccessCode = useServerModeStore((state) => state.verifyAccessCode);
    const [code, setCode] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const submit = async () => {
        if (submitting) return;
        setSubmitting(true);
        const result = await verifyAccessCode(code);
        setSubmitting(false);
        if (!result.ok) {
            message.error(result.message || "访问码无效");
            return;
        }
        if (result.message) message.warning(result.message);
        message.success("访问码验证成功");
        setCode("");
        setConfigDialogOpen(false);
    };

    return (
        <Modal title="输入访问码" open={isConfigOpen} onOk={submit} onCancel={() => setConfigDialogOpen(false)} confirmLoading={submitting} okText="确认" cancelText="取消" maskClosable={false}>
            <div className="space-y-2 py-2">
                <Input.Password value={code} onChange={(event) => setCode(event.target.value)} placeholder="请输入站长提供的访问码" onPressEnter={submit} autoFocus />
                <p className="text-xs text-stone-500">输入一次后本浏览器将自动记住，无需重复配置。</p>
            </div>
        </Modal>
    );
}
```

- [ ] **Step 2: 顶部导航按模式切换弹窗**

修改 `web/src/components/layout/app-top-nav.tsx`。import 区追加：

```tsx
import { AccessCodeModal } from "@/components/layout/access-code-modal";
import { useServerModeStore } from "@/stores/use-server-mode-store";
```

组件内（`const pathname = usePathname();` 之后）追加：

```tsx
const serverModeStatus = useServerModeStore((state) => state.status);
```

将第 79 行 `<AppConfigModal />` 替换为：

```tsx
{serverModeStatus === "on" ? <AccessCodeModal /> : <AppConfigModal />}
```

所有 `openConfigDialog(...)` 的调用点（10+ 处）无需改动——服务端模式下它们打开的就是访问码弹窗。

- [ ] **Step 3: Commit**

```bash
git add web/src/components/layout/access-code-modal.tsx web/src/components/layout/app-top-nav.tsx
git commit -m "feat(proxy): 访问码弹窗，服务端模式下替换渠道配置弹窗"
```

---

### Task 6: 应用初始化接线（initServerMode + URL 导入门控）

**Files:**
- Modify: `web/src/components/layout/client-root-init.tsx`

- [ ] **Step 1: 修改初始化组件**

修改 `web/src/components/layout/client-root-init.tsx`。import 区追加：

```tsx
import { useServerModeStore } from "@/stores/use-server-mode-store";
```

组件内追加两个订阅与一个初始化 effect（放在现有 useEffect 之前）：

```tsx
const serverModeStatus = useServerModeStore((state) => state.status);
const initServerMode = useServerModeStore((state) => state.initServerMode);

useEffect(() => {
    void initServerMode();
}, [initServerMode]);
```

现有 URL 导入 effect 的修改：在 `if (handledConfigParams.current) return;` 之后插入两行门控，并在清理 URL 参数之后、写入配置之前插入服务端模式短路；依赖数组追加 `serverModeStatus`。修改后的完整 effect：

```tsx
useEffect(() => {
    if (handledConfigParams.current) return;
    if (serverModeStatus === "unknown") return;
    const searchParams = new URLSearchParams(window.location.search);
    const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
    const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
    if (!baseUrl && !apiKey) return;
    handledConfigParams.current = true;
    searchParams.delete("baseUrl");
    searchParams.delete("baseurl");
    searchParams.delete("apiKey");
    searchParams.delete("apikey");
    window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
    if (serverModeStatus === "on") return;
    const firstChannel = config.channels[0];
    updateConfig(
        "channels",
        firstChannel
            ? config.channels.map((channel, index) =>
                  index === 0
                      ? {
                            ...channel,
                            ...(baseUrl ? { baseUrl } : {}),
                            ...(apiKey ? { apiKey } : {}),
                        }
                      : channel,
              )
            : [createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
    );
    if (baseUrl) updateConfig("baseUrl", baseUrl);
    if (apiKey) updateConfig("apiKey", apiKey);
    openConfigDialog(false);
    message.success("已导入本地直连配置");
}, [config.channels, message, openConfigDialog, updateConfig, serverModeStatus]);
```

行为变化说明：原版 URL 导入现在等待一次 `/api/ai-config` 探测（`status !== "unknown"`）后才执行；服务端模式下仅清理 URL 参数、不导入。

- [ ] **Step 2: 回归验证（原版行为不变）**

不设代理环境变量启动 `cd web && bun dev`，浏览器访问 `http://localhost:3000/?baseurl=https://api.example.com&apikey=sk-abc`：
预期仍弹出"已导入本地直连配置"、配置弹窗为原版渠道配置 UI。

- [ ] **Step 3: 服务端模式冒烟**

用 Task 2 的环境变量启动 dev，访问 `http://localhost:3000`：
预期自动弹出"输入访问码"弹窗；输入 `wrong` 提示无效；输入 `test-code`（上游不可达）提示模型列表拉取失败但验证通过；刷新页面不再要求输入。

- [ ] **Step 4: Commit**

```bash
git add web/src/components/layout/client-root-init.tsx
git commit -m "feat(proxy): 应用启动探测服务端模式，URL 直连导入按模式门控"
```

---

### Task 7: 部署配置（docker-compose / Nginx 示例 / README）

**Files:**
- Modify: `docker-compose.yml`
- Create: `docs/deploy/nginx-infinite-canvas.conf.example`
- Modify: `README.md`（部署章节追加服务端模式说明）

- [ ] **Step 1: docker-compose 增加环境变量示例**

`docker-compose.yml` 全文替换为：

```yaml
services:
  app:
    image: ghcr.io/basketikun/infinite-canvas:latest
    container_name: infinite-canvas
    ports:
      - "3000:3000"
    restart: unless-stopped
    # 服务端代理模式（可选）：三个变量齐备时开启，访客凭访问码免配置使用。
    # 任一缺失则应用行为与原版一致（浏览器直连、用户自配置）。
    # environment:
    #   AI_PROXY_UPSTREAM_BASE_URL: http://new-api:3000   # New API 内网地址
    #   AI_PROXY_API_KEY: sk-xxxx                          # New API 真密钥（不会下发到浏览器）
    #   AI_PROXY_ACCESS_CODES: alice-x7k2,bob-m9q4         # 逗号分隔的访问码，可随时增删后重启生效
    # 若 New API 在同一 docker 网络，取消注释接入（网络名按实际填写）：
    # networks:
    #   - new-api-network

# networks:
#   new-api-network:
#     external: true
```

- [ ] **Step 2: Nginx 站点配置示例**

创建 `docs/deploy/nginx-infinite-canvas.conf.example`：

```nginx
# infinite-canvas 站点配置示例（放入 /etc/nginx/conf.d/ 或 sites-available）
# 替换 canvas.example.com 与证书路径后 `nginx -t && nginx -s reload`

server {
    listen 443 ssl;
    http2 on;
    server_name canvas.example.com;

    ssl_certificate     /etc/nginx/ssl/canvas.example.com.pem;
    ssl_certificate_key /etc/nginx/ssl/canvas.example.com.key;

    # 参考图/视频以 dataUrl 形式经代理上行，放宽请求体限制
    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;      # SSE 流式输出必需
        proxy_read_timeout 600s;  # 视频等长生成任务
        proxy_send_timeout 600s;
    }
}

server {
    listen 80;
    server_name canvas.example.com;
    return 301 https://$host$request_uri;
}
```

- [ ] **Step 3: README 部署章节追加**

在 `README.md` 的 Docker 部署说明之后追加小节（位置：现有部署章节末尾）：

```markdown
### 服务端代理模式（访客免配置）

为容器设置以下三个环境变量即可开启；任一缺失则行为与原版一致：

| 变量 | 说明 |
| --- | --- |
| `AI_PROXY_UPSTREAM_BASE_URL` | 上游（如 New API）内网地址，例如 `http://new-api:3000` |
| `AI_PROXY_API_KEY` | 上游真密钥，仅存在于服务器，不会下发到浏览器 |
| `AI_PROXY_ACCESS_CODES` | 逗号分隔的访问码列表，访客输入其一即可使用；删除某个码并重启即作废 |

开启后：访客首次打开站点会弹出"输入访问码"，验证通过即可使用全部生成能力；
模型列表自动从上游 `/v1/models` 拉取（5 分钟缓存）。
反向代理配置参考 `docs/deploy/nginx-infinite-canvas.conf.example`（注意关闭 `proxy_buffering` 以支持流式输出）。
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docs/deploy/nginx-infinite-canvas.conf.example README.md
git commit -m "docs(deploy): 服务端代理模式部署配置（compose 环境变量 / nginx 示例 / README）"
```

---

### Task 8: 整体验证

**Files:** 无新增（验证性任务）

- [ ] **Step 1: 全量单测**

```bash
cd web && bun test
```

预期：全部 PASS。

- [ ] **Step 2: 生产构建 + 格式检查**

```bash
cd web && bun run build && bun run format:check
```

预期：build 成功（类型检查含新增路由/store/测试文件）；format:check 通过（不过则先 `bun run format`）。

- [ ] **Step 3: 手动 E2E 清单（本地，指向真实 New API 时执行）**

```powershell
cd web
$env:AI_PROXY_UPSTREAM_BASE_URL="<New API 地址>"; $env:AI_PROXY_API_KEY="<真密钥>"; $env:AI_PROXY_ACCESS_CODES="test-code"; bun dev
```

| # | 场景 | 预期 |
|---|---|---|
| 1 | 首次访问 | 自动弹访问码窗，输错提示"访问码无效或已停用" |
| 2 | 输对访问码 | 提示成功，模型选择器出现按能力分类的模型 |
| 3 | 文本生成 | 流式逐字输出正常，停止按钮可中断 |
| 4 | 图像生成 | 出图正常 |
| 5 | 音频生成 | 可播放 |
| 6 | 视频生成 | 任务创建→轮询→出片，停止可中断 |
| 7 | 刷新页面 | 免重复输码，模型清单自动刷新 |
| 8 | 环境变量删掉某访问码后重启 | 该码请求 401，前端重新弹码窗 |
| 9 | DevTools Network 检查 | 所有 AI 请求指向 `/api/ai/...`，Bearer 仅为访问码，真密钥不出现 |
| 10 | 不设环境变量重启 | 行为与原版完全一致（配置弹窗为渠道配置 UI） |

- [ ] **Step 4: 最终提交（如有格式化产生的改动）**

```bash
git add -A && git commit -m "chore: 格式化与验证收尾"
```

---

## 后续（不在本计划内，等待用户提供服务器信息）

1. 服务器上 `git clone` fork → `docker compose build`（或推镜像）
2. compose 填入真实环境变量、接入 New API docker 网络
3. Nginx 挂载用户提供的 SSL 证书，套用 `docs/deploy/nginx-infinite-canvas.conf.example`
4. 用生产域名复跑 Task 8 Step 3 清单
