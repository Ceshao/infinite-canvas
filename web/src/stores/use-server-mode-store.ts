"use client";

import { create } from "zustand";

import { encodeChannelModel, modelMatchesCapability, useConfigStore, type AiConfig, type ModelChannel } from "@/stores/use-config-store";

export const SERVER_CHANNEL_ID = "server";

export type ServerModeStatus = "unknown" | "off" | "on";

type ServerConfigResponse = { serverMode?: boolean; valid?: boolean; models?: string[]; asyncImageModels?: string[]; modelsError?: string; error?: { message?: string } };

type ServerModeStore = {
    status: ServerModeStatus;
    initServerMode: () => Promise<void>;
    verifyAccessCode: (code: string) => Promise<{ ok: boolean; message?: string }>;
};

export const useServerModeStore = create<ServerModeStore>()((set, get) => ({
    status: "unknown",
    initServerMode: async () => {
        try {
            const response = await fetch("/api/ai-config", { cache: "no-store" });
            const payload = (await response.json()) as ServerConfigResponse;
            if (!payload.serverMode) {
                set({ status: "off" });
                return;
            }
            set({ status: "on" });
            const code = storedAccessCode();
            if (!code) {
                useConfigStore.getState().openConfigDialog(false);
                return;
            }
            const result = await get().verifyAccessCode(code);
            if (!result.ok) useConfigStore.getState().openConfigDialog(false);
        } catch {
            set({ status: "off" });
        }
    },
    verifyAccessCode: async (code) => {
        const trimmed = code.trim();
        if (!trimmed) return { ok: false, message: "请输入访问码" };
        try {
            const response = await fetch("/api/ai-config", { headers: { authorization: `Bearer ${trimmed}` }, cache: "no-store" });
            const payload = (await response.json()) as ServerConfigResponse;
            if (!response.ok || !payload.valid) return { ok: false, message: payload.error?.message || "访问码无效或已停用" };
            applyServerConfig(trimmed, payload.models || [], payload.asyncImageModels || []);
            return { ok: true, message: payload.modelsError };
        } catch {
            return { ok: false, message: "网络错误，请稍后重试" };
        }
    },
}));

function storedAccessCode() {
    const channel = useConfigStore.getState().config.channels.find((item) => item.id === SERVER_CHANNEL_ID);
    return channel?.apiKey?.trim() || "";
}

export function applyServerConfig(code: string, models: string[], asyncImageModels: string[] = []) {
    const { config, updateConfig } = useConfigStore.getState();
    const updates = buildServerConfigUpdates(config, code, models, asyncImageModels);
    for (const [key, value] of Object.entries(updates)) updateConfig(key as keyof AiConfig, value as never);
}

export function buildServerConfigUpdates(config: AiConfig, code: string, models: string[], asyncImageModels: string[] = []): Partial<AiConfig> {
    const channel: ModelChannel = { id: SERVER_CHANNEL_ID, name: "服务器渠道", baseUrl: "/api/ai", apiKey: code, apiFormat: "openai", models };
    const encoded = models.map((model) => encodeChannelModel(SERVER_CHANNEL_ID, model));
    // 异步图像模型（nano-2 等）名字里没有 image/flux 等关键词，能力分类器会误判为文本；
    // 服务端既然声明它们是图像模型，这里强制归入图像类并从其他类排除。
    const encodedAsyncImage = new Set(asyncImageModels.map((model) => encodeChannelModel(SERVER_CHANNEL_ID, model)));
    const isAsyncImage = (model: string) => encodedAsyncImage.has(model);
    const imageModels = encoded.filter((model) => isAsyncImage(model) || modelMatchesCapability(model, "image"));
    const videoModels = encoded.filter((model) => !isAsyncImage(model) && modelMatchesCapability(model, "video"));
    const textModels = encoded.filter((model) => !isAsyncImage(model) && modelMatchesCapability(model, "text"));
    const audioModels = encoded.filter((model) => !isAsyncImage(model) && modelMatchesCapability(model, "audio"));
    const pick = (current: string, list: string[]) => (list.includes(current) ? current : list[0] || "");
    return {
        channels: [channel],
        models: encoded,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel: pick(config.imageModel, imageModels),
        videoModel: pick(config.videoModel, videoModels),
        textModel: pick(config.textModel, textModels),
        audioModel: pick(config.audioModel, audioModels),
        model: pick(config.model, imageModels.length ? imageModels : encoded),
        baseUrl: "/api/ai",
        apiKey: code,
        asyncImageModels,
    };
}
