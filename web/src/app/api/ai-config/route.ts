import type { NextRequest } from "next/server";

import { verifyCode } from "@/lib/access-code-store";
import { parseAsyncImageModels, parseGeminiModels, parseModelsPayload, proxyErrorResponse, readAccessCode, readServerProxyConfig } from "@/lib/ai-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const modelsCacheTtlMs = 1000 * 60 * 5;
let modelsCache: { models: string[]; fetchedAt: number } | null = null;

export async function GET(request: NextRequest) {
    const config = readServerProxyConfig();
    if (!config) return Response.json({ serverMode: false });
    const access = readAccessCode(request.headers);
    if (!access) return Response.json({ serverMode: true });
    if (!(await verifyCode(access.code))) return proxyErrorResponse(401, "访问码无效或已停用");
    const { models, modelsError } = await loadUpstreamModels(config.upstreamBaseUrl, config.apiKey);
    return Response.json({ serverMode: true, valid: true, models, asyncImageModels: parseAsyncImageModels(), geminiModels: parseGeminiModels(), ...(modelsError ? { modelsError } : {}) });
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
        const message = error instanceof Error && error.message.startsWith("模型列表拉取失败") ? error.message : "模型列表拉取失败，请检查上游连接";
        return { models: modelsCache?.models || [], modelsError: message };
    }
}
