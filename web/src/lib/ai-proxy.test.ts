import { describe, expect, test } from "bun:test";

import { buildForwardHeaders, buildUpstreamUrl, parseAccessCodes, parseAsyncImageModels, parseGeminiModels, parseModelsPayload, readAccessCode, readMgdbProxyConfig, readServerProxyConfig, safeEqualSecret } from "@/lib/ai-proxy";

describe("parseAccessCodes", () => {
    test("按逗号分隔并去除空白项", () => {
        expect(parseAccessCodes(" alice-x7k2, bob-m9q4,,  ")).toEqual(new Set(["alice-x7k2", "bob-m9q4"]));
    });

    test("空值返回空集合", () => {
        expect(parseAccessCodes(undefined)).toEqual(new Set());
        expect(parseAccessCodes("")).toEqual(new Set());
    });
});

describe("parseAsyncImageModels", () => {
    test("按逗号分隔、去空白、保持顺序去重", () => {
        expect(parseAsyncImageModels({ AI_PROXY_ASYNC_IMAGE_MODELS: " nano-pro, nano-2,,gpt-img2, nano-pro " })).toEqual(["nano-pro", "nano-2", "gpt-img2"]);
    });

    test("未配置或为空时返回空数组（功能关闭，行为与原版一致）", () => {
        expect(parseAsyncImageModels({})).toEqual([]);
        expect(parseAsyncImageModels({ AI_PROXY_ASYNC_IMAGE_MODELS: "  " })).toEqual([]);
    });
});

describe("parseGeminiModels", () => {
    test("按逗号分隔、去空白、保持顺序去重", () => {
        expect(parseGeminiModels({ AI_PROXY_GEMINI_MODELS: " gemini-3-pro-image-preview, gemini-2.5-flash-image,,gemini-3-pro-image-preview " })).toEqual(["gemini-3-pro-image-preview", "gemini-2.5-flash-image"]);
    });

    test("未配置或为空时返回空数组（不生成 Gemini 渠道）", () => {
        expect(parseGeminiModels({})).toEqual([]);
        expect(parseGeminiModels({ AI_PROXY_GEMINI_MODELS: "  " })).toEqual([]);
    });
});

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

describe("readMgdbProxyConfig", () => {
    test("只配 API Key 时上游默认 gw.amlig.com", () => {
        expect(readMgdbProxyConfig({ AI_PROXY_MGDB_API_KEY: "mgdb-key" })).toEqual({ upstreamBaseUrl: "https://gw.amlig.com", apiKey: "mgdb-key" });
    });

    test("可覆盖上游地址并去除尾斜杠", () => {
        expect(readMgdbProxyConfig({ AI_PROXY_MGDB_UPSTREAM_BASE_URL: "https://gw.example.com/", AI_PROXY_MGDB_API_KEY: "mgdb-key" })).toEqual({ upstreamBaseUrl: "https://gw.example.com", apiKey: "mgdb-key" });
    });

    test("缺少 API Key 返回 null（代理未启用）", () => {
        expect(readMgdbProxyConfig({})).toBeNull();
        expect(readMgdbProxyConfig({ AI_PROXY_MGDB_API_KEY: "  " })).toBeNull();
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

describe("safeEqualSecret", () => {
    test("相同返回 true，不同/为空返回 false", () => {
        expect(safeEqualSecret("admin-pw", "admin-pw")).toBe(true);
        expect(safeEqualSecret("admin-pw", "wrong")).toBe(false);
        expect(safeEqualSecret("", "")).toBe(false);
        expect(safeEqualSecret("a", "")).toBe(false);
    });
});
