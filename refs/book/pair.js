// 対訳・版の比較の頁：「左右に並べる」と「交互に並べる」の切り替え（選んだ表示は次の頁でも使う）
//   狭い画面では style.css が常に交互にする
(() => {
  const root = document.querySelector('.pair');
  if (!root) return;
  const KEY = 'pair-layout';
  const buttons = [...document.querySelectorAll('[data-layout-btn]')];

  function set(layout) {
    root.dataset.layout = layout;
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.layoutBtn === layout));
    try { localStorage.setItem(KEY, layout); } catch { /* 保存できなくても動作には影響しない */ }
  }

  let saved = 'side';
  try { saved = localStorage.getItem(KEY) || 'side'; } catch { /* 既定の左右のまま */ }
  set(saved === 'alt' ? 'alt' : 'side');
  for (const b of buttons) b.addEventListener('click', () => set(b.dataset.layoutBtn));
})();
