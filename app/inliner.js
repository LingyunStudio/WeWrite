/* ================================================================
   inliner.js —— 样式内联化核心
   把 iframe 预览中应用了 wewrite 主题的 DOM，转换成所有样式都
   写在 style 属性上的"扁平 HTML"，以便粘贴到微信公众号编辑器
   后样式不丢失（公众号会剥离 <style>、class、id、CSS 变量等）。

   核心思路：
   1. 克隆 iframe 内 #write 节点
   2. 对每个元素用 getComputedStyle 读取实际渲染样式（CSS 变量、
      :has()、:is()、@media 等都已被浏览器解析为具体值）
   3. 只内联"白名单属性"，跳过默认值/空值，控制体积
   4. 处理 ::before/::after 伪元素（公众号不支持伪元素，把有
      实际内容的转为真实 <span>；纯装饰的丢弃）
   5. 处理 ::marker（列表符号颜色公众号不支持，保留 list-style-type）
   6. 清理 class / id / data-* 等属性、过滤装饰元素
   7. 序列化为 HTML 字符串
   ================================================================ */

(function (global) {
  'use strict';

  // ====== 白名单：需要内联的 CSS 属性 ======
  // 精简版：只保留对排版有实际意义、且公众号会保留的属性
  // 去掉 background-attachment/clip/origin 等浏览器默认值属性
  const INLINE_PROPS = [
    // 文本与字体
    'color', 'font-family', 'font-size', 'font-weight', 'font-style',
    'font-stretch', 'letter-spacing', 'line-height',
    'text-align', 'text-decoration', 'text-decoration-color',
    'text-indent', 'text-shadow', 'text-transform',
    'white-space', 'word-break', 'word-spacing', 'overflow-wrap',
    'vertical-align', 'tab-size',
    // 盒模型
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-left-radius', 'border-bottom-right-radius',
    'width', 'max-width', 'height',
    'box-sizing',
    // 背景（只保留 color 和 image，去掉 attachment/clip/origin 等默认值）
    'background-color', 'background-image', 'background-size', 'background-position',
    'background-repeat',
    // 装饰
    'box-shadow', 'opacity',
    // box-decoration-break：行内代码等带 padding/border 的 inline 元素换行时，
    // 让每个片段各自闭合边框/内边距（clone），否则边框只画在首末片段、中间断口难看。
    // 公众号支持该属性，需内联保留。
    'box-decoration-break',
    '-webkit-box-decoration-break',
    // display：保留 inline/block/inline-block（分式 span 需要 block 才能上下排列）
    // 只跳过 list-item（列表用 section+p 方案，不需要 list-item）
    'display',
    // text-decoration 相关（根号 overline 需要）
    'text-decoration-line',
    // 列表（只保留 list-style-type，不要 list-style-position——
    // outside 会让公众号把符号推到 li 外部导致换行）
    'list-style-type',
    // 表格
    'border-collapse', 'border-spacing',
    // 缩放（Typora 的 style="zoom:40%" 语法，控制图片大小）
    'zoom',
    // 其他
    'visibility'
  ];

  // 快速查找集合
  const INLINE_SET = new Set(INLINE_PROPS);

  // 跳过这些值（视为默认值/无意义）
  const SKIP_VALUES = new Set([
    '', 'none', 'normal', 'initial', 'inherit', 'unset', 'revert',
    'auto', 'medium', '0', '0px', '0%', '0.0', 'transparent',
    'rgba(0, 0, 0, 0)', 'rgba(0,0,0,0)', 'static',
    'visible',
    // 注意：不跳过 'disc'/'outside'，列表元素需要这些值才能在公众号显示符号
    // background 默认值
    'scroll', 'border-box', 'padding-box', 'repeat', '0% 0%',
    '0px 0px', '0px 0%', '0% 0px',
    // border 默认值
    'separate', '0px', 'medium',
    // display 默认值（不内联，让公众号用默认）
    'inline',
    // flex 默认值
    'row', 'nowrap',
    // 其他默认值
    'baseline', 'start', 'auto auto', 'normal normal',
    '100%', '1', 'content-box', '8', '6'
  ]);

  // 这些属性的 "auto" 是有意义的，不能跳过
  const KEEP_AUTO_PROPS = new Set([
    'margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'margin'
  ]);

  // 这些属性只在特定上下文有意义，需条件判断
  // list-style-* 只对 li/ul/ol 有意义
  const LIST_TAGS = new Set(['UL', 'OL', 'LI', 'DL', 'DT', 'DD']);
  // width/height 对块级元素应跳过（用 auto 让公众号自适应）
  // 但对 img/td/th 等应保留
  const KEEP_WH_TAGS = new Set(['IMG', 'TD', 'TH', 'SVG', 'VIDEO', 'IFRAME']);
  // table 相关属性只对 table 系列有意义
  const TABLE_TAGS = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION']);
  // 这些元素的默认 display 等需要保留，避免被错误清理
  // 公众号支持的基础标签
  // 注意：SECTION/FIGURE/FIGCAPTION 等 HTML5 语义标签保留在此列表中，
  // 以便 walk() 正常提取 computed style（尤其是 padding-left 缩进）。
  // 序列化后再通过字符串替换将这些标签转为 <div>，避免公众号默认间距。
  const ALLOWED_TAGS = new Set([
    'P', 'SPAN', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN',
    'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION', 'BLOCKQUOTE', 'PRE', 'CODE',
    'KBD', 'MARK', 'STRONG', 'EM', 'B', 'I', 'U', 'S', 'STRIKE', 'DEL',
    'INS', 'SUB', 'SUP', 'SMALL', 'BIG', 'ABBR', 'CITE', 'Q', 'TIME',
    'ADDRESS', 'DETAILS', 'SUMMARY', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'TABLE', 'THEAD', 'TBODY', 'TFOOT',
    'TR', 'TH', 'TD', 'CAPTION', 'COLGROUP', 'COL', 'IMG', 'HR', 'BR',
    'A', 'WBR', 'BDI', 'BDO', 'DATA', 'RP', 'RT', 'RUBY'
  ]);

  // 完全移除的标签（连内容也丢弃，因为它们是装饰/不兼容）
  const DROP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'HEAD', 'IFRAME', 'OBJECT',
    'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION',
    'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'CANVAS', 'SVG', 'TEMPLATE',
    'SLOT', 'COLGROUP' // colgroup 公众号支持差，丢弃但保留 col 信息已在 th/td
  ]);

  // 主题装饰类前缀，匹配这些类的元素一律丢弃
  const VLOOK_CLASS_RE = /(^|\s)(v-|md-toc-thumb|md-toc-refresh|md-toc-show|md-toc-hide|md-toc-pin|md-toc-reset|md-toc-close|md-toc-block-fold|md-toc-block-unfold|md-diagram-panel-backdrop|md-rawblock)/;

  // ====== 工具函数 ======

  function shouldSkipValue(prop, value) {
    if (!value) return true;
    const v = value.trim().toLowerCase();
    if (SKIP_VALUES.has(v)) {
      // 对 KEEP_AUTO_PROPS 中的属性，"auto" 不跳过
      if (v === 'auto' && KEEP_AUTO_PROPS.has(prop)) return false;
      if (v === 'disc' && prop === 'list-style-type') return false; // disc 是 li 默认值，但主题可能改了
      return true;
    }
    // 跳过浏览器内部光标/scrollbar 等
    if (v.indexOf('data:image/svg+xml') === 0 && prop === 'cursor') return true;
    return false;
  }

  // 判断元素是否是主题装饰元素（需要丢弃）
  function isDecorEl(el) {
    if (!el.className || typeof el.className !== 'string') return false;
    return VLOOK_CLASS_RE.test(el.className);
  }

  // 判断元素是否"不可见"（display:none/visibility:hidden/opacity:0 且无内容）
  function isInvisible(computed) {
    if (computed.getPropertyValue('display') === 'none') return true;
    if (computed.getPropertyValue('visibility') === 'hidden') return true;
    return false;
  }

  // 提取元素的有效内联样式（基于 computed style + 白名单）
  // 智能跳过默认值和上下文无关属性，并加 !important
  function extractInlineStyles(el, sourceWin) {
    const computed = sourceWin.getComputedStyle(el);
    const result = [];
    const tag = el.tagName;

    // 保留元素原有 style 属性里 inliner 可能跳过但有意义的属性
    // （如公式分式的 border-bottom、根号的 border-top、section/figure 的 margin:0）
    var origStyle = el.getAttribute('style') || '';
    // 保留带 !important 的 border 属性
    var borderProps = origStyle.match(/border-(?:top|bottom|left|right)(?:-width|-color|-style)?(?:-bottom)?(?:-left|-right)?:\s*[^;]+!important/gi) || [];
    borderProps.forEach(function (bp) {
      var propName = bp.match(/([a-z-]+):/i);
      if (propName && result.indexOf(propName[1]) < 0) {
        result.push(bp.trim());
      }
    });
    // 保留带 !important 的 margin 属性（section/figure/pre 的 margin:0 需要保留，
    // 否则公众号会用默认 margin 产生多余空行）
    var marginProps = origStyle.match(/margin(?:-top|-bottom|-left|-right)?:\s*[^;]+!important/gi) || [];
    marginProps.forEach(function (mp) {
      var propName = mp.match(/([a-z-]+):/i);
      if (propName) {
        var key = propName[1];
        // 避免重复
        var already = result.some(function(r) { return r.indexOf(key + ':') === 0; });
        if (!already) result.push(mp.trim());
      }
    });
    // 保留带 !important 的 padding 属性（列表 section 的 padding-left 缩进需要保留，
    // 否则列表缩进和嵌套层级在公众号中会丢失）
    var paddingProps = origStyle.match(/padding(?:-top|-bottom|-left|-right)?:\s*[^;]+!important/gi) || [];
    paddingProps.forEach(function (pp) {
      var propName = pp.match(/([a-z-]+):/i);
      if (propName) {
        var key = propName[1];
        var already = result.some(function(r) { return r.indexOf(key + ':') === 0; });
        if (!already) result.push(pp.trim());
      }
    });

    // 先读取 border-width，如果为 0 则跳过所有 border-color/style
    const borderTopWidth = computed.getPropertyValue('border-top-width');
    const borderRightWidth = computed.getPropertyValue('border-right-width');
    const borderBottomWidth = computed.getPropertyValue('border-bottom-width');
    const borderLeftWidth = computed.getPropertyValue('border-left-width');
    const hasBorderTop = borderTopWidth && borderTopWidth !== '0px';
    const hasBorderRight = borderRightWidth && borderRightWidth !== '0px';
    const hasBorderBottom = borderBottomWidth && borderBottomWidth !== '0px';
    const hasBorderLeft = borderLeftWidth && borderLeftWidth !== '0px';

    // 读取 background-image，如果为 none 则跳过 background-size/position/repeat
    const bgImage = computed.getPropertyValue('background-image');
    const hasBgImage = bgImage && bgImage !== 'none';

    // 读取 text-decoration，如果为 none 则跳过 text-decoration-color
    const textDecoration = computed.getPropertyValue('text-decoration-line') || computed.getPropertyValue('text-decoration');
    const hasTextDecoration = textDecoration && textDecoration !== 'none';

    // 是否为列表元素
    const isListEl = LIST_TAGS.has(tag);
    // 是否为表格元素
    const isTableEl = TABLE_TAGS.has(tag);
    // 是否保留 width/height
    const keepWh = KEEP_WH_TAGS.has(tag);

    for (let i = 0; i < computed.length; i++) {
      const prop = computed[i];
      if (!INLINE_SET.has(prop)) continue;

      // display：保留 inline/block/inline-block（分式 span 需要 block）
      // 只跳过 list-item（列表用 section+p 方案，不需要 list-item）
      if (prop === 'display') {
        const dv = computed.getPropertyValue('display');
        if (dv === 'list-item') continue;
        // inline/block/inline-block/flex 等保留
      }

      // 非列表元素跳过 list-style-* 属性
      if (prop.indexOf('list-style') === 0 && !isListEl) continue;

      // 非表格元素跳过 border-collapse/border-spacing
      if ((prop === 'border-collapse' || prop === 'border-spacing') && !isTableEl) continue;

      // width/height：img/td/th 保留（需要固定尺寸）
      // 只有 border-radius:50% 的小圆点（有背景色、圆形）才保留 width/height
      // 其他元素（包括有渐变背景的标题）一律跳过，用 auto 让公众号自适应
      if ((prop === 'width' || prop === 'height' || prop === 'max-width') && !keepWh) {
        const isRoundDot = (computed.getPropertyValue('background-color') !== 'rgba(0, 0, 0, 0)' &&
                           computed.getPropertyValue('background-color') !== 'transparent' &&
                           computed.getPropertyValue('border-bottom-left-radius') === '50%' &&
                           computed.getPropertyValue('border-top-left-radius') === '50%');
        if (!isRoundDot) continue;
      }

      // 无文本装饰时跳过 text-decoration-color
      if (prop === 'text-decoration-color' && !hasTextDecoration) continue;

      // 无边框时跳过 border-color 和 border-style
      if (prop.indexOf('border-') === 0 && prop.indexOf('-color') > 0) {
        const side = prop.replace('border-', '').replace('-color', '');
        if (side === 'top' && !hasBorderTop) continue;
        if (side === 'right' && !hasBorderRight) continue;
        if (side === 'bottom' && !hasBorderBottom) continue;
        if (side === 'left' && !hasBorderLeft) continue;
      }
      if (prop.indexOf('border-') === 0 && prop.indexOf('-style') > 0) {
        const side = prop.replace('border-', '').replace('-style', '');
        if (side === 'top' && !hasBorderTop) continue;
        if (side === 'right' && !hasBorderRight) continue;
        if (side === 'bottom' && !hasBorderBottom) continue;
        if (side === 'left' && !hasBorderLeft) continue;
      }

      // 无背景图时跳过 background-size/position/repeat
      if (!hasBgImage && (prop === 'background-size' || prop === 'background-position' || prop === 'background-repeat')) {
        continue;
      }

      const value = computed.getPropertyValue(prop);
      if (shouldSkipValue(prop, value)) {
        // 例外1：列表元素的 list-style-type 值（disc/none 等）
        if (isListEl && prop === 'list-style-type') {
          // 不跳过
        }
        // 例外2：块级元素的 margin-top/margin-bottom 为 0 时也要内联
        // 否则公众号用默认 margin 产生多余空行
        // 覆盖所有公众号可能注入默认 margin 的块级标签
        else if ((tag === 'SECTION' || tag === 'FIGURE' || tag === 'PRE' ||
                  tag === 'P' || tag === 'TABLE' || tag === 'UL' || tag === 'OL' ||
                  tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'DL' || tag === 'DT' || tag === 'DD' ||
                  tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') &&
                 (prop === 'margin-top' || prop === 'margin-bottom') &&
                 (value === '0px' || value === '0')) {
          // 不跳过，内联 margin:0
        }
        // 例外3：img 的 max-width:100% 需要保留，否则图片在公众号会超出编辑区
        // （100% 通常被跳过，但对 img 是防止溢出的关键约束）
        else if (tag === 'IMG' && prop === 'max-width' && value === '100%') {
          // 不跳过
        } else {
          continue;
        }
      }

      // 加 !important 确保覆盖公众号编辑器的默认样式
      result.push(prop + ': ' + value.trim() + ' !important');
    }
    return result.join('; ');
  }

  // 处理伪元素 ::before / ::after：如果有实际 content（非空、非纯装饰），转为真实 <span>
  function extractPseudoContent(el, sourceWin, pseudo) {
    const computed = sourceWin.getComputedStyle(el, pseudo);
    const content = computed.getPropertyValue('content');
    if (!content || content === 'none' || content === 'normal' || content === '""' || content === "''") {
      return null;
    }
    // 跳过 CSS counter() / counters() / attr() —— 公众号不支持，且无法转为静态文本
    if (/counter|counters|attr\(/i.test(content)) return null;
    // 跳过插件错误提示等长文本装饰
    if (/VLOOK|plugin load failed|Oops/i.test(content)) return null;
    // content 形如 "text" / "★" / open-quote 等
    // 只处理字符串字面量（"..." 或 '...'），其他丢弃
    const m = content.match(/^"((?:[^"\\]|\\.)*)"$|^'((?:[^'\\]|\\.)*)'$/);
    if (!m) return null;
    let text = (m[1] !== undefined ? m[1] : m[2]) || '';
    if (!text) return null;
    // 解码 CSS 转义（如 \a 为换行，\2003 为 em 空格等）
    text = decodeCssString(text);
    // 跳过纯空白
    if (!text.trim()) return null;
    // 提取伪元素的样式（color/font 等）
    const styleParts = [];
    for (let i = 0; i < computed.length; i++) {
      const prop = computed[i];
      if (!INLINE_SET.has(prop)) continue;
      if (prop === 'content') continue;
      const value = computed.getPropertyValue(prop);
      if (shouldSkipValue(prop, value)) continue;
      styleParts.push(prop + ': ' + value.trim());
    }
    return { text: text, style: styleParts.join('; ') };
  }

  // 解码 CSS content 字符串里的转义（\a → 换行，\xxxx → unicode）
  function decodeCssString(s) {
    return s
      .replace(/\\a([0-9a-fA-F]{0,6})/g, (_, h) => '\n' + cssHexToChar(h))
      .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h) => cssHexToChar(h))
      .replace(/\\(.)/g, '$1');
  }
  function cssHexToChar(h) {
    if (!h) return '';
    try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ''; }
  }

  // 清理属性：只保留白名单属性 + style（我们内联的）
  const KEEP_ATTRS = new Set([
    'style', 'href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'target',
    'rel', 'width', 'height', 'lang', 'language', 'span', 'datetime', 'cite',
    'dir', 'lang'
  ]);

  function cleanAttributes(el, iframeDoc) {
    const attrs = Array.from(el.attributes || []);
    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      if (KEEP_ATTRS.has(name)) continue;
      el.removeAttribute(attr.name);
    }
    // 链接处理
    if (el.tagName === 'A' && el.getAttribute('href')) {
      var href = el.getAttribute('href');
      // 公众号禁止插入 mp.weixin.qq.com 域名的非图文链接，
      // 检测到这类链接时把 <a> 解包为纯文本（保留文字，去掉链接）
      if (/mp\.weixin\.qq\.com/i.test(href)) {
        var parent = el.parentNode;
        if (parent) {
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
          return; // 元素已被移除，不再处理
        }
      }
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener');
      // 链接颜色处理：公众号粘贴时会剥离 <a> 上的内联 color（把外部链接转成
      // 它自己的超链接组件，文字颜色由公众号控制，常变黑）。单靠 <a style=color>
      // 不可靠。这里用"双层保险"：把链接文字包进一个带蓝色的 <span>：
      //   <a ...><span style="color:#298bcc !important">链接文字</span></a>
      // 公众号即使把 <a> 解包成纯文字、或覆盖 <a> 的 color，内层 <span> 的蓝色
      // 仍保留（span 是普通格式元素，公众号不剥其 style）。同时 <a> 本身也设蓝色
      // + 下划线作兜底。
      var st = el.getAttribute('style') || '';
      st = st.replace(/color\s*:\s*[^;]+;?\s*/gi, '');
      st = st.replace(/text-decoration(-line)?\s*:\s*[^;]+;?\s*/gi, '');
      el.setAttribute('style', 'color:#298bcc !important;text-decoration:underline !important;' + st);
      // 用蓝色 span 包裹所有子节点
      var span = el.ownerDocument.createElement('span');
      span.setAttribute('style', 'color:#298bcc !important;');
      while (el.firstChild) span.appendChild(el.firstChild);
      el.appendChild(span);
    }
  }

  // ====== 列表缩进修复 ======
  // 问题：markdown.js 把列表渲染为 <section style="padding-left:1.5em">，
  // 嵌套列表 section 套 section，padding 逐层叠加。但 inliner 把 section
  // 转成 div 后，微信公众号会剥离/扁平化嵌套 div 的 padding，导致：
  //   1. 列表缩进丢失（左对齐，无缩进）
  //   2. 嵌套层级失效（所有项同级）
  // 修复：把 padding-left 从 section 包装器移到每个 <p> 列表项上。
  //   <p> 的 padding 公众号会保留，即使包装器 div 被剥离也不影响缩进。
  //   嵌套列表的 <p> 按深度递增 padding-left，视觉层级保持正确。

  // 计算所有列表 section 的嵌套深度
  // 返回 Map<Element, depth>，depth 从 0 开始（0 = 顶层列表）
  function computeListDepths(root) {
    var depths = new Map();
    var sections = root.querySelectorAll('section');
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      var style = section.getAttribute('style') || '';
      if (style.indexOf('padding-left:1.5em') < 0) continue;
      var depth = 0;
      var ancestor = section.parentElement;
      while (ancestor && ancestor !== root) {
        if (ancestor.tagName === 'SECTION') {
          var aStyle = ancestor.getAttribute('style') || '';
          if (aStyle.indexOf('padding-left:1.5em') >= 0) depth++;
        }
        ancestor = ancestor.parentElement;
      }
      depths.set(section, depth);
    }
    return depths;
  }

  // 从样式字符串中移除所有 padding-left 声明
  function removePaddingLeft(styleText) {
    if (!styleText) return '';
    return styleText.split(';').map(function (s) { return s.trim(); })
      .filter(function (s) { return s && !/^padding-left\s*:/i.test(s); })
      .join('; ');
  }

  // 在样式字符串中设置 padding-left（替换已有的或添加新的）
  function setPaddingLeft(styleText, value) {
    var cleaned = removePaddingLeft(styleText);
    if (cleaned) return cleaned + '; padding-left:' + value + ' !important';
    return 'padding-left:' + value + ' !important';
  }

  // 主入口：从 iframe 文档提取并内联化
  // 返回 { html, stats: { elements, dropped, pseudo } }
  function extractAndInline(iframe, opts) {
    opts = opts || {};
    const iframeWin = iframe.contentWindow;
    const iframeDoc = iframe.contentDocument;
    if (!iframeDoc) throw new Error('无法访问预览 iframe 文档');

    const sourceRoot = iframeDoc.getElementById('write');
    if (!sourceRoot) throw new Error('预览中未找到 #write 节点');

    // 预计算列表 section 的嵌套深度，用于缩进修复
    const listDepths = computeListDepths(sourceRoot);

    const stats = { elements: 0, dropped: 0, pseudo: 0, beforeAfter: 0 };
    const clone = sourceRoot.cloneNode(true);

    // 递归处理
    function walk(srcEl, dstEl) {
      stats.elements++;
      // 计算源元素的内联样式（用源元素而非克隆，因为 computed 依赖 DOM 位置）
      let styleText = extractInlineStyles(srcEl, iframeWin);

      // 列表缩进修复：把 section 的 padding-left 移到每个子元素上
      if (listDepths.has(srcEl)) {
        // 列表 section 本身：去掉 padding-left（缩进已移到子元素）
        styleText = removePaddingLeft(styleText);
      } else if (srcEl.parentElement && listDepths.has(srcEl.parentElement) &&
                 !listDepths.has(srcEl)) {
        // 是列表 section 的直接子元素，且自身不是嵌套列表 section
        // 如果元素已有自定义 padding-left（如通过微调面板设置的），不覆盖
        var origPStyle = srcEl.getAttribute('style') || '';
        var plMatch = origPStyle.match(/padding-left\s*:\s*([^;!]+)/i);
        var hasCustomPadding = plMatch && parseFloat(plMatch[1]) > 0;
        if (!hasCustomPadding) {
          // 按深度计算 padding-left：depth=0 → 1.5em，depth=1 → 3em，…
          var depth = listDepths.get(srcEl.parentElement);
          var computedFs = iframeWin.getComputedStyle(srcEl);
          var fs = parseFloat(computedFs.getPropertyValue('font-size')) || 18;
          var indentPx = Math.round((depth + 1) * 1.5 * fs);
          styleText = setPaddingLeft(styleText, indentPx + 'px');
        }
      }

      // 图片居中修复：包含 <img> 的 <p> 强制 text-align:center
      // 手机端微信对 margin:auto 支持不可靠，用父容器 text-align:center 居中
      // markdown.js 已把裸 <img> 包裹进居中的 <p>，这里确保内联样式不丢失
      if (srcEl.tagName === 'P') {
        var hasImg = false;
        for (var ci = 0; ci < srcEl.children.length; ci++) {
          if (srcEl.children[ci].tagName === 'IMG') { hasImg = true; break; }
        }
        if (hasImg && styleText.indexOf('text-align: center') < 0) {
          styleText = (styleText ? styleText + '; ' : '') + 'text-align: center !important';
        }
      }

      if (styleText) {
        dstEl.setAttribute('style', styleText);
      } else if (dstEl.hasAttribute('style')) {
        dstEl.removeAttribute('style');
      }

      // 处理 ::before（插入到子节点最前）
      const before = extractPseudoContent(srcEl, iframeWin, '::before');
      // 处理 ::after（追加到子节点最后）
      const after = extractPseudoContent(srcEl, iframeWin, '::after');

      // 先处理子节点（深度优先，便于删除不可见/装饰元素）
      const srcChildren = Array.from(srcEl.children || []);
      const dstChildren = Array.from(dstEl.children || []);
      const survivors = [];
      for (let i = 0; i < srcChildren.length; i++) {
        const sc = srcChildren[i];
        const dc = dstChildren[i];
        if (!dc) continue;
        const tag = sc.tagName;

        // task list 复选框：INPUT[type=checkbox] 转为可读符号 ☑/☐（公众号不支持 input）
        if (tag === 'INPUT' && (sc.type === 'checkbox' || sc.type === 'radio')) {
          const symbol = sc.checked ? '☑' : '☐';
          const symbolSpan = iframeDoc.createElement('span');
          symbolSpan.textContent = symbol + ' ';
          // 复制一些视觉样式
          const inpStyle = extractInlineStyles(sc, iframeWin);
          if (inpStyle) symbolSpan.setAttribute('style', 'margin-right: 4px; color: ' +
            (iframeWin.getComputedStyle(sc).color || 'inherit') + '; font-weight: bold;');
          dstEl.replaceChild(symbolSpan, dc);
          survivors.push({ src: sc, dst: symbolSpan });
          continue;
        }

        // 丢弃的标签
        if (DROP_TAGS.has(tag)) {
          stats.dropped++;
          dstEl.removeChild(dc);
          continue;
        }
        // 主题装饰元素
        if (isDecorEl(sc)) {
          stats.dropped++;
          dstEl.removeChild(dc);
          continue;
        }
        // 不可见元素（display:none 等）
        const computed = iframeWin.getComputedStyle(sc);
        if (isInvisible(computed)) {
          stats.dropped++;
          dstEl.removeChild(dc);
          continue;
        }
        // 不在允许列表中的标签：保留内容但解除标签（用 <span> 或 <div> 替换）
        if (!ALLOWED_TAGS.has(tag)) {
          // 用 span 替换行内元素，div 替换块级元素
          const isBlock = (computed.getPropertyValue('display') !== 'inline');
          const replacement = iframeDoc.createElement(isBlock ? 'div' : 'span');
          while (dc.firstChild) replacement.appendChild(dc.firstChild);
          // 复制属性
          for (const attr of Array.from(dc.attributes || [])) {
            if (KEEP_ATTRS.has(attr.name.toLowerCase())) {
              replacement.setAttribute(attr.name, attr.value);
            }
          }
          dstEl.replaceChild(replacement, dc);
          survivors.push({ src: sc, dst: replacement });
          continue;
        }
        survivors.push({ src: sc, dst: dc });
      }

      // 递归处理幸存的子节点
      for (const pair of survivors) {
        walk(pair.src, pair.dst);
      }

      // 插入 ::before / ::after 转换的真实节点
      if (before) {
        stats.beforeAfter++;
        const span = iframeDoc.createElement('span');
        span.textContent = before.text;
        if (before.style) span.setAttribute('style', before.style);
        dstEl.insertBefore(span, dstEl.firstChild);
      }
      if (after) {
        stats.beforeAfter++;
        const span = iframeDoc.createElement('span');
        span.textContent = after.text;
        if (after.style) span.setAttribute('style', after.style);
        dstEl.appendChild(span);
      }

      // 清理属性（保留 style + 白名单），处理 mp.weixin 链接
      cleanAttributes(dstEl, iframeDoc);
    }

    walk(sourceRoot, clone);

    // 清理块元素之间的空白文本节点（换行符、缩进空格等）
    // marked 生成的 HTML 每个块元素后有 \n，渲染到 iframe 后成为 DOM 文本节点；
    // clone.outerHTML 会保留这些文本节点，粘贴到微信编辑器时会被转成
    // <p><br></p> 产生多余空行。只移除包含换行的纯空白文本节点，
    // 保留行内元素之间的单个空格（如 <span>a</span> <span>b</span>）
    (function stripInterBlockWhitespace(el) {
      var children = el.childNodes;
      for (var i = children.length - 1; i >= 0; i--) {
        var child = children[i];
        if (child.nodeType === 3) {
          // 只移除包含换行的纯空白文本节点
          if (/^\s+$/.test(child.textContent) && /[\n\r]/.test(child.textContent)) {
            el.removeChild(child);
          }
        } else if (child.nodeType === 1) {
          stripInterBlockWhitespace(child);
        }
      }
    })(clone);

    // 序列化
    var html = clone.outerHTML;

    // 将 HTML5 语义标签替换为 div（微信公众号编辑器对 section/figure/article 等
    // 有自己的默认间距处理，会在前后插入空行；div 作为透明容器没有此问题）
    // 必须在序列化之后替换（不能在 walk 阶段转换标签，否则会丢失 computed style）
    html = html
      .replace(/<(section|article|header|footer|main|aside|nav|figure|figcaption)\b/gi, '<div')
      .replace(/<\/(section|article|header|footer|main|aside|nav|figure|figcaption)>/gi, '</div>');

    return { html: html, stats: stats };
  }

  global.WmpInliner = {
    extractAndInline: extractAndInline,
    INLINE_PROPS: INLINE_PROPS,
    ALLOWED_TAGS: ALLOWED_TAGS
  };

})(window);
