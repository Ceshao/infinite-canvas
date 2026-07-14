import { createHash, timingSafeEqual } from "node:crypto";

export type AccessCodeStyle = "bearer" | "gemini";

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

const MGDB_DEFAULT_UPSTREAM_BASE_URL = "https://gw.amlig.com";

export function readMgdbProxyConfig(env: Record<string, string | undefined> = process.env): ServerProxyConfig | null {
    const upstreamBaseUrl = (env.AI_PROXY_MGDB_UPSTREAM_BASE_URL || MGDB_DEFAULT_UPSTREAM_BASE_URL).trim().replace(/\/+$/, "");
    const apiKey = (env.AI_PROXY_MGDB_API_KEY || "").trim();
    if (!upstreamBaseUrl || !apiKey) return null;
    return { upstreamBaseUrl, apiKey };
}

// 服务端声明哪些图像模型走异步任务链路（new-api Sora 任务中继 → image shim），
// 未配置时前端保持原同步 /images/* 行为。
export function parseAsyncImageModels(env: Record<string, string | undefined> = process.env): string[] {
    return parseModelListEnv(env.AI_PROXY_ASYNC_IMAGE_MODELS);
}

// 服务端声明哪些模型必须走 Gemini 原生调用格式（/v1beta …:generateContent）。
// new-api 的 OpenAI images 接口会拒绝 gemini 生图模型（only imagen models are
// supported），前端据此清单生成第二个 Gemini 格式的服务器渠道。
export function parseGeminiModels(env: Record<string, string | undefined> = process.env): string[] {
    return parseModelListEnv(env.AI_PROXY_GEMINI_MODELS);
}

function parseModelListEnv(value: string | undefined): string[] {
    return Array.from(
        new Set(
            (value || "")
                .split(",")
                .map((model) => model.trim())
                .filter(Boolean),
        ),
    );
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

export function safeEqualSecret(expected: string, provided: string) {
    if (!expected.trim() || !provided.trim()) return false;
    const expectedHash = createHash("sha256").update(expected).digest();
    const providedHash = createHash("sha256").update(provided).digest();
    return timingSafeEqual(expectedHash, providedHash);
}
