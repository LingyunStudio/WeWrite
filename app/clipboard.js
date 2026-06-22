/* ================================================================
   clipboard.js —— 复制到微信公众号剪贴板
   把内联样式后的 HTML 以 text/html MIME 类型写入剪贴板，
   公众号编辑器粘贴时会识别该格式并保留 inline style。

   优先使用 ClipboardItem API（secure context: localhost/https）；
   不可用时回退到 contenteditable + execCommand('copy')。
   ================================================================ */

(function (global) {
  'use strict';

  // 把 HTML 作为富文本复制到剪贴板
  // 返回 Promise<{method, ok}>，失败时 throw
  async function copyHtmlToClipboard(html, plainText) {
    plainText = plainText || stripHtmlToText(html);

    // 方式 A：ClipboardItem API（推荐，富文本 HTML）
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
      try {
        const htmlBlob = new Blob([html], { type: 'text/html' });
        const textBlob = new Blob([plainText], { type: 'text/plain' });
        const item = new ClipboardItem({
          'text/html': htmlBlob,
          'text/plain': textBlob
        });
        await navigator.clipboard.write([item]);
        return { method: 'ClipboardItem', ok: true };
      } catch (e) {
        console.warn('ClipboardItem 复制失败，尝试回退方案:', e);
      }
    }

    // 方式 B：execCommand('copy') 回退（同样能复制富文本）
    try {
      return execCommandCopy(html, plainText);
    } catch (e) {
      console.warn('execCommand 复制失败，尝试纯文本降级:', e);
    }

    // 方式 C：navigator.clipboard.writeText 纯文本降级（最后兜底）
    // 注意：纯文本会丢失样式，但至少能让用户拿到内容，再手动粘贴
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(plainText);
        const err = new Error('已复制纯文本（浏览器限制无法复制富文本）。建议在右上角点击「下载 HTML」，用浏览器打开后全选复制，再粘贴到公众号。');
        err.code = 'PLAINTEXT_FALLBACK';
        err.method = 'writeText';
        throw err;
      } catch (e2) {
        // 继续
      }
    }

    // 全部失败
    const err = new Error('复制失败：浏览器拒绝所有剪贴板写入方式。请改用「下载 HTML」按钮，用浏览器打开下载的文件后全选复制，再粘贴到公众号编辑器。');
    err.code = 'COPY_FAILED';
    throw err;
  }

  function execCommandCopy(html, plainText) {
    // 创建临时可编辑容器，插入 HTML，选中并复制
    const container = document.createElement('div');
    container.setAttribute('contenteditable', 'true');
    container.style.position = 'fixed';
    container.style.left = '-99999px';
    container.style.top = '0';
    container.style.width = '1px';
    container.style.height = '1px';
    container.style.overflow = 'hidden';
    container.style.opacity = '0';
    container.innerHTML = html;
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }

    // 清理
    sel.removeAllRanges();
    document.body.removeChild(container);

    if (!ok) {
      const err = new Error('复制失败：浏览器拒绝执行复制命令。请使用 HTTPS 或 localhost 访问，或手动选中预览内容复制。');
      err.code = 'COPY_FAILED';
      throw err;
    }
    return { method: 'execCommand', ok: true };
  }

  // 简单的 HTML → 纯文本转换（作为 text/plain fallback）
  function stripHtmlToText(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    // 把 <br> 转成换行，<p>/<h*> 转成换行
    const brs = tmp.querySelectorAll('br');
    brs.forEach(br => br.replaceWith('\n'));
    const blocks = tmp.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, tr, div');
    blocks.forEach(b => { b.appendChild(document.createTextNode('\n')); });
    return (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // 触发下载：把 HTML 保存为 .html 文件
  function downloadHtml(html, filename) {
    filename = filename || ('wewrite-' + Date.now() + '.html');
    // 包裹成完整 HTML 文档（带 meta charset，避免乱码）
    const full = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<title>微信公众号内容</title>\n</head>\n<body>\n' + html + '\n</body>\n</html>\n';
    const blob = new Blob([full], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  global.WmpClipboard = {
    copyHtmlToClipboard: copyHtmlToClipboard,
    downloadHtml: downloadHtml,
    stripHtmlToText: stripHtmlToText
  };

})(window);
