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
    // 渲染后必须调整 iframe 高度，否则 iframe 默认高度很小、
    // 内容被裁切，用户看到一片空白
    autoHeight();
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
  // iframe 不会自动撑高，必须用 JS 读取内容文档的 scrollHeight 并设置到 iframe
  function autoHeight() {
    try {
      const doc = getDoc();
      const win = getWin();
      if (!doc || !doc.body) return;
      // 用 getBoundingClientRect 更精确，回退到 scrollHeight
      const htmlEl = doc.documentElement;
      const bodyH = doc.body.scrollHeight;
      const htmlH = htmlEl ? htmlEl.scrollHeight : 0;
      // 取较大值，并预留底部留白
      const h = Math.max(bodyH, htmlH, 200) + 24;
      _iframe.style.height = h + 'px';
      // 同时设置 minHeight 兜底（防止 0 高度）
      if (h < 400) _iframe.style.minHeight = '400px';
      else _iframe.style.minHeight = '';
    } catch (e) {
      // iframe 可能未就绪，忽略
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
    getIframe: () => _iframe
  };

})(window);
