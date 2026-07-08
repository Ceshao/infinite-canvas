// 品牌集中配置：全站所有品牌触点（应用名、Logo、文案、外链）统一引用这里。
// 换皮 / 调整品牌只改本文件 + public 下的静态资源，同步上游时冲突面最小。
// ⚠️ 不要把 localStorage / IndexedDB 的键名（infinite-canvas:* 前缀）当品牌字符串改动，
//    那些是数据格式标识，改了会清空老用户的配置、画布与访问码记忆。

export const BRAND = {
    /** 完整品牌名：浏览器标题、顶部导航文字 */
    name: "华视锐达 · 无限画布",
    /** 产品名：首页 Hero 大标题 */
    product: "无限画布",
    /** 出品公司（中 / 英） */
    company: "华视锐达科技",
    companyEn: "Huashi Ruida Technology",
    /** 元数据描述 */
    description: "华视锐达科技出品 · 无限画布 AI 创作工具",
    /** 首页副标题 */
    tagline: "在无限画布中生成、连接和重组图片、文字与图形，让创作从单次生成变成连续推演。",
    /** 品牌标识（彩色，放导航；favicon 见 app/icon.png） */
    mark: "/brand-mark.png",
    /** 品牌主色（华视锐达紫） */
    color: "#7848F8",
    /** 外链：留空即在界面上隐藏对应入口 */
    githubUrl: "",
    docsUrl: "",
} as const;
