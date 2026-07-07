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
