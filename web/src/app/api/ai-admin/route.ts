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
