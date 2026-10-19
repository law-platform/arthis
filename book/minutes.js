// 一覧の全文検索から開かれたとき（?q=…）は、本文中の検索語を強調し、該当の議題（#pN）か最初の該当箇所へ移る
//   正規化は normalize.js（一覧の検索と同じ）。段落をまたぐ語は強調しない
(async () => {
  const q = new URLSearchParams(location.search).get('q');
  const N = window.MinutesNorm;
  const root = document.querySelector('.minutes');
  if (!q || !N || !root) return;
  await N.load('search/');
  const terms = N.terms(q);
  if (!terms.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    const ranges = N.ranges(N.norm(text), terms);
    if (!ranges.length) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const [s, e] of ranges) {
      frag.append(text.slice(pos, s));
      const m = document.createElement('mark');
      m.textContent = text.slice(s, e);
      frag.append(m);
      pos = e;
    }
    frag.append(text.slice(pos));
    node.replaceWith(frag);
  }
  const target = location.hash && document.getElementById(location.hash.slice(1));
  const first = (target && target.querySelector('mark')) || root.querySelector('mark');
  if (first) first.scrollIntoView({ block: 'center' });
})();

// 原本画像ビューア：国立国会図書館デジタルコレクションの IIIF 画像を本文の横（狭い画面では下）に表示する
//   各カードの data-pid / data-frame がコマを指す。「原本 →」のクリックでそのコマを開き、
//   「本文に連動」が有効なら、スクロールに合わせて表示中の議題のコマに切り替える
//   対訳・版の比較の頁（左右の欄 data-side="L|R"）では、最後に「原本 →」を押した側の列のカードに連動する（初めは左）
//   開いた状態は記憶しない（頁を移ると閉じた状態から始まる）
(() => {
  const OSD_URL = 'https://cdnjs.cloudflare.com/ajax/libs/openseadragon/5.0.1/openseadragon.min.js';
  const allParts = [...document.querySelectorAll('.part[data-frame]')];
  if (!allParts.length) return;
  const sideOf = (el) => el.closest('[data-side]')?.dataset.side ?? null;
  let side = null;
  let parts = allParts;
  function setSide(s) {
    const own = allParts.filter((p) => sideOf(p) === s);
    side = own.length ? s : null;
    parts = side ? own : allParts;
  }
  if (allParts.some((p) => sideOf(p))) setSide(allParts.some((p) => sideOf(p) === 'L') ? 'L' : 'R');

  const iiifInfo = (pid, frame) => `https://dl.ndl.go.jp/api/iiif/${pid}/R${String(frame).padStart(7, '0')}/info.json`;
  const ndlPage = (pid, frame) => `https://dl.ndl.go.jp/pid/${pid}/1/${frame}`;

  // ── 画面部品 ──
  const panel = document.createElement('aside');
  panel.id = 'viewer';
  panel.hidden = true;
  panel.setAttribute('aria-label', '原本画像');
  panel.innerHTML = `
    <div class="viewer-bar">
      <button type="button" data-act="prev" title="前のコマ">‹</button>
      <span class="label"></span>
      <button type="button" data-act="next" title="次のコマ">›</button>
      <label title="スクロールに合わせて表示中の議題のコマに切り替える"><input type="checkbox" checked> 本文に連動</label>
      <span class="spacer"></span>
      <button type="button" data-act="right" title="右頁を拡大">右頁</button>
      <button type="button" data-act="left" title="左頁を拡大">左頁</button>
      <button type="button" data-act="home" title="全体を表示">全体</button>
      <button type="button" data-act="in" title="拡大">＋</button>
      <button type="button" data-act="out" title="縮小">－</button>
      <a class="ndl" target="_blank" rel="noopener">NDL →</a>
      <button type="button" data-act="close" title="閉じる">×</button>
    </div>
    <div id="viewer-canvas"><div class="viewer-msg"></div></div>`;
  document.body.appendChild(panel);
  const label = panel.querySelector('.label');
  const followBox = panel.querySelector('input');
  const ndlLink = panel.querySelector('.ndl');
  const msg = panel.querySelector('.viewer-msg');

  let osd = null;
  let osdLoading = null;
  let shown = null;        // { pid, frame }
  let shownCard = null;

  function loadOsd() {
    if (window.OpenSeadragon) return Promise.resolve();
    osdLoading ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = OSD_URL;
      s.onload = resolve;
      s.onerror = () => reject(new Error('OpenSeadragon を読み込めませんでした'));
      document.head.appendChild(s);
    });
    return osdLoading;
  }

  async function show(pid, frame) {
    frame = Math.max(1, frame);
    if (shown && shown.pid === pid && shown.frame === frame) return;
    shown = { pid, frame };
    label.textContent = `コマ ${frame}`;
    ndlLink.href = ndlPage(pid, frame);
    msg.textContent = '読み込み中…';
    try {
      await loadOsd();
    } catch (e) {
      msg.textContent = e.message;
      return;
    }
    if (!osd) {
      osd = OpenSeadragon({
        element: document.getElementById('viewer-canvas'),
        showNavigationControl: false,
        gestureSettingsMouse: { clickToZoom: false },
        visibilityRatio: 0.5,
        minZoomImageRatio: 0.5,
        animationTime: 0.4,
      });
      osd.addHandler('open', () => { msg.textContent = ''; });
      osd.addHandler('open-failed', () => { msg.textContent = '画像を読み込めませんでした'; });
    }
    osd.open(iiifInfo(pid, frame));
  }

  function markCard(card) {
    if (shownCard === card) return;
    shownCard?.classList.remove('is-shown');
    shownCard = card;
    card?.classList.add('is-shown');
  }

  function showCard(card) {
    markCard(card);
    show(card.dataset.pid, Number(card.dataset.frame));
  }

  // 画面上部 1/4 の位置にかかっている議題
  function currentCard() {
    const line = window.innerHeight * 0.25;
    let cur = parts[0];
    for (const p of parts) {
      if (p.getBoundingClientRect().top <= line) cur = p; else break;
    }
    return cur;
  }

  function open(card) {
    panel.hidden = false;
    document.body.classList.add('viewer-open');
    showCard(card || currentCard());
  }

  function close() {
    panel.hidden = true;
    document.body.classList.remove('viewer-open');
    markCard(null);
  }

  // ── 操作 ──
  panel.addEventListener('click', e => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    const vp = osd?.viewport;
    switch (act) {
      case 'prev':
      case 'next':
        followBox.checked = false;
        markCard(null);
        show(shown.pid, shown.frame + (act === 'next' ? 1 : -1));
        break;
      case 'close': close(); break;
      case 'home': vp?.goHome(); break;
      case 'in': vp?.zoomBy(1.5); break;
      case 'out': vp?.zoomBy(1 / 1.5); break;
      case 'right':
      case 'left': {
        const item = osd?.world.getItemAt(0);
        if (!item) break;
        const b = item.getBounds();
        vp.fitBounds(new OpenSeadragon.Rect(b.x + (act === 'right' ? b.width / 2 : 0), b.y, b.width / 2, b.height));
        break;
      }
    }
  });

  followBox.addEventListener('change', () => { if (followBox.checked) showCard(currentCard()); });

  document.addEventListener('click', e => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const toggle = e.target.closest('[data-viewer-toggle]');
    if (toggle) { panel.hidden ? open() : close(); return; }
    const src = e.target.closest('.part .source');
    if (!src) return;
    e.preventDefault();
    const card = src.closest('.part');
    if (sideOf(card)) setSide(sideOf(card));
    followBox.checked = true;
    open(card);
    card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (panel.hidden || !followBox.checked || ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; showCard(currentCard()); });
  }, { passive: true });

})();

// 一覧の全文検索から開かれたとき（?q=…）は、上端のリンク（#back-link）を「← 検索結果に戻る」にする（司法省日誌と同じ）。
// 一覧から来た場合は、目次などで移動して増えた履歴もまとめて遡って戻る（「さらに表示」で出した分・スクロール位置も
// 一覧の search.js が戻す）。別タブで開いた等で戻る先が無いときは同じ検索語で開き直す
(() => {
  const q = new URLSearchParams(location.search).get('q');
  const link = document.getElementById('back-link');
  if (!q || !link) return;
  link.textContent = '← 検索結果に戻る';
  link.href = 'index.html?' + new URLSearchParams({ q });
  const list = new URL('index.html', location.href).pathname;
  let fromSearch = false;
  try {
    const ref = new URL(document.referrer);
    fromSearch = ref.origin === location.origin && (ref.pathname === list || ref.pathname === list.slice(0, -'index.html'.length));
  } catch (e) {}
  if (!fromSearch) return;
  // このページに来てから増えた履歴の数を、各履歴の state に記録しておく
  let depth = history.state?.backDepth || 0;
  history.replaceState({ ...history.state, backDepth: depth }, '');
  addEventListener('hashchange', () => {
    if (typeof history.state?.backDepth === 'number') depth = history.state.backDepth;
    else history.replaceState({ backDepth: ++depth }, '');
  });
  link.addEventListener('click', (e) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (history.length <= depth + 1) return;
    e.preventDefault();
    history.go(-(depth + 1));
  });
})();

// 版のある巻の頁（書籍）：版の選択（.ed-select）で、その版の同じ条などを含む頁へ移る。検索語（?q=）は引き継ぐ
(() => {
  const sel = document.querySelector('.ed-select');
  if (!sel) return;
  sel.addEventListener('change', () => {
    const url = new URL(sel.value, location.href);
    const q = new URLSearchParams(location.search).get('q');
    if (q) url.searchParams.set('q', q);
    location.href = url;
  });
})();
