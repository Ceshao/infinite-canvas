# 访问码管理后台 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 站长在 `/admin` 网页后台自主管理访问码（查看备注/时间/用量、生成、作废），改动即时生效。

**Architecture:** 访问码从环境变量迁移到持久化 JSON 文件（Docker 卷 `/data`），进程内单例缓存；代理鉴权改查存储层并记录用量（10 秒节流落盘）；新增管理接口 `/api/ai-admin`（`x-admin-password` 恒时比较鉴权）与管理页 `/admin`。

**Tech Stack:** Next.js route handlers（nodejs runtime）、node:fs/promises + node:crypto、antd、copy-to-clipboard（已有依赖）、bun test。

**Spec:** `docs/superpowers/specs/2026-07-07-admin-access-codes-design.md`

---

### Task 1: 存储层 `access-code-store.ts`（TDD）

**Files:**
- Create: `web/src/lib/access-code-store.ts`
- Test: `web/src/lib/access-code-store.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `web/src/lib/access-code-store.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addCode, flushUsageNow, generateCode, listCodes, recordUsage, removeCode, resetStoreForTests, verifyCode } from "@/lib/access-code-store";

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "codes-"));
    process.env.AI_PROXY_DATA_DIR = dir;
    delete process.env.AI_PROXY_ACCESS_CODES;
    resetStoreForTests();
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe("generateCode", () => {
    test("格式为 ic- 前缀 + 10 位，无易混淆字符", () => {
        for (let i = 0; i < 20; i += 1) {
            expect(generateCode()).toMatch(/^ic-[abcdefghjkmnpqrstuvwxyz23456789]{10}$/);
        }
    });
});

describe("种子迁移", () => {
    test("文件不存在时从环境变量导入并落盘", async () => {
        process.env.AI_PROXY_ACCESS_CODES = "old-1, old-2";
        resetStoreForTests();
        const codes = await listCodes();
        expect(codes.map((item) => item.code)).toEqual(["old-1", "old-2"]);
        expect(codes[0].note).toBe("初始导入");
        expect(JSON.parse(readFileSync(join(dir, "access-codes.json"), "utf8"))).toHaveLength(2);
    });

    test("文件已存在时环境变量不再参与", async () => {
        writeFileSync(join(dir, "access-codes.json"), JSON.stringify([{ code: "file-1", note: "", createdAt: "", requests: 0, lastUsedAt: "" }]));
        process.env.AI_PROXY_ACCESS_CODES = "env-only";
        resetStoreForTests();
        expect(await verifyCode("file-1")).toBe(true);
        expect(await verifyCode("env-only")).toBe(false);
    });

    test("损坏文件容错：回退到环境变量种子且不崩", async () => {
        writeFileSync(join(dir, "access-codes.json"), "{broken json");
        process.env.AI_PROXY_ACCESS_CODES = "rescue-1";
        resetStoreForTests();
        expect(await verifyCode("rescue-1")).toBe(true);
    });
});

describe("增删与校验", () => {
    test("addCode 生成新码并立即落盘", async () => {
        const entry = await addCode("小明");
        expect(entry.note).toBe("小明");
        expect(entry.requests).toBe(0);
        expect(await verifyCode(entry.code)).toBe(true);
        const onDisk = JSON.parse(readFileSync(join(dir, "access-codes.json"), "utf8"));
        expect(onDisk.some((item: { code: string }) => item.code === entry.code)).toBe(true);
    });

    test("removeCode 作废后校验失败且落盘", async () => {
        const entry = await addCode("临时");
        expect(await removeCode(entry.code)).toBe(true);
        expect(await verifyCode(entry.code)).toBe(false);
        expect(await removeCode("不存在的码")).toBe(false);
    });
});

describe("用量统计", () => {
    test("recordUsage 累加并在 flush 后落盘", async () => {
        const entry = await addCode("统计");
        await recordUsage(entry.code);
        await recordUsage(entry.code);
        const inMemory = (await listCodes()).find((item) => item.code === entry.code)!;
        expect(inMemory.requests).toBe(2);
        expect(inMemory.lastUsedAt).not.toBe("");
        await flushUsageNow();
        const onDisk = JSON.parse(readFileSync(join(dir, "access-codes.json"), "utf8"));
        expect(onDisk.find((item: { code: string }) => item.code === entry.code).requests).toBe(2);
    });

    test("原子写不留 tmp 文件", async () => {
        await addCode("原子");
        expect(existsSync(join(dir, "access-codes.json.tmp"))).toBe(false);
    });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd web && bun test src/lib/access-code-store.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

创建 `web/src/lib/access-code-store.ts`：

```ts
import { randomInt } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { parseAccessCodes } from "@/lib/ai-proxy";

export type AccessCodeEntry = {
    code: string;
    note: string;
    createdAt: string;
    requests: number;
    lastUsedAt: string;
};

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 10;
const FLUSH_DELAY_MS = 10_000;

let cache: AccessCodeEntry[] | null = null;
let loading: Promise<AccessCodeEntry[]> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

function dataFile() {
    return path.join(process.env.AI_PROXY_DATA_DIR || "/data", "access-codes.json");
}

export function generateCode() {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    return `ic-${code}`;
}

function seedFromEnv(): AccessCodeEntry[] {
    return Array.from(parseAccessCodes(process.env.AI_PROXY_ACCESS_CODES)).map((code) => ({
        code,
        note: "初始导入",
        createdAt: new Date().toISOString(),
        requests: 0,
        lastUsedAt: "",
    }));
}

function normalizeEntry(entry: Partial<AccessCodeEntry>): AccessCodeEntry | null {
    const code = String(entry.code || "").trim();
    if (!code) return null;
    return {
        code,
        note: String(entry.note || ""),
        createdAt: String(entry.createdAt || ""),
        requests: Number(entry.requests) || 0,
        lastUsedAt: String(entry.lastUsedAt || ""),
    };
}

async function loadStore(): Promise<AccessCodeEntry[]> {
    if (cache) return cache;
    if (loading) return loading;
    loading = (async () => {
        try {
            const raw = await fs.readFile(dataFile(), "utf8");
            const parsed = JSON.parse(raw) as Partial<AccessCodeEntry>[];
            cache = (Array.isArray(parsed) ? parsed : []).map(normalizeEntry).filter((entry): entry is AccessCodeEntry => Boolean(entry));
        } catch (error) {
            cache = seedFromEnv();
            if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
                await persist().catch((persistError) => console.error("access-code-store 种子写入失败", persistError));
            } else {
                console.error("access-code-store 读取失败，回退到环境变量种子", error);
            }
        } finally {
            loading = null;
        }
        return cache!;
    })();
    return loading;
}

async function persist() {
    if (!cache) return;
    const file = dataFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(cache, null, 2), "utf8");
    await fs.rename(tmp, file);
}

function scheduleFlush() {
    dirty = true;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        if (!dirty) return;
        dirty = false;
        void persist().catch((error) => console.error("access-code-store 用量落盘失败", error));
    }, FLUSH_DELAY_MS);
}

export async function flushUsageNow() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    dirty = false;
    await persist();
}

export async function listCodes(): Promise<AccessCodeEntry[]> {
    return [...(await loadStore())];
}

export async function verifyCode(code: string): Promise<boolean> {
    const trimmed = code.trim();
    if (!trimmed) return false;
    return (await loadStore()).some((entry) => entry.code === trimmed);
}

export async function recordUsage(code: string) {
    const entry = (await loadStore()).find((item) => item.code === code.trim());
    if (!entry) return;
    entry.requests += 1;
    entry.lastUsedAt = new Date().toISOString();
    scheduleFlush();
}

export async function addCode(note: string): Promise<AccessCodeEntry> {
    const store = await loadStore();
    const entry: AccessCodeEntry = { code: generateCode(), note: note.trim(), createdAt: new Date().toISOString(), requests: 0, lastUsedAt: "" };
    store.push(entry);
    await persist();
    return entry;
}

export async function removeCode(code: string): Promise<boolean> {
    const store = await loadStore();
    const index = store.findIndex((entry) => entry.code === code.trim());
    if (index < 0) return false;
    store.splice(index, 1);
    await persist();
    return true;
}

export function resetStoreForTests() {
    cache = null;
    loading = null;
    dirty = false;
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd web && bun test src/lib/access-code-store.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/access-code-store.ts web/src/lib/access-code-store.test.ts
git commit -m "feat(admin): 访问码持久化存储层（JSON 文件+种子迁移+用量节流落盘）"
```

---

### Task 2: 鉴权切换到存储层

**Files:**
- Modify: `web/src/lib/ai-proxy.ts`（`readServerProxyConfig` 不再要求 ACCESS_CODES）
- Modify: `web/src/lib/ai-proxy.test.ts`（同步测试）
- Modify: `web/src/app/api/ai/[...path]/route.ts`（查存储层 + recordUsage）
- Modify: `web/src/app/api/ai-config/route.ts`（查存储层）

- [ ] **Step 1: 更新 ai-proxy 测试（先红）**

`web/src/lib/ai-proxy.test.ts` 中 `readServerProxyConfig` 的 describe 块整体替换为：

```ts
describe("readServerProxyConfig", () => {
    const env = { AI_PROXY_UPSTREAM_BASE_URL: "http://new-api:3000/", AI_PROXY_API_KEY: "sk-test" };

    test("两个变量齐备时返回配置并去除尾斜杠（ACCESS_CODES 不再必需）", () => {
        expect(readServerProxyConfig(env)).toEqual({ upstreamBaseUrl: "http://new-api:3000", apiKey: "sk-test" });
    });

    test("任一变量缺失返回 null", () => {
        expect(readServerProxyConfig({ ...env, AI_PROXY_UPSTREAM_BASE_URL: "" })).toBeNull();
        expect(readServerProxyConfig({ ...env, AI_PROXY_API_KEY: undefined })).toBeNull();
    });
});
```

Run: `cd web && bun test src/lib/ai-proxy.test.ts` → 该块 FAIL（实现仍要求 accessCodes）

- [ ] **Step 2: 修改 `ai-proxy.ts`**

`ServerProxyConfig` 与 `readServerProxyConfig` 替换为（`parseAccessCodes` 保留，供存储层种子使用）：

```ts
export type ServerProxyConfig = {
    upstreamBaseUrl: string;
    apiKey: string;
};

export function readServerProxyConfig(env: Record<string, string | undefined> = process.env): ServerProxyConfig | null {
    const upstreamBaseUrl = (env.AI_PROXY_UPSTREAM_BASE_URL || "").trim().replace(/\/+$/, "");
    const apiKey = (env.AI_PROXY_API_KEY || "").trim();
    if (!upstreamBaseUrl || !apiKey) return null;
    return { upstreamBaseUrl, apiKey };
}
```

Run: `bun test src/lib/ai-proxy.test.ts` → PASS

- [ ] **Step 3: 代理路由接入存储层**

`web/src/app/api/ai/[...path]/route.ts` 顶部加 import：

```ts
import { recordUsage, verifyCode } from "@/lib/access-code-store";
```

`proxyRequest` 中鉴权两行：

```ts
    const access = readAccessCode(request.headers);
    if (!access || !(await verifyCode(access.code))) return proxyErrorResponse(401, "访问码无效或已停用");
    await recordUsage(access.code);
```

- [ ] **Step 4: ai-config 路由接入存储层**

`web/src/app/api/ai-config/route.ts` 顶部加 import：

```ts
import { verifyCode } from "@/lib/access-code-store";
```

校验行改为：

```ts
    if (!(await verifyCode(access.code))) return proxyErrorResponse(401, "访问码无效或已停用");
```

- [ ] **Step 5: 全量测试 + Commit**

Run: `cd web && bun test` → 全部 PASS

```bash
git add web/src/lib/ai-proxy.ts web/src/lib/ai-proxy.test.ts "web/src/app/api/ai/[...path]/route.ts" web/src/app/api/ai-config/route.ts
git commit -m "feat(admin): 代理鉴权切换到持久化存储层并记录用量"
```

---

### Task 3: 管理接口 `/api/ai-admin`（口令恒时比较 TDD）

**Files:**
- Modify: `web/src/lib/ai-proxy.ts`（新增 `safeEqualSecret`）
- Modify: `web/src/lib/ai-proxy.test.ts`（测试）
- Create: `web/src/app/api/ai-admin/route.ts`

- [ ] **Step 1: 写失败的测试**

`web/src/lib/ai-proxy.test.ts` import 行加入 `safeEqualSecret`，文件末尾追加：

```ts
describe("safeEqualSecret", () => {
    test("相同返回 true，不同/为空返回 false", () => {
        expect(safeEqualSecret("admin-pw", "admin-pw")).toBe(true);
        expect(safeEqualSecret("admin-pw", "wrong")).toBe(false);
        expect(safeEqualSecret("", "")).toBe(false);
        expect(safeEqualSecret("a", "")).toBe(false);
    });
});
```

Run: `bun test src/lib/ai-proxy.test.ts` → FAIL

- [ ] **Step 2: 实现 `safeEqualSecret`**

`web/src/lib/ai-proxy.ts` 顶部加 `import { createHash, timingSafeEqual } from "node:crypto";`，末尾追加：

```ts
export function safeEqualSecret(expected: string, provided: string) {
    if (!expected.trim() || !provided.trim()) return false;
    const expectedHash = createHash("sha256").update(expected).digest();
    const providedHash = createHash("sha256").update(provided).digest();
    return timingSafeEqual(expectedHash, providedHash);
}
```

Run: `bun test src/lib/ai-proxy.test.ts` → PASS

- [ ] **Step 3: 实现管理接口**

创建 `web/src/app/api/ai-admin/route.ts`：

```ts
import type { NextRequest } from "next/server";

import { addCode, listCodes, removeCode } from "@/lib/access-code-store";
import { proxyErrorResponse, readServerProxyConfig, safeEqualSecret } from "@/lib/ai-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminAuth = "disabled" | "unauthorized" | "ok";

function checkAdmin(request: NextRequest): AdminAuth {
    const adminPassword = (process.env.AI_PROXY_ADMIN_PASSWORD || "").trim();
    if (!readServerProxyConfig() || !adminPassword) return "disabled";
    return safeEqualSecret(adminPassword, request.headers.get("x-admin-password") || "") ? "ok" : "unauthorized";
}

function guard(request: NextRequest): Response | null {
    const auth = checkAdmin(request);
    if (auth === "disabled") return proxyErrorResponse(404, "管理后台未启用");
    if (auth === "unauthorized") return proxyErrorResponse(401, "管理口令错误");
    return null;
}

export async function GET(request: NextRequest) {
    const denied = guard(request);
    if (denied) return denied;
    return Response.json({ codes: await listCodes() });
}

export async function POST(request: NextRequest) {
    const denied = guard(request);
    if (denied) return denied;
    const body = (await request.json().catch(() => ({}))) as { note?: string };
    return Response.json({ code: await addCode(String(body.note || "")) });
}

export async function DELETE(request: NextRequest) {
    const denied = guard(request);
    if (denied) return denied;
    const body = (await request.json().catch(() => ({}))) as { code?: string };
    const code = String(body.code || "").trim();
    if (!code || !(await removeCode(code))) return proxyErrorResponse(404, "访问码不存在");
    return Response.json({ ok: true });
}
```

- [ ] **Step 4: curl 验证（dev 服务器）**

PowerShell/Git Bash 启动 dev（Windows 需指定数据目录）：

```bash
cd web && AI_PROXY_DATA_DIR=./data AI_PROXY_UPSTREAM_BASE_URL="http://127.0.0.1:59988" AI_PROXY_API_KEY="sk-test" AI_PROXY_ACCESS_CODES="test-code" AI_PROXY_ADMIN_PASSWORD="admin-pw" bunx next dev --webpack -p 3100
```

```bash
curl -s -w ' [%{http_code}]' http://localhost:3100/api/ai-admin                                   # 预期 401（启用但没口令）
curl -s -w ' [%{http_code}]' -H 'x-admin-password: wrong' http://localhost:3100/api/ai-admin      # 预期 401
curl -s -H 'x-admin-password: admin-pw' http://localhost:3100/api/ai-admin                        # 预期 {"codes":[{"code":"test-code","note":"初始导入",...}]}
curl -s -X POST -H 'x-admin-password: admin-pw' -H 'Content-Type: application/json' -d '{"note":"测试"}' http://localhost:3100/api/ai-admin   # 预期返回新 ic- 码
curl -s -X DELETE -H 'x-admin-password: admin-pw' -H 'Content-Type: application/json' -d '{"code":"<上一步的码>"}' http://localhost:3100/api/ai-admin  # 预期 {"ok":true}
# 不设 AI_PROXY_ADMIN_PASSWORD 重启后：GET 预期 404
```

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/ai-proxy.ts web/src/lib/ai-proxy.test.ts web/src/app/api/ai-admin/route.ts
git commit -m "feat(admin): /api/ai-admin 管理接口（恒时口令比较，增删查访问码）"
```

---

### Task 4: 管理页面 `/admin`

**Files:**
- Create: `web/src/app/(user)/admin/page.tsx`

- [ ] **Step 1: 实现页面**

创建 `web/src/app/(user)/admin/page.tsx`：

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, Modal, Popconfirm, Table, Typography } from "antd";
import copy from "copy-to-clipboard";
import { Plus, RefreshCw } from "lucide-react";

type AccessCodeEntry = { code: string; note: string; createdAt: string; requests: number; lastUsedAt: string };
type PanelState = "loading" | "disabled" | "login" | "ready";

const PASSWORD_KEY = "infinite-canvas:admin_password";

export default function AdminPage() {
    const { message } = App.useApp();
    const [state, setState] = useState<PanelState>("loading");
    const [password, setPassword] = useState("");
    const [passwordInput, setPasswordInput] = useState("");
    const [codes, setCodes] = useState<AccessCodeEntry[]>([]);
    const [noteInput, setNoteInput] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    const fetchCodes = useCallback(
        async (candidate: string) => {
            const response = await fetch("/api/ai-admin", { headers: candidate ? { "x-admin-password": candidate } : {}, cache: "no-store" });
            if (response.status === 404) {
                setState("disabled");
                return false;
            }
            if (response.status === 401) {
                sessionStorage.removeItem(PASSWORD_KEY);
                setState("login");
                return false;
            }
            const payload = (await response.json()) as { codes?: AccessCodeEntry[] };
            setCodes(payload.codes || []);
            setPassword(candidate);
            sessionStorage.setItem(PASSWORD_KEY, candidate);
            setState("ready");
            return true;
        },
        [],
    );

    useEffect(() => {
        void fetchCodes(sessionStorage.getItem(PASSWORD_KEY) || "");
    }, [fetchCodes]);

    const login = async () => {
        if (!passwordInput.trim()) return;
        setBusy(true);
        const ok = await fetchCodes(passwordInput.trim());
        setBusy(false);
        if (!ok && state !== "disabled") message.error("管理口令错误");
        else setPasswordInput("");
    };

    const createCode = async () => {
        setBusy(true);
        const response = await fetch("/api/ai-admin", {
            method: "POST",
            headers: { "x-admin-password": password, "Content-Type": "application/json" },
            body: JSON.stringify({ note: noteInput.trim() }),
        });
        setBusy(false);
        if (!response.ok) {
            message.error("生成失败");
            return;
        }
        const payload = (await response.json()) as { code: AccessCodeEntry };
        setCreateOpen(false);
        setNoteInput("");
        await fetchCodes(password);
        Modal.success({
            title: "新访问码已生成",
            content: (
                <Typography.Paragraph copyable={{ text: payload.code.code }} className="!mb-0 pt-2 font-mono text-base">
                    {payload.code.code}
                </Typography.Paragraph>
            ),
        });
    };

    const revoke = async (code: string) => {
        const response = await fetch("/api/ai-admin", {
            method: "DELETE",
            headers: { "x-admin-password": password, "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
        });
        if (response.ok) {
            message.success("已作废");
            await fetchCodes(password);
        } else message.error("作废失败");
    };

    if (state === "loading") return <main className="flex h-full items-center justify-center text-sm text-stone-500">正在加载...</main>;
    if (state === "disabled") return <main className="flex h-full items-center justify-center text-sm text-stone-500">管理后台未启用</main>;
    if (state === "login")
        return (
            <main className="flex h-full items-center justify-center">
                <div className="w-80 space-y-3 rounded-lg border border-stone-200 p-6 dark:border-stone-800">
                    <h1 className="text-lg font-medium">访问码管理</h1>
                    <Input.Password value={passwordInput} onChange={(event) => setPasswordInput(event.target.value)} placeholder="请输入管理口令" onPressEnter={login} autoFocus />
                    <Button type="primary" block loading={busy} onClick={login}>
                        进入后台
                    </Button>
                </div>
            </main>
        );

    return (
        <main className="h-full overflow-auto bg-background">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-10">
                <header className="flex items-end justify-between border-b border-stone-200 pb-5 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">站长后台</p>
                        <h1 className="mt-2 text-2xl font-semibold">访问码管理</h1>
                    </div>
                    <div className="flex gap-2">
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => void fetchCodes(password)}>
                            刷新
                        </Button>
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
                            生成新访问码
                        </Button>
                    </div>
                </header>

                <Table<AccessCodeEntry>
                    rowKey="code"
                    dataSource={codes}
                    pagination={false}
                    columns={[
                        {
                            title: "访问码",
                            dataIndex: "code",
                            render: (code: string) => (
                                <button
                                    type="button"
                                    className="cursor-pointer font-mono hover:underline"
                                    onClick={() => {
                                        copy(code);
                                        message.success("已复制");
                                    }}
                                    title="点击复制"
                                >
                                    {code}
                                </button>
                            ),
                        },
                        { title: "备注", dataIndex: "note", render: (note: string) => note || "—" },
                        { title: "创建时间", dataIndex: "createdAt", render: (value: string) => (value ? new Date(value).toLocaleString() : "—") },
                        { title: "请求数", dataIndex: "requests" },
                        { title: "最后使用", dataIndex: "lastUsedAt", render: (value: string) => (value ? new Date(value).toLocaleString() : "从未使用") },
                        {
                            title: "操作",
                            render: (_: unknown, record: AccessCodeEntry) => (
                                <Popconfirm title={`作废 ${record.code}？`} description="使用该码的访客将立即失去访问权限" okText="作废" cancelText="取消" onConfirm={() => void revoke(record.code)}>
                                    <Button danger size="small">
                                        作废
                                    </Button>
                                </Popconfirm>
                            ),
                        },
                    ]}
                />
            </div>

            <Modal title="生成新访问码" open={createOpen} onOk={createCode} onCancel={() => setCreateOpen(false)} confirmLoading={busy} okText="生成" cancelText="取消">
                <Input value={noteInput} onChange={(event) => setNoteInput(event.target.value)} placeholder="备注（给谁用的，可留空）" onPressEnter={createCode} className="my-2" autoFocus />
            </Modal>
        </main>
    );
}
```

- [ ] **Step 2: 浏览器冒烟（Playwright，dev 环境同 Task 3 Step 4）**

用 Playwright 脚本验证（`wait_until="domcontentloaded"`，antd message 用 `wait_for_selector` 及时断言）：
1. 打开 `/admin` → 出现"访问码管理"口令界面
2. 输错口令 → 提示"管理口令错误"
3. 输对 `admin-pw` → 表格出现 `test-code`（备注"初始导入"）
4. 生成新访问码（备注"冒烟"）→ 成功弹窗出现 `ic-` 码
5. 用新码调 `/api/ai-config` → `valid:true`
6. 作废新码 → 再调 `/api/ai-config` → 401
7. 刷新页面 → 免重输口令（sessionStorage）

- [ ] **Step 3: Commit**

```bash
git add "web/src/app/(user)/admin/page.tsx"
git commit -m "feat(admin): /admin 访问码管理页面（口令登录/生成/作废/用量展示）"
```

---

### Task 5: 全量验证 + 构建

**Files:** 无新增

- [ ] **Step 1**: `cd web && bun test` → 全部 PASS
- [ ] **Step 2**: `bun run build` → 成功，路由清单含 `ƒ /api/ai-admin`、`○ /admin`
- [ ] **Step 3**: 对本次改动的文件跑 `bunx prettier --write <files>`（**不要全量格式化**），确认无 diff 噪音后：

```bash
git add -u && git commit -m "chore: 格式化收尾" # 若无改动则跳过
```

---

### Task 6: 文档与部署配置

**Files:**
- Modify: `docker-compose.yml`（注释增加 ADMIN_PASSWORD 与 volumes 示例）
- Modify: `README.md`（服务端模式表格加 ADMIN_PASSWORD 行 + /admin 说明）
- Modify: `docs/deploy/OPERATIONS.md`（管码方式改为 /admin 后台，.env 编辑降为备用手段；新增 canvas-data 卷说明）

- [ ] **Step 1**: `docker-compose.yml` 的 environment 注释块加：

```yaml
    #   AI_PROXY_ADMIN_PASSWORD: your-admin-password        # 设置后可用 /admin 网页管理访问码
    # volumes:
    #   - canvas-data:/data                                 # 访问码与用量数据持久化
# volumes:
#   canvas-data:
```

- [ ] **Step 2**: README 服务端模式表格追加一行：

```markdown
| `AI_PROXY_ADMIN_PASSWORD` | 可选。设置后站长可访问 `/admin` 网页后台管理访问码（生成/作废/查看用量），改动即时生效 |
```

并在表格下说明：`AI_PROXY_ACCESS_CODES` 现为首次启动的种子导入，之后请通过 `/admin` 管理（需挂载 `/data` 卷持久化）。

- [ ] **Step 3**: OPERATIONS.md 第 3 节"增删访问码"改为：

```markdown
### 增删访问码（推荐：网页后台）

打开 https://cancanvas.shaolabs.xyz/admin，输入管理口令（存于服务器 `.env` 的 `AI_PROXY_ADMIN_PASSWORD`）。
生成/作废即时生效，无需重启。数据存于 docker 卷 `canvas-data`（`/data/access-codes.json`），含每码请求数与最后使用时间。

备用（后台不可用时）：删除卷内 `access-codes.json` 并重启容器可重新从 `.env` 的 `AI_PROXY_ACCESS_CODES` 种子导入。
```

- [ ] **Step 4: Commit + push（触发 Actions 构建）**

```bash
git add docker-compose.yml README.md docs/deploy/OPERATIONS.md
git commit -m "docs(admin): 管理后台部署配置与运维文档更新"
git push origin main   # 合并到 main 后执行
```

---

### Task 7: 生产部署与验证

**Files:** 服务器 `/opt/infinite-canvas/docker-compose.server.yml`、`/opt/infinite-canvas/.env`（不进 git）

- [ ] **Step 1**: 等 Actions 构建成功（`gh api` 或网页确认）
- [ ] **Step 2**: 服务器 compose 增加卷挂载与命名卷（scratchpad 版本更新后 SFTP 上传）：

```yaml
    volumes:
      - canvas-data:/data
# 顶层：
volumes:
  canvas-data:
```

- [ ] **Step 3**: 服务器 `.env` 追加 `AI_PROXY_ADMIN_PASSWORD=<强口令>`（用密码生成器，告知用户保存）
- [ ] **Step 4**: `docker compose -f docker-compose.server.yml pull && docker compose -f docker-compose.server.yml up -d`
- [ ] **Step 5**: 生产验证（服务器侧 curl）：
  - `GET /api/ai-admin` 无口令 → 401；错口令 → 401；对口令 → codes 列表含种子导入的两个旧码
  - 老访问码仍可通过 `/api/ai-config` 校验（平滑迁移成功）
  - 浏览器打开 `/admin` 全流程（登录/生成/作废/用量）
  - 用新生成的码跑一次流式生成，确认 requests 计数增加

---

## 自审记录

- Spec 覆盖：存储层→T1；鉴权切换→T2；管理接口→T3；页面→T4；部署变更→T6/T7；测试→T1/T3/T4/T5 ✓
- 占位符：无
- 类型一致：`AccessCodeEntry` 字段、`verifyCode/recordUsage/addCode/removeCode/listCodes/flushUsageNow/resetStoreForTests/generateCode`、`safeEqualSecret` 前后一致 ✓
