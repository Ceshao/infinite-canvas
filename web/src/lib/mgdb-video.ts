import { isServerProxiedBaseUrl } from "@/lib/server-proxy";
import { normalizeSeedanceRatio } from "@/lib/seedance-video";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export const MGDB_UPSTREAM_MODEL = "sd_2.0_fast";
export const MGDB_REFERENCE_IMAGE_LIMIT = 9;

export const mgdbRatioOptions = [
    { value: "16:9", label: "横屏" },
    { value: "9:16", label: "竖屏" },
    { value: "1:1", label: "方形" },
    { value: "4:3", label: "标准横屏" },
    { value: "3:4", label: "标准竖屏" },
    { value: "21:9", label: "宽银幕" },
] as const;

export const mgdbDurationOptions = [5, 10, 15] as const;

const mgdbPixels: Record<string, string> = {
    "16:9": "1280x720",
    "9:16": "720x1280",
    "1:1": "960x960",
    "4:3": "1112x834",
    "3:4": "834x1112",
    "21:9": "1470x630",
};

export function isMgdbVideoModel(model: string) {
    return modelOptionName(model).toLowerCase().includes("mgdb");
}

export function isMgdbVideoConfig(config: AiConfig | Pick<AiConfig, "model" | "videoModel">) {
    const requestConfig = "channels" in config ? resolveModelRequestConfig(config, config.model || config.videoModel) : config;
    return isMgdbVideoModel(requestConfig.model || requestConfig.videoModel);
}

export function normalizeMgdbRatio(value: string) {
    const ratio = normalizeSeedanceRatio(value);
    return ratio === "adaptive" ? "16:9" : ratio;
}

export function normalizeMgdbDuration(value: string) {
    const seconds = Math.floor(Number(value)) || 5;
    return mgdbDurationOptions.reduce<(typeof mgdbDurationOptions)[number]>((best, item) => (Math.abs(item - seconds) < Math.abs(best - seconds) ? item : best), mgdbDurationOptions[0]);
}

export function mgdbPixelLabel(ratio: string) {
    return mgdbPixels[normalizeMgdbRatio(ratio)] || "";
}

// 服务端代理模式（baseUrl 为 /api/ai）下，MGDB 视频生成改走 new-api 的
// Sora 兼容异步任务接口（/v1/videos 提交/轮询/取件），由 new-api 统一计量计费；
// 只有直连网关的自部署用户仍走 /api/v1/generate 私有协议。
export function isMgdbServerProxied(baseUrl: string) {
    return isServerProxiedBaseUrl(baseUrl);
}

// 服务器模式下渠道 baseUrl 固定为 /api/ai（转发到 new-api），MGDB 网关协议
// 与 new-api 不兼容，需改走专用代理 /api/mgdb；直连网关时去掉误填的 /v1 后缀。
export function mgdbGatewayBaseUrl(baseUrl: string) {
    const normalized = (baseUrl || "").trim().replace(/\/+$/, "");
    if (isMgdbServerProxied(normalized) || normalized === "") return `${normalized.replace(/\/api\/ai$/i, "")}/api/mgdb`;
    return normalized.replace(/\/v1$/i, "");
}

// 任务详情的 result.url 实测返回相对路径（/files/...），与网关文档"完整地址"的
// 说法不符；绝对地址在服务器模式下也要改走 /api/mgdb 代理避免跨域
export function mgdbVideoFileUrl(baseUrl: string, url: string) {
    const base = mgdbGatewayBaseUrl(baseUrl);
    if (!/^https?:\/\//i.test(url)) return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
    if (/^https?:\/\//i.test(base)) return url;
    try {
        return `${base}${new URL(url).pathname}`;
    } catch {
        return url;
    }
}
