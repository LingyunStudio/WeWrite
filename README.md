# WeWrite 微信公众号编辑器

将 **wewrite** Typora 主题的视觉效果，无损移植到微信公众号文章的编辑工具。

左侧写 Markdown，右侧实时预览（与 Typora 主题完全一致），点击「复制到公众号」即可把**所有样式内联化**的 HTML 复制到剪贴板，粘贴到微信公众号编辑器后样式不会丢失。

## 功能特性

- ✅ 完整复用 `wewrite.css` 主题（不修改原主题文件，使用副本 + 覆盖层）
- ✅ 实时预览：左侧 Markdown，右侧 iframe，与 Typora 显示效果一致
- ✅ 公众号宽度适配：预览可在 350/620/750/860/自定义 之间切换
  - 自动把主题里固定宽度的元素（表格、代码块、多栏列表）改为自适应宽度，避免溢出
- ✅ 明暗主题切换：跟随系统 / 强制亮色 / 强制暗色
- ✅ 字号缩放：80%–130%
- ✅ 一键复制：基于 `getComputedStyle` 把所有样式（含 CSS 变量、`:has()`、`@media`）解析为具体值并内联到 `style` 属性
- ✅ 复制时自动：
  - 移除 `class` / `id` / `data-*` / Typora 专用属性
  - 过滤装饰元素（工具栏、章节导航、状态栏等需要 JS 才能工作的部分）
  - 把 `::before` / `::after` 伪元素中有实际内容的转为真实 `<span>`（公众号不支持伪元素）
  - 用 `<span>` / `<div>` 替换公众号不兼容的标签
- ✅ 下载 HTML：导出内联样式后的单文件 HTML
- ✅ 导入 `.md` 文件、加载示例、字数统计、同步滚动、可拖动分栏
- ✅ 零依赖后端（Node 原生 http），前端仅 CDN 引入 marked / highlight.js / DOMPurify

## 快速开始

### 环境要求

- Node.js ≥ 14（用于启动静态服务器）
- 现代浏览器（Chrome / Edge / Firefox / Safari，推荐 Chromium 内核）

### 启动

```powershell
cd wewrite-editor
node server.js
# 默认端口 3000，如需换端口：node server.js 3001
```

启动后会自动打开浏览器访问 `http://127.0.0.1:3000/`。

> ⚠️ 请务必通过 `http://127.0.0.1` 访问，**不要**用 `file://` 协议直接打开 `index.html`：
> - iframe 加载主题 CSS 需要 `fetch`，`file://` 下会被浏览器 CORS 拦截
> - `ClipboardItem` API 只在 secure context（https / localhost / 127.0.0.1）下可用

### 使用流程

1. 在左侧编辑器输入或粘贴 Markdown（也可点击「示例」或「导入」加载 `.md` 文件）
2. 右侧实时预览，调整「预览宽度」「主题」「字号」直到满意
3. 点击右上角「**复制到公众号**」按钮（或 `Ctrl/Cmd + Enter`）
4. 打开微信公众号后台 → 新建图文 → 在正文编辑区按 `Ctrl + V` 粘贴
5. 样式应与预览基本一致

## 目录结构

```
wewrite-editor/
├── index.html              # 编辑器主页面
├── server.js               # 零依赖静态服务器（Node http）
├── app/
│   ├── editor.css          # 编辑器 UI 样式（不影响 iframe 预览主题）
│   ├── markdown.js         # Markdown 解析（marked + highlight.js 配置）
│   ├── renderer.js         # iframe 预览渲染器
│   ├── inliner.js          # 样式内联化核心（getComputedStyle 方案）
│   ├── clipboard.js        # 复制到剪贴板（ClipboardItem + execCommand 回退）
│   └── main.js             # 主入口、事件绑定
├── assets/
│   ├── wewrite.css         # 主题 CSS 副本（@import 路径已调整 + 末尾追加公众号适配覆盖）
│   └── fs-zen-min.css      # 字体 CSS 副本（本地预览用，复制到公众号时不会带字体）
├── samples/
│   └── demo.md             # 示例 Markdown（覆盖主题所有主要元素）
└── README.md
```

## 设计要点

### 1. 不修改原主题

`assets/wewrite.css` 是原始主题 CSS 的**副本**，仅做两处调整：

- 开头 `@import "path/to/fs-zen-min.css"` → `@import "./fs-zen-min.css"`（路径适配）
- 文件末尾追加一段 `.wmp-preview` 作用域的「公众号适配覆盖样式」：
  - 隐藏装饰元素
  - 把固定宽度的表格/代码块/多栏列表改为自适应
  - 把 `@media (prefers-color-scheme: dark)` 的暗色变量复制为 `[data-wmp-theme="dark"]` 作用域，便于手动切换
  - 把暗色变量的 `-dk` 后缀替换为 `-lg`，生成 `[data-wmp-theme="light"]` 强制亮色覆盖

原主题 CSS 文件和相关目录完全不动。

### 2. 预览与 Typora 一致

iframe 内构造了与 Typora 导出完全相同的 DOM 结构：

```html
<body class="typora-export">
  <div class="wmp-preview">
    <content class="typora-export-content">
      <div id="write"> ... </div>
    </content>
  </div>
</body>
```

这样主题里所有 `.typora-export #write`、`content>#write`、`#write ...` 选择器都能直接匹配，无需改写。

### 3. 样式内联化（复制不丢失的关键）

微信公众号编辑器粘贴 HTML 时的行为：

- ✅ **保留**：元素的 `style="..."` 内联样式、基础 HTML 标签
- ❌ **剥离**：`<style>` 标签、`class`、`id`、CSS 变量 `var(--xxx)`、`@import`、外部资源、媒体查询、伪元素

因此本工具的核心是：复制前把所有样式"扁平化"到 `style` 属性上。采用 `getComputedStyle` 方案（而非 juice 等库），原因：

- 浏览器原生解析所有现代 CSS（`:has()`、`:is()`、CSS 变量、`@media`、`@supports`），无需自己实现
- `getComputedStyle` 返回的值已经是 CSS 变量解析后的具体值（如 `rgb(28,30,31)` 而非 `var(--df)`）
- 白名单属性 + 跳过默认值，控制输出体积

### 4. 公众号宽度适配

Typora 默认编辑区宽度 860px（≥1270px 屏幕），但公众号正文宽度仅约 620px（PC 编辑器）/ 350px（手机）。直接照搬主题会出现：

- 表格 `max-width: 80%` 在 620px 下过窄
- 代码块 `width: 94%` 在 350px 下溢出
- 多栏列表（`hr + ul`）的 49% / 32% / 23.5% 列宽在窄屏严重错位

覆盖样式统一改为 `max-width: 100%` + `overflow-x: auto` 兜底，多栏列表强制单栏。

## 已知限制

1. **字体无法带走**：`fs-zen-min.css` 里的字体是 base64 嵌入的本地字体（约 280KB），公众号不支持 `@font-face`。复制后字体会回退到 `Times New Roman` + `宋体`（主题 zen 方案的 fallback 链）。本地预览时字体正常显示。
2. **图片需手动上传**：如果 Markdown 里图片是本地路径或 `data:` URL，复制到公众号后会失效，需要在公众号编辑器里手动重新上传。如果图片是 `http(s)://` 网络图片，微信会自动转存到微信图床。
3. **`::marker` 彩色符号丢失**：主题里无序列表每 7 项循环 7 种颜色的 `::marker`，公众号不支持 `::marker` 自定义颜色，会回退为默认黑色符号。列表结构本身保留。
4. **代码块语法高亮**：复制后保留（`hljs-*` 的 `<span>` 已内联颜色），但代码块外层圆角/背景的内边距可能在个别情况下需要微调。
5. **复杂交互功能不支持**：如文档库跳转、章节导航、图片放大、表格冻结列等需要 JS 的交互功能，本编辑器仅做静态样式还原。
6. **`<details>` 折叠 / Mermaid 图表**：本编辑器不渲染，原 Markdown 会作为普通段落或代码块显示。

## 离线使用（可选）

如果需要在没有外网的环境下使用，把以下三个库下载到本地 `vendor/` 目录，并修改 `index.html` 中的 `<script src>` 路径：

```text
vendor/
├── marked.min.js       ← https://cdn.jsdelivr.net/npm/marked@12/marked.min.js
├── highlight.min.js    ← https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11/highlight.min.js
└── purify.min.js       ← https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js
```

## 排错

- **复制按钮没反应 / 提示失败**：确认访问地址是 `http://127.0.0.1:3000` 而非 `file://`。Chrome 对 `file://` 下的剪贴板 API 限制严格。
- **预览空白**：打开浏览器开发者工具 Console 查看错误。常见原因是 CSS 加载失败（路径错误或服务器未启动）。
- **粘贴到公众号样式丢失**：先尝试「下载 HTML」打开查看是否正常；如果正常但公众号丢失，多半是触发了公众号的白名单（如 `position: fixed`、`<script>` 等），可在 `inliner.js` 的 `DROP_TAGS` / `INLINE_PROPS` 中调整过滤策略。
- **端口被占用**：`node server.js 3001` 换一个端口。
