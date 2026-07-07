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
