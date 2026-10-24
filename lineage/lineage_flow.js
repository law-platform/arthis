// 条文の沿革の全体像を描く。データは <法令ID>_flow.js の window.LINEAGE_FLOW
//   (convert_lineage_to_html.ps1 → lineage_flow.ps1 が書き出す)
//   #flow の data-view で描くものを選ぶ (タブ「フロー・テーブル・条文」は頁ごとのリンク。flow.html・table.html・index.html)
//     フロー (flow): 区分 (編・章・節・款のいちばん下) を 1 つ選び、各段階 (列) の条を箱で並べて、前の段階の条から線を引く。その段階で廃案になった条 (続きのない条) は、箱の枠を赤にし、箱の右に ✕
//     テーブル (table): 法律全体を、行 = 対応でつながる条のまとまり、列 = 会議体の表にする。編・章・節・款の見出しごとに折りたためる
//   条 (箱・表の条) を押すと、その条の沿革のページのその段階へ移る。成立しなかった条は、その段階の全文 (草案のページ・議事録) へ移る
//   条にマウスを置くと、段階・状態・成立法の何条になったか・条文を出す
//   フローは #g=3 (その区分の位置)・#p=2.html (その沿革のページの条のある区分) のようなリンクで開ける
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
  // 編章節の行で帯の色を付ける列: 見出しのある列と、対応でつながる見出しの間の列 (主査会・総会 → 決議案なら、間の原案・修正案も)。
  //   後に続く段階のない所 (削除の後など) は含めない
  const bandCols = r => {
    const cs = new Set(r.nodes.map(n => n.c));
    r.nodes.forEach(n => n.p.forEach(pi => { const p = byId.get(pi); if (p && p.row === r) for (let c = Math.min(p.c, n.c); c <= Math.max(p.c, n.c); c++) cs.add(c); }));
    return cs;
  };
  // 条の名前。削除の条は赤で示し、「削除」とは書かない (マウスを置くと出る)
  //   編章節は見出しの文字 (第一節　私權ノ享有)。その段階の文字がなければ (議事録の段階など)、同じ行のほかの段階の見出しの文字
  const headText = n => n.t || (n.row.nodes.find(m => m.t) || n).t || n.a;
  const label = n => n.row.head ? headText(n) : n.a + (n.g ? `(${n.g})` : '');
  // マウスを置いたときの説明。編章節は見出しの文字 (短い書き方は出さない。条文の行も見出しの文字と同じなので付けない)
  const tip = n => `${colFull(n.c)}　${label(n)}　［${STATUS[n.s]}］${n.e >= 0 ? '　✕ この段階で廃案' : ''}　${n.row.final ? '成立法 ' + n.row.final : n.row.adopted ? '成立（' + n.row.adopted + '）' : '成立せず'}` + (n.t && !n.row.head ? '\n' + n.t : '');

  // 区分 (行の group。「第一編　總則 ＞ 第一章　人 ＞ 第一節　私權ノ享有」のように編・章・節・款を上から並べたもの) と、その中の新設・削除・廃案・統合や分割の数
  //   path は区分の見出しの並び。heads は、前の区分と見出しが違ってくる階層 (そこから下の見出しを出す)
  const groups = [];
  data.rows.forEach(r => { if (!groups.length || groups[groups.length - 1].label !== r.group) groups.push({ label: r.group, path: r.group.split(' ＞ '), rows: [] }); groups[groups.length - 1].rows.push(r); });
  const heads = (g, prev) => { let d = 0; while (prev && d < g.path.length - 1 && g.path[d] === prev.path[d]) d++; return d; };
  // 編章節の行 (行の head。lv は階層、path は成立法の見出しの並び): 区分の見出しの並びと同じ path の行は、その見出しのすぐ下に描く (headRow)。
  //   それ以外 (成立法に届かない見出し) は条の行と同じ所に描く
  const allPaths = new Set(groups.flatMap(g => g.path.map((_, i) => g.path.slice(0, i + 1).join(' ＞ '))));
  const headRow = new Map(data.rows.filter(r => r.head && allPaths.has(r.head.path)).map(r => [r.head.path, r]));
  const isHeadRow = r => r.head && headRow.get(r.head.path) === r;
  // 区分の中の行 (見出しの下に描く編章節の行を除く)。条の数には編章節の行を数えない
  const bodyRows = g => g.rows.filter(r => !isHeadRow(r));
  // 区分の見出し (前の区分と違ってくる階層 d から下) と、その見出しの行
  const headItems = (g, d) => g.path.slice(d).map((h, k) => ({ lv: d + k, label: h, leaf: d + k === g.path.length - 1, row: headRow.get(g.path.slice(0, d + k + 1).join(' ＞ ')) || null }));
  const legend = `<div class="fl-legend">${['orig', 'new', 'same', 'changed', 'merge', 'split', 'deleted'].map(s => `<span class="fl-key st-${s}"><i></i>${STATUS[s]}</span>`).join('')}<span class="fl-key st-end"><b>✕</b>この段階で廃案</span></div>`;

  // 区分の選択欄: すべての見出し (編・章・節・款。節のある章も) を選べる。下の階層ほど字下げする。値は headList の番号
  //   headList: 図に出す見出しを上から順に並べたもの (g は区分の番号、lv は階層)。図の中の位置 (y) は drawFlow が入れる
  const headList = groups.flatMap((g, i) => headItems(g, heads(g, groups[i - 1])).map(it => ({ g: i, lv: it.lv, label: it.label, y: 0 })));
  const options = headList.map((h, i) => `<option value="${i}">${'　'.repeat(h.lv)}${esc(h.label)}</option>`).join('');
  root.innerHTML = `
    <div class="fl-view" data-view="flow">
      <div class="fl-nav"><select aria-label="区分">${options}</select></div>
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
  // 法律全体を 1 枚の図にし、区分の切れ目に見出しの行 (編章節の行) を置く。見出しの行は階層の色の帯にし (テーブルと同じ色)、
  //   各段階の箱に見出しの文字を出す。列の見出しは画面の上端に固定 (HTML の .fl-head)
  //   区分の選択欄で見出しを選ぶと、その見出しの行の位置へ図を送る。図を送ると、選択欄は今いる見出しになる
  // STEP: 同じ列の中で前の案と続く案 (原案→修正案) の間に足す隙間。そこに下向きの矢印を引く
  // 列の幅 (CW) は枠の幅を列の数で割ったもの (横に送らずに全体が見えるように)。箱の幅 (BW) は列の幅から箱の間 (GUTTER) を引いたもの。
  //   狭い画面では MIN_CW より細くせず、そのときだけ横に送る。窓の大きさが変わったら描き直す
  const BH = 25, GAP = 4, STEP = 10, PAD = 8, BAND = 33, GUTTER = 28, MIN_CW = 110;
  let CW = 140, BW = 112;
  const bands = [];
  function drawFlow() {
    const width = svgBox.clientWidth;
    if (svgBox.dataset.ready === String(width)) return;
    svgBox.dataset.ready = String(width);
    CW = Math.max(MIN_CW, Math.floor((width - PAD * 2) / cols.length));
    BW = CW - GUTTER;
    bands.length = 0;
    const pos = new Map();
    const rowsY = new Map();
    const bandList = [];
    let y = 0;
    const place = r => {
      // 行の中を段 (レーン: たどり着く成立法の条ごと。データの l) に分け、段ごとに列の中を上から積む。
      // 分かれた条の流れが別の段になるので、列を飛ばす線がほかの流れの箱を通らない。
      // 段が変わる (前の案から続く案になる) ところは STEP だけ空ける
      const lanes = [...new Set(r.nodes.map(n => n.l || 0))].sort((a, b) => a - b);
      let top = 0;
      lanes.forEach(ln => {
        const heights = cols.map((_, ci) => {
          let dy = 0;
          inCol(r, ci).filter(n => (n.l || 0) === ln).forEach((n, k, ns) => {
            if (k && level(n) > level(ns[k - 1])) dy += STEP;
            pos.set(n.i, { x: PAD + ci * CW, y: y + PAD / 2 + top + dy });
            dy += BH + GAP;
          });
          return dy;
        });
        top += Math.max(BH + GAP, ...heights);
      });
      const h = top + PAD;
      rowsY.set(r, [y, h]);
      y += h;
    };
    let hi = 0;
    groups.forEach((g, gi) => {
      bands.push(y);
      // 見出しの行 (編章節の行) そのものを階層の色の帯にし、各段階の箱に見出しの文字を出す。編章節の行のない見出しだけ、文字の帯にする
      //   見出しの位置は区分の選択欄のため headList に入れる (headItems の順は headList と同じ)
      headItems(g, heads(g, groups[gi - 1])).forEach(it => {
        headList[hi++].y = y;
        if (it.row) { place(it.row); return; }
        bandList.push({ y, lv: it.lv, label: it.label });
        y += BAND;
      });
      bodyRows(g).forEach(place);
    });
    const W = PAD * 2 + cols.length * CW, H = y + PAD;
    let svg = `<svg class="fl-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`
      // 矢印の先。fl-arrow-w は編の濃い帯の上の見出しの矢印 (白)
      + '<defs><marker id="fl-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" class="fl-arrow"/></marker>'
      + '<marker id="fl-arrow-w" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" class="fl-arrow fl-arrow-w"/></marker></defs>';
    // 条の行は 1 行おきに薄い縞。編章節の行は、見出しのある段階とつながる見出しの間の欄だけ階層の色にする (bandCols。テーブルと同じ。ほかは白)
    //   欄は列の幅 (箱とその左右の隙間の半分ずつ)。隣り合う段階の欄はつながる
    let k = 0;
    rowsY.forEach(([ry, rh], r) => {
      if (r.head) [...bandCols(r)].forEach(ci => {
        const x1 = Math.max(0, PAD + ci * CW - GUTTER / 2), x2 = PAD + ci * CW + BW + GUTTER / 2;
        svg += `<rect class="fl-band fl-lv${r.head.lv}" x="${x1}" y="${ry}" width="${x2 - x1}" height="${rh}"/>`;
      });
      else if (k++ % 2) svg += `<rect class="fl-stripe" x="0" y="${ry}" width="${W}" height="${rh}"/>`;
    });
    bandList.forEach(b => {
      svg += `<rect class="fl-band fl-lv${b.lv}" x="0" y="${b.y}" width="${W}" height="${BAND - 2}"/><text class="fl-band-text fl-lv${b.lv}" x="${PAD + b.lv * 18}" y="${b.y + 22}">${esc(b.label)}</text>`;
    });
    let boxes = '';
    data.rows.forEach(r => r.nodes.forEach(n => {
      const b = pos.get(n.i);
      if (!b) return;
      // 編章節の行には、列をまたぐ線を引かない (旧サイトの表と同じ。見出しの文字が箱の幅を少しはみ出してもよいように)。同じ列の中の矢印 (原案→修正案) は引く
      n.p.forEach(pi => {
        const a = pos.get(pi);
        if (!a) return;
        // 同じ列の前の案から: 上の案の下端の中ほどから、下の案の上端へ下向きの矢印
        if (byId.get(pi).c === n.c) {
          const cx = b.x + BW / 2;
          svg += `<path class="fl-edge fl-edge-col${r.head ? ` fl-lv${r.head.lv}` : ''}" d="M${cx},${a.y + BH} V${b.y - 1}" marker-end="url(#${r.head && !r.head.lv ? 'fl-arrow-w' : 'fl-arrow'})"/>`;
          return;
        }
        if (r.head) return;
        const x1 = a.x + BW, y1 = a.y + BH / 2, x2 = b.x, y2 = b.y + BH / 2, mx = (x1 + x2) / 2;
        svg += `<path class="fl-edge${n.s === 'merge' || n.s === 'split' ? ' fl-edge-ms' : ''}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
      });
      // その段階で廃案になった条: 箱の枠を赤にし、箱の右 (次の列との間) に ✕
      //   編章節は箱に入れず、見出しの文字を帯の上に条より少し大きい字で直接出す (新設・削除だけはその色の箱)。
      //   押せる範囲は箱と同じ大きさの透明な四角。見出しの文字は箱の左右に 8px ずつはみ出してよく、それでも入らない長い見出しは字の間を詰める
      const ended = n.e >= 0;
      const hd = !!r.head;
      const text = label(n);
      const fit = hd && text.length * 15.5 > BW + 16 ? ` textLength="${BW + 16}" lengthAdjust="spacingAndGlyphs"` : '';
      const rectCls = hd && n.s !== 'new' && n.s !== 'deleted' ? 'fl-hit' : 'fl-box';
      const box = `<g class="fl-node st-${n.s}${ended ? ' fl-ended' : ''}${hd ? ` fl-head-node fl-lv${r.head.lv}` : ''}"><title>${esc(tip(n))}</title><rect class="${rectCls}" x="${b.x}" y="${b.y}" width="${BW}" height="${BH}" rx="4"/><text x="${b.x + BW / 2}" y="${b.y + 18}" text-anchor="middle"${fit}>${esc(text)}</text>`
        + (ended ? `<text class="fl-x" x="${b.x + BW + 4}" y="${b.y + 18}">✕</text>` : '') + '</g>';
      boxes += n.h ? `<a href="${esc(n.h)}">${box}</a>` : box;
    }));
    const head = `<div class="fl-head${groupSpans.length ? ' fl-head-2' : ''}" style="width:${W}px">`
      + groupSpans.map(s => `<span class="fl-group" style="left:${PAD + s.from * CW}px;width:${(s.to - s.from) * CW + BW}px">${esc(s.group)}</span>`).join('')
      + cols.map((c, ci) => `<span class="fl-col${c.group ? ' fl-col-sub' : ''}" style="left:${PAD + ci * CW}px;width:${BW}px">${esc(colName(ci))}</span>`).join('') + '</div>';
    svgBox.innerHTML = head + svg + boxes + '</svg>';
    stickyTop();
  }
  // 図はページと一緒に送る (表示エリアの枠はない)。列の見出し (.fl-head) は画面の上端に固定されるので、図の位置はその下端から測る
  //   区分の選択 (.fl-nav) も画面の上端に固定し、列の見出しはそのすぐ下に固定する (stickyTop)
  //   svgTop: 図の y=0 が、固定したもののすぐ下に来るときのページの送り量
  const navBar = flowView.querySelector('.fl-nav');
  const stickyTop = () => { const h = svgBox.querySelector('.fl-head'); if (h) h.style.top = navBar.offsetHeight + 'px'; return navBar.offsetHeight + (h ? h.offsetHeight : 0); };
  const svgTop = () => svgBox.querySelector('svg').getBoundingClientRect().top + window.scrollY - stickyTop();
  // 今いる区分 (gi) と見出し (hi): 列の見出しのすぐ下にかかっている区分の最初の帯・見出しの行
  const topY = () => window.scrollY - svgTop() + 1;
  const chapterAt = top => { let gi = 0; bands.forEach((by, i) => { if (by <= top) gi = i; }); return gi; };
  const headAt = top => { let hi = 0; headList.forEach((h, i) => { if (h.y <= top) hi = i; }); return hi; };
  // 選択欄は今いる見出し、頁の URL (#g=) は今いる区分
  function markChapter(gi, hi = headAt(bands[gi])) {
    state.g = gi;
    select.value = String(hi);
    history.replaceState(null, '', '#g=' + gi);
  }
  function goChapter(i) {
    const gi = Math.max(0, Math.min(groups.length - 1, i));
    window.scrollTo(0, svgTop() + bands[gi]);
    markChapter(gi);
  }
  function goHead(hi) {
    window.scrollTo(0, svgTop() + headList[hi].y);
    markChapter(headList[hi].g, hi);
  }
  // 図の上端より上 (題名など) を見ているあいだは、最初の見出しとする
  window.addEventListener('scroll', () => {
    if (state.view !== 'flow' || !bands.length) return;
    const top = topY(), gi = chapterAt(top), hi = headAt(top);
    if (gi !== state.g || String(hi) !== select.value) markChapter(gi, hi);
  }, { passive: true });

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
      <button type="button" class="tb-fold">すべて閉じる</button></div>${legend}
      <div class="fl-scroll tb-scroll"><table class="tb-table"><thead>${tableHead()}</thead><tbody></tbody></table></div>`;
    const body = tableView.querySelector('tbody');
    const cell = n => (n.h ? `<a class="tb-n st-${n.s}" href="${esc(n.h)}" title="${esc(tip(n))}">${esc(label(n))}</a>` : `<span class="tb-n st-${n.s}" title="${esc(tip(n))}">${esc(label(n))}</span>`)
      + (n.e >= 0 ? '<span class="tb-x" title="この段階で廃案">✕</span>' : '');
    // 見出しの行: 編章節の行そのものを階層の色の帯にし、各段階の欄に見出しの文字を出す (旧サイトの表と同じ)。
    //   いちばん左の欄の ▾ で、その見出しの下の行を折りたたむ。編章節の行のない見出しだけ、見出しの文字の行 (表の幅いっぱい) にする
    //   どの行にも、上にある見出しの番号を data-anc に書き、閉じた見出しが 1 つでもあれば隠す
    const fold = tableView.querySelector('.tb-fold');
    const closed = new Set();
    const showRows = () => body.querySelectorAll('tr[data-anc]').forEach(tr => { tr.hidden = tr.dataset.anc.split(' ').some(h => closed.has(h)); });
    // 同じ列の中の移り変わり (法典調査会の原案→修正案): 並行するものは「・」、引き継ぎは ⇒
    //   $head は見出しの行のとき (折りたたみの番号・行数)。成立法に届かない見出しの行も階層の色にする (折りたたみはない)
    const rowHtml = (r, anc, head) => {
      const lv = r.head ? ` tb-headrow tb-lv${r.head.lv}` : '';
      const attr = head ? ` class="tb-group${lv}" data-h="${head.id}"${head.anc ? ` data-anc="${head.anc}"` : ''}${head.leaf ? ' data-leaf="1"' : ''}`
        : ` class="tb-row${lv}${ended(r) ? ' tb-ended' : ''}" data-anc="${anc}"`;
      const bc = r.head ? bandCols(r) : null;
      return `<tr${attr}>` + cols.map((c, ci) => {
        const steps = [];
        inCol(r, ci).forEach(n => (steps[level(n)] ||= []).push(cell(n)));
        const parts = steps.filter(Boolean).map(a => a.join('<span class="tb-sep">・</span>'));
        const toggle = head && !ci ? `<button type="button" class="tb-toggle" aria-expanded="true" title="${head.count} 行"></button>` : '';
        // 見出しの行で、見出しがなく、つながる見出しの間でもない欄は白 (tb-empty)
        return `<td${bc && !bc.has(ci) ? ' class="tb-empty"' : ''}>${toggle}${parts.join('<span class="tb-sep">⇒</span>')}</td>`;
      }).join('') + '</tr>';
    };
    const draw = () => {
      const f = filters[tableView.querySelector('select').value][1];
      const out = [], hs = [], stack = [];
      let prev = null;
      groups.forEach(g => {
        const rows = bodyRows(g).filter(f);
        if (!rows.length) return;
        const d = heads(g, prev);
        prev = g;
        stack.length = d;
        headItems(g, d).forEach(it => {
          const head = { id: String(hs.length), lv: it.lv, label: it.label, anc: stack.join(' '), count: 0, leaf: it.leaf, row: it.row };
          hs.push(head); out.push(head); stack.push(head.id);
        });
        const arts = rows.filter(r => !r.head).length;
        stack.forEach(id => { hs[id].count += arts; });
        const anc = stack.join(' ');
        rows.forEach(r => out.push(rowHtml(r, anc, null)));
      });
      body.innerHTML = out.map(o => typeof o === 'string' ? o : o.row ? rowHtml(o.row, '', o)
        : `<tr class="tb-group tb-lv${o.lv}" data-h="${o.id}"${o.anc ? ` data-anc="${o.anc}"` : ''}${o.leaf ? ' data-leaf="1"' : ''}><th colspan="${cols.length}"><button type="button" aria-expanded="true" style="padding-left:${8 + o.lv * 16}px">${esc(o.label)}<small>${o.count} 行</small></button></th></tr>`).join('');
      closed.clear();
      fold.textContent = 'すべて閉じる';
      // 表の上の見出しの 2 段目 (主査会・総会など) は、1 段目の実際の高さのすぐ下に固定する (字の大きさや罫線で高さが変わるため)
      const h1 = tableView.querySelector('thead tr').offsetHeight;
      tableView.querySelectorAll('thead th.tb-sub').forEach(th => { th.style.top = h1 + 'px'; });
    };
    tableView.querySelector('select').addEventListener('change', draw);
    // すべて閉じる: いちばん下の見出しを閉じる (見出しはすべて見えたまま)
    fold.addEventListener('click', () => {
      const close = fold.textContent.includes('閉じる');
      closed.clear();
      body.querySelectorAll('.tb-group').forEach(tr => {
        const c = close && tr.dataset.leaf === '1';
        if (c) closed.add(tr.dataset.h);
        tr.querySelector('button').setAttribute('aria-expanded', String(!c));
      });
      showRows();
      fold.textContent = close ? 'すべて開く' : 'すべて閉じる';
    });
    body.addEventListener('click', e => {
      const b = e.target.closest('.tb-group button');
      if (!b) return;
      const h = b.closest('tr').dataset.h;
      const open = closed.has(h);
      if (open) closed.delete(h); else closed.add(h);
      b.setAttribute('aria-expanded', String(open));
      showRows();
    });
    draw();
  }

  // --- 描く ---------------------------------------------------------------------
  function render() {
    flowView.hidden = state.view !== 'flow';
    tableView.hidden = state.view !== 'table';
    // 区分を指すリンク (#g=・#p=) で開いたときだけ、その区分の位置まで送る (ほかは頁の先頭のまま)
    if (state.view === 'flow') { drawFlow(); if (state.jump) goChapter(state.g); else markChapter(state.g); } else drawTable();
  }
  // 窓の大きさが変わったら、フローを枠の幅に合わせて描き直し、今の区分の位置へ戻す
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.view !== 'flow') return;
      const g = state.g, inside = window.scrollY > svgTop();   // 図を見ているときだけ、描き直した後にその区分へ戻す
      drawFlow();
      if (inside) goChapter(g);
    }, 200);
  });
  select.addEventListener('change', () => goHead(+select.value));

  const mg = location.hash.match(/^#g=(\d+)$/);
  if (mg) { state.g = Math.min(groups.length - 1, +mg[1]); state.jump = true; }
  // #p=2.html (条の沿革のページの戻るリンク): その頁の条のある区分
  const mp = location.hash.match(/^#p=(.+)$/);
  if (mp) {
    const page = decodeURIComponent(mp[1]);
    const gi = groups.findIndex(g => g.rows.some(r => r.page === page || r.nodes.some(n => n.h && n.h.split('#')[0] === page)));
    if (gi >= 0) { state.g = gi; state.jump = true; }
  }
  render();
})();
