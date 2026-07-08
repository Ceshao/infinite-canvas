import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

// 品牌强调色（华视锐达紫）：用于主按钮、链接、信息态等强调点。
// 中性灰仍保留给菜单 / 选择 / 表格的选中背景，维持整体简洁。
const accent = {
    light: { primary: "#7848F8", hover: "#6636E0", text: "#ffffff" },
    dark: { primary: "#8B66FF", hover: "#9C7DFF", text: "#ffffff" },
};

const neutral = {
    light: {
        menuBg: "#f5f5f5",
        menuText: "#171717",
        selectActiveBg: "#f5f5f5",
        selectSelectedBg: "#f0f0f0",
        selectText: "#171717",
        tableSelectedBg: "rgba(17, 17, 17, 0.05)",
        tableSelectedHoverBg: "rgba(17, 17, 17, 0.08)",
    },
    dark: {
        menuBg: "#262626",
        menuText: "#fafafa",
        selectActiveBg: "#262626",
        selectSelectedBg: "#333333",
        selectText: "#fafafa",
        tableSelectedBg: "rgba(255, 255, 255, 0.08)",
        tableSelectedHoverBg: "rgba(255, 255, 255, 0.12)",
    },
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? neutral.dark : neutral.light;
    const brand = dark ? accent.dark : accent.light;

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: dark ? "infinite-canvas-dark" : "infinite-canvas-light" },
        token: {
            colorPrimary: brand.primary,
            colorInfo: brand.primary,
            colorLink: brand.primary,
            colorLinkHover: brand.hover,
            colorLinkActive: brand.hover,
            colorTextLightSolid: brand.text,
        },
        components: {
            Button: {
                primaryShadow: "none",
            },
            Menu: {
                itemActiveBg: color.menuBg,
                itemHoverBg: color.menuBg,
                itemSelectedBg: color.menuBg,
                itemSelectedColor: color.menuText,
                darkItemHoverBg: neutral.dark.menuBg,
                darkItemSelectedBg: neutral.dark.menuBg,
                darkItemSelectedColor: neutral.dark.menuText,
            },
            Select: {
                optionActiveBg: color.selectActiveBg,
                optionSelectedBg: color.selectSelectedBg,
                optionSelectedColor: color.selectText,
            },
            Table: {
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
        },
    };
}
