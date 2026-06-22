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
    setTimeout(() => { try { window.WmpRenderer.autoHeight(); } catch (e) {} }, 300);
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

  // ====== 双向同步滚动（编辑器 ↔ 预览，按比例） ======
  function setupSyncScroll() {
    let syncing = false;

    // 编辑器 → 预览
    els.markdownInput.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      const ta = els.markdownInput;
      const taMax = ta.scrollHeight - ta.clientHeight;
      const ratio = taMax > 0 ? ta.scrollTop / taMax : 0;
      // 预览区滚动容器是 #previewWrap
      const wrap = els.previewWrap;
      const wrapMax = wrap.scrollHeight - wrap.clientHeight;
      if (wrapMax > 0) wrap.scrollTop = ratio * wrapMax;
      requestAnimationFrame(() => { syncing = false; });
    });

    // 预览 → 编辑器
    els.previewWrap.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      const wrap = els.previewWrap;
      const wrapMax = wrap.scrollHeight - wrap.clientHeight;
      const ratio = wrapMax > 0 ? wrap.scrollTop / wrapMax : 0;
      const ta = els.markdownInput;
      const taMax = ta.scrollHeight - ta.clientHeight;
      if (taMax > 0) ta.scrollTop = ratio * taMax;
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
