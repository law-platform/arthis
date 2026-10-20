// 条文の沿革の全体像を描く。データは <法令ID>_flow.js の window.LINEAGE_FLOW
//   (convert_lineage_to_html.ps1 → lineage_flow.ps1 が書き出す)
//   #flow の data-view で描くものを選ぶ (タブ「フロー・テーブル・条文」は頁ごとのリンク。flow.html・table.html・index.html)
//     フロー (flow): 編・章を 1 つ選び、各段階 (列) の条を箱で並べて、前の段階の条から線を引く。その段階で廃案になった条 (続きのない条) は、箱の枠を赤にし、箱の右に ✕
//     テーブル (table): 法律全体を、行 = 対応でつながる条のまとまり、列 = 会議体の表にする。編・章ごとに折りたためる
//   条 (箱・表の条) を押すと、その条の沿革のページのその段階へ移る。成立しなかった条は、その段階の全文 (草案のページ・議事録) へ移る
//   条にマウスを置くと、段階・状態・成立法の何条になったか・条文を出す
//   フローは #g=3 (その章の位置) のようなリンクで開ける
//   条 (node): i 番号, c 列, a 条, g 原案の列の段階の印 (甲11 など), s 状態, p 前の段階の条の番号, e 続きのない次の列 (-1 は続きあり。0 以上ならその条の段階で廃案),
//     h 沿革のページの段階へのリンク, t 条文
(() => {
  const data = window.LINEAGE_FLOW;
  const root = document.getElementById('flow');
  if (!data || !root) return;
  const cols = data.columns;
  const byId = new Map();
  data.rows.forEach(r => r.nodes.forEach(n => { n.row = r; byId.set(n.i, n); }));
  const STATUS = {
    orig: '原案', new: '新設', same: '修正なし', changed: '修正あり', merge: '統合', split: '分割',
    deleted: '削除', unknown: '比べられない', end: '廃案'
  };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const colName = c => cols[c].label.replace('法典調査会 ', '');
  // 列の組 (法典調査会の中の主査会・総会・原案・決議案など)。続く列の同じ組を 1 つの見出しにまとめ、見出しを 2 段にする
  const colFull = c => (cols[c].group ? cols[c].group + ' ' : '') + cols[c].label;
  const groupSpans = [];
  cols.forEach((c, ci) => {
    if (!c.group) return;
    const last = groupSpans[groupSpans.length - 1];
    if (last && last.group === c.group && last.to === ci - 1) last.to = ci; else groupSpans.push({ group: c.group, from: ci, to: ci });
  });
  // 同じ列の中の何段目か (法典調査会の原案→修正案): 同じ列の前の案から続く条は、その案の次の段
  const levels = new Map();
  const level = n => {
    if (!levels.has(n.i)) levels.set(n.i, Math.max(-1, ...n.p.map(pi => byId.get(pi)).filter(m => m && m.c === n.c).map(level)) + 1);
    return levels.get(n.i);
  };
  // 列の中の条を、前の案が上・後の案が下になるように並べる (同じ段はデータの順)
  const inCol = (r, ci) => r.nodes.filter(n => n.c === ci).sort((a, b) => level(a) - level(b));
  // 条の名前。削除の条は赤で示し、「削除」とは書かない (マウスを置くと出る)
  const label = n => n.a + (n.g ? `(${n.g})` : '');
  const tip = n => `${colFull(n.c)}　${label(n)}　［${STATUS[n.s]}］${n.e >= 0 ? '　✕ この段階で廃案' : ''}　${n.row.final ? '成立法 ' + n.row.final : n.row.adopted ? '成立（' + n.row.adopted + '）' : '成立せず'}` + (n.t ? '\n' + n.t : '');

  // 編・章のまとまりと、その中の新設・削除・廃案・統合や分割の数
  const groups = [];
  data.rows.forEach(r => { if (!groups.length || groups[groups.length - 1].label !== r.group) groups.push({ label: r.group, rows: [] }); groups[groups.length - 1].rows.push(r); });
  groups.forEach(g => {
    const ns = g.rows.flatMap(r => r.nodes);
    g.count = {
      new: ns.filter(n => n.s === 'new').length,
      end: ns.filter(n => n.s === 'deleted' || n.e >= 0).length,
      ms: ns.filter(n => n.s === 'merge' || n.s === 'split').length
    };
  });
  const marks = g => [['new', '新設'], ['end', '削除・廃案'], ['ms', '統合・分割']]
    .filter(([k]) => g.count[k]).map(([k, t]) => `<span class="fl-mark fl-mark-${k}" title="${t} ${g.count[k]}">${g.count[k]}</span>`).join('');
  const legend = `<div class="fl-legend">${['orig', 'new', 'same', 'changed', 'merge', 'split', 'deleted'].map(s => `<span class="fl-key st-${s}"><i></i>${STATUS[s]}</span>`).join('')}<span class="fl-key st-end"><b>✕</b>この段階で廃案</span></div>`;

  root.innerHTML = `
    <div class="fl-view" data-view="flow">
      <div class="fl-nav">
        <button type="button" data-go="-1">◁ 前の章</button>
        <select aria-label="編・章">${groups.map((g, i) => `<option value="${i}">${esc(g.label)}</option>`).join('')}</select>
        <button type="button" data-go="1">次の章 ▷</button>
      </div>
      <details class="fl-chapters"><summary>章の一覧</summary>
        <p class="fl-chapters-note">数字は、<span class="fl-mark fl-mark-new">新設</span><span class="fl-mark fl-mark-end">削除・廃案</span><span class="fl-mark fl-mark-ms">統合・分割</span>の条の数</p>
        <ol>${groups.map((g, i) => `<li><button type="button" data-g="${i}">${esc(g.label)}</button>${marks(g)}</li>`).join('')}</ol>
      </details>
      ${legend}
      <div class="fl-scroll" id="fl-svg"></div>
    </div>
    <div class="fl-view" data-view="table" hidden></div>`;
  const flowView = root.querySelector('.fl-view[data-view="flow"]');
  const tableView = root.querySelector('.fl-view[data-view="table"]');
  const select = flowView.querySelector('select');
  const svgBox = flowView.querySelector('#fl-svg');
  const state = { view: root.dataset.view === 'table' ? 'table' : 'flow', g: 0 };

  // --- 流れ図 ----------------------------------------------------------------
  // 法律全体を 1 枚の図にし、章の切れ目に見出しの帯を置く。列の見出しは枠の上端に固定 (HTML の .fl-head)
  //   章の選択・◁ ▷・章の一覧は、その章の帯の位置へ図を送る。図を送ると、選択欄は今いる章になる
  // STEP: 同じ列の中で前の案と続く案 (原案→修正案) の間に足す隙間。そこに下向きの矢印を引く
  const CW = 140, BW = 112, BH = 22, GAP = 4, STEP = 10, PAD = 8, BAND = 32;
  const bands = [];
  function drawFlow() {
    if (svgBox.dataset.ready) return;
    svgBox.dataset.ready = '1';
    const pos = new Map();
    const rowsY = new Map();
    let y = 0;
    groups.forEach((g, gi) => {
      bands.push(y);
      y += BAND;
      g.rows.forEach(r => {
        // 列ごとに上から積む。段が変わる (前の案から続く案になる) ところは STEP だけ空ける
        const heights = cols.map((_, ci) => {
          let dy = 0;
          inCol(r, ci).forEach((n, k, ns) => {
            if (k && level(n) > level(ns[k - 1])) dy += STEP;
            pos.set(n.i, { x: PAD + ci * CW, y: y + PAD / 2 + dy });
            dy += BH + GAP;
          });
          return dy;
        });
        const h = Math.max(BH + GAP, ...heights) + PAD;
        rowsY.set(r, [y, h]);
        y += h;
      });
    });
    const W = PAD * 2 + cols.length * CW, H = y + PAD;
    let svg = `<svg class="fl-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`
      + '<defs><marker id="fl-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" class="fl-arrow"/></marker></defs>';
    let k = 0;
    rowsY.forEach(([ry, rh]) => { if (k++ % 2) svg += `<rect class="fl-stripe" x="0" y="${ry}" width="${W}" height="${rh}"/>`; });
    groups.forEach((g, gi) => {
      svg += `<rect class="fl-band" x="0" y="${bands[gi]}" width="${W}" height="${BAND - 4}"/><text class="fl-band-text" x="${PAD}" y="${bands[gi] + 20}">${esc(g.label)}</text>`;
    });
    let boxes = '';
    data.rows.forEach(r => r.nodes.forEach(n => {
      const b = pos.get(n.i);
      n.p.forEach(pi => {
        const a = pos.get(pi);
        if (!a) return;
        // 同じ列の前の案から: 上の案の下端の中ほどから、下の案の上端へ下向きの矢印
        if (byId.get(pi).c === n.c) {
          const cx = b.x + BW / 2;
          svg += `<path class="fl-edge fl-edge-col" d="M${cx},${a.y + BH} V${b.y - 1}" marker-end="url(#fl-arrow)"/>`;
          return;
        }
        const x1 = a.x + BW, y1 = a.y + BH / 2, x2 = b.x, y2 = b.y + BH / 2, mx = (x1 + x2) / 2;
        svg += `<path class="fl-edge${n.s === 'merge' || n.s === 'split' ? ' fl-edge-ms' : ''}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
      });
      // その段階で廃案になった条: 箱の枠を赤にし、箱の右 (次の列との間) に ✕
      const ended = n.e >= 0;
      const box = `<g class="fl-node st-${n.s}${ended ? ' fl-ended' : ''}"><title>${esc(tip(n))}</title><rect class="fl-box" x="${b.x}" y="${b.y}" width="${BW}" height="${BH}" rx="4"/><text x="${b.x + BW / 2}" y="${b.y + 16}" text-anchor="middle">${esc(label(n))}</text>`
        + (ended ? `<text class="fl-x" x="${b.x + BW + 4}" y="${b.y + 16}">✕</text>` : '') + '</g>';
      boxes += n.h ? `<a href="${esc(n.h)}">${box}</a>` : box;
    }));
    const head = `<div class="fl-head${groupSpans.length ? ' fl-head-2' : ''}" style="width:${W}px">`
      + groupSpans.map(s => `<span class="fl-group" style="left:${PAD + s.from * CW}px;width:${(s.to - s.from) * CW + BW}px">${esc(s.group)}</span>`).join('')
      + cols.map((c, ci) => `<span class="fl-col${c.group ? ' fl-col-sub' : ''}" style="left:${PAD + ci * CW}px;width:${BW}px">${esc(colName(ci))}</span>`).join('') + '</div>';
    svgBox.innerHTML = head + svg + boxes + '</svg>';
  }
  // 今いる章 (図の上端にかかっている帯)
  function chapterAt() {
    const top = svgBox.scrollTop + 1;
    let gi = 0;
    bands.forEach((by, i) => { if (by <= top) gi = i; });
    return gi;
  }
  function markChapter(gi) {
    state.g = gi;
    select.value = String(gi);
    flowView.querySelector('[data-go="-1"]').disabled = gi === 0;
    flowView.querySelector('[data-go="1"]').disabled = gi === groups.length - 1;
    flowView.querySelectorAll('.fl-chapters [data-g]').forEach(b => b.classList.toggle('is-current', +b.dataset.g === gi));
    history.replaceState(null, '', '#g=' + gi);
  }
  function goChapter(i) {
    const gi = Math.max(0, Math.min(groups.length - 1, i));
    svgBox.scrollTop = bands[gi];
    markChapter(gi);
  }
  svgBox.addEventListener('scroll', () => { const gi = chapterAt(); if (gi !== state.g) markChapter(gi); }, { passive: true });

  // --- 対照表 ----------------------------------------------------------------
  // 見出し: 組のある列は 2 段 (上に組、下に列)、組のない列は 2 段をまたぐ
  function tableHead() {
    if (!groupSpans.length) return `<tr>${cols.map((c, ci) => `<th>${esc(colName(ci))}</th>`).join('')}</tr>`;
    let top = '';
    for (let ci = 0; ci < cols.length; ci++) {
      const s = groupSpans.find(g => g.from === ci);
      if (s) { top += `<th class="tb-colgroup" colspan="${s.to - s.from + 1}">${esc(s.group)}</th>`; ci = s.to; }
      else top += `<th rowspan="2">${esc(colName(ci))}</th>`;
    }
    const sub = cols.map((c, ci) => c.group ? `<th class="tb-sub">${esc(colName(ci))}</th>` : '').join('');
    return `<tr>${top}</tr><tr>${sub}</tr>`;
  }
  function drawTable() {
    if (tableView.dataset.ready) return;
    tableView.dataset.ready = '1';
    const ended = r => !r.final && !r.adopted;   // 乙号議案・目次の全体像は、最後の段階に届いた行を成立とする
    const has = (r, f) => r.nodes.some(f);
    const filters = {
      all: ['すべての行', () => true],
      ended: ['成立しなかった条を含む行', r => ended(r) || has(r, n => n.s === 'deleted' || n.e >= 0)],
      new: ['新設を含む行', r => has(r, n => n.s === 'new')],
      ms: ['統合・分割を含む行', r => has(r, n => n.s === 'merge' || n.s === 'split')],
      changed: ['修正ありを含む行', r => has(r, n => n.s === 'changed')]
    };
    tableView.innerHTML = `<div class="fl-tools"><label>表示する行 <select>${Object.entries(filters).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></label>
      <button type="button" class="tb-fold">章をすべて閉じる</button></div>${legend}
      <div class="fl-scroll tb-scroll"><table class="tb-table"><thead>${tableHead()}</thead><tbody></tbody></table></div>`;
    const body = tableView.querySelector('tbody');
    const cell = n => (n.h ? `<a class="tb-n st-${n.s}" href="${esc(n.h)}" title="${esc(tip(n))}">${esc(label(n))}</a>` : `<span class="tb-n st-${n.s}" title="${esc(tip(n))}">${esc(label(n))}</span>`)
      + (n.e >= 0 ? '<span class="tb-x" title="この段階で廃案">✕</span>' : '');
    const draw = () => {
      const f = filters[tableView.querySelector('select').value][1];
      let html = '';
      groups.forEach((g, gi) => {
        const rows = g.rows.filter(f);
        if (!rows.length) return;
        html += `<tr class="tb-group" data-g="${gi}"><th colspan="${cols.length}"><button type="button" aria-expanded="true">${esc(g.label)}<small>${rows.length} 行</small></button></th></tr>`;
        rows.forEach(r => {
          html += `<tr class="tb-row${ended(r) ? ' tb-ended' : ''}" data-g="${gi}">` + cols.map((c, ci) => {
            // 同じ列の中の移り変わり (法典調査会の原案→修正案): 並行するものは「・」、引き継ぎは ⇒
            const steps = [];
            inCol(r, ci).forEach(n => (steps[level(n)] ||= []).push(cell(n)));
            const parts = steps.filter(Boolean).map(a => a.join('<span class="tb-sep">・</span>'));
            return `<td>${parts.join('<span class="tb-sep">⇒</span>')}</td>`;
          }).join('') + '</tr>';
        });
      });
      body.innerHTML = html;
    };
    tableView.querySelector('select').addEventListener('change', draw);
    tableView.querySelector('.tb-fold').addEventListener('click', e => {
      const close = e.target.textContent.includes('閉じる');
      body.querySelectorAll('.tb-group button').forEach(b => b.setAttribute('aria-expanded', String(!close)));
      body.querySelectorAll('.tb-row').forEach(tr => tr.hidden = close);
      e.target.textContent = close ? '章をすべて開く' : '章をすべて閉じる';
    });
    body.addEventListener('click', e => {
      const b = e.target.closest('.tb-group button');
      if (!b) return;
      const open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open));
      body.querySelectorAll(`.tb-row[data-g="${b.closest('tr').dataset.g}"]`).forEach(tr => tr.hidden = !open);
    });
    draw();
  }

  // --- 描く ---------------------------------------------------------------------
  function render() {
    flowView.hidden = state.view !== 'flow';
    tableView.hidden = state.view !== 'table';
    if (state.view === 'flow') { drawFlow(); goChapter(state.g); } else drawTable();
  }
  flowView.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => goChapter(state.g + +b.dataset.go)));
  select.addEventListener('change', () => goChapter(+select.value));
  flowView.querySelector('.fl-chapters').addEventListener('click', e => {
    const b = e.target.closest('[data-g]');
    if (b) { goChapter(+b.dataset.g); e.currentTarget.open = false; }
  });

  const mg = location.hash.match(/^#g=(\d+)$/);
  if (mg) state.g = Math.min(groups.length - 1, +mg[1]);
  render();
})();
