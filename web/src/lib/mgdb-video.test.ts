import { describe, expect, test } from "bun:test";

import { isMgdbServerProxied, isMgdbVideoModel, mgdbGatewayBaseUrl, mgdbPixelLabel, mgdbVideoFileUrl, normalizeMgdbDuration, normalizeMgdbRatio } from "@/lib/mgdb-video";
import { isSeedanceVideoModel } from "@/lib/seedance-video";

describe("isMgdbVideoModel", () => {
    test("识别 mgdb 模型（含渠道编码前缀）", () => {
        expect(isMgdbVideoModel("mgdb-seedance-2.0")).toBe(true);
        expect(isMgdbVideoModel("server::mgdb-seedance-2.0")).toBe(true);
        expect(isMgdbVideoModel("MGDB-SD-2.0-FAST")).toBe(true);
    });

    test("普通 Seedance 模型不是 mgdb", () => {
        expect(isMgdbVideoModel("doubao-seedance-1-0-pro")).toBe(false);
        expect(isMgdbVideoModel("sora-2")).toBe(false);
    });
});

describe("isSeedanceVideoModel 与 mgdb 互斥", () => {
    test("mgdb 模型不再走 Seedance（Ark）协议", () => {
        expect(isSeedanceVideoModel("mgdb-seedance-2.0")).toBe(false);
        expect(isSeedanceVideoModel("doubao-seedance-1-0-pro")).toBe(true);
    });
});

describe("normalizeMgdbRatio", () => {
    test("直接支持的比例原样返回", () => {
        expect(normalizeMgdbRatio("9:16")).toBe("9:16");
        expect(normalizeMgdbRatio("21:9")).toBe("21:9");
    });

    test("adaptive/auto/空值回退 16:9", () => {
        expect(normalizeMgdbRatio("adaptive")).toBe("16:9");
        expect(normalizeMgdbRatio("auto")).toBe("16:9");
        expect(normalizeMgdbRatio("")).toBe("16:9");
    });

    test("像素尺寸归一到最接近的比例", () => {
        expect(normalizeMgdbRatio("1280x720")).toBe("16:9");
        expect(normalizeMgdbRatio("720x1280")).toBe("9:16");
    });
});

describe("normalizeMgdbDuration", () => {
    test("归一到网关支持的 5/10/15", () => {
        expect(normalizeMgdbDuration("5")).toBe(5);
        expect(normalizeMgdbDuration("10")).toBe(10);
        expect(normalizeMgdbDuration("15")).toBe(15);
    });

    test("其他值取最接近档位，智能(-1)与空值回退 5", () => {
        expect(normalizeMgdbDuration("-1")).toBe(5);
        expect(normalizeMgdbDuration("")).toBe(5);
        expect(normalizeMgdbDuration("6")).toBe(5);
        expect(normalizeMgdbDuration("8")).toBe(10);
        expect(normalizeMgdbDuration("12")).toBe(10);
        expect(normalizeMgdbDuration("20")).toBe(15);
    });
});

describe("mgdbPixelLabel", () => {
    test("按网关文档输出分辨率", () => {
        expect(mgdbPixelLabel("16:9")).toBe("1280x720");
        expect(mgdbPixelLabel("1:1")).toBe("960x960");
        expect(mgdbPixelLabel("adaptive")).toBe("1280x720");
    });
});

describe("isMgdbServerProxied", () => {
    test("服务端代理模式（baseUrl 为 /api/ai）走 new-api 异步转发", () => {
        expect(isMgdbServerProxied("/api/ai")).toBe(true);
        expect(isMgdbServerProxied("/api/ai/")).toBe(true);
        expect(isMgdbServerProxied("https://cancanvas.shaolabs.xyz/api/ai")).toBe(true);
    });

    test("直连网关地址保持私有协议路径", () => {
        expect(isMgdbServerProxied("https://gw.amlig.com")).toBe(false);
        expect(isMgdbServerProxied("https://gw.amlig.com/v1")).toBe(false);
        expect(isMgdbServerProxied("")).toBe(false);
    });
});

describe("mgdbGatewayBaseUrl", () => {
    test("服务器渠道 /api/ai 改走 /api/mgdb 专用代理", () => {
        expect(mgdbGatewayBaseUrl("/api/ai")).toBe("/api/mgdb");
        expect(mgdbGatewayBaseUrl("/api/ai/")).toBe("/api/mgdb");
        expect(mgdbGatewayBaseUrl("https://cancanvas.shaolabs.xyz/api/ai")).toBe("https://cancanvas.shaolabs.xyz/api/mgdb");
    });

    test("直连网关地址原样保留并去掉误填的 /v1", () => {
        expect(mgdbGatewayBaseUrl("https://gw.amlig.com")).toBe("https://gw.amlig.com");
        expect(mgdbGatewayBaseUrl("https://gw.amlig.com/")).toBe("https://gw.amlig.com");
        expect(mgdbGatewayBaseUrl("https://gw.amlig.com/v1")).toBe("https://gw.amlig.com");
    });
});

describe("mgdbVideoFileUrl", () => {
    test("网关实测返回的相对路径：服务器模式拼到 /api/mgdb 代理", () => {
        expect(mgdbVideoFileUrl("/api/ai", "/files/gw_07b1422127434b4b/final.mp4")).toBe("/api/mgdb/files/gw_07b1422127434b4b/final.mp4");
        expect(mgdbVideoFileUrl("/api/ai", "files/gw_x/final.mp4")).toBe("/api/mgdb/files/gw_x/final.mp4");
    });

    test("相对路径 + 直连网关：拼成网关绝对地址", () => {
        expect(mgdbVideoFileUrl("https://gw.amlig.com", "/files/gw_x/final.mp4")).toBe("https://gw.amlig.com/files/gw_x/final.mp4");
    });

    test("绝对地址：服务器模式改走代理，直连模式原样返回", () => {
        expect(mgdbVideoFileUrl("/api/ai", "https://gw.amlig.com/files/gw_x/final.mp4")).toBe("/api/mgdb/files/gw_x/final.mp4");
        expect(mgdbVideoFileUrl("https://gw.amlig.com", "https://gw.amlig.com/files/gw_x/final.mp4")).toBe("https://gw.amlig.com/files/gw_x/final.mp4");
    });
});
