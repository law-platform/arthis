// 本文の全文検索（入口のページ github/index.html。議事録 minutes/・書籍 book/ などの区画をまとめて検索する）
//   対象の区画は入口のチェック（.fsrc。value はフォルダ名、data-kind は種別）で、分野は #fgroup（分野名で照合）で絞り込む。
//   分野で絞るのは、groups が分野の区画（data-fields のあるもの。議事録・書籍）だけ。参照立法例の groups は国なので絞らない。
//   索引と本文は区画ごとに <フォルダ>/search/ から読む。結果は区画ごとの順を保ったまま、区画を交互に並べる
//   search/pages.json     ページの一覧（索引での番号の順）と、索引を分けたファイルの数、件数の単位（unit）
//   search/idx/NNN.json   見出し（正規化した 1 文字・隣り合う 2 文字）→ それを含む議事録の番号（差分で並べたもの）
//   search/text/<ページ>.json  議題ごとの本文。候補の回だけ読み込み、語を含む議題を確かめて前後の文脈を出す。
//     議題の番号が数なら頁の #p<番号>、文字列（参照立法例の条の id）なら #<id> へ移る。
//     参照立法例は 1 頁の本文を分けて置くので、pages の 6 つ目に本文のファイル名がある
//   見出しの作り方と振り分けの式は program/minutes_search.cs と同じ
//   版のある巻（書籍の book_index.json の editions）は、同じ箇所（最新版で当たる頁）の結果を 1 件にまとめ、
//   新しい版の結果を出して、ほかに当たった版を「ほかの版でも該当」に並べる
(() => {
  const PAGES_PER_BATCH = 20;   // 「さらに表示」1 回で出す回数
  const FETCH_PARALLEL = 6;     // 本文を同時に読み込む数
  const HITS_PER_PAGE = 5;      // 1 回の中で文脈を出す箇所数
  const CONTEXT = 40;           // 文脈の前後の文字数
  const SPEAKER = '\u0001';     // 本文中の発言者名の前の印
  const SPEECH_END = '\u0002';  // 本文中の発言の終わりの印

  const N = window.MinutesNorm;
  const input = document.getElementById('fq');
  const groupSel = document.getElementById('fgroup');
  const srcBoxes = [...document.querySelectorAll('.fsrc')];
  const statusEl = document.getElementById('fstatus');
  const results = document.getElementById('results');
  const moreWrap = document.getElementById('more-wrap');
  const moreBtn = document.getElementById('more');

  // 区画ごとの索引の一覧・読み込んだ索引と本文。fields は分野で絞り込む区画か
  const sources = srcBoxes.map((box) => ({ box, dir: box.value, kind: box.dataset.kind, fields: 'fields' in box.dataset, base: `${box.value}/search/`, meta: null, shardCache: new Map(), textCache: new Map() }));

  // 分野の選択は、分野で絞り込む区画にチェックがあるときだけ使える
  function syncGroupSel() {
    groupSel.disabled = !sources.some((s) => s.fields && s.box.checked);
  }
  let run = null;   // 実行中の検索（新しい検索が始まったら古い結果は捨てる）

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function getJson(src, path) {
    const r = await fetch(src.base + path);
    if (!r.ok) throw new Error(`${src.base}${path}: ${r.status}`);
    return r.json();
  }

  // 旧字→新字の表はどの区画も同じなので、最初の区画のものを読む
  async function loadMeta(src) {
    if (src.meta) return;
    const [m] = await Promise.all([getJson(src, 'pages.json'), N.load(sources[0].base)]);
    src.meta = m;
  }

  // ── 索引 ──
  function shardOf(src, key) {
    const h = key.length === 1 ? key.charCodeAt(0) : key.charCodeAt(0) * 31 + key.charCodeAt(1);
    return h % src.meta.shards;
  }

  function shard(src, i) {
    if (!src.shardCache.has(i)) src.shardCache.set(i, getJson(src, `idx/${String(i).padStart(3, '0')}.json`));
    return src.shardCache.get(i);
  }

  async function postings(src, key) {
    const deltas = (await shard(src, shardOf(src, key)))[key];
    if (!deltas) return [];
    const out = new Array(deltas.length);
    let v = 0;
    for (let i = 0; i < deltas.length; i++) out[i] = v += deltas[i];
    return out;
  }

  function intersect(a, b) {
    const out = [];
    for (let i = 0, j = 0; i < a.length && j < b.length;) {
      if (a[i] === b[j]) { out.push(a[i]); i++; j++; } else if (a[i] < b[j]) i++; else j++;
    }
    return out;
  }

  // 語の見出し: 1 文字ならその文字、2 文字以上なら隣り合う 2 文字すべて。
  // 索引に 3 文字の見出しがあれば（tri）、a-z が 3 つ続くところは 3 文字で引き、それに含まれる 2 文字は引かない
  const LATIN3 = /^[a-z]{3}$/;
  function keysOf(term, tri) {
    if (term.length === 1) return [term];
    const keys = new Set();
    for (let i = 0; i < term.length - 1; i++) {
      if (tri && LATIN3.test(term.slice(i, i + 3))) { keys.add(term.slice(i, i + 3)); continue; }
      if (tri && i > 0 && LATIN3.test(term.slice(i - 1, i + 2))) continue;
      keys.add(term.slice(i, i + 2));
    }
    return [...keys];
  }

  // すべての語の見出しを含む回（候補。2 文字の並びが離れて出てくるだけの回も含む）
  async function candidates(src, terms) {
    const keys = [...new Set(terms.flatMap((t) => keysOf(t, src.meta.trigrams)))];
    const lists = (await Promise.all(keys.map((k) => postings(src, k)))).sort((a, b) => a.length - b.length);
    let c = lists[0];
    for (let i = 1; i < lists.length && c.length; i++) c = intersect(c, lists[i]);
    return c;
  }

  // ── 本文の照合 ──
  function textOf(src, pageNo) {
    const row = src.meta.pages[pageNo];
    const name = row[5] ?? row[1].replace(/\.html$/, '.json');
    if (!src.textCache.has(name)) src.textCache.set(name, getJson(src, 'text/' + encodeURIComponent(name)).catch(() => []));
    return src.textCache.get(name);
  }

  // すべての語を含む議題 → [{ no, text, ranges, firsts }]（firsts は最初の語の出現位置）
  function findHits(parts, terms) {
    const hits = [];
    for (const [no, text] of parts) {
      const nt = N.norm(text);
      if (!terms.every((t) => nt.includes(t))) continue;
      const firsts = [];
      for (let i = nt.indexOf(terms[0]); i !== -1; i = nt.indexOf(terms[0], i + terms[0].length)) firsts.push(i);
      hits.push({ no, text, ranges: N.ranges(nt, terms), firsts });
    }
    return hits;
  }

  // pos の前後の文脈（同じ段落の中だけ）と、発言の中なら発言者
  function snippet(text, pos, ranges) {
    const segStart = text.lastIndexOf('\n', pos) + 1;
    const segEnd = text.indexOf('\n', pos) === -1 ? text.length : text.indexOf('\n', pos);
    const s = Math.max(segStart, pos - CONTEXT);
    const e = Math.min(segEnd, pos + CONTEXT);
    let who = '';
    const mark = text.lastIndexOf(SPEAKER, pos);
    if (mark !== -1 && mark > text.lastIndexOf(SPEECH_END, pos)) {
      const end = text.indexOf('\n', mark);
      who = text.slice(mark + 1, end === -1 ? text.length : end);
    }
    const clean = (x) => esc(x.replace(/[\u0001\u0002]/g, ''));
    let html = s > segStart ? '…' : '';
    let cur = s;
    for (const [a, b] of ranges) {
      if (b <= s || a >= e) continue;
      const a2 = Math.max(a, s);
      const b2 = Math.min(b, e);
      html += clean(text.slice(cur, a2)) + '<mark>' + clean(text.slice(a2, b2)) + '</mark>';
      cur = b2;
    }
    html += clean(text.slice(cur, e)) + (e < segEnd ? '…' : '');
    return { who: who === text.slice(segStart, segEnd).replace(SPEAKER, '') ? '' : who, html };
  }

  // others: 同じ箇所で当たったほかの版の頁（新しい順）
  function renderPage(src, pageNo, hits, q, others = []) {
    const meta = src.meta;
    const [itemNo, page, title, date] = meta.pages[pageNo];
    const [groupNo, label] = meta.items[itemNo];
    const href = `${src.dir}/${esc(page)}?q=${encodeURIComponent(q)}`;
    const otherEds = others.map((p) => `<a href="${src.dir}/${esc(meta.pages[p][1])}?q=${encodeURIComponent(q)}">${esc(meta.pages[p][4][1])}</a>`).join('・');
    const total = hits.reduce((n, h) => n + h.firsts.length, 0);
    let lis = '';
    let shown = 0;
    for (const h of hits) {
      for (const pos of h.firsts) {
        if (shown >= HITS_PER_PAGE) break;
        const sn = snippet(h.text, pos, h.ranges);
        lis += `<li><a href="${href}#${typeof h.no === 'string' ? esc(h.no) : 'p' + h.no}">${sn.who ? `<span class="who">${esc(sn.who)}</span>` : ''}${sn.html}</a></li>`;
        shown++;
      }
    }
    const rest = total - shown;
    return `<article class="entry result">
<div class="entry-meta"><span class="badge">${esc(src.kind)}</span><span class="crumb">${esc(meta.groups[groupNo])} ・ ${esc(label)}${date ? ' ・ ' + esc(date) : ''}</span><span class="source">${total} 箇所</span></div>
<h3 class="hw"><a href="${href}">${esc(title)}</a></h3>
<ul class="kwic">${lis}</ul>${rest > 0 ? `<p class="more-hits"><a href="${href}">ほか ${rest} 箇所 →</a></p>` : ''}${otherEds ? `<p class="ed-others">ほかの版でも該当：${otherEds}</p>` : ''}
</article>`;
  }

  // 候補の頁を、同じ箇所の版ごとの組にする（pages の 5 つ目 [最新版で当たる頁, 版の名前, 版の古い順の番号]）。
  // 組は最新版の頁の順、組の中は新しい版から。版のない頁は 1 頁で 1 組。→ [{ src, ps }]
  function groupEditions(src, cand) {
    const meta = src.meta;
    const groups = new Map();
    for (const p of cand) {
      const key = meta.pages[p][4]?.[0] ?? p;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const rank = (p) => meta.pages[p][4]?.[2] ?? 0;
    return [...groups].sort((a, b) => a[0] - b[0]).map(([, ps]) => ({ src, ps: ps.sort((a, b) => rank(b) - rank(a)) }));
  }

  // 区画ごとの候補を、区画を交互に 1 組ずつ並べる（どの区画の結果も最初から出るように）
  function interleave(lists) {
    const out = [];
    for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
    return out;
  }

  // ── 検索の実行 ──
  // 区画ごとの件数（議事録は「回」、書籍は「頁」）と、全体の箇所数
  function setStatus(r) {
    const done = r.next >= r.cand.length;
    if (done && !r.pages) { statusEl.textContent = '該当する箇所はありません'; return; }
    const counts = r.srcs.map((s) => `${s.kind} ${r.found.get(s)} ${s.meta.unit || '回'}`).join('・');
    statusEl.textContent = `${counts}・${r.hits} 箇所` + (done ? '' : `（候補 ${r.cand.length} 件のうち ${r.next} 件を確認済み）`);
  }

  async function showMore(r) {
    moreWrap.hidden = true;
    let shown = 0;
    while (r.next < r.cand.length && shown < PAGES_PER_BATCH) {
      // 本文を読み込む組（読み込む頁が FETCH_PARALLEL に達するまで。版の多い組は 1 組ずつ）
      const batch = [];
      for (let n = 0; n < FETCH_PARALLEL && r.next + batch.length < r.cand.length;) {
        const g = r.cand[r.next + batch.length];
        batch.push(g);
        n += g.ps.length;
      }
      const texts = await Promise.all(batch.map((g) => Promise.all(g.ps.map((p) => textOf(g.src, p)))));
      if (run !== r) return;
      r.next += batch.length;
      let html = '';
      batch.forEach((g, i) => {
        // 当たった版のうち最も新しいものを出し、ほかは「ほかの版でも該当」に
        const found = g.ps.map((p, j) => ({ p, hits: findHits(texts[i][j], r.terms) })).filter((x) => x.hits.length);
        if (!found.length) return;
        html += renderPage(g.src, found[0].p, found[0].hits, r.q, found.slice(1).map((x) => x.p));
        r.pages++;
        r.found.set(g.src, r.found.get(g.src) + 1);
        r.hits += found[0].hits.reduce((n, h) => n + h.firsts.length, 0);
        shown++;
      });
      results.insertAdjacentHTML('beforeend', html);
      setStatus(r);
    }
    setStatus(r);
    moreWrap.hidden = r.next >= r.cand.length;
  }

  // s は対象の区画（すべてのときは付けない）
  function saveUrl(q, g, srcs) {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (q && g) p.set('g', g);
    if (q && srcs.length < sources.length) p.set('s', srcs.map((s) => s.dir).join(','));
    history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
  }

  // Google アナリティクスに検索語と件数を送る（Enter・検索ボタンでの検索だけ。URL から開き直したときと、直前と同じ語は送らない）。
  // 件数は見つかった回（頁）の数。候補を確かめきっていなければ「20+」のように、その時点の数に + を付ける
  let lastSent = '';
  function sendSearch(q, count) {
    if (!q || q === lastSent || typeof gtag !== 'function') return;
    lastSent = q;
    gtag('event', 'search', { search_term: q.slice(0, 100), result_count: String(count) });
  }

  async function search(send = false) {
    const q = input.value.trim();
    const g = groupSel.value;
    const gName = g === '' || groupSel.disabled ? null : groupSel.selectedOptions[0].textContent;
    const srcs = sources.filter((s) => s.box.checked);
    const r = { q, terms: [], srcs, cand: [], next: 0, pages: 0, hits: 0, found: new Map(srcs.map((s) => [s, 0])) };
    run = r;
    saveUrl(q, g, srcs);
    results.innerHTML = '';
    moreWrap.hidden = true;
    if (!q) { statusEl.textContent = ''; return; }
    if (!srcs.length) { statusEl.textContent = '検索の対象を選んでください'; return; }
    statusEl.textContent = '検索中…';
    try {
      await Promise.all(srcs.map(loadMeta));
      r.terms = N.terms(q);
      const lists = await Promise.all(srcs.map(async (src) => {
        const meta = src.meta;
        let cand = await candidates(src, r.terms);
        if (gName !== null && src.fields) cand = cand.filter((p) => meta.groups[meta.items[meta.pages[p][0]][0]] === gName);
        return groupEditions(src, cand);
      }));
      if (run !== r) return;
      r.cand = interleave(lists);
      await showMore(r);
      if (send && run === r) sendSearch(q, r.next >= r.cand.length ? r.pages : `${r.pages}+`);
    } catch (e) {
      if (run === r) statusEl.textContent = '検索用のデータを読み込めませんでした';
    }
  }

  // 入力中は検索せず、Enter・検索ボタンで検索する
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(true); });
  document.getElementById('fsubmit').addEventListener('click', () => search(true));
  groupSel.addEventListener('change', () => search());
  for (const box of srcBoxes) box.addEventListener('change', () => { syncGroupSel(); search(); });
  document.getElementById('fclear').addEventListener('click', () => { input.value = ''; search(); input.focus(); });
  moreBtn.addEventListener('click', () => { if (run) showMore(run); });

  // 本文のページを開いて戻ってきたとき、「さらに表示」で出していた分まで出し直して、結果一覧のスクロール位置を戻す
  // （結果は戻った後に描き直すので、ブラウザ任せだと先頭に戻ってしまう）。離れるときにその分と位置を履歴に残す
  addEventListener('pagehide', () => {
    if (run && run.q) history.replaceState({ ...history.state, resultNext: run.next, resultScrollY: scrollY }, '');
  });
  const saved = history.state;

  // ?q=…&g=…&s=… で開かれたら、その検索を出す（チェックはブラウザが戻すこともあるので、まず分野の選択を合わせる）
  syncGroupSel();
  const params = new URLSearchParams(location.search);
  if (params.get('q')) {
    input.value = params.get('q');
    groupSel.value = params.get('g') || '';
    if (groupSel.selectedIndex < 0) groupSel.value = '';
    if (params.get('s')) {
      const only = params.get('s').split(',');
      for (const s of sources) s.box.checked = only.includes(s.dir);
    }
    syncGroupSel();
    if (saved?.resultScrollY) history.scrollRestoration = 'manual';
    search().then(async () => {
      if (!saved?.resultScrollY) return;
      const r = run;
      while (run === r && r.next < Math.min(saved.resultNext || 0, r.cand.length)) await showMore(r);
      if (run === r) scrollTo(0, saved.resultScrollY);
    });
  }
})();
