// 本文の全文検索（一覧ページ。議事録 minutes/ と書籍 book/ で共通）
//   search/pages.json     ページの一覧（索引での番号の順）と、索引を分けたファイルの数、件数の単位（unit）
//   search/idx/NNN.json   見出し（正規化した 1 文字・隣り合う 2 文字）→ それを含む議事録の番号（差分で並べたもの）
//   search/text/<ページ>.json  議題ごとの本文。候補の回だけ読み込み、語を含む議題を確かめて前後の文脈を出す
//   見出しの作り方と振り分けの式は program/minutes_search.cs と同じ
//   版のある巻（書籍の book_index.json の editions）は、同じ箇所（最新版で当たる頁）の結果を 1 件にまとめ、
//   新しい版の結果を出して、ほかに当たった版を「ほかの版でも該当」に並べる
(() => {
  const BASE = 'search/';
  const PAGES_PER_BATCH = 20;   // 「さらに表示」1 回で出す回数
  const FETCH_PARALLEL = 6;     // 本文を同時に読み込む数
  const HITS_PER_PAGE = 5;      // 1 回の中で文脈を出す箇所数
  const CONTEXT = 40;           // 文脈の前後の文字数
  const SPEAKER = '\u0001';     // 本文中の発言者名の前の印
  const SPEECH_END = '\u0002';  // 本文中の発言の終わりの印

  const N = window.MinutesNorm;
  const input = document.getElementById('fq');
  const groupSel = document.getElementById('fgroup');
  const statusEl = document.getElementById('fstatus');
  const results = document.getElementById('results');
  const moreWrap = document.getElementById('more-wrap');
  const moreBtn = document.getElementById('more');
  const browse = document.getElementById('browse');

  let meta = null;
  const shardCache = new Map();
  const textCache = new Map();
  let run = null;   // 実行中の検索（新しい検索が始まったら古い結果は捨てる）

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function getJson(path) {
    const r = await fetch(BASE + path);
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }

  async function loadMeta() {
    if (meta) return;
    const [m] = await Promise.all([getJson('pages.json'), N.load(BASE)]);
    meta = m;
  }

  // ── 索引 ──
  function shardOf(key) {
    const h = key.length === 1 ? key.charCodeAt(0) : key.charCodeAt(0) * 31 + key.charCodeAt(1);
    return h % meta.shards;
  }

  function shard(i) {
    if (!shardCache.has(i)) shardCache.set(i, getJson(`idx/${String(i).padStart(3, '0')}.json`));
    return shardCache.get(i);
  }

  async function postings(key) {
    const deltas = (await shard(shardOf(key)))[key];
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

  // 語の見出し: 1 文字ならその文字、2 文字以上なら隣り合う 2 文字すべて
  function keysOf(term) {
    if (term.length === 1) return [term];
    const keys = new Set();
    for (let i = 0; i < term.length - 1; i++) keys.add(term.slice(i, i + 2));
    return [...keys];
  }

  // すべての語の見出しを含む回（候補。2 文字の並びが離れて出てくるだけの回も含む）
  async function candidates(terms) {
    const keys = [...new Set(terms.flatMap(keysOf))];
    const lists = (await Promise.all(keys.map(postings))).sort((a, b) => a.length - b.length);
    let c = lists[0];
    for (let i = 1; i < lists.length && c.length; i++) c = intersect(c, lists[i]);
    return c;
  }

  // ── 本文の照合 ──
  function textOf(pageNo) {
    const name = meta.pages[pageNo][1].replace(/\.html$/, '.json');
    if (!textCache.has(name)) textCache.set(name, getJson('text/' + encodeURIComponent(name)).catch(() => []));
    return textCache.get(name);
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
  function renderPage(pageNo, hits, q, others = []) {
    const [itemNo, page, title, date] = meta.pages[pageNo];
    const [groupNo, label] = meta.items[itemNo];
    const href = `${esc(page)}?q=${encodeURIComponent(q)}`;
    const otherEds = others.map((p) => `<a href="${esc(meta.pages[p][1])}?q=${encodeURIComponent(q)}">${esc(meta.pages[p][4][1])}</a>`).join('・');
    const total = hits.reduce((n, h) => n + h.firsts.length, 0);
    let lis = '';
    let shown = 0;
    for (const h of hits) {
      for (const pos of h.firsts) {
        if (shown >= HITS_PER_PAGE) break;
        const sn = snippet(h.text, pos, h.ranges);
        lis += `<li><a href="${href}#p${h.no}">${sn.who ? `<span class="who">${esc(sn.who)}</span>` : ''}${sn.html}</a></li>`;
        shown++;
      }
    }
    const rest = total - shown;
    return `<article class="entry result">
<div class="entry-meta"><span class="badge">${esc(meta.groups[groupNo])}</span><span class="crumb">${esc(label)}${date ? ' ・ ' + esc(date) : ''}</span><span class="source">${total} 箇所</span></div>
<h3 class="hw"><a href="${href}">${esc(title)}</a></h3>
<ul class="kwic">${lis}</ul>${rest > 0 ? `<p class="more-hits"><a href="${href}">ほか ${rest} 箇所 →</a></p>` : ''}${otherEds ? `<p class="ed-others">ほかの版でも該当：${otherEds}</p>` : ''}
</article>`;
  }

  // 候補の頁を、同じ箇所の版ごとの組にする（pages の 5 つ目 [最新版で当たる頁, 版の名前, 版の古い順の番号]）。
  // 組は最新版の頁の順、組の中は新しい版から。版のない頁は 1 頁で 1 組
  function groupEditions(cand) {
    const groups = new Map();
    for (const p of cand) {
      const key = meta.pages[p][4]?.[0] ?? p;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const rank = (p) => meta.pages[p][4]?.[2] ?? 0;
    return [...groups].sort((a, b) => a[0] - b[0]).map(([, ps]) => ps.sort((a, b) => rank(b) - rank(a)));
  }

  // ── 検索の実行 ──
  function setStatus(r) {
    const done = r.next >= r.cand.length;
    const unit = meta.unit || '回';   // 議事録は「回」、書籍は「頁」
    if (done && !r.pages) { statusEl.textContent = '該当する箇所はありません'; return; }
    statusEl.textContent = `${r.pages} ${unit}・${r.hits} 箇所` + (done ? '' : `（候補 ${r.cand.length} ${unit}のうち ${r.next} ${unit}を確認済み）`);
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
        n += g.length;
      }
      const texts = await Promise.all(batch.map((g) => Promise.all(g.map(textOf))));
      if (run !== r) return;
      r.next += batch.length;
      let html = '';
      batch.forEach((g, i) => {
        // 当たった版のうち最も新しいものを出し、ほかは「ほかの版でも該当」に
        const found = g.map((p, j) => ({ p, hits: findHits(texts[i][j], r.terms) })).filter((x) => x.hits.length);
        if (!found.length) return;
        html += renderPage(found[0].p, found[0].hits, r.q, found.slice(1).map((x) => x.p));
        r.pages++;
        r.hits += found[0].hits.reduce((n, h) => n + h.firsts.length, 0);
        shown++;
      });
      results.insertAdjacentHTML('beforeend', html);
      setStatus(r);
    }
    setStatus(r);
    moreWrap.hidden = r.next >= r.cand.length;
  }

  function saveUrl(q, g) {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (q && g) p.set('g', g);
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
    const r = { q, terms: [], cand: [], next: 0, pages: 0, hits: 0 };
    run = r;
    saveUrl(q, g);
    results.innerHTML = '';
    moreWrap.hidden = true;
    if (!q) { statusEl.textContent = ''; browse.hidden = false; return; }
    browse.hidden = true;
    statusEl.textContent = '検索中…';
    try {
      await loadMeta();
      r.terms = N.terms(q);
      let cand = await candidates(r.terms);
      if (g !== '') cand = cand.filter((p) => meta.items[meta.pages[p][0]][0] === Number(g));
      if (run !== r) return;
      r.cand = groupEditions(cand);
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
  document.getElementById('fclear').addEventListener('click', () => { input.value = ''; search(); input.focus(); });
  moreBtn.addEventListener('click', () => { if (run) showMore(run); });

  // 本文のページを開いて戻ってきたとき、「さらに表示」で出していた分まで出し直して、結果一覧のスクロール位置を戻す
  // （結果は戻った後に描き直すので、ブラウザ任せだと先頭に戻ってしまう）。離れるときにその分と位置を履歴に残す
  addEventListener('pagehide', () => {
    if (run && run.q) history.replaceState({ ...history.state, resultNext: run.next, resultScrollY: scrollY }, '');
  });
  const saved = history.state;

  // ?q=…&g=… で開かれたら、その検索を出す
  const params = new URLSearchParams(location.search);
  if (params.get('q')) {
    input.value = params.get('q');
    groupSel.value = params.get('g') || '';
    if (saved?.resultScrollY) history.scrollRestoration = 'manual';
    search().then(async () => {
      if (!saved?.resultScrollY) return;
      const r = run;
      while (run === r && r.next < Math.min(saved.resultNext || 0, r.cand.length)) await showMore(r);
      if (run === r) scrollTo(0, saved.resultScrollY);
    });
  }
})();
