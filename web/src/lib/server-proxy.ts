// 服务端代理模式判定：渠道 baseUrl 为 /api/ai（本站 Next 代理 → new-api）。
// 生图/生视频服务据此决定走 new-api 的异步任务链路还是各自的直连协议。
export function isServerProxiedBaseUrl(baseUrl: string) {
    const normalized = (baseUrl || "").trim().replace(/\/+$/, "");
    return /\/api\/ai$/i.test(normalized);
}
