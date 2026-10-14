// 条文の沿革の全体像を描く。データは <法令ID>_flow.js の window.LINEAGE_FLOW
//   (convert_lineage_to_html.ps1 → lineage_flow.ps1 が書き出す)
//   #flow の data-view で描くものを選ぶ (タブ「フロー・テーブル・条文」は頁ごとのリンク。flow.html・table.html・index.html)
//     フロー (flow): 編・章を 1 つ選び、各段階 (列) の条を箱で並べて、前の段階の条から線を引く。続きのない条は「続きなし」へ赤の点線
//     テーブル (table): 法律全体を、行 = 対応でつながる条のまとまり、列 = 会議体の表にする。編・章ごとに折りたためる
//   条 (箱・表の条) を押すと、その条の沿革のページのその段階へ移る。成立しなかった条は、その段階の全文 (草案のページ・議事録) へ移る
//   条にマウスを置くと、段階・状態・成立法の何条になったか・条文を出す
//   フローは #g=3 (その章の位置) のようなリンクで開ける
//   条 (node): i 番号, c 列, a 条, g 原案の列の段階の印 (甲11 など), s 状態, p 前の段階の条の番号, e 続きなしを置く列 (-1 はなし),
//     h 沿革のページの段階へのリンク, t 条文
(() => {
  const data = window.LINEAGE_FLOW;
  const root = document.getElementById('flow');
  if (!data || !root) return;
  const cols = data.columns;
  const byId = new Map();
  data.rows.forEach(r => r.nodes.forEach(n => { n.row = r; byId.set(n.i, n); }));
  const STATUS = {
    orig: '原案', new: '新設', same: '変わらず', changed: '文言の変更', merge: '統合', split: '分割',
    deleted: '削除', unknown: '比べられない', end: '続きなし'
  };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const colName = c => cols[c].label.replace('法典調査会 ', '');
  const label = n => n.a + (n.g ? `(${n.g})` : '') + (n.s === 'deleted' ? ' 削除' : '');
  const tip = n => `${cols[n.c].label}　${label(n)}　［${STATUS[n.s]}］　${n.row.final ? '成立法 ' + n.row.final : '成立せず'}` + (n.t ? '\n' + n.t : '');

  // 編・章のまとまりと、その中の新設・削除・続きなし・統合や分割の数
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
  const marks = g => [['new', '新設'], ['end', '削除・続きなし'], ['ms', '統合・分割']]
    .filter(([k]) => g.count[k]).map(([k, t]) => `<span class="fl-mark fl-mark-${k}" title="${t} ${g.count[k]}">${g.count[k]}</span>`).join('');
  const legend = `<div class="fl-legend">${['orig', 'new', 'same', 'changed', 'merge', 'split', 'deleted', 'end'].map(s => `<span class="fl-key st-${s}"><i></i>${STATUS[s]}</span>`).join('')}</div>`;

  root.innerHTML = `
    <div class="fl-view" data-view="flow">
      <div class="fl-nav">
        <button type="button" data-go="-1">◁ 前の章</button>
        <select aria-label="編・章">${groups.map((g, i) => `<option value="${i}">${esc(g.label)}</option>`).join('')}</select>
        <button type="button" data-go="1">次の章 ▷</button>
      </div>
      <details class="fl-chapters"><summary>章の一覧</summary>
        <p class="fl-chapters-note">数字は、<span class="fl-mark fl-mark-new">新設</span><span class="fl-mark fl-mark-end">削除・続きなし</span><span class="fl-mark fl-mark-ms">統合・分割</span>の条の数</p>
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
  const CW = 140, BW = 112, BH = 22, GAP = 4, PAD = 8, BAND = 32;
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
        const counts = cols.map((_, ci) => r.nodes.filter(n => n.c === ci).length + (r.nodes.some(n => n.e === ci) ? 1 : 0));
        const h = Math.max(1, ...counts) * (BH + GAP) + PAD;
        rowsY.set(r, [y, h]);
        cols.forEach((_, ci) => r.nodes.filter(n => n.c === ci).forEach((n, k) => pos.set(n.i, { x: PAD + ci * CW, y: y + PAD / 2 + k * (BH + GAP) })));
        y += h;
      });
    });
    const W = PAD * 2 + cols.length * CW, H = y + PAD;
    let svg = `<svg class="fl-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
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
        const x1 = a.x + BW, y1 = a.y + BH / 2, x2 = b.x, y2 = b.y + BH / 2, mx = (x1 + x2) / 2;
        svg += `<path class="fl-edge${n.s === 'merge' || n.s === 'split' ? ' fl-edge-ms' : ''}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
      });
      if (n.e >= 0) {
        const kk = r.nodes.filter(m => m.c === n.e).length;
        const ex = PAD + n.e * CW, ey = rowsY.get(r)[0] + PAD / 2 + kk * (BH + GAP);
        svg += `<path class="fl-edge fl-edge-end" d="M${b.x + BW},${b.y + BH / 2} L${ex},${ey + BH / 2}"/>`;
        boxes += `<g class="st-end"><rect class="fl-box" x="${ex}" y="${ey}" width="${BW}" height="${BH}" rx="4"/><text x="${ex + BW / 2}" y="${ey + 16}" text-anchor="middle">✕ 続きなし</text></g>`;
      }
      const box = `<g class="fl-node st-${n.s}"><title>${esc(tip(n))}</title><rect class="fl-box" x="${b.x}" y="${b.y}" width="${BW}" height="${BH}" rx="4"/><text x="${b.x + BW / 2}" y="${b.y + 16}" text-anchor="middle">${esc(label(n))}</text></g>`;
      boxes += n.h ? `<a href="${esc(n.h)}">${box}</a>` : box;
    }));
    const head = `<div class="fl-head" style="width:${W}px">${cols.map((c, ci) => `<span style="left:${PAD + ci * CW}px;width:${BW}px">${esc(colName(ci))}</span>`).join('')}</div>`;
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
  function drawTable() {
    if (tableView.dataset.ready) return;
    tableView.dataset.ready = '1';
    const ended = r => !r.final;
    const has = (r, f) => r.nodes.some(f);
    const filters = {
      all: ['すべての行', () => true],
      ended: ['成立しなかった条を含む行', r => ended(r) || has(r, n => n.s === 'deleted' || n.e >= 0)],
      new: ['新設を含む行', r => has(r, n => n.s === 'new')],
      ms: ['統合・分割を含む行', r => has(r, n => n.s === 'merge' || n.s === 'split')],
      changed: ['文言の変更を含む行', r => has(r, n => n.s === 'changed')]
    };
    tableView.innerHTML = `<div class="fl-tools"><label>表示する行 <select>${Object.entries(filters).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></label>
      <button type="button" class="tb-fold">章をすべて閉じる</button></div>${legend}
      <div class="fl-scroll tb-scroll"><table class="tb-table"><thead><tr>${cols.map((c, ci) => `<th>${esc(colName(ci))}</th>`).join('')}</tr></thead><tbody></tbody></table></div>`;
    const body = tableView.querySelector('tbody');
    const cell = n => n.h ? `<a class="tb-n st-${n.s}" href="${esc(n.h)}" title="${esc(tip(n))}">${esc(label(n))}</a>` : `<span class="tb-n st-${n.s}" title="${esc(tip(n))}">${esc(label(n))}</span>`;
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
            const ns = r.nodes.filter(n => n.c === ci);
            const level = new Map();
            const lv = n => {
              if (!level.has(n.i)) level.set(n.i, Math.max(-1, ...n.p.map(pi => byId.get(pi)).filter(m => m && m.c === ci).map(lv)) + 1);
              return level.get(n.i);
            };
            const steps = [];
            ns.forEach(n => (steps[lv(n)] ||= []).push(cell(n)));
            const parts = steps.filter(Boolean).map(a => a.join('<span class="tb-sep">・</span>'));
            if (r.nodes.some(n => n.e === ci)) parts.push('<span class="tb-n st-end">続きなし</span>');
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
