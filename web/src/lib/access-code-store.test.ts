import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
