// 検索語と本文の正規化（juridic の app.js と同じ。索引を作る program/minutes_search.cs の NormChar とも同じ）
//   1文字ずつ正規化し、UTF-16 の長さを変えない。正規化後の文字列で見つけた位置が
//   そのまま原文の位置になるので、強調表示を原文に戻せる。
window.MinutesNorm = (() => {
  let OLD2NEW = {};
  let loading = null;
  const cache = new Map();

  function normChar(ch) {
    let r = cache.get(ch);
    if (r !== undefined) return r;
    // 全角英数→半角、アクセント除去、小文字化
    r = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase();
    // 旧字→新字
    r = OLD2NEW[r] || r;
    // カタカナ→ひらがな
    if (r.length === 1) {
      const c = r.charCodeAt(0);
      if (c >= 0x30a1 && c <= 0x30f6) r = String.fromCharCode(c - 0x60);
    }
    if (r.length !== ch.length) {
      r = ch.toLowerCase();
      if (r.length !== ch.length) r = ch;
    }
    cache.set(ch, r);
    return r;
  }

  function norm(s) {
    let out = '';
    for (const ch of s) out += normChar(ch);
    return out;
  }

  // 旧字→新字の対応表（search/norm.json）を読み込む。読めなくても他の正規化は効く
  function load(base) {
    loading ??= fetch(base + 'norm.json')
      .then(r => (r.ok ? r.json() : {}))
      .then(t => { OLD2NEW = t; cache.clear(); })
      .catch(() => {});
    return loading;
  }

  // 検索語: 空白区切り、正規化済み、重複なし
  function terms(q) {
    return [...new Set(q.trim().split(/\s+/).map(norm).filter(Boolean))];
  }

  // 正規化済みの text の中の各語の位置 → [[start, end], ...]（重なりはまとめる）
  function ranges(text, termList) {
    const out = [];
    for (const t of termList) {
      for (let i = text.indexOf(t); i !== -1; i = text.indexOf(t, i + t.length)) out.push([i, i + t.length]);
    }
    out.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [];
    for (const r of out) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    }
    return merged;
  }

  return { load, norm, terms, ranges };
})();
