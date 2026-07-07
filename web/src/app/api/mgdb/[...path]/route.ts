import type { NextRequest } from "next/server";

import { recordUsage, verifyCode } from "@/lib/access-code-store";
import { buildForwardHeaders, buildUpstreamUrl, proxyErrorResponse, readAccessCode, readMgdbProxyConfig } from "@/lib/ai-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
    return proxyRequest(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
    return proxyRequest(request, context);
}

// 网关的 /files/:taskId/final.mp4 上游本身免鉴权（任务 ID 不可枚举），
// 放行访问码校验后 <video> 标签才能直接播放代理地址
function isFileDownloadPath(path: string[]) {
    return path[0] === "files";
}

function isGatewayApiPath(path: string[]) {
    return path[0] === "api" && path[1] === "v1";
}

async function proxyRequest(request: NextRequest, context: RouteContext) {
    const config = readMgdbProxyConfig();
    if (!config) return proxyErrorResponse(404, "MGDB 代理未启用");
    const { path } = await context.params;
    const segments = path || [];
    if (!isGatewayApiPath(segments) && !isFileDownloadPath(segments)) return proxyErrorResponse(404, "不支持的 MGDB 接口路径");
    if (!isFileDownloadPath(segments)) {
        const access = readAccessCode(request.headers);
        if (!access || !(await verifyCode(access.code))) return proxyErrorResponse(401, "访问码无效或已停用");
        await recordUsage(access.code);
    }
    const url = buildUpstreamUrl(config.upstreamBaseUrl, segments, request.nextUrl.search);
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : request.body;
    const init: RequestInit & { duplex?: "half" } = {
        method: request.method,
        headers: buildForwardHeaders(request.headers, config.apiKey, "bearer"),
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
        return proxyErrorResponse(502, "MGDB 网关连接失败");
    }
}
