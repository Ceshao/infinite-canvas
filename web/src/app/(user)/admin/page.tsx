"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, Modal, Popconfirm, Table, Typography } from "antd";
import copy from "copy-to-clipboard";
import { Plus, RefreshCw } from "lucide-react";

type AccessCodeEntry = { code: string; note: string; createdAt: string; requests: number; lastUsedAt: string };
type PanelState = "loading" | "disabled" | "login" | "ready";

const PASSWORD_KEY = "infinite-canvas:admin_password";

export default function AdminPage() {
    const { message } = App.useApp();
    const [state, setState] = useState<PanelState>("loading");
    const [password, setPassword] = useState("");
    const [passwordInput, setPasswordInput] = useState("");
    const [codes, setCodes] = useState<AccessCodeEntry[]>([]);
    const [noteInput, setNoteInput] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    const fetchCodes = useCallback(async (candidate: string) => {
        const response = await fetch("/api/ai-admin", { headers: candidate ? { "x-admin-password": candidate } : {}, cache: "no-store" });
        if (response.status === 404) {
            setState("disabled");
            return false;
        }
        if (response.status === 401) {
            sessionStorage.removeItem(PASSWORD_KEY);
            setState("login");
            return false;
        }
        const payload = (await response.json()) as { codes?: AccessCodeEntry[] };
        setCodes(payload.codes || []);
        setPassword(candidate);
        sessionStorage.setItem(PASSWORD_KEY, candidate);
        setState("ready");
        return true;
    }, []);

    useEffect(() => {
        void fetchCodes(sessionStorage.getItem(PASSWORD_KEY) || "");
    }, [fetchCodes]);

    const login = async () => {
        if (!passwordInput.trim() || busy) return;
        setBusy(true);
        const ok = await fetchCodes(passwordInput.trim());
        setBusy(false);
        if (ok) setPasswordInput("");
        else message.error("管理口令错误");
    };

    const createCode = async () => {
        if (busy) return;
        setBusy(true);
        const response = await fetch("/api/ai-admin", {
            method: "POST",
            headers: { "x-admin-password": password, "Content-Type": "application/json" },
            body: JSON.stringify({ note: noteInput.trim() }),
        });
        setBusy(false);
        if (!response.ok) {
            message.error("生成失败");
            return;
        }
        const payload = (await response.json()) as { code: AccessCodeEntry };
        setCreateOpen(false);
        setNoteInput("");
        await fetchCodes(password);
        Modal.success({
            title: "新访问码已生成",
            content: (
                <Typography.Paragraph copyable={{ text: payload.code.code }} className="!mb-0 pt-2 font-mono text-base">
                    {payload.code.code}
                </Typography.Paragraph>
            ),
        });
    };

    const revoke = async (code: string) => {
        const response = await fetch("/api/ai-admin", {
            method: "DELETE",
            headers: { "x-admin-password": password, "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
        });
        if (response.ok) {
            message.success("已作废");
            await fetchCodes(password);
        } else message.error("作废失败");
    };

    if (state === "loading") return <main className="flex h-full items-center justify-center text-sm text-stone-500">正在加载...</main>;
    if (state === "disabled") return <main className="flex h-full items-center justify-center text-sm text-stone-500">管理后台未启用</main>;
    if (state === "login")
        return (
            <main className="flex h-full items-center justify-center">
                <div className="w-80 space-y-3 rounded-lg border border-stone-200 p-6 dark:border-stone-800">
                    <h1 className="text-lg font-medium">访问码管理</h1>
                    <Input.Password value={passwordInput} onChange={(event) => setPasswordInput(event.target.value)} placeholder="请输入管理口令" onPressEnter={login} autoFocus />
                    <Button type="primary" block loading={busy} onClick={login}>
                        进入后台
                    </Button>
                </div>
            </main>
        );

    return (
        <main className="h-full overflow-auto bg-background">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-10">
                <header className="flex items-end justify-between border-b border-stone-200 pb-5 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">站长后台</p>
                        <h1 className="mt-2 text-2xl font-semibold">访问码管理</h1>
                    </div>
                    <div className="flex gap-2">
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => void fetchCodes(password)}>
                            刷新
                        </Button>
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
                            生成新访问码
                        </Button>
                    </div>
                </header>

                <Table<AccessCodeEntry>
                    rowKey="code"
                    dataSource={codes}
                    pagination={false}
                    columns={[
                        {
                            title: "访问码",
                            dataIndex: "code",
                            render: (code: string) => (
                                <button
                                    type="button"
                                    className="cursor-pointer font-mono hover:underline"
                                    onClick={() => {
                                        copy(code);
                                        message.success("已复制");
                                    }}
                                    title="点击复制"
                                >
                                    {code}
                                </button>
                            ),
                        },
                        { title: "备注", dataIndex: "note", render: (note: string) => note || "—" },
                        { title: "创建时间", dataIndex: "createdAt", render: (value: string) => (value ? new Date(value).toLocaleString() : "—") },
                        { title: "请求数", dataIndex: "requests" },
                        { title: "最后使用", dataIndex: "lastUsedAt", render: (value: string) => (value ? new Date(value).toLocaleString() : "从未使用") },
                        {
                            title: "操作",
                            render: (_: unknown, record: AccessCodeEntry) => (
                                <Popconfirm title={`作废 ${record.code}？`} description="使用该码的访客将立即失去访问权限" okText="作废" cancelText="取消" onConfirm={() => void revoke(record.code)}>
                                    <Button danger size="small">
                                        作废
                                    </Button>
                                </Popconfirm>
                            ),
                        },
                    ]}
                />
            </div>

            <Modal title="生成新访问码" open={createOpen} onOk={createCode} onCancel={() => setCreateOpen(false)} confirmLoading={busy} okText="生成" cancelText="取消">
                <Input value={noteInput} onChange={(event) => setNoteInput(event.target.value)} placeholder="备注（给谁用的，可留空）" onPressEnter={createCode} className="my-2" autoFocus />
            </Modal>
        </main>
    );
}
