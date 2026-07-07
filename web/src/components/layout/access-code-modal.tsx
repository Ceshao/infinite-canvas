"use client";

import { useState } from "react";
import { App, Input, Modal } from "antd";

import { useConfigStore } from "@/stores/use-config-store";
import { useServerModeStore } from "@/stores/use-server-mode-store";

export function AccessCodeModal() {
    const { message } = App.useApp();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const verifyAccessCode = useServerModeStore((state) => state.verifyAccessCode);
    const [code, setCode] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const submit = async () => {
        if (submitting) return;
        setSubmitting(true);
        const result = await verifyAccessCode(code);
        setSubmitting(false);
        if (!result.ok) {
            message.error(result.message || "访问码无效");
            return;
        }
        if (result.message) message.warning(result.message);
        message.success("访问码验证成功");
        setCode("");
        setConfigDialogOpen(false);
    };

    return (
        <Modal title="输入访问码" open={isConfigOpen} onOk={submit} onCancel={() => setConfigDialogOpen(false)} confirmLoading={submitting} okText="确认" cancelText="取消" maskClosable={false}>
            <div className="space-y-2 py-2">
                <Input.Password value={code} onChange={(event) => setCode(event.target.value)} placeholder="请输入站长提供的访问码" onPressEnter={submit} autoFocus />
                <p className="text-xs text-stone-500">输入一次后本浏览器将自动记住，无需重复配置。</p>
            </div>
        </Modal>
    );
}
