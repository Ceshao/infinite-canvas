import type { NextRequest } from "next/server";

import { recordUsage, verifyCode } from "@/lib/access-code-store";
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
    if (!access || !(await verifyCode(access.code))) return proxyErrorResponse(401, "访问码无效或已停用");
    await recordUsage(access.code);
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
