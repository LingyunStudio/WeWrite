/* ================================================================
   markdown.js —— Markdown 解析配置
   基于 marked + highlight.js，自定义 renderer 让输出 HTML 结构
   尽量匹配 wewrite 主题（Typora 专用类如 .md-fences 等）
   ================================================================ */

(function (global) {
  'use strict';

  // 等待 marked 加载
  function getMarked() {
    if (typeof marked === 'undefined') throw new Error('marked.js 未加载，请检查网络或使用本地 vendor 版本');
    return marked;
  }

  // 高亮代码：使用 highlight.js，返回带 hljs 类的 HTML
  function highlightCode(code, lang) {
    if (typeof hljs === 'undefined') return { html: escapeHtml(code), lang: null };
    try {
      if (lang && hljs.getLanguage(lang)) {
        const res = hljs.highlight(code, { language: lang, ignoreIllegal: true });
        return { html: res.value, lang: lang };
      }
      // 自动检测语言
      const res = hljs.highlightAuto(code);
      return { html: res.value, lang: res.language || null };
    } catch (e) {
      return { html: escapeHtml(code), lang: lang || null };
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function configureMarked() {
    const m = getMarked();
    m.setOptions({
      gfm: true,
      breaks: false,
      headerIds: false,
      mangle: false,
      smartLists: true,
      smartypants: false,
      silence: false
    });
  }

  // ====== 预处理：上下标、公式 ======
  // marked 默认不支持 Typora 的上下标语法（~ 和 ^）和公式语法（$ $$）
  // 在 marked 解析前，把这些语法替换为占位符，解析后再替换为 HTML 标签

  // 判断 $...$ 之间的内容是否“看起来像公式”，避免把货币金额（$5、$100）误当公式。
  // 规则：
  //   - 排除含表格列分隔符 |（避免跨列误匹配 $10|$50）
  //   - 排除含中文/全角标点（公式内部不会有中文）
  //   - 必须含至少一个“公式特征”：反斜杠命令 \、上下标 ^ _、关系/运算符 = + - * /
  //     （= + - 需其两侧有非空白字符，避免单个 = 被误判；这里简单起见只要有即可，
  //      因为金额如 $5、$3.5、$100 不会含这些符号）
  function isInlineFormula(content) {
    if (!content) return false;
    // 含表格列分隔或中文/全角符号 → 不是公式
    if (/[|]/.test(content)) return false;
    if (/[一-鿿　-〿＀-￯]/.test(content)) return false;
    // 含反斜杠命令（\frac \alpha 等）→ 公式
    if (/\\[a-zA-Z]/.test(content)) return true;
    // 含上下标 ^ 或 _ → 公式
    if (/[\^_]/.test(content)) return true;
    // 含关系/运算符 = + - * / 且这些是数学用法（前后有内容）→ 公式
    // 单独的 $5、$3.5、$100 不含这些符号
    if (/[=+\-*/]/.test(content)) return true;
    return false;
  }

  // 预处理：把上下标和公式替换为占位符（避免 marked 破坏它们）
  function preprocessMarkdown(md) {
    var placeholders = [];
    function save(html) {
      var key = '\x00PH' + placeholders.length + '\x00';
      placeholders.push(html);
      return key;
    }

    // 0. 脚注（先处理，避免 marked 把 [^id] 渲染为带 ^ 的难看链接）
    // Typora/WeWrite 的脚注显示为上标小徽章，公众号不支持跳转链接，
    // 所以把脚注引用替换为上标徽章，脚注内容收集到底部统一显示
    var footnotes = [];
    var footnoteOrder = [];
    // 0a. 提取脚注定义 [^id]: content
    md = md.replace(/^\[\^([^\]]+)\]:\s*(.+)$/gm, function (_, id, content) {
      footnotes[id] = content.trim();
      footnoteOrder.push(id);
      return ''; // 移除定义行（替换为空，后续清理空行）
    });
    // 0b. 替换脚注引用 [^id] 为上标徽章
    if (footnoteOrder.length > 0) {
      var refNum = {};
      var refCounter = 0;
      md = md.replace(/\[\^([^\]]+)\]/g, function (_, id) {
        if (footnotes[id] === undefined) return _; // 未定义的脚注，保留原文
        if (refNum[id] === undefined) {
          refCounter++;
          refNum[id] = refCounter;
        }
        var num = refNum[id];
        // 上标徽章样式：圆角小标签，带背景色，与主题一致
        var badge = '<sup style="display:inline-block;font-size:12px !important;font-weight:bold !important;color:#fff !important;background:#3498db !important;border-radius:4px !important;padding:1px 5px !important;margin:0 2px !important;line-height:1.4 !important;vertical-align:super !important;">' + num + '</sup>';
        return save(badge);
      });
      // 0c. 在文档末尾添加脚注列表
      // 用 markdown 的 --- 分隔线（由 marked 渲染为 <hr>，与正文分隔线一致，
      // 公众号对 <hr> 的支持比对自定义 <div> border 更可靠）
      var listHtml = '<section style="margin-top:0 !important;padding-top:0.5em !important;font-size:0.85em !important;color:#666 !important;">';
      for (var i = 0; i < footnoteOrder.length; i++) {
        var fid = footnoteOrder[i];
        var fnum = refNum[fid];
        if (fnum === undefined) continue; // 脚注定义了但未被引用，不显示
        listHtml += '<p style="margin:0.3em 0 !important;padding-left:1.5em !important;text-indent:-1.5em !important;"><span style="display:inline-block;font-size:11px !important;font-weight:bold !important;color:#fff !important;background:#3498db !important;border-radius:3px !important;padding:0 4px !important;margin-right:4px !important;">' + fnum + '</span>' + escapeHtml(footnotes[fid]) + '</p>';
      }
      listHtml += '</section>';
      // 先追加 --- 让 marked 渲染为 <hr>，再追加脚注列表占位符
      md = md + '\n\n---\n\n' + save(listHtml);
    }

    // 1. 块公式 $$...$$（先处理，避免被行内公式逻辑干扰）
    md = md.replace(/\$\$([\s\S]+?)\$\$/g, function (_, formula) {
      return save(renderBlockFormula(formula.trim()));
    });

    // 2. 行内公式 $...$
    //    原 /\$([^\$\n]+?)\$/ 会把任何 $...$ 当公式，导致表格里的价格 $10|$50、
    //    正文里的“$5 一个…$10”等被误匹配（$ 之间是货币金额甚至跨了表格列）。
    //    收紧：$ 之间的内容必须“看起来像公式”——含反斜杠命令或数学结构
    //    （^ _ = + - * / 及函数名），且不含 |（表格列分隔）和中文（公式里不会有中文）。
    //    这样 $5、$3.5、$100 等纯金额不会被吞，而 $E=mc^2$、$\alpha+\beta$ 仍正常。
    md = md.replace(/\$([^\$\n]+?)\$/g, function (_, formula) {
      if (!isInlineFormula(formula)) return _; // 不是公式，保留原文 $
      return save(renderInlineFormula(formula.trim()));
    });

    // 3. 下标 H~2~O（注意：要先于 marked 的删除线 ~~ 处理）
    //    只匹配 ~单词~ 模式，不匹配 ~~删除线~~
    md = md.replace(/~(?!~)(\w+)~/g, function (_, text) {
      return save('<sub>' + escapeHtml(text) + '</sub>');
    });

    // 4. 上标 2^10^
    md = md.replace(/\^(\w+)\^/g, function (_, text) {
      return save('<sup>' + escapeHtml(text) + '</sup>');
    });

    return { md: md, placeholders: placeholders };
  }

  // 后处理：把占位符替换回 HTML，并清理 marked 产生的多余包裹
  function postprocessHtml(html, placeholders) {
    for (var i = 0; i < placeholders.length; i++) {
      var ph = '\x00PH' + i + '\x00';
      var replacement = placeholders[i];
      // 如果占位符被 marked 包在 <p> 里（如 <p>\x00PH0\x00</p>），
      // 且替换内容本身是块级元素（以 <p 或 <div 开头），
      // 则去掉外层 <p> 避免嵌套产生多余空行
      if (replacement.charAt(0) === '<' && replacement.match(/^<(p|div|section|figure|blockquote|pre|h[1-6]|hr)/)) {
        // 去掉 <p>占位符</p> 的外层包裹
        html = html.replace('<p>' + ph + '</p>', replacement);
        // 也处理 <p> 占位符前后有空白的情况
        html = html.replace(/<p>\s*<\/p>/g, '');  // 清理空 p
      }
      // 普通替换（行内公式、上下标等，不产生嵌套）
      html = html.split(ph).join(replacement);
    }
    // 清理空段落（marked 可能产生空 <p></p>）
    html = html.replace(/<p>\s*<\/p>/g, '');
    return html;
  }

  // 公式字体栈：优先使用数学字体，回退到衬线体
  var FORMULA_FONT = "'Cambria Math','STIX Two Math','Latin Modern Math','Times New Roman',serif";

  // 渲染行内公式：把 LaTeX 转为简单 HTML（公众号不支持 MathJax/KaTeX）
  function renderInlineFormula(formula) {
    return '<span class="formula-inline" style="font-family:' + FORMULA_FONT + ' !important;font-style:italic;">' + latexToHtml(formula) + '</span>';
  }

  // 渲染块公式：居中显示，用 currentColor 画线以适配明暗主题
  function renderBlockFormula(formula) {
    return '<p class="formula-block" style="text-align:center !important;margin:1em 0 !important;font-family:' + FORMULA_FONT + ' !important;font-size:1.1em !important;line-height:2 !important;">' + latexToHtml(formula) + '</p>';
  }

  // LaTeX 数学符号 → Unicode 映射表（用 \b 词边界避免前缀冲突，如 \in 不会匹配 \int）
  var LATEX_SYMBOLS = {
    // 希腊字母小写
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ',
    rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
    phi: 'φ', varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
    // 希腊字母大写
    Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε', Zeta: 'Ζ',
    Eta: 'Η', Theta: 'Θ', Iota: 'Ι', Kappa: 'Κ', Lambda: 'Λ', Mu: 'Μ',
    Nu: 'Ν', Xi: 'Ξ', Omicron: 'Ο', Pi: 'Π', Rho: 'Ρ', Sigma: 'Σ',
    Tau: 'Τ', Upsilon: 'Υ', Phi: 'Φ', Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω',
    // 运算符
    times: '×', div: '÷', pm: '±', mp: '∓', cdot: '⋅', ast: '∗', star: '⋆',
    dagger: '†', ddagger: '‡', bullet: '•', circ: '∘',
    cdots: '⋯', ldots: '…', vdots: '⋮', ddots: '⋱', dots: '…',
    // 关系符
    neq: '≠', ne: '≠', leq: '≤', geq: '≥', le: '≤', ge: '≥',
    leqslant: '⩽', geqslant: '⩾', ll: '≪', gg: '≫', equiv: '≡',
    sim: '∼', simeq: '≃', cong: '≅', approx: '≈', propto: '∝', asymp: '≈',
    doteq: '≐', models: '⊧', vdash: '⊢', dashv: '⊣',
    // 大运算符
    sum: '∑', int: '∫', oint: '∮', iint: '∬', iiint: '∭', iiiint: '⨌',
    prod: '∏', coprod: '∐', bigcap: '⋂', bigcup: '⋃', bigvee: '⋁', bigwedge: '⋀',
    bigoplus: '⨁', bigotimes: '⨂', bigodot: '⨀', bigsqcup: '⨆',
    // 箭头
    rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
    leftrightarrow: '↔', Leftrightarrow: '⇔', to: '→', gets: '←',
    mapsto: '↦', uparrow: '↑', downarrow: '↓', Uparrow: '⇑', Downarrow: '⇓',
    updownarrow: '↕', Updownarrow: '⇕', nearrow: '↗', searrow: '↘',
    nwarrow: '↖', swarrow: '↙', rightrightarrows: '⇉', leftrightarrows: '⇇',
    hookrightarrow: '↪', hookleftarrow: '↩', rightleftharpoons: '⇌',
    leftrightharpoons: '⇋', rightsquigarrow: '⇝', leadsto: '⤳',
    // 集合论
    in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃',
    subseteq: '⊆', supseteq: '⊇', notsubset: '⊄', emptyset: '∅', varnothing: '∅',
    cup: '∪', cap: '∩', setminus: '∖', complement: '∁', mid: '∣', nmid: '∤',
    // 逻辑
    forall: '∀', exists: '∃', nexists: '∄', neg: '¬', lnot: '¬',
    land: '∧', lor: '∨', wedge: '∧', vee: '∨', therefore: '∴', because: '∵',
    // 微积分
    nabla: '∇', partial: '∂', infty: '∞', hbar: 'ℏ', ell: 'ℓ',
    Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', angle: '∠', perp: '⊥', parallel: '∥',
    nparallel: '∦', degree: '°', prime: '′', backprime: '‵',
    // 几何与杂项
    triangle: '△', triangleleft: '⊲', triangleright: '⊳', square: '□',
    blacksquare: '■', blacktriangle: '▲', diamond: '◇', diamondsuit: '♢',
    clubsuit: '♣', heartsuit: '♥', spadesuit: '♠',
    // 圈运算
    oplus: '⊕', ominus: '⊖', otimes: '⊗', odot: '⊙', oslash: '⊘',
    // 其他
    backslash: '∖', vert: '∣', Vert: '‖', lVert: '‖', rVert: '‖',
    lvert: '∣', rvert: '∣', wp: '℘', Bot: '⊥', top: '⊤'
  };

  // 构建符号匹配正则：用负向前瞻 (?![a-zA-Z]) 代替 \b 作为命令边界
  // 因为 \b 把下划线 _ 也当词字符，导致 \sum_、\int_ 等后接下标时匹配失败
  // LaTeX 命令名只含字母，遇到非字母字符（_、^、{、空格等）即结束
  var _symKeys = Object.keys(LATEX_SYMBOLS).sort(function (a, b) { return b.length - a.length; });
  var _symRegex = new RegExp('\\\\(' + _symKeys.join('|') + ')(?![a-zA-Z])', 'g');

  // 黑板粗体字母 \mathbb{R} → ℝ
  var BLACKBOARD = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', H: 'ℍ', O: '𝕆', P: 'ℙ',
    A: '𝔸', B: '𝔹', D: '𝔻', E: '𝔼', F: '𝔽', G: '𝔾', I: '𝕀', J: '𝕁', K: '𝕂',
    L: '𝕃', M: '𝕄', S: '𝕊', T: '𝕋', U: '𝕌', V: '𝕍', W: '𝕎', X: '𝕏', Y: '𝕐' };

  // LaTeX → HTML 转换（覆盖常见语法，用 Unicode 数学符号 + HTML 标签近似渲染）
  function latexToHtml(latex) {
    var s = escapeHtml(latex);

    // 1. 数学减号：LaTeX 数学模式中 - 是减号运算符，用 Unicode 减号 (U+2212)
    s = s.replace(/-/g, '−');

    // 2. 文本模式命令 \mathrm{} \mathbf{} \text{} 等——内容用正体显示
    s = s.replace(/\\mathrm\{([^}]*)\}/g, '<span style="font-style:normal;">$1</span>');
    s = s.replace(/\\mathbf\{([^}]*)\}/g, '<span style="font-style:normal;font-weight:bold;">$1</span>');
    s = s.replace(/\\mathit\{([^}]*)\}/g, '<span style="font-style:italic;">$1</span>');
    s = s.replace(/\\mathsf\{([^}]*)\}/g, '<span style="font-family:sans-serif;">$1</span>');
    s = s.replace(/\\mathnormal\{([^}]*)\}/g, '$1');
    s = s.replace(/\\text\{([^}]*)\}/g, '<span style="font-style:normal;">$1</span>');
    s = s.replace(/\\textbf\{([^}]*)\}/g, '<span style="font-style:normal;font-weight:bold;">$1</span>');
    s = s.replace(/\\operatorname\{([^}]*)\}/g, '<span style="font-style:normal;">$1</span>');
    s = s.replace(/\\mathcal\{([^}]*)\}/g, '<span style="font-style:italic;">$1</span>');
    s = s.replace(/\\mathbb\{([^}])\}/g, function (_, ch) { return BLACKBOARD[ch] || ch; });

    // 3. \left \right（自动尺寸定界符，仅移除命令保留定界符本身）
    s = s.replace(/\\left\b/g, '').replace(/\\right\b/g, '');

    // 4. 间距命令
    s = s.replace(/\\\\/g, '<br>');
    s = s.replace(/\\,/g, ' ');
    s = s.replace(/\\;/g, ' ');
    s = s.replace(/\\:/g, ' ');
    s = s.replace(/\\!/g, '');
    s = s.replace(/\\ /g, ' ');
    s = s.replace(/\\quad/g, '  ');
    s = s.replace(/\\qquad/g, '    ');

    // 5. n 次根 \sqrt[n]{x}（必须在 \sqrt{x} 之前处理）
    s = s.replace(/\\sqrt\[([^\]]+)\]\{([\s\S]+?)\}/g,
      '<span style="display:inline-block;vertical-align:middle;"><span style="display:inline-block;vertical-align:top;font-size:0.65em;position:relative;top:-0.3em;margin-right:-1px;">$1</span><span style="display:inline-block;vertical-align:top;margin-right:-1px;">√</span><span style="display:inline-block;border-top:1px solid currentColor !important;padding:0 2px;vertical-align:top;">$2</span></span>');

    // 6. 平方根 \sqrt{x}——用 border-top 画上方横线，currentColor 适配明暗主题
    s = s.replace(/\\sqrt\{([\s\S]+?)\}/g,
      '<span style="display:inline-block;vertical-align:middle;"><span style="display:inline-block;vertical-align:top;margin-right:-1px;">√</span><span style="display:inline-block;border-top:1px solid currentColor !important;padding:0 2px;vertical-align:top;">$1</span></span>');

    // 7. 分数 \frac{a}{b}——用 inline-table 布局，currentColor 画分数线适配明暗主题
    s = s.replace(/\\frac\{([\s\S]+?)\}\{([\s\S]+?)\}/g,
      '<span style="display:inline-table;vertical-align:middle;text-align:center;"><span style="display:table-row;"><span style="display:table-cell;padding:0 4px;border-bottom:1px solid currentColor !important;">$1</span></span><span style="display:table-row;"><span style="display:table-cell;padding:0 4px;">$2</span></span></span>');

    // 8. 二项式系数 \binom{n}{k}
    s = s.replace(/\\binom\{([^}]*)\}\{([^}]*)\}/g,
      '(<span style="display:inline-table;vertical-align:middle;text-align:center;"><span style="display:table-row;"><span style="display:table-cell;padding:0 3px;border-bottom:1px solid currentColor !important;">$1</span></span><span style="display:table-row;"><span style="display:table-cell;padding:0 3px;">$2</span></span></span>)');

    // 9. 上划线/下划线/向量/帽子
    s = s.replace(/\\overline\{([^}]+)\}/g, '<span style="text-decoration:overline;">$1</span>');
    s = s.replace(/\\underline\{([^}]+)\}/g, '<span style="text-decoration:underline;">$1</span>');
    s = s.replace(/\\bar\{([^}]+)\}/g, '<span style="text-decoration:overline;">$1</span>');
    s = s.replace(/\\vec\{([^}]+)\}/g, '<span style="display:inline-block;position:relative;">$1<span style="position:absolute;left:0;right:0;top:-0.35em;text-align:center;font-size:0.6em;pointer-events:none;">→</span></span>');
    s = s.replace(/\\hat\{([^}]+)\}/g, '<span style="display:inline-block;position:relative;">$1<span style="position:absolute;left:0;right:0;top:-0.45em;text-align:center;font-size:0.65em;pointer-events:none;">^</span></span>');

    // 10. 函数名（sin/cos/log/lim 等）用正体显示，不继承容器的斜体
    s = s.replace(/\\(sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|log|ln|exp|lim|min|max|inf|sup|det|dim|gcd|ker|deg|hom|arg|Pr)(?![a-zA-Z])/g,
      '<span style="font-style:normal;">$1</span>');

    // 10.5 大运算符（sum/prod/bigcap 等）的上下标：放在符号正上方和正下方
    // 必须在符号表替换之前处理，否则 _{} 和 ^{} 会被通用上下标消耗
    // 积分号（int/oint 等）的上下标放在右侧（标准数学排版行为）
    var BIG_OPS_LIST = ['sum', 'prod', 'coprod', 'bigcap', 'bigcup', 'bigvee', 'bigwedge',
                        'bigoplus', 'bigotimes', 'bigodot', 'bigsqcup'];
    var INT_OPS_LIST = ['iiiint', 'iiint', 'iint', 'oint', 'int'];

    function makeBigOpHtml(symbol, lower, upper) {
      var html = '<span style="display:inline-table;vertical-align:middle;text-align:center;line-height:1;">';
      if (upper) html += '<span style="display:table-row;"><span style="display:table-cell;font-size:0.6em;line-height:1.3;padding:0 3px;">' + upper + '</span></span>';
      html += '<span style="display:table-row;"><span style="display:table-cell;font-size:1.8em;line-height:1;">' + symbol + '</span></span>';
      if (lower) html += '<span style="display:table-row;"><span style="display:table-cell;font-size:0.6em;line-height:1.3;padding:0 3px;">' + lower + '</span></span>';
      html += '</span>';
      return html;
    }

    function makeIntOpHtml(symbol, lower, upper) {
      var html = '<span style="display:inline-block;vertical-align:middle;"><span style="font-size:1.6em;font-style:normal;">' + symbol + '</span>';
      if (upper || lower) {
        html += '<span style="display:inline-table;vertical-align:middle;text-align:left;line-height:1;margin-left:-2px;">';
        if (upper) html += '<span style="display:table-row;"><span style="display:table-cell;font-size:0.6em;line-height:1.2;">' + upper + '</span></span>';
        if (lower) html += '<span style="display:table-row;"><span style="display:table-cell;font-size:0.6em;line-height:1.2;">' + lower + '</span></span>';
        html += '</span>';
      }
      html += '</span>';
      return html;
    }

    // 大运算符：匹配 \sum_{...}^{...} 或 \sum^{...}_{...} 或 \sum_{...} 或 \sum^{...}
    var bigOpsAlt = BIG_OPS_LIST.join('|');
    // 先处理 _{...}^{...} 或 _{...}（下标在前的情况）
    s = s.replace(
      new RegExp('\\\\(' + bigOpsAlt + ')_\\{([^}]*)\\}(\\^\\{([^}]*)\\})?', 'g'),
      function(_, op, lower, _u, upper) { return makeBigOpHtml(LATEX_SYMBOLS[op], lower, upper || ''); }
    );
    // 再处理 ^{...}_{...} 或 ^{...}（上标在前的情况，未被上面匹配的）
    s = s.replace(
      new RegExp('\\\\(' + bigOpsAlt + ')\\^\\{([^}]*)\\}(_\\{([^}]*)\\})?', 'g'),
      function(_, op, upper, _l, lower) { return makeBigOpHtml(LATEX_SYMBOLS[op], lower || '', upper); }
    );

    // 积分号：上下标放在右侧
    // 支持花括号版 \int_{0}^{∞} 和单字符版 \int_0^x
    var intOpsAlt = INT_OPS_LIST.join('|');
    // 先处理 _{...}^{...} 或 _{...} 或 _c^{...} 或 _c（c=单字符）
    s = s.replace(
      new RegExp('\\\\(' + intOpsAlt + ')(?:_(?:\\{([^}]*)\\}|([a-zA-Z0-9])))(?:\\^(?:\\{([^}]*)\\}|([a-zA-Z0-9])))?', 'g'),
      function(_, op, lowerBr, lowerChar, upperBr, upperChar) {
        var lower = lowerBr !== undefined ? lowerBr : (lowerChar || '');
        var upper = upperBr !== undefined ? upperBr : (upperChar || '');
        return makeIntOpHtml(LATEX_SYMBOLS[op], lower, upper);
      }
    );
    // 再处理 ^{...}_{...} 或 ^{...} 或 ^c_{...} 或 ^c（上标在前的情况）
    s = s.replace(
      new RegExp('\\\\(' + intOpsAlt + ')(?:\\^(?:\\{([^}]*)\\}|([a-zA-Z0-9])))(?:_(?:\\{([^}]*)\\}|([a-zA-Z0-9])))?', 'g'),
      function(_, op, upperBr, upperChar, lowerBr, lowerChar) {
        var lower = lowerBr !== undefined ? lowerBr : (lowerChar || '');
        var upper = upperBr !== undefined ? upperBr : (upperChar || '');
        return makeIntOpHtml(LATEX_SYMBOLS[op], lower, upper);
      }
    );

    // 11. 用符号表批量替换希腊字母和数学符号
    s = s.replace(_symRegex, function (_, name) { return LATEX_SYMBOLS[name]; });

    // 12. 上下标（先处理花括号版，再处理单字符版）
    s = s.replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>');
    s = s.replace(/\^([a-zA-Z0-9+\u2212])/g, '<sup>$1</sup>');
    s = s.replace(/_\{([^}]+)\}/g, '<sub>$1</sub>');
    s = s.replace(/_([a-zA-Z0-9])/g, '<sub>$1</sub>');

    // 13. 清理剩余的反斜杠命令（未识别的命令去掉反斜杠，保留名称作为纯文本）
    s = s.replace(/\\([a-zA-Z]+)/g, '$1');
    s = s.replace(/\\/g, '');
    return s;
  }

  // 自定义 renderer：让输出结构贴合 wewrite 主题
  function buildRenderer() {
    const m = getMarked();
    const Renderer = m.Renderer || m.renderer.constructor;
    const renderer = new Renderer();

    // 主题 ul ::marker 的 7 色循环（#write ul>li:nth-child(7n+N)::marker）
    const UL_MARKER_COLORS = ['#e74c3c', '#f39c12', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6'];

    // 标题：h2-h6 内容包裹 <span>，匹配用户主题的 `#write h2 span { background: #FFCBA4 }`
    const origHeading = renderer.heading.bind(renderer);
    renderer.heading = function (text, level, raw, slug) {
      if (level >= 2) {
        return '<h' + level + '><span>' + text + '</span></h' + level + '>\n';
      }
      return origHeading(text, level, raw, slug);
    };

    // 代码块：包装为 <pre class="md-fences">
    renderer.code = function (code, infostring, escaped) {
      const lang = (infostring || '').trim().split(/\s+/)[0] || '';
      const { html: highlighted, lang: detected } = highlightCode(code, lang);
      const langClass = (detected || lang) ? ' language-' + escapeHtml(detected || lang) : '';
      return '<pre class="md-fences"><code class="hljs' + langClass + '">' + highlighted + '</code></pre>\n';
    };

    // 表格：外面包 figure.table-figure
    const origTable = renderer.table.bind(renderer);
    renderer.table = function (header, body) {
      const tableHtml = origTable(header, body);
      return '<figure class="table-figure" style="margin:0 !important;">' + tableHtml + '</figure>\n';
    };

    // 列表项：任务列表去掉 checkbox input（在 list 里统一用符号代替）
    const origListitem = renderer.listitem.bind(renderer);
    renderer.listitem = function (text, task, checked) {
      if (task) {
        // 去掉 marked 生成的 <input> checkbox，只保留文字
        var cleanText = text.replace(/<input[^>]*>/gi, '').trim();
        return '<li class="task-item" data-checked="' + (checked ? '1' : '0') + '">' + cleanText + '</li>\n';
      }
      return origListitem(text, task, checked);
    };

    // 列表：用 section + p 代替 ul + li
    // 原因：公众号对 <ul>/<li> 有自己的样式处理，display:list-item 会导致
    // 内部 span 圆点和文字换行。改用 section+p 完全绕开列表布局
    const origList = renderer.list.bind(renderer);
    renderer.list = function (body, ordered, start) {
      var tmp = document.createElement('div');
      tmp.innerHTML = '<ul>' + body + '</ul>';
      var lis = tmp.querySelectorAll(':scope > ul > li');
      var items = [];

      // 辅助函数：把 li 的内容分成文本部分和嵌套块级元素部分
      // 嵌套列表（section）、表格（figure）等块元素不能放在 <p> 内（无效 HTML），
      // 浏览器会自动关闭 <p> 产生空 <p> 标签，微信会把空 <p> 渲染成空行
      // 注意：marked 对“宽松列表”会把每个 li 的内容包在 <p> 里（<li><p>...</p></li>），
      // 此时要把 <p> 的内部内容展开为文本部分，而不是把整个 <p> 当文本塞进去——
      // 后者会让输出变成 <p>●</p><p>文字</p>，圆点和文字被拆成两行
      function splitLiContent(li) {
        var textParts = [];
        var blockParts = [];
        var childNodes = li.childNodes;
        for (var k = 0; k < childNodes.length; k++) {
          var node = childNodes[k];
          if (node.nodeType === 1 && /^(SECTION|FIGURE|PRE|TABLE|BLOCKQUOTE|DIV|UL|OL)$/i.test(node.tagName)) {
            blockParts.push(node.outerHTML);
          } else if (node.nodeType === 1 && node.tagName === 'P') {
            // 宽松列表项的包裹 <p>：展开其内部内容到 textParts
            textParts.push(node.innerHTML);
          } else {
            if (node.nodeType === 1) {
              textParts.push(node.outerHTML);
            } else if (node.nodeType === 3) {
              textParts.push(node.textContent);
            }
          }
        }
        return { text: textParts.join(''), blocks: blockParts.join('') };
      }

      if (!ordered) {
        // 无序列表
        var colorIdx = 0;
        for (var i = 0; i < lis.length; i++) {
          var li = lis[i];
          var isTask = li.className.indexOf('task-item') >= 0;
          var parts = splitLiContent(li);
          if (isTask) {
            // 任务列表：用 ☑/☐ 符号
            var checked = li.getAttribute('data-checked') === '1';
            var symbol = checked ? '☑' : '☐';
            items.push('<p style="margin:9px 0 0 0 !important;"><span style="margin-right:6px;">' + symbol + '</span>' + parts.text + '</p>' + parts.blocks);
          } else {
            var color = UL_MARKER_COLORS[colorIdx % 7];
            colorIdx++;
            items.push('<p style="margin:9px 0 0 0 !important;"><span style="color:' + color + ' !important;margin-right:6px;">●</span>' + parts.text + '</p>' + parts.blocks);
          }
        }
        return '<section style="padding-left:1.5em !important;margin-top:0 !important;margin-bottom:0 !important;">' + items.join('') + '</section>\n';
      } else {
        // 有序列表
        var num = parseInt(start, 10) || 1;
        for (var j = 0; j < lis.length; j++) {
          var parts = splitLiContent(lis[j]);
          items.push('<p style="margin:9px 0 0 0 !important;"><span style="margin-right:6px;">' + (num + j) + '.</span>' + parts.text + '</p>' + parts.blocks);
        }
        return '<section style="padding-left:1.5em !important;margin-top:0 !important;margin-bottom:0 !important;">' + items.join('') + '</section>\n';
      }
    };

    // 链接
    renderer.link = function (href, title, text) {
      const t = title ? ' title="' + escapeHtml(title) + '"' : '';
      const safeHref = href || '#';
      return '<a href="' + escapeHtml(safeHref) + '"' + t + '>' + text + '</a>';
    };

    // 行内格式：用 <span md-inline=...> 包裹 strong/em/codespan，
    // 与 Typora 导出结构一致。原因：wewrite 主题有多条规则形如
    //   .typora-export #write>p>strong:only-child { display:block; ... }
    // CSS 的 :only-child 只看“是否有兄弟元素”，忽略文本节点。
    // 若直接输出裸 <strong>，则“排名**第2**（…）”这种“段落里唯一元素是 strong、
    // 前后都是纯文本”的情况会被误判为 only-child，从而 display:block，把加粗
    // 强制独占一行，造成意外换行。Typora 里 strong 永远包在 <span md-inline=strong>
    // 中，不再是 <p> 的直接子元素，这些规则不会触发。这里复刻该结构。
    renderer.strong = function (text) {
      return '<span md-inline="strong"><strong>' + text + '</strong></span>';
    };
    renderer.em = function (text) {
      return '<span md-inline="em"><em>' + text + '</em></span>';
    };
    renderer.codespan = function (code) {
      return '<span md-inline="code"><code>' + code + '</code></span>';
    };
    renderer.del = function (text) {
      return '<span md-inline="del"><del>' + text + '</del></span>';
    };

    return renderer;
  }

  // 解析 Markdown → HTML 字符串（已套用 wewrite 结构）
  function parse(mdText) {
    const m = getMarked();
    configureMarked();
    const renderer = buildRenderer();

    // 预处理：上下标、公式（在 marked 解析前替换为占位符）
    var pp = preprocessMarkdown(mdText || '');

    let html;
    try {
      html = m.parse(pp.md, { renderer: renderer, async: false });
    } catch (e) {
      html = '<p style="color:#c00">Markdown 解析错误：' + escapeHtml(e.message) + '</p>';
    }

    // 后处理：把占位符替换回 HTML
    html = postprocessHtml(html, pp.placeholders);

    // 图片居中：把直接出现在 #write 下（未被 <p> 包裹）的裸 <img> 用居中的 <p> 包裹
    // marked 对行内 HTML 的 <img> 不自动包 <p>，导致图片成为 #write 直接子元素
    // 手机端微信对 margin:auto 居中不可靠，用 text-align:center 的容器包裹最通用
    html = html.replace(/(^|>|\n)(<img\b[^>]*>)(?!\s*<\/p>)/gi, function (match, prefix, imgTag) {
      // 只包裹未被 <p> 包含的 img（后面不是 </p>）
      return prefix + '<p style="text-align:center !important;margin:0.5em 0 !important;">' + imgTag + '</p>';
    });

    // 用 DOMPurify 清理
    if (typeof DOMPurify !== 'undefined') {
      html = DOMPurify.sanitize(html, {
        ADD_ATTR: ['target', 'title', 'lang', 'language', 'class', 'style', 'md-inline'],
        ADD_TAGS: ['sub', 'sup', 'span'],
        FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
        FORBID_ATTR: ['id', 'contenteditable', 'onload', 'onerror', 'onclick'],
        ALLOW_DATA_ATTR: false
      });
    }
    return html;
  }

  global.WmpMarkdown = {
    parse: parse,
    configureMarked: configureMarked,
    escapeHtml: escapeHtml
  };

})(window);
