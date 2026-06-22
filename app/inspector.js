/* ================================================================
   inspector.js —— 预览区点击微调面板（升级版）
   - 点击预览元素 → 识别类型 → 右侧滑出属性面板
   - 点击预览空白处或按 Esc → 取消选定，关闭面板
   - 面板顶部有「仅此项 / 所有同类」切换开关
   - 表格点击表头/单元格时，可选「整列对齐」
   - 修改属性 → 实时更新预览
   ================================================================ */

(function () {
  'use strict';

  let _iframe = null;
  let _iframeDoc = null;
  let _iframeWin = null;
  let _panel = null;
  let _panelBody = null;
  let _panelTitle = null;
  let _closeBtn = null;
  let _currentEl = null;
  let _currentType = null;
  let _origStyles = {};
  let _applyMode = 'single';  // 'single' | 'all' — 仅此项 / 所有同类
  let _highlightedEls = [];   // 所有被高亮的元素（取消时恢复）

  // ====== 持久化：样式覆盖表 ======
  // key = 元素路径（如 "3" 表示 #write 的第4个子元素，"5>table>2>1" 表示嵌套路径）
  // value = { "prop-name": "value !important", ... }
  let _styleOverrides = {};

  // ---- 属性定义（同上一版，保持不变） ----
  const PROPERTY_DEFS = {
    text: [
      { key: 'color', label: '文字颜色', type: 'color' },
      { key: 'font-size', label: '字号', type: 'range', min: 10, max: 40, step: 1, unit: 'px' },
      { key: 'font-weight', label: '字重', type: 'select', options: [
        { v: '300', l: '细体 300' }, { v: '400', l: '常规 400' }, { v: '500', l: '中等 500' },
        { v: '600', l: '半粗 600' }, { v: '700', l: '粗体 700' }, { v: '800', l: '特粗 800' }
      ]},
      { key: 'font-style', label: '字体样式', type: 'select', options: [
        { v: 'normal', l: '正常' }, { v: 'italic', l: '斜体' }
      ]},
      { key: 'line-height', label: '行高', type: 'range', min: 1, max: 3, step: 0.1, unit: '' },
      { key: 'letter-spacing', label: '字间距', type: 'range', min: -2, max: 10, step: 0.5, unit: 'px' },
      { key: 'text-align', label: '对齐', type: 'select', options: [
        { v: 'left', l: '左对齐' }, { v: 'center', l: '居中' }, { v: 'right', l: '右对齐' }, { v: 'justify', l: '两端对齐' }
      ]},
      { key: 'text-decoration', label: '装饰线', type: 'select', options: [
        { v: 'none', l: '无' }, { v: 'underline', l: '下划线' }, { v: 'line-through', l: '删除线' }, { v: 'overline', l: '上划线' }
      ]},
      { key: 'text-indent', label: '首行缩进', type: 'range', min: 0, max: 60, step: 2, unit: 'px' },
    ],
    box: [
      { key: 'background-color', label: '背景颜色', type: 'color' },
      { key: 'margin-top', label: '上外边距', type: 'range', min: 0, max: 80, step: 1, unit: 'px' },
      { key: 'margin-bottom', label: '下外边距', type: 'range', min: 0, max: 80, step: 1, unit: 'px' },
      { key: 'padding-top', label: '上内边距', type: 'range', min: 0, max: 40, step: 1, unit: 'px' },
      { key: 'padding-bottom', label: '下内边距', type: 'range', min: 0, max: 40, step: 1, unit: 'px' },
      { key: 'padding-left', label: '左内边距', type: 'range', min: 0, max: 60, step: 1, unit: 'px' },
      { key: 'padding-right', label: '右内边距', type: 'range', min: 0, max: 60, step: 1, unit: 'px' },
      { key: 'border-radius', label: '圆角', type: 'range', min: 0, max: 30, step: 1, unit: 'px' },
      { key: 'opacity', label: '透明度', type: 'range', min: 0.1, max: 1, step: 0.05, unit: '' },
    ],
    border: [
      { key: 'border-top-width', label: '上边框宽度', type: 'range', min: 0, max: 10, step: 1, unit: 'px' },
      { key: 'border-bottom-width', label: '下边框宽度', type: 'range', min: 0, max: 10, step: 1, unit: 'px' },
      { key: 'border-left-width', label: '左边框宽度', type: 'range', min: 0, max: 20, step: 1, unit: 'px' },
      { key: 'border-top-color', label: '上边框颜色', type: 'color' },
      { key: 'border-bottom-color', label: '下边框颜色', type: 'color' },
      { key: 'border-left-color', label: '左边框颜色', type: 'color' },
      { key: 'border-left-style', label: '左边框样式', type: 'select', options: [
        { v: 'none', l: '无' }, { v: 'solid', l: '实线' }, { v: 'dashed', l: '虚线' }, { v: 'dotted', l: '点线' }, { v: 'double', l: '双线' }
      ]},
    ],
    table: [
      { key: 'border-collapse', label: '边框合并', type: 'select', options: [
        { v: 'collapse', l: '合并' }, { v: 'separate', l: '分离' }
      ]},
      { key: 'background-color', label: '背景颜色', type: 'color' },
      { key: 'border-bottom-width', label: '下边框宽度', type: 'range', min: 0, max: 6, step: 1, unit: 'px' },
      { key: 'border-bottom-color', label: '下边框颜色', type: 'color' },
      { key: 'width', label: '表格宽度', type: 'select', options: [
        { v: '100%', l: '撑满' }, { v: 'auto', l: '自适应' }
      ]},
    ],
    tableColumn: [
      { key: 'text-align', label: '本列对齐', type: 'select', options: [
        { v: 'left', l: '左对齐' }, { v: 'center', l: '居中' }, { v: 'right', l: '右对齐' }
      ]},
      { key: 'width', label: '本列宽度', type: 'select', options: [
        { v: 'auto', l: '自适应' }, { v: '20%', l: '20%' }, { v: '30%', l: '30%' }, { v: '40%', l: '40%' }, { v: '50%', l: '50%' }
      ]},
      { key: 'color', label: '本列文字颜色', type: 'color' },
      { key: 'background-color', label: '本列背景颜色', type: 'color' },
    ],
    image: [
      { key: 'width', label: '宽度', type: 'select', options: [
        { v: '100%', l: '撑满' }, { v: '50%', l: '50%' }, { v: '75%', l: '75%' }, { v: 'auto', l: '原始大小' }
      ]},
      { key: 'border-radius', label: '圆角', type: 'range', min: 0, max: 30, step: 1, unit: 'px' },
      { key: 'margin-top', label: '上外边距', type: 'range', min: 0, max: 60, step: 1, unit: 'px' },
      { key: 'margin-bottom', label: '下外边距', type: 'range', min: 0, max: 60, step: 1, unit: 'px' },
      { key: 'text-align', label: '对齐(父容器)', type: 'select', options: [
        { v: 'left', l: '左对齐' }, { v: 'center', l: '居中' }, { v: 'right', l: '右对齐' }
      ]},
    ],
  };

  const TYPE_GROUPS = {
    h1: { title: '一级标题', groups: ['text', 'box', 'border'] },
    h2: { title: '二级标题', groups: ['text', 'box'] },
    h3: { title: '三级标题', groups: ['text', 'box'] },
    h4: { title: '四级标题', groups: ['text', 'box'] },
    h5: { title: '五级标题', groups: ['text', 'box'] },
    h6: { title: '六级标题', groups: ['text', 'box'] },
    p: { title: '段落', groups: ['text', 'box'] },
    blockquote: { title: '引用块', groups: ['text', 'box', 'border'] },
    pre: { title: '代码块', groups: ['text', 'box', 'border'] },
    code: { title: '行内代码', groups: ['text', 'box', 'border'] },
    table: { title: '表格', groups: ['table', 'box'] },
    th: { title: '表头单元格', groups: ['text', 'box', 'border', 'tableColumn'] },
    td: { title: '表格单元格', groups: ['text', 'box', 'border', 'tableColumn'] },
    section: { title: '列表', groups: ['text', 'box'] },
    a: { title: '链接', groups: ['text'] },
    strong: { title: '加粗', groups: ['text'] },
    em: { title: '斜体', groups: ['text'] },
    img: { title: '图片', groups: ['image', 'box'] },
    hr: { title: '分隔线', groups: ['box'] },
    kbd: { title: '键盘符号', groups: ['text', 'box', 'border'] },
    'formula-block': { title: '块公式', groups: ['text', 'box'] },
    'formula-inline': { title: '行内公式', groups: ['text'] },
    default: { title: '元素', groups: ['text', 'box'] },
  };

  const GROUP_LABELS = {
    text: '文字与排版',
    box: '盒模型与背景',
    border: '边框',
    table: '表格属性',
    tableColumn: '表格列属性（整列生效）',
    image: '图片属性'
  };

  // ---- 初始化 ----
  function init(iframe) {
    _iframe = iframe;
    _panel = document.getElementById('inspectorPanel');
    _panelBody = document.getElementById('inspectorBody');
    _panelTitle = document.getElementById('inspectorTitle');
    _closeBtn = document.getElementById('inspectorClose');

    if (!_panel || !_iframe) return false;

    function tryBind() {
      _iframeDoc = _iframe.contentDocument;
      _iframeWin = _iframe.contentWindow;
      if (!_iframeDoc || !_iframeDoc.body) {
        setTimeout(tryBind, 200);
        return;
      }
      _iframeDoc.addEventListener('click', onPreviewClick, true);
      _closeBtn.addEventListener('click', closePanel);
    }
    tryBind();
    return true;
  }

  // ---- 工具函数 ----
  function detectType(el) {
    // 公式元素优先按 class 识别（formula-block / formula-inline）
    if (el.classList) {
      if (el.classList.contains('formula-block')) return 'formula-block';
      if (el.classList.contains('formula-inline')) return 'formula-inline';
    }
    var tag = el.tagName.toLowerCase();
    if (TYPE_GROUPS[tag]) return tag;
    return 'default';
  }

  function getComputedVal(el, prop) {
    if (!_iframeWin) return '';
    return _iframeWin.getComputedStyle(el).getPropertyValue(prop) || '';
  }

  function parseNum(val) {
    var m = String(val).match(/^-?[\d.]+/);
    return m ? parseFloat(m[0]) : 0;
  }

  function parseColor(val) {
    val = String(val).trim();
    var m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      var r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
      var a = val.match(/,\s*([\d.]+)\s*\)/);
      var alpha = a ? parseFloat(a[1]) : 1;
      if (alpha < 1) {
        r = Math.round(r * alpha + 255 * (1 - alpha));
        g = Math.round(g * alpha + 255 * (1 - alpha));
        b = Math.round(b * alpha + 255 * (1 - alpha));
      }
      return '#' + [r, g, b].map(function (x) {
        var s = x.toString(16);
        return s.length < 2 ? '0' + s : s;
      }).join('');
    }
    if (val.charAt(0) === '#') return val;
    return '#000000';
  }

  // 获取所有同类元素（用于"所有同类"模式）
  // 关键：按"区块上下文"分组，普通段落、列表项、引用内段落等互不算同类
  function getSimilarElements(el, type) {
    if (!_iframeDoc) return [el];
    var write = _iframeDoc.getElementById('write');
    if (!write) return [el];

    // 0. 公式元素：按 formula-block / formula-inline 分别归类，不与普通段落/span 混合
    if (type === 'formula-block') {
      return Array.prototype.slice.call(write.querySelectorAll('.formula-block'));
    }
    if (type === 'formula-inline') {
      return Array.prototype.slice.call(write.querySelectorAll('.formula-inline'));
    }

    var tag = el.tagName.toLowerCase();

    // 1. 列表项（section 内的 p）：同类 = 同一 section 内所有 p（不含其他 section）
    if (tag === 'p' && el.parentElement && el.parentElement.tagName === 'SECTION') {
      return Array.prototype.slice.call(el.parentElement.querySelectorAll('p'));
    }

    // 2. th/td 同类 = 同列的所有 th+td
    if (type === 'th' || type === 'td') {
      return getColumnCells(el);
    }

    // 3. code：区分"行内 code"和"代码块内的 code"
    if (tag === 'code') {
      var inPre = el.parentElement && el.parentElement.tagName === 'PRE';
      var allCode = write.querySelectorAll('code');
      var result = [];
      for (var i = 0; i < allCode.length; i++) {
        var c = allCode[i];
        var cInPre = c.parentElement && c.parentElement.tagName === 'PRE';
        if (cInPre === inPre) result.push(c); // 同类型才归为一组
      }
      return result;
    }

    // 4. p（普通段落）：只选 #write 直接子级 p，排除公式块（formula-block）
    //    引用块内 p 在分支 5 处理，不在这里
    if (tag === 'p' && el.parentElement === write) {
      var allP = write.querySelectorAll('p');
      var normalP = [];
      for (var j = 0; j < allP.length; j++) {
        var pp = allP[j];
        if (pp.parentElement === write && !pp.classList.contains('formula-block')) normalP.push(pp);
      }
      return normalP;
    }

    // 5. 引用块内的 p：同类 = 同一 blockquote 内所有 p（排除公式块）
    if (tag === 'p' && el.parentElement && el.parentElement.tagName === 'BLOCKQUOTE') {
      var bqP = el.parentElement.querySelectorAll('p');
      var bqResult = [];
      for (var bi = 0; bi < bqP.length; bi++) {
        if (!bqP[bi].classList.contains('formula-block')) bqResult.push(bqP[bi]);
      }
      return bqResult;
    }

    // 6. span：按父元素类型区分（列表圆点 span vs 标题 span vs 公式内 span vs 其他）
    if (tag === 'span') {
      var parentTag = el.parentElement ? el.parentElement.tagName : '';
      // 标题内的 span（h2-h6 的 span）
      if (parentTag.match(/^H[2-6]$/)) {
        var headingSpans = [];
        var headings = write.querySelectorAll(parentTag);
        for (var k = 0; k < headings.length; k++) {
          var s = headings[k].querySelector('span');
          if (s) headingSpans.push(s);
        }
        return headingSpans;
      }
      // 默认：同父元素下的 span（排除公式内 span——公式 span 由 formula-inline 统一管理）
      if (el.parentElement) {
        var sibs = el.parentElement.querySelectorAll(':scope > span');
        var sibsFiltered = [];
        for (var si = 0; si < sibs.length; si++) {
          if (!sibs[si].classList.contains('formula-inline')) sibsFiltered.push(sibs[si]);
        }
        return sibsFiltered.length > 0 ? sibsFiltered : [el];
      }
    }

    // 7. 通用 fallback：同标签 + 同"区块上下文"
    // 检查元素是否在特定容器内，只选相同容器的同标签元素
    var context = getBlockContext(el);
    var allSameTag = write.querySelectorAll(tag);
    var filtered = [];
    for (var m = 0; m < allSameTag.length; m++) {
      if (getBlockContext(allSameTag[m]) === context) filtered.push(allSameTag[m]);
    }
    return filtered.length > 0 ? filtered : [el];
  }

  // 判断元素的"区块上下文"——用于区分同类
  // 返回一个字符串标识，相同标识才算同类
  function getBlockContext(el) {
    var p = el.parentElement;
    if (!p) return 'root';
    // 向上遍历到 #write 下的直接子级，记录路径
    var write = _iframeDoc ? _iframeDoc.getElementById('write') : null;
    if (!write) return 'root';
    if (p === write) return 'write-direct';  // #write 直接子级（普通段落/标题等）
    // 找到 #write 的直接子级祖先
    var cur = p;
    while (cur && cur.parentElement !== write) cur = cur.parentElement;
    if (!cur) return 'root';
    // 用祖先标签 + 当前父标签 作为上下文标识
    return cur.tagName + '>' + (el.parentElement.tagName || '');
  }

  // 获取表格中某单元格所在列的所有单元格（th + td）
  function getColumnCells(el) {
    var tr = el.parentElement;
    if (!tr) return [el];
    var table = tr.parentElement;
    while (table && table.tagName !== 'TABLE') table = table.parentElement;
    if (!table) return [el];

    // 用 cellIndex 直接获取列索引（浏览器原生属性，自动计算 colspan）
    var colIndex = el.cellIndex;
    if (colIndex < 0) return [el];

    // 遍历所有行，取每行对应列的单元格
    var result = [];
    var rows = table.querySelectorAll('tr');
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].children;
      if (colIndex < cells.length) {
        result.push(cells[colIndex]);
      }
    }
    return result;
  }

  // ---- 点击处理 ----
  function onPreviewClick(e) {
    // 点击空白处（#write 或 body）取消选定
    var target = e.target;
    if (target.id === 'write' || target.tagName === 'BODY' || target.tagName === 'HTML' ||
        target.className === 'wmp-preview' || target.tagName === 'CONTENT') {
      e.preventDefault();
      e.stopPropagation();
      closePanel();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    var el = target;

    // 公式元素：点击公式内部的任何子节点 → 选中整个公式
    // formula-block 是 <p>，formula-inline 是 <span>，内部有分数/根号等嵌套 span
    var formulaAncestor = el.closest ? el.closest('.formula-block, .formula-inline') : null;
    if (formulaAncestor) {
      selectElement(formulaAncestor);
      return;
    }

    // span 在 section > p 内 → 选中 p（列表项）
    if (el.tagName === 'SPAN' && el.parentElement && el.parentElement.tagName === 'P' &&
        el.parentElement.parentElement && el.parentElement.parentElement.tagName === 'SECTION') {
      el = el.parentElement;
    }
    // code 在 pre 内 → 选中 pre
    if (el.tagName === 'CODE' && el.parentElement && el.parentElement.tagName === 'PRE') {
      el = el.parentElement;
    }
    // text 节点在 th/td 内 → 选中 th/td
    if (el.parentElement && (el.parentElement.tagName === 'TH' || el.parentElement.tagName === 'TD') &&
        el.tagName !== 'TH' && el.tagName !== 'TD') {
      el = el.parentElement;
    }

    selectElement(el);
  }

  // ---- 选中元素 ----
  function selectElement(el) {
    // 取消之前的高亮
    clearHighlights();

    _currentEl = el;
    _currentType = detectType(el);
    var def = TYPE_GROUPS[_currentType] || TYPE_GROUPS['default'];

    // 重置应用模式为"仅此项"
    _applyMode = 'single';

    // 记录所有同类元素的原始 style（用于重置）
    _origStyles = {};
    var allEls = getSimilarElements(el, _currentType);
    _origStyles.all = allEls.map(function (e) { return { el: e, style: e.getAttribute('style') || '' }; });

    _panelTitle.textContent = def.title + ' 微调';

    // 高亮选中元素
    highlightElements([el]);

    // 构建面板（含模式切换开关）
    buildPanel(el, def, allEls);

    _panel.classList.add('open');
    document.body.classList.add('inspector-open');
  }

  // ---- 高亮管理 ----
  function highlightElements(els) {
    clearHighlights();
    els.forEach(function (el) {
      el.style.outline = '2px dashed #36a3d9';
      el.style.outlineOffset = '2px';
      _highlightedEls.push(el);
    });
  }

  function clearHighlights() {
    _highlightedEls.forEach(function (el) {
      el.style.outline = '';
      el.style.outlineOffset = '';
    });
    _highlightedEls = [];
  }

  // ---- 构建面板 ----
  function buildPanel(el, def, allEls) {
    _panelBody.innerHTML = '';

    // 模式切换开关：仅此项 / 所有同类
    var modeDiv = document.createElement('div');
    modeDiv.className = 'insp-mode-bar';

    var singleBtn = document.createElement('button');
    singleBtn.type = 'button';
    singleBtn.className = 'insp-mode-btn active';
    singleBtn.textContent = '仅此项';
    singleBtn.addEventListener('click', function () {
      _applyMode = 'single';
      singleBtn.classList.add('active');
      allBtn.classList.remove('active');
      highlightElements([el]);
    });

    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'insp-mode-btn';
    allBtn.textContent = '所有同类（' + allEls.length + '项）';
    allBtn.addEventListener('click', function () {
      _applyMode = 'all';
      allBtn.classList.add('active');
      singleBtn.classList.remove('active');
      highlightElements(allEls);
    });

    modeDiv.appendChild(singleBtn);
    modeDiv.appendChild(allBtn);
    _panelBody.appendChild(modeDiv);

    // 属性组
    var seenProps = {};
    def.groups.forEach(function (groupKey) {
      var props = PROPERTY_DEFS[groupKey];
      if (!props) return;

      var groupDiv = document.createElement('div');
      groupDiv.className = 'insp-group';

      var groupLabel = document.createElement('div');
      groupLabel.className = 'insp-group-label';
      groupLabel.textContent = GROUP_LABELS[groupKey] || groupKey;
      groupDiv.appendChild(groupLabel);

      props.forEach(function (propDef) {
        // tableColumn 组的属性独立去重（不和 text/box 组冲突）
        var dedupKey = groupKey === 'tableColumn' ? 'col:' + propDef.key : propDef.key;
        if (seenProps[dedupKey]) return;
        seenProps[dedupKey] = true;
        var row = createPropRow(el, propDef, allEls, groupKey);
        groupDiv.appendChild(row);
      });

      _panelBody.appendChild(groupDiv);
    });

    // 重置按钮
    var resetDiv = document.createElement('div');
    resetDiv.className = 'insp-reset';
    var resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = '重置为默认';
    resetBtn.addEventListener('click', function () {
      _origStyles.all.forEach(function (item) {
        if (item.style) item.el.setAttribute('style', item.style);
        else item.el.removeAttribute('style');
      });
      buildPanel(el, def, allEls);
    });
    resetDiv.appendChild(resetBtn);
    _panelBody.appendChild(resetDiv);
  }

  // ---- 创建属性行 ----
  function createPropRow(el, propDef, allEls, groupKey) {
    var row = document.createElement('div');
    row.className = 'insp-row';

    var label = document.createElement('label');
    label.className = 'insp-label';
    label.textContent = propDef.label;
    row.appendChild(label);

    var controlDiv = document.createElement('div');
    controlDiv.className = 'insp-control';
    var currentVal = getComputedVal(el, propDef.key);

    // 应用样式的目标元素列表
    function getTargets() {
      if (groupKey === 'tableColumn') {
        // 表格列属性：始终应用到整列
        return getColumnCells(el);
      }
      if (_applyMode === 'all') return allEls;
      return [el];
    }

    if (propDef.type === 'color') {
      var colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = parseColor(currentVal);
      var hexSpan = document.createElement('span');
      hexSpan.className = 'insp-val';
      hexSpan.textContent = colorInput.value;
      colorInput.addEventListener('input', function () {
        getTargets().forEach(function (t) { applyStyle(t, propDef.key, colorInput.value); });
        hexSpan.textContent = colorInput.value;
      });
      controlDiv.appendChild(colorInput);
      controlDiv.appendChild(hexSpan);

    } else if (propDef.type === 'range') {
      var rangeInput = document.createElement('input');
      rangeInput.type = 'range';
      rangeInput.min = propDef.min;
      rangeInput.max = propDef.max;
      rangeInput.step = propDef.step;
      var num = parseNum(currentVal);
      num = Math.max(propDef.min, Math.min(propDef.max, num));
      rangeInput.value = num;
      var valSpan = document.createElement('span');
      valSpan.className = 'insp-val';
      valSpan.textContent = num + (propDef.unit || '');
      rangeInput.addEventListener('input', function () {
        var v = rangeInput.value + (propDef.unit || '');
        getTargets().forEach(function (t) { applyStyle(t, propDef.key, v); });
        valSpan.textContent = rangeInput.value + (propDef.unit || '');
      });
      controlDiv.appendChild(rangeInput);
      controlDiv.appendChild(valSpan);

    } else if (propDef.type === 'select') {
      var sel = document.createElement('select');
      propDef.options.forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt.v;
        o.textContent = opt.l;
        sel.appendChild(o);
      });
      var cv = currentVal.trim();
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === cv) { sel.selectedIndex = i; break; }
      }
      sel.addEventListener('change', function () {
        getTargets().forEach(function (t) { applyStyle(t, propDef.key, sel.value); });
      });
      controlDiv.appendChild(sel);
    }

    row.appendChild(controlDiv);
    return row;
  }

  // ---- 计算元素在 #write 中的唯一路径 ----
  // 路径格式：用 ">" 分隔层级，每层是 "tagName:childIndex"
  // 如 "H1:0" 表示 #write 下第一个 H1
  //    "FIGURE:2>TABLE:0>TBODY:0>TR:1>TD:2" 表示嵌套路径
  function getElementPath(el) {
    if (!_iframeDoc) return null;
    var write = _iframeDoc.getElementById('write');
    if (!write) return null;
    var parts = [];
    var cur = el;
    while (cur && cur !== write) {
      var parent = cur.parentElement;
      if (!parent) return null;
      // 在同级同名兄弟中找索引
      var sameTagSiblings = [];
      for (var i = 0; i < parent.children.length; i++) {
        if (parent.children[i].tagName === cur.tagName) sameTagSiblings.push(parent.children[i]);
      }
      var idx = sameTagSiblings.indexOf(cur);
      if (idx < 0) return null;
      parts.unshift(cur.tagName + ':' + idx);
      cur = parent;
    }
    if (cur !== write) return null;
    return parts.join('>');
  }

  // 根据路径在 #write 中查找元素
  function findElementByPath(path) {
    if (!_iframeDoc) return null;
    var write = _iframeDoc.getElementById('write');
    if (!write) return null;
    var parts = path.split('>');
    var cur = write;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].split(':');
      var tag = p[0];
      var idx = parseInt(p[1], 10);
      var matches = [];
      for (var j = 0; j < cur.children.length; j++) {
        if (cur.children[j].tagName === tag) matches.push(cur.children[j]);
      }
      if (idx >= matches.length) return null;
      cur = matches[idx];
    }
    return cur;
  }

  // 保存样式覆盖到持久化表
  function saveOverride(el, prop, value) {
    var path = getElementPath(el);
    if (!path) return;
    if (!_styleOverrides[path]) _styleOverrides[path] = {};
    _styleOverrides[path][prop] = value;
  }

  // 重新应用所有覆盖样式（doRender 后调用）
  function reapplyOverrides() {
    if (!_iframeDoc) return;
    var write = _iframeDoc.getElementById('write');
    if (!write) return;
    for (var path in _styleOverrides) {
      var el = findElementByPath(path);
      if (el) {
        var props = _styleOverrides[path];
        for (var prop in props) {
          // 图片对齐：转换为 img 自身的 margin 对齐
          if (el.tagName === 'IMG' && prop === 'text-align') {
            applyImgAlign(el, props[prop]);
          } else {
            el.style.setProperty(prop, props[prop], 'important');
          }
        }
      }
    }
    // 更新 iframe 高度
    if (window.WmpRenderer && window.WmpRenderer.autoHeight) {
      try { window.WmpRenderer.autoHeight(); } catch (e) {}
    }
  }

  // 清除所有覆盖样式
  function clearOverrides() {
    _styleOverrides = {};
  }

  // 图片对齐：text-align 对 img 无效，且设到父容器会影响其他内容
  // 改为在 img 自身上设置 display:block + margin:auto 实现对齐
  // 这样只影响图片本身，不影响兄弟元素
  function applyImgAlign(el, value) {
    el.style.setProperty('display', 'block', 'important');
    if (value === 'center') {
      el.style.setProperty('margin-left', 'auto', 'important');
      el.style.setProperty('margin-right', 'auto', 'important');
    } else if (value === 'left') {
      el.style.setProperty('margin-left', '0', 'important');
      el.style.setProperty('margin-right', 'auto', 'important');
    } else if (value === 'right') {
      el.style.setProperty('margin-left', 'auto', 'important');
      el.style.setProperty('margin-right', '0', 'important');
    }
  }

  // ---- 应用样式 ----
  function applyStyle(el, prop, value) {
    // 图片对齐：转换为 img 自身的 margin 对齐，不影响父容器和兄弟元素
    if (el.tagName === 'IMG' && prop === 'text-align') {
      applyImgAlign(el, value);
    } else {
      el.style.setProperty(prop, value, 'important');
    }
    // 持久化保存（保存原始的 text-align，重新应用时再转换）
    saveOverride(el, prop, value);
    if (window.WmpRenderer && window.WmpRenderer.autoHeight) {
      try { window.WmpRenderer.autoHeight(); } catch (e) {}
    }
  }

  // ---- 关闭面板 ----
  function closePanel() {
    _panel.classList.remove('open');
    document.body.classList.remove('inspector-open');
    clearHighlights();
    _currentEl = null;
  }

  // ---- Esc 关闭 ----
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _panel && _panel.classList.contains('open')) {
      closePanel();
    }
  });

  // ---- 暴露 API ----
  window.WmpInspector = {
    init: init,
    close: closePanel,
    isOpen: function () { return _panel && _panel.classList.contains('open'); },
    reapplyOverrides: reapplyOverrides,
    clearOverrides: clearOverrides,
    hasOverrides: function () {
      return Object.keys(_styleOverrides).length > 0;
    }
  };

})();
