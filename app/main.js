/* ================================================================
   main.js —— 编辑器主入口
   协调 markdown / renderer / inliner / clipboard 各模块，
   绑定 UI 事件，处理用户交互。
   ================================================================ */

(function () {
  'use strict';

  // ====== DOM 引用 ======
  const $ = (id) => document.getElementById(id);
  const els = {
    markdownInput: $('markdownInput'),
    widthSelect:   $('widthSelect'),
    widthCustom:   $('widthCustom'),
    themeSelect:   $('themeSelect'),
    fontScale:     $('fontScale'),
    fontScaleVal:  $('fontScaleVal'),
    copyBtn:       $('copyBtn'),
    downloadHtml:  $('downloadHtml'),
    loadSample:    $('loadSample'),
    uploadMd:      $('uploadMd'),
    mdFile:        $('mdFile'),
    clearOverrides: $('clearOverrides'),
    preview:       $('preview'),
    previewWrap:   $('previewWrap'),
    previewInfo:   $('previewInfo'),
    charCount:     $('charCount'),
    copyStatus:    $('copyStatus'),
    statusInfo:    $('statusInfo'),
    themeStatus:   $('themeStatus'),
    resizer:       $('resizer'),
    editorPane:    $('editorPane'),
    previewPane:   $('previewPane')
  };

  const SAMPLE_URL = 'samples/demo.md';
  const RENDER_DEBOUNCE = 180;

  let renderTimer = null;
  let lastWidth = 620;
  let lastTheme = 'auto';

  // ====== 工具 ======
  function setStatus(text, kind) {
    els.copyStatus.textContent = text;
    els.copyStatus.className = kind || '';
  }

  function setBusy(text) {
    els.statusInfo.textContent = text || '处理中…';
  }

  function updatePreviewInfo() {
    const themeLabel = lastTheme === 'auto' ? '跟随系统' : (lastTheme === 'dark' ? '暗色' : '亮色');
    els.previewInfo.textContent = lastWidth + 'px · ' + themeLabel;
  }

  function updateCharCount() {
    const text = els.markdownInput.value || '';
    const len = text.length;
    const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    els.charCount.textContent = len + ' 字符' + (cn ? ' · ' + cn + ' 中文' : '');
  }

  // ====== 渲染调度 ======
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(doRender, RENDER_DEBOUNCE);
  }

  function doRender() {
    const md = els.markdownInput.value || '';
    let html;
    try {
      html = window.WmpMarkdown.parse(md);
    } catch (e) {
      setStatus('Markdown 解析失败：' + e.message, 'error');
      return;
    }
    try {
      window.WmpRenderer.render(html);
    } catch (e) {
      setStatus('渲染失败：' + e.message, 'error');
      return;
    }
    // 重新渲染后重新应用 inspector 的样式覆盖（持久化保存的修改不丢失）
    if (window.WmpInspector) {
      // 重新绑定 inspector 的点击事件（iframe 内容已更新）
      window.WmpInspector.init(els.preview);
      // 重新应用之前通过微调面板修改的样式
      window.WmpInspector.reapplyOverrides();
      // 如果面板正在打开，关闭它（选中元素已失效，路径可能变化）
      if (window.WmpInspector.isOpen()) {
        window.WmpInspector.close();
      }
    }
    // 延迟再测一次高度：字体/图片加载完成后高度可能变化
    setTimeout(() => {
      try { window.WmpRenderer.autoHeight(); } catch (e) {}
      // 高度稳定后重建滚动锚点（offsetTop 依赖最终布局）
      try { rebuildScrollAnchors(); } catch (e) {}
    }, 300);
    // 立即也重建一次（图片未加载时也先有锚点，后续滚动即可用）
    try { rebuildScrollAnchors(); } catch (e) {}
    setBusy('已就绪');
    setStatus('就绪。点击「复制到公众号」按钮，然后粘贴到微信公众号编辑器即可保留样式。');
  }

  // ====== 复制到公众号 ======
  async function copyToWechat() {
    setBusy('正在提取样式…');
    setStatus('正在提取样式…', 'busy');
    els.copyBtn.disabled = true;
    try {
      // 让最新的渲染结果先落地
      clearTimeout(renderTimer);
      doRender();
      // 等下一帧，确保 layout 完成
      await new Promise(r => requestAnimationFrame(r));

      const iframe = window.WmpRenderer.getIframe();
      const result = window.WmpInliner.extractAndInline(iframe);
      const html = result.html;

      setBusy('正在复制到剪贴板…');
      const r = await window.WmpClipboard.copyHtmlToClipboard(html);
      const detail = '内联 ' + result.stats.elements + ' 元素' +
        (result.stats.dropped ? '，过滤 ' + result.stats.dropped + ' 个装饰/不可见元素' : '') +
        (result.stats.beforeAfter ? '，转换 ' + result.stats.beforeAfter + ' 个伪元素' : '') +
        '（' + r.method + '）';
      setStatus('复制成功！' + detail + '。现在去微信公众号编辑器按 Ctrl+V 粘贴。', 'success');
    } catch (e) {
      console.error(e);
      // 区分错误类型给出更友好的提示
      let msg = e.message || String(e);
      if (e.code === 'PLAINTEXT_FALLBACK') {
        setStatus(msg, 'error');
      } else if (e.code === 'COPY_FAILED' || /复制失败|execCommand/i.test(msg)) {
        // 提示用户改用「下载 HTML」方案
        setStatus('复制失败：' + msg + '（可改用「下载 HTML」按钮：用浏览器打开下载文件 → 全选复制 → 粘贴到公众号）', 'error');
      } else {
        setStatus('复制失败：' + msg, 'error');
      }
    } finally {
      els.copyBtn.disabled = false;
      setBusy('已就绪');
    }
  }

  // ====== 下载 HTML ======
  function downloadHtmlFile() {
    try {
      clearTimeout(renderTimer);
      doRender();
      const iframe = window.WmpRenderer.getIframe();
      const result = window.WmpInliner.extractAndInline(iframe);
      window.WmpClipboard.downloadHtml(result.html);
      setStatus('已下载 HTML 文件（' + result.stats.elements + ' 元素已内联样式）。', 'success');
    } catch (e) {
      setStatus('下载失败：' + (e.message || e), 'error');
    }
  }

  // ====== 加载示例 ======
  async function loadSample() {
    try {
      const resp = await fetch(SAMPLE_URL, { cache: 'no-store' });
      if (!resp.ok) throw new Error('示例文件加载失败：' + resp.status);
      const text = await resp.text();
      els.markdownInput.value = text;
      updateCharCount();
      doRender();
      setStatus('已加载示例 Markdown。可在此基础上修改。');
    } catch (e) {
      setStatus('加载示例失败：' + e.message, 'error');
    }
  }

  // ====== 导入 .md 文件 ======
  function importMdFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      els.markdownInput.value = String(reader.result || '');
      updateCharCount();
      doRender();
      setStatus('已导入文件：' + file.name);
    };
    reader.onerror = () => setStatus('文件读取失败', 'error');
    reader.readAsText(file, 'utf-8');
  }

  // ====== 宽度切换 ======
  function onWidthChange() {
    const v = els.widthSelect.value;
    if (v === 'custom') {
      els.widthCustom.style.display = '';
      lastWidth = parseInt(els.widthCustom.value, 10) || 620;
    } else {
      els.widthCustom.style.display = 'none';
      lastWidth = parseInt(v, 10) || 620;
    }
    window.WmpRenderer.setWidth(lastWidth);
    updatePreviewInfo();
  }

  // ====== 主题切换 ======
  function onThemeChange() {
    lastTheme = els.themeSelect.value;
    window.WmpRenderer.setTheme(lastTheme);
    updatePreviewInfo();
    // 主题改变后重新渲染（确保 computed style 更新）
    requestAnimationFrame(doRender);
  }

  // ====== 字号缩放 ======
  function onFontScale() {
    const v = parseInt(els.fontScale.value, 10);
    els.fontScaleVal.textContent = v + '%';
    window.WmpRenderer.setFontScale(v);
  }

  // ====== 分隔条拖动 ======
  function setupResizer() {
    let dragging = false;
    let startX = 0, startY = 0, startW = 0;
    const isVertical = () => window.matchMedia('(max-width: 880px)').matches;

    els.resizer.addEventListener('mousedown', (e) => {
      dragging = true;
      els.resizer.classList.add('active');
      startX = e.clientX; startY = e.clientY;
      startW = isVertical() ? els.editorPane.offsetHeight : els.editorPane.offsetWidth;
      document.body.style.cursor = isVertical() ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      if (isVertical()) {
        const dy = e.clientY - startY;
        const newH = Math.max(120, Math.min(window.innerHeight - 200, startW + dy));
        els.editorPane.style.flex = '0 0 ' + newH + 'px';
        els.editorPane.style.height = newH + 'px';
      } else {
        const dx = e.clientX - startX;
        const newW = Math.max(220, Math.min(window.innerWidth - 320, startW + dx));
        els.editorPane.style.flex = '0 0 ' + newW + 'px';
        els.editorPane.style.width = newW + 'px';
      }
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      els.resizer.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  // ====== 等待第三方库就绪 ======
  function waitForLibs(timeout) {
    timeout = timeout || 15000;
    const start = Date.now();
    return new Promise((resolve, reject) => {
      (function check() {
        if (typeof marked !== 'undefined' && typeof hljs !== 'undefined' && typeof DOMPurify !== 'undefined') {
          resolve();
        } else if (Date.now() - start > timeout) {
          reject(new Error('第三方库加载超时（marked/highlight.js/DOMPurify），请检查网络或使用本地 vendor 版本'));
        } else {
          setTimeout(check, 50);
        }
      })();
    });
  }

  // ====== 双向同步滚动（编辑器 ↔ 预览） ======
  // 设计要点（修复原实现的三类问题）：
  //   1) 坐标系：原代码用 el.offsetTop（相对 iframe 内 content 容器）直接当作
  //      previewWrap.scrollTop，两者坐标系不同，导致右侧滚动定位整体偏移。
  //      原尝试用 getBoundingClientRect().top 也错——iframe 内元素的 rect.top 相对
  //      iframe 视口，父页面滚动 previewWrap 时它不变化，无法换算。正确做法见
  //      blockContentTop()：用 iframe 的 rect.top + 块在 iframe 文档内的稳定
  //      offsetTop 换算到 previewWrap 内容坐标系。
  //   2) 源行号：原代码用 scrollTop/lineHeight 估算“当前顶部源行”，但 textarea
  //      开了 white-space:pre-wrap，长段落会折行，视觉行 ≠ 源行，于是左侧到文末时
  //      算出的行号还停在半路、右侧跟着停在中段。改为按字符位置插值：把 scrollTop
  //      映射到 textarea 内容的字符偏移，再与预览块的字符偏移配对，折行不再影响。
  //   3) 底部对齐 + 同源行多块：原实现 line>=last.line 直接 clamp 到 last.offsetTop，
  //      永远到不了底；且 ## 列表/### 无序列表 等多个块都匹配到同一源行时，插值会
  //      选到最后一个块把位置拉偏。改为：去重保留每源行首个块，接近首尾时回退纯比例，
  //      保证两侧能同时到顶/到底且中段内容对齐。
  let scrollAnchors = []; // [{line, charOffset, el, offsetTop, writeDocTop}]
  let lastMdSource = '';

  // 计算源中每个块的“源行号”与“源字符偏移（块首字符在全文中的索引）”。
  // 字符偏移用于把 textarea 的 scrollTop 映射到源位置（不折行、最稳定）。
  function findSourceOffsets(mdSrc, plainText) {
    if (!plainText) return { line: -1, charOffset: -1 };
    const norm = s => s.replace(/[#>*`~_\[\]()!|-]/g, ' ').replace(/\s+/g, ' ').trim();
    const needle = norm(plainText);
    if (!needle) return { line: -1, charOffset: -1 };
    const lines = mdSrc.split('\n');
    let charOffset = 0;
    let bestLine = -1, bestOffset = -1, bestScore = 0;
    for (let i = 0; i < lines.length; i++) {
      const hay = norm(lines[i]);
      if (hay) {
        if (hay.includes(needle) || needle.includes(hay)) {
          return { line: i, charOffset: charOffset };
        }
        const minLen = Math.min(hay.length, needle.length);
        let match = 0;
        for (let k = 0; k < minLen; k++) {
          if (hay[k] === needle[k]) match++; else break;
        }
        if (match > bestScore && match >= 4) {
          bestScore = match; bestLine = i; bestOffset = charOffset;
        }
      }
      charOffset += lines[i].length + 1; // +1 for the \n
    }
    return { line: bestLine, charOffset: bestOffset };
  }

  // 渲染后重建锚点表（保存元素引用 + 稳定 offsetTop，滚动时实时测量位置）
  function rebuildScrollAnchors() {
    lastMdSource = els.markdownInput.value || '';
    const blocks = window.WmpRenderer.getBlocks ? window.WmpRenderer.getBlocks() : [];
    const raw = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const off = findSourceOffsets(lastMdSource, b.text);
      if (off.line >= 0) raw.push({
        line: off.line,
        charOffset: off.charOffset,
        el: b.el,
        offsetTop: b.offsetTop || 0,      // 相对 #write（稳定，不受滚动影响）
        writeDocTop: b.writeDocTop || 0   // #write 相对 iframe 文档（稳定）
      });
    }
    raw.sort((x, y) => x.line - y.line || x.offsetTop - y.offsetTop);
    // 去重：同一源行可能有多个预览块都匹配到（如 ## 列表 / ### 无序列表 / ### 有序列表
    // 都把开头匹配到 "## 列表" 这一源行）。保留每个源行的第一个块（预览中最靠上的），
    // 否则插值会在这些同 charOffset 的锚点间选到最后一个，把目标位置拉偏。
    scrollAnchors = [];
    let lastLine = -1;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i].line !== lastLine) {
        scrollAnchors.push(raw[i]);
        lastLine = raw[i].line;
      }
    }
  }

  // 把 textarea 的 scrollTop 换算为“当前可见顶部对应的源字符偏移”。
  // textarea 内容总字符数对应总可滚动高度，按比例映射（折行不影响字符总数，
  // 也不影响总高度，比例映射在折行场景下仍近似正确）。
  function taScrollTopToCharOffset(ta) {
    const total = (ta.value || '').length;
    const taMax = ta.scrollHeight - ta.clientHeight;
    if (taMax <= 0) return 0;
    return Math.max(0, Math.min(total, (ta.scrollTop / taMax) * total));
  }

  // 计算 previewWrap 在“内容坐标系”（scrollTop 到达的取值空间）中，块顶部位置。
  // 关键：iframe 内元素的 getBoundingClientRect().top 在父页面滚动 previewWrap 时
  // 不会改变（它相对 iframe 视口，而非父页面视口），所以不能直接用 rect.top。
  // 正确做法：块在 previewWrap 内容坐标 = previewWrap.scrollTop + (iframe 视口当前
  // 在页面上的位置 iframeRect.top) + (块在 iframe 文档内的稳定 offsetTop) - (wrapRect.top)。
  // 其中 iframeRect.top 随 previewWrap 滚动而实时变化，offsetTop/writeDocTop 稳定，
  // 代入后整体与 scrollTop 无关（恒等），因此插值结果稳定。
  function blockContentTop(anchor) {
    const iframe = window.WmpRenderer.getIframe();
    const wrap = els.previewWrap;
    const ir = iframe.getBoundingClientRect().top;
    const wr = wrap.getBoundingClientRect().top;
    return wrap.scrollTop + ir + anchor.writeDocTop + anchor.offsetTop - wr;
  }

  // 由源字符偏移 → 预览块在 previewWrap 滚动坐标系中的顶部位置（插值）
  function charOffsetToPreviewTop(charOffset) {
    if (scrollAnchors.length === 0) return null;
    const first = scrollAnchors[0];
    const last = scrollAnchors[scrollAnchors.length - 1];
    if (charOffset <= first.charOffset) return blockContentTop(first);
    if (charOffset >= last.charOffset) return blockContentTop(last);
    for (let i = 0; i < scrollAnchors.length - 1; i++) {
      const a = scrollAnchors[i], b = scrollAnchors[i + 1];
      if (charOffset >= a.charOffset && charOffset <= b.charOffset) {
        const t = b.charOffset === a.charOffset ? 0 : (charOffset - a.charOffset) / (b.charOffset - a.charOffset);
        return blockContentTop(a) + t * (blockContentTop(b) - blockContentTop(a));
      }
    }
    return blockContentTop(last);
  }

  // 由 previewWrap 当前 scrollTop → 源字符偏移（插值）
  function previewTopToCharOffset() {
    if (scrollAnchors.length === 0) return null;
    const wrap = els.previewWrap;
    const wrapPadTop = parseFloat(getComputedStyle(wrap).paddingTop) || 0;
    const offsetTop = wrap.scrollTop + wrapPadTop; // wrap 内容坐标系的可见顶部
    const first = scrollAnchors[0];
    const last = scrollAnchors[scrollAnchors.length - 1];
    const firstTop = blockContentTop(first);
    const lastTop = blockContentTop(last);
    if (offsetTop <= firstTop) return first.charOffset;
    if (offsetTop >= lastTop) return last.charOffset;
    for (let i = 0; i < scrollAnchors.length - 1; i++) {
      const a = scrollAnchors[i], b = scrollAnchors[i + 1];
      const ta = blockContentTop(a), tb = blockContentTop(b);
      if (offsetTop >= ta && offsetTop <= tb) {
        const t = tb === ta ? 0 : (offsetTop - ta) / (tb - ta);
        return a.charOffset + t * (b.charOffset - a.charOffset);
      }
    }
    return last.charOffset;
  }

  // 由源字符偏移 → textarea 的 scrollTop（按比例，折行近似正确）
  function charOffsetToTaScrollTop(ta, charOffset) {
    const total = (ta.value || '').length;
    const taMax = ta.scrollHeight - ta.clientHeight;
    if (taMax <= 0 || total <= 0) return 0;
    return (charOffset / total) * taMax;
  }

  function setupSyncScroll() {
    let syncing = false;

    // 编辑器 → 预览
    els.markdownInput.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      const ta = els.markdownInput;
      const wrap = els.previewWrap;
      const taMax = ta.scrollHeight - ta.clientHeight;
      const wrapMax = wrap.scrollHeight - wrap.clientHeight;
      let target;
      const charOffset = taScrollTopToCharOffset(ta);
      const anchored = charOffsetToPreviewTop(charOffset);
      const anchoredRatio = (anchored != null && wrapMax > 0)
        ? Math.max(0, Math.min(1, anchored / wrapMax)) : null;
      const ratio = taMax > 0 ? ta.scrollTop / taMax : 0;
      // 接近首尾时用纯比例，保证两侧能同时到底/到顶；中段用锚点插值
      if (anchoredRatio != null && ratio > 0.02 && ratio < 0.98) {
        target = anchored;
      } else {
        target = ratio * wrapMax;
      }
      wrap.scrollTop = Math.max(0, Math.min(wrapMax, target));
      requestAnimationFrame(() => { syncing = false; });
    });

    // 预览 → 编辑器
    els.previewWrap.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      const ta = els.markdownInput;
      const wrap = els.previewWrap;
      const taMax = ta.scrollHeight - ta.clientHeight;
      const wrapMax = wrap.scrollHeight - wrap.clientHeight;
      let target;
      const charOffset = previewTopToCharOffset();
      const ratio = wrapMax > 0 ? wrap.scrollTop / wrapMax : 0;
      if (charOffset != null && ratio > 0.02 && ratio < 0.98) {
        target = charOffsetToTaScrollTop(ta, charOffset);
      } else {
        target = ratio * taMax;
      }
      ta.scrollTop = Math.max(0, Math.min(taMax, target));
      requestAnimationFrame(() => { syncing = false; });
    });
  }

  // ====== 初始化 ======
  async function init() {
    setStatus('正在加载依赖库…', 'busy');
    try {
      await waitForLibs();
    } catch (e) {
      setStatus(e.message, 'error');
      return;
    }

    setStatus('正在加载 WeWrite 主题…', 'busy');
    try {
      await window.WmpRenderer.init(els.preview);
    } catch (e) {
      setStatus('主题加载失败：' + e.message, 'error');
      return;
    }

    // 初始尺寸/主题
    window.WmpRenderer.setWidth(lastWidth);
    window.WmpRenderer.setTheme(lastTheme);
    window.WmpRenderer.setFontScale(parseInt(els.fontScale.value, 10));
    updatePreviewInfo();

    // 事件绑定
    els.markdownInput.addEventListener('input', () => {
      updateCharCount();
      scheduleRender();
    });

    els.widthSelect.addEventListener('change', onWidthChange);
    els.widthCustom.addEventListener('input', onWidthChange);
    els.themeSelect.addEventListener('change', onThemeChange);
    els.fontScale.addEventListener('input', onFontScale);

    els.copyBtn.addEventListener('click', copyToWechat);
    els.downloadHtml.addEventListener('click', downloadHtmlFile);
    els.loadSample.addEventListener('click', loadSample);
    els.clearOverrides.addEventListener('click', function () {
      if (window.WmpInspector) {
        window.WmpInspector.clearOverrides();
        // 重新渲染恢复默认样式
        doRender();
        setStatus('已清除所有微调样式，恢复主题默认。');
      }
    });
    els.uploadMd.addEventListener('click', () => els.mdFile.click());
    els.mdFile.addEventListener('change', (e) => {
      importMdFile(e.target.files[0]);
      e.target.value = '';
    });

    // 快捷键：Ctrl/Cmd + Enter 复制
    els.markdownInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        copyToWechat();
      }
      // Tab 键插入 4 空格
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = els.markdownInput;
        const s = ta.selectionStart, en = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(en);
        ta.selectionStart = ta.selectionEnd = s + 4;
        scheduleRender();
      }
    });

    setupResizer();
    setupSyncScroll();

    // 初始化微调面板（点击预览元素时滑出）
    if (window.WmpInspector) {
      window.WmpInspector.init(els.preview);
    }

    // 加载示例
    await loadSample();

    updateCharCount();
    setBusy('已就绪');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
