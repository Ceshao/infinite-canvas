import { describe, expect, test } from "bun:test";

const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
};

const { SERVER_CHANNEL_ID, buildServerConfigUpdates } = await import("@/stores/use-server-mode-store");
const { defaultConfig } = await import("@/stores/use-config-store");

const models = ["gpt-image-2", "seedance-pro", "gpt-5.5", "gpt-4o-mini-tts"];

describe("buildServerConfigUpdates", () => {
    test("生成唯一的服务器渠道，访问码作为 apiKey", () => {
        const updates = buildServerConfigUpdates(defaultConfig, "test-code", models);
        expect(updates.channels).toEqual([{ id: SERVER_CHANNEL_ID, name: "服务器渠道", baseUrl: "/api/ai", apiKey: "test-code", apiFormat: "openai", models }]);
        expect(updates.baseUrl).toBe("/api/ai");
        expect(updates.apiKey).toBe("test-code");
    });

    test("模型按能力分类并编码渠道前缀", () => {
        const updates = buildServerConfigUpdates(defaultConfig, "test-code", models);
        expect(updates.models).toEqual(["server::gpt-image-2", "server::seedance-pro", "server::gpt-5.5", "server::gpt-4o-mini-tts"]);
        expect(updates.imageModels).toEqual(["server::gpt-image-2"]);
        expect(updates.videoModels).toEqual(["server::seedance-pro"]);
        expect(updates.textModels).toEqual(["server::gpt-5.5"]);
        expect(updates.audioModels).toEqual(["server::gpt-4o-mini-tts"]);
    });

    test("当前选中模型不在清单内时回退到各能力第一项", () => {
        const updates = buildServerConfigUpdates(defaultConfig, "test-code", models);
        expect(updates.imageModel).toBe("server::gpt-image-2");
        expect(updates.videoModel).toBe("server::seedance-pro");
        expect(updates.textModel).toBe("server::gpt-5.5");
        expect(updates.audioModel).toBe("server::gpt-4o-mini-tts");
    });

    test("当前选中模型仍在清单内时保持不变", () => {
        const config = { ...defaultConfig, imageModel: "server::gpt-image-2" };
        const updates = buildServerConfigUpdates(config, "test-code", models);
        expect(updates.imageModel).toBe("server::gpt-image-2");
    });

    test("空模型清单时选中项为空字符串", () => {
        const updates = buildServerConfigUpdates(defaultConfig, "test-code", []);
        expect(updates.imageModel).toBe("");
        expect(updates.models).toEqual([]);
    });

    test("服务端下发的异步图像模型清单原样进入配置", () => {
        const updates = buildServerConfigUpdates(defaultConfig, "test-code", models, ["nano-pro", "gpt-img2"]);
        expect(updates.asyncImageModels).toEqual(["nano-pro", "gpt-img2"]);
    });

    test("未下发异步图像模型时为空数组（保持原同步行为）", () => {
        const updates = buildServerConfigUpdates(defaultConfig, "test-code", models);
        expect(updates.asyncImageModels).toEqual([]);
    });
});
