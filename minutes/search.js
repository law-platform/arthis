// 本文の全文検索（一覧ページ）
//   search/pages.json     議事録の一覧（索引での番号の順）と、索引を分けたファイルの数
//   search/idx/NNN.json   見出し（正規化した 1 文字・隣り合う 2 文字）→ それを含む議事録の番号（差分で並べたもの）
//   search/text/<ページ>.json  議題ごとの本文。候補の回だけ読み込み、語を含む議題を確かめて前後の文脈を出す
//   見出しの作り方と振り分けの式は program/minutes_search.cs と同じ
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

  function renderPage(pageNo, hits, q) {
    const [itemNo, page, title, date] = meta.pages[pageNo];
    const [groupNo, label] = meta.items[itemNo];
    const href = `${esc(page)}?q=${encodeURIComponent(q)}`;
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
<ul class="kwic">${lis}</ul>${rest > 0 ? `<p class="more-hits"><a href="${href}">ほか ${rest} 箇所 →</a></p>` : ''}
</article>`;
  }

  // ── 検索の実行 ──
  function setStatus(r) {
    const done = r.next >= r.cand.length;
    if (done && !r.pages) { statusEl.textContent = '該当する箇所はありません'; return; }
    statusEl.textContent = `${r.pages} 回・${r.hits} 箇所` + (done ? '' : `（候補 ${r.cand.length} 回のうち ${r.next} 回を確認済み）`);
  }

  async function showMore(r) {
    moreWrap.hidden = true;
    let shown = 0;
    while (r.next < r.cand.length && shown < PAGES_PER_BATCH) {
      const batch = r.cand.slice(r.next, r.next + FETCH_PARALLEL);
      const texts = await Promise.all(batch.map(textOf));
      if (run !== r) return;
      r.next += batch.length;
      let html = '';
      batch.forEach((pageNo, i) => {
        const hits = findHits(texts[i], r.terms);
        if (!hits.length) return;
        html += renderPage(pageNo, hits, r.q);
        r.pages++;
        r.hits += hits.reduce((n, h) => n + h.firsts.length, 0);
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

  async function search() {
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
      r.cand = cand;
      await showMore(r);
    } catch (e) {
      if (run === r) statusEl.textContent = '検索用のデータを読み込めませんでした';
    }
  }

  // 入力中は検索せず、Enter・検索ボタンで検索する
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  document.getElementById('fsubmit').addEventListener('click', search);
  groupSel.addEventListener('change', search);
  document.getElementById('fclear').addEventListener('click', () => { input.value = ''; search(); input.focus(); });
  moreBtn.addEventListener('click', () => { if (run) showMore(run); });

  // ?q=…&g=… で開かれたら、その検索を出す
  const params = new URLSearchParams(location.search);
  if (params.get('q')) {
    input.value = params.get('q');
    groupSel.value = params.get('g') || '';
    search();
  }
})();
