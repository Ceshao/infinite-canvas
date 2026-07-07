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
