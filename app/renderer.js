/* ================================================================
   renderer.js —— 预览 iframe 渲染器
   - 加载 wewrite.css 并注入到 iframe
   - 构造与 Typora 导出结构一致的 DOM（body.typora-export >
     .wmp-preview > content.typora-export-content > #write）
   - 提供 render / setWidth / setTheme / setFontScale API
   ================================================================ */

(function (global) {
  'use strict';

  const PREVIEW_CSS_URL = 'assets/wewrite.css';
  const FONT_CSS_URL = 'assets/fs-zen-min.css';
  const FONT_SCALE_BASE = 18; // --v-f-size 默认值

  let _iframe = null;
  let _cssText = null;
  let _ready = false;
  let _onReady = null;

  // 加载主题 CSS 文本（仅一次）
  // 关键：把 @import "./fs-zen-min.css" 替换为字体 CSS 的实际内容
  // 因为 CSS 被注入到 iframe srcdoc 的 <style> 标签里后，@import 的相对路径
  // 会相对于 iframe 文档的 base URL（主页面根目录）解析，而不是 assets/ 目录，
  // 导致字体 CSS 加载失败（@font-face 为 0），预览字体回退到 Times New Roman
  async function loadCss() {
    if (_cssText) return _cssText;
    // 并行 fetch 主 CSS 和字体 CSS
    const [mainResp, fontResp] = await Promise.all([
      fetch(PREVIEW_CSS_URL, { cache: 'no-store' }),
      fetch(FONT_CSS_URL, { cache: 'no-store' })
    ]);
    if (!mainResp.ok) throw new Error('加载主题 CSS 失败：' + PREVIEW_CSS_URL + ' (' + mainResp.status + ')');
    if (!fontResp.ok) throw new Error('加载字体 CSS 失败：' + FONT_CSS_URL + ' (' + fontResp.status + ')');
    let mainCss = await mainResp.text();
    const fontCss = await fontResp.text();
    // 把 @import "./fs-zen-min.css" 行替换为字体 CSS 的实际内容
    // 匹配各种可能的 @import 写法
    mainCss = mainCss.replace(
      /@import\s+["']\.\/fs-zen-min\.css["'];?\s*/g,
      '/* === 字体样式（内联，避免 srcdoc 中 @import 路径解析失败） === */\n' + fontCss + '\n'
    );
    _cssText = mainCss;
    return _cssText;
  }

  // 主题覆盖样式：修复 wewrite 主题里若干会误伤正常 Markdown 的“特效”规则。
  // 这些规则原本是为 Typora 的特定交互语法（涂层/剧透、卡片等）设计的，但本
  // 编辑器没有等价的交互，导致普通语法被错误套用。这里用高优先级选择器覆盖。
  const PATCH_CSS = '\n' +
    '/* —— 修复：***粗斜体***、*斜体里有 **加粗*** 被套上条纹背景且文字被隐藏 ——\n' +
    '   主题规则 span[md-inline=em]:has(>em>span[md-inline=strong]:only-child) 原是\n' +
    '   Typora “涂层/剧透”特效（灰底条纹 + strong 隐藏成 ••••）。但普通\n' +
    '   ***粗斜体*** 渲染出 <em><span md-inline=strong><strong></span></em> 也\n' +
    '   匹配该选择器，于是被误加条纹背景、且 strong 被 display:none 文字消失。\n' +
    '   这里无条件关闭该特效：恢复正常背景、去掉边框、显示 strong、保持斜体。 */\n' +
    '.typora-export #write span[md-inline="em"]:has(>em>span[md-inline="strong"]:only-child),\n' +
    '.typora-export #write span[md-inline="em"]:has(>em>span:first-child+span[md-inline="strong"]:last-child) {\n' +
    '  background: none !important;\n' +
    '  border: none !important;\n' +
    '  padding: 0 !important;\n' +
    '  display: inline !important;\n' +
    '  text-shadow: none !important;\n' +
    '  color: inherit !important;\n' +
    '  font: inherit !important;\n' +
    '}\n' +
    '.typora-export #write span[md-inline="em"]:has(>em>span[md-inline="strong"]:only-child) > em,\n' +
    '.typora-export #write span[md-inline="em"]:has(>em>span:first-child+span[md-inline="strong"]:last-child) > em {\n' +
    '  font-style: italic !important;\n' +
    '  line-height: inherit !important;\n' +
    '}\n' +
    '.typora-export #write span[md-inline="em"] > em > span[md-inline="strong"]:only-child > strong,\n' +
    '.typora-export #write span[md-inline="em"] > em > span:first-child+span[md-inline="strong"]:last-child > strong {\n' +
    '  display: inline !important;\n' +
    '  color: inherit !important;\n' +
    '  text-shadow: none !important;\n' +
    '  background: none !important;\n' +
    '  margin-left: 0 !important;\n' +
    '}\n' +
    '/* 去掉涂层特效在 strong 前生成的 •••• 伪元素 */\n' +
    '.typora-export #write span[md-inline="em"] > em > span[md-inline="strong"]:only-child::before,\n' +
    '.typora-export #write span[md-inline="em"] > em > span:first-child+span[md-inline="strong"]:last-child::before {\n' +
    '  content: none !important;\n' +
    '}\n' +
    '/* —— 修复：中英文混排换行出现大段空白（行尾留白，疑似两端对齐） ——\n' +
    '   预览、电脑端公众号、手机端公众号都要修复。根因：\n' +
    '   1) 行内代码 <code> 用了 font-size:14px + line-height:18px（正文 18px / 27px），\n' +
    '      display:inline-block。Chromium 中行内元素字号或行高与正文不一致时，其\n' +
    '      inline box 行高不齐，会导致该元素之后的 CJK 文本无法在它边界处换行，\n' +
    '      整段被提前断行、行尾留下大片空白。公众号里 inline-block + 不同行高同样\n' +
    '      触发该问题。修复：让 code 完全融入正文行——display:inline、继承字号与\n' +
    '      行高、vertical-align:baseline；box-decoration-break:clone 让 padding/border\n' +
    '      在换行片段上各自闭合（否则 inline 元素 border/padding 会画歪）。\n' +
    '   2) 长 URL 在 <a> 里无法在中间断行，溢出时整体被挤到下一行，同样留白。\n' +
    '      对 <a> 单独加 word-break:break-all，让 URL 在字符间断开。\n' +
    '   3) 手机端微信正文容器默认套 text-align:justify，而段落 computed 的 text-align\n' +
    '      是 start（默认值），inliner 会跳过不内联，于是 justify 生效把每行拉开\n' +
    '      造成“文字间距很大”。修复：段落强制 text-align:left。\n' +
    '   4) 手机端窄屏（~375px）下，normal + overflow-wrap:anywhere 仍会因代码/URL\n' +
    '      后剩余空间不足而提前换行留白；且旧版 WebView 不认 anywhere。改为\n' +
    '      word-break:break-all（中文排版标准，允许任意字符间断行）+ overflow-wrap:\n' +
    '      break-word（兼容回退）。代价是英文单词偶有截断，中文文章可接受。\n' +
    '   行内代码改为融入正文字号/行高后，靠等宽字体 + 背景 + 边框与正文区分，视觉仍清晰。 */\n' +
    '.typora-export #write code {\n' +
    '  display: inline !important;\n' +
    '  font-size: inherit !important;\n' +
    '  line-height: inherit !important;\n' +
    '  vertical-align: baseline !important;\n' +
    '  -webkit-box-decoration-break: clone !important;\n' +
    '  box-decoration-break: clone !important;\n' +
    '}\n' +
    '.typora-export #write p,\n' +
    '.typora-export #write li,\n' +
    '.typora-export #write blockquote {\n' +
    '  text-align: left !important;\n' +
    '  word-break: break-all !important;\n' +
    '  overflow-wrap: break-word !important;\n' +
    '}\n' +
    '.typora-export #write a {\n' +
    '  word-break: break-all !important;\n' +
    '}\n' +
    '/* —— 超链接统一为蓝色（公众号默认 <a> 可能是黑色，这里强制蓝色更醒目） ——\n' +
    '   主题变量 --a-c 已是 #298bcc，但个别上下文可能继承正文色，这里显式覆盖。 */\n' +
    '.typora-export #write a {\n' +
    '  color: #298bcc !important;\n' +
    '  text-decoration: none !important;\n' +
    '}\n';

  // 初始化 iframe：构造文档结构 + 注入 CSS
  async function init(iframe) {
    _iframe = iframe;
    const css = await loadCss();

    // 用 srcdoc 一次性构造骨架，避免外部资源加载问题
    const skeleton =
      '<!DOCTYPE html>\n' +
      '<html lang="zh-CN" data-wmp-theme="auto">\n' +
      '<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<style id="theme-css">' + escapeForStyle(css) + '</style>\n' +
      '<style id="wewrite-patch">' + escapeForStyle(PATCH_CSS) + '</style>\n' +
      '</head>\n' +
      '<body class="typora-export">\n' +
      '  <div class="wmp-preview"><content class="typora-export-content"><div id="write"></div></content></div>\n' +
      '</body>\n' +
      '</html>\n';

    // 用 load 事件确认就绪
    await new Promise((resolve) => {
      const onLoad = () => {
        iframe.removeEventListener('load', onLoad);
        _ready = true;
        resolve();
      };
      iframe.addEventListener('load', onLoad);
      iframe.srcdoc = skeleton;
    });

    if (_onReady) _onReady();
  }

  // CSS 文本嵌入 <style> 时的最小转义（</style> 序列需要拆开）
  function escapeForStyle(css) {
    return css.replace(/<\/(style|script)>/gi, function (m) {
      return m.slice(0, 2) + '\\' + m.slice(2);
    });
  }

  function getDoc() {
    if (!_iframe || !_iframe.contentDocument) throw new Error('iframe 未初始化');
    return _iframe.contentDocument;
  }

  function getWin() {
    if (!_iframe || !_iframe.contentWindow) throw new Error('iframe 未初始化');
    return _iframe.contentWindow;
  }

  function getWrite() {
    return getDoc().getElementById('write');
  }

  function getPreviewEl() {
    return getDoc().querySelector('.wmp-preview');
  }

  // 渲染 HTML 到 #write
  function render(html) {
    const write = getWrite();
    if (!write) return;
    write.innerHTML = html || '';
    // 关键：给 #write 加 .done 类，移除加载遮罩
    // 原主题 .typora-export #write:not(.done):before 会显示全屏蓝色渐变遮罩
    // ("Preparing...")，插件 JS 加载完成后才会加 .done 类。本编辑器无
    // 插件 JS，必须手动加 .done，否则遮罩永远盖住内容
    write.classList.add('done');
    // 复刻 Typora 的行内结构：把段落里的裸文本节点也包进 <span class="md-plain">。
    // 原因：wewrite 主题有规则
    //   .typora-export #write > p > [md-inline=strong]:only-child:has(> strong)
    //   { display: block; ... }
    // CSS 的 :only-child 只判断“是否有兄弟元素”，忽略文本节点。我们的 renderer
    // 把 strong/em 等包在 <span md-inline=...> 里，但前后纯文本是裸文本节点，
    // 于是“排名**第2**（…）”这种段落里唯一元素就是该 span，被误判为 only-child，
    // 触发 display:block，把加粗强制独占一行、造成意外换行。Typora 里纯文本也包在
    // <span class="md-plain"> 中，这样 span[md-inline] 就不是唯一子元素，规则不触发。
    wrapPlainTextInParagraphs(write);
    // 渲染后必须调整 iframe 高度，否则 iframe 默认高度很小、
    // 内容被裁切，用户看到一片空白
    autoHeight();
  }

  // 把 #write 下相关段落里的裸文本节点包裹进 <span class="md-plain">。
  // 只处理“包含 md-inline 行内元素”的段落（这类段落才可能误触发 :only-child）。
  function wrapPlainTextInParagraphs(write) {
    try {
      const doc = write.ownerDocument;
      // 选取可能含行内格式的段落：#write 直接子 p、blockquote 直接子 p、
      // 以及列表 section 内的 p
      const ps = write.querySelectorAll('#write > p, blockquote > p, section > p');
      ps.forEach(function (p) {
        // 仅当段落含 md-inline 行内元素时才处理
        if (!p.querySelector('span[md-inline]')) return;
        const kids = Array.prototype.slice.call(p.childNodes);
        kids.forEach(function (node) {
          if (node.nodeType === 3) { // 文本节点
            const txt = node.nodeValue;
            if (txt === '' || txt == null) return;
            const span = doc.createElement('span');
            span.className = 'md-plain';
            span.textContent = txt;
            p.replaceChild(span, node);
          }
        });
      });
    } catch (e) {
      // 出错不影响渲染
    }
  }

  // 设置预览宽度（px）
  function setWidth(px) {
    px = Math.max(280, Math.min(2000, parseInt(px, 10) || 620));
    // iframe 自身宽度
    _iframe.style.width = px + 'px';
    // 同时更新 --wmp-width（控制 #write 容器宽度）
    const prev = getPreviewEl();
    if (prev) {
      prev.style.setProperty('--wmp-width', px + 'px');
    }
    // 宽度变化后内容高度也会变，重新计算
    autoHeight();
  }

  // 设置明暗主题：'auto' | 'light' | 'dark'
  function setTheme(mode) {
    const html = getDoc().documentElement;
    if (mode === 'auto') {
      html.removeAttribute('data-wmp-theme');
    } else {
      html.setAttribute('data-wmp-theme', mode);
    }
    // 主题切换后重新测量高度
    autoHeight();
  }

  // 字号缩放：percent 为 80~130
  function setFontScale(percent) {
    percent = Math.max(50, Math.min(200, parseInt(percent, 10) || 100));
    const prev = getPreviewEl();
    if (prev) {
      // 覆盖 --v-f-size，影响 #write font-size
      prev.style.setProperty('--v-f-size', (FONT_SCALE_BASE * percent / 100) + 'px');
    }
    // 字号变化后内容高度变化，重新测量
    autoHeight();
  }

  // 等待 iframe 就绪
  function ready() {
    if (_ready) return Promise.resolve();
    return new Promise((resolve) => { _onReady = resolve; });
  }

  // 自动调整 iframe 高度以适应内容
  // iframe 不会自动撑高，必须用 JS 读取内容高度并设置到 iframe
  // 关键：直接用 documentElement.scrollHeight 会偏大——body 默认 8px margin、
  // 以及主题里某些 margin 折叠/::after 会让 html.scrollHeight 比 #write 实际内容
  // 底部多出上百像素，导致预览末尾出现一大片空白。改为测量 #write 的实际底边
  // （content.typora-export-content 内的 #write），加 #write 的 padding 与少量留白，
  // 既不裁切内容也不留多余空白。
  function autoHeight() {
    try {
      const doc = getDoc();
      if (!doc || !doc.body) return;
      const write = doc.getElementById('write');
      let h;
      if (write) {
        // #write 相对于 iframe 文档的底边位置（含其自身 padding）
        const rect = write.getBoundingClientRect();
        // rect.top 可能为正（body 8px margin 等），底部 = rect.top + rect.height
        h = Math.max(rect.top + rect.height, 0);
      } else {
        // 回退：取 body / html scrollHeight 较小者，避免偏大的 html 值引入空白
        const bodyH = doc.body.scrollHeight;
        const htmlH = doc.documentElement ? doc.documentElement.scrollHeight : 0;
        h = Math.min(bodyH || htmlH || 0, htmlH || bodyH || 0);
      }
      // 预留少量底部留白（呼吸空间），但不再叠加 html 的偏大量
      h = Math.max(h + 24, 200);
      _iframe.style.height = h + 'px';
      if (h < 400) _iframe.style.minHeight = '400px';
      else _iframe.style.minHeight = '';
    } catch (e) {
      // iframe 可能未就绪，忽略
    }
  }

  // 返回 #write 顶层块的元素引用列表（跳过空 <p>），供同步滚动在滚动时实时
  // 测量位置。注意：iframe 内元素的 getBoundingClientRect().top 在父页面滚动
  // previewWrap 时不会改变（相对 iframe 视口，而非父页面视口），因此不能用它
  // 换算到 previewWrap 的滚动坐标系。这里额外返回每个块相对 #write 的 offsetTop
  //（稳定、不受滚动影响），以及 #write 相对 iframe 文档的 offsetTop，由 main.js
  // 配合 iframe.getBoundingClientRect() 实时换算为 previewWrap 内容坐标。
  function getBlocks() {
    try {
      const write = getWrite();
      if (!write) return [];
      // #write 相对 iframe 文档的累计 offsetTop（含 .wmp-preview/content 的 padding）
      let writeDocTop = 0;
      let node = write, body = write.ownerDocument.body;
      while (node && node !== body) {
        writeDocTop += node.offsetTop || 0;
        node = node.offsetParent;
        if (!node || node === body) break;
      }
      const out = [];
      const kids = write.children;
      for (let i = 0; i < kids.length; i++) {
        const el = kids[i];
        if (el.tagName === 'P' && !el.textContent.trim()) continue;
        out.push({
          el: el,
          offsetTop: el.offsetTop,          // 相对 #write（稳定）
          writeDocTop: writeDocTop,          // #write 相对 iframe 文档（稳定）
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)
        });
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  global.WmpRenderer = {
    init: init,
    render: render,
    setWidth: setWidth,
    setTheme: setTheme,
    setFontScale: setFontScale,
    autoHeight: autoHeight,
    ready: ready,
    getDoc: getDoc,
    getWin: getWin,
    getWrite: getWrite,
    getBlocks: getBlocks,
    getIframe: () => _iframe
  };

})(window);
