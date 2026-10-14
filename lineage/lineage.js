// 条文の沿革のページ (lineage/): 表示を切り替える
//   段階ごと (data-view="step"): 段階を 1 つずつ出す。画面の左右の ◁ ▷ か ← → キーで移る
//   一覧 (data-view="all"): 段階を縦に並べる。条文のみ (data-view="text"): 資料を隠して各段階の条文を続けて並べる
//   「前の段階との違い」のスイッチで、加わった文字・削られた文字の印を出すか消すかを切り替える
//   既定は段階ごと・印あり。選んだものはこのブラウザに覚えておく (保存できなくても動く)。?view=all などでも開ける
//   上端の段階の一覧で、見ている段階に印を付ける。#s3 のようなリンクで開いたときは、その段階を出す
(() => {
  const steps = document.querySelector('.lin-steps');
  if (!steps) return;
  const stepper = document.querySelector('.lin-stepper');
  const sections = [...steps.querySelectorAll('.lin-stage')];
  const links = [...stepper.querySelectorAll('a[data-step]')];
  const viewButtons = [...stepper.querySelectorAll('.lin-view button')];
  const diffBox = stepper.querySelector('.lin-diff-toggle input');
  const prevBtn = steps.querySelector('[data-go="-1"]');
  const nextBtn = steps.querySelector('[data-go="1"]');
  const VIEW = 'lineage-view', DIFF = 'lineage-diff';
  // 上端に固定したもの (「← 条文の沿革」の帯と段階の一覧) の下端の位置
  const stuckBottom = () => stepper.offsetHeight + (parseFloat(getComputedStyle(stepper).top) || 0);
  let current = 0;

  const load = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 保存できなくてもよい */ } };

  function mark(i) {
    links.forEach((a, k) => {
      a.classList.toggle('is-current', k === i);
      if (k === i) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current');
    });
  }

  // 段階ごとの表示で i 番目を出す
  function show(i, scroll) {
    current = Math.max(0, Math.min(sections.length - 1, i));
    sections.forEach((s, k) => s.classList.toggle('is-current', k === current));
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === sections.length - 1;
    mark(current);
    history.replaceState(null, '', '#' + sections[current].id);
    if (scroll) {
      const top = steps.getBoundingClientRect().top + window.scrollY - stuckBottom() - 8;
      if (window.scrollY > top) window.scrollTo({ top });
    }
  }

  function setView(v, keep) {
    steps.dataset.view = v;
    viewButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    if (keep) save(VIEW, v);
    if (v === 'step') show(current, false);
    else { sections.forEach(s => s.classList.remove('is-current')); mark(current); if (keep) sections[current].scrollIntoView(); }
  }

  function setDiff(on, keep) {
    steps.classList.toggle('no-diff', !on);
    diffBox.checked = on;
    if (keep) save(DIFF, on ? '1' : '0');
  }

  // 一覧・条文のみの表示: スクロールに合わせて、見ている段階に印を付ける
  window.addEventListener('scroll', () => {
    if (steps.dataset.view === 'step') return;
    const line = stuckBottom() + 24;
    let i = 0;
    sections.forEach((s, k) => { if (s.getBoundingClientRect().top <= line) i = k; });
    if (i !== current) { current = i; mark(i); }
  }, { passive: true });

  links.forEach((a, k) => a.addEventListener('click', e => {
    if (steps.dataset.view !== 'step') { current = k; mark(k); return; }
    e.preventDefault();
    show(k, true);
  }));
  viewButtons.forEach(b => b.addEventListener('click', () => setView(b.dataset.view, true)));
  diffBox.addEventListener('change', () => setDiff(diffBox.checked, true));
  prevBtn.addEventListener('click', () => show(current - 1, true));
  nextBtn.addEventListener('click', () => show(current + 1, true));
  document.addEventListener('keydown', e => {
    if (steps.dataset.view !== 'step' || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowLeft' && current > 0) show(current - 1, true);
    if (e.key === 'ArrowRight' && current < sections.length - 1) show(current + 1, true);
  });

  const fromHash = sections.findIndex(s => '#' + s.id === location.hash);
  current = fromHash >= 0 ? fromHash : 0;
  const param = new URLSearchParams(location.search).get('view');
  const view = ['step', 'all', 'text'].includes(param) ? param : load(VIEW);
  setDiff(load(DIFF) !== '0', false);
  setView(['step', 'all', 'text'].includes(view) ? view : 'step', false);
  if (steps.dataset.view !== 'step' && fromHash >= 0) sections[current].scrollIntoView();
})();
