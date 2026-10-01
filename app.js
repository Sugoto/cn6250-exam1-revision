(() => {
  const MODULES = window.MODULES;
  const ALL = MODULES.flatMap(m => m.questions.map(q => ({ ...q, module: m.n })));
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // Wrap numbers, addresses, prefixes and bit patterns in <code> (text-safe, no innerHTML).
  const CODE = /(\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d+)?\b|\b[01]+\*|\/\d+\b|\b\d+(?:[.,]\d+)*(?:\s?(?:Mbps|Gbps|Kbps|bps|ms|bytes|bits|KB|MB|GB|B|b|s)\b)?)/g;
  function rich(text) {
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(CODE)) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      frag.append(el("code", null, m[0]));
      last = m.index + m[0].length;
    }
    frag.append(text.slice(last));
    return frag;
  }
  const richEl = (tag, cls, text) => { const e = el(tag, cls); e.append(rich(text)); return e; };

  const KEY = "cn6250-exam1";
  const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  const state = {
    module: saved.module ?? 1,
    mode: saved.mode ?? "quiz",
    shuffle: saved.shuffle ?? false,
    missed: false,
    results: saved.results ?? {},
    pos: saved.pos ?? {},
  };
  const save = () => localStorage.setItem(KEY, JSON.stringify({
    module: state.module, mode: state.mode, shuffle: state.shuffle, results: state.results, pos: state.pos,
  }));

  let deck = [];
  let idx = 0;

  const pool = () => (state.module ? ALL.filter(q => q.module === state.module) : ALL);

  function buildDeck() {
    deck = pool();
    if (state.missed) deck = deck.filter(q => state.results[q.id] === false);
    if (state.shuffle) {
      deck = deck.slice();
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      idx = 0;
    } else {
      idx = Math.min(state.pos[state.module] ?? 0, Math.max(deck.length - 1, 0));
    }
  }

  // ---- rendering -------------------------------------------------------

  function stemNode(q) {
    const p = el("p", "stem");
    let parts = q.stem.split("\n");
    if (parts.length === 1) {
      const m = q.stem.match(/^(.*[.:])\s+([^.]*\?)$/s);
      if (m) parts = [m[1], m[2]];
    }
    const ask = parts.length > 1 ? parts.pop() : null;
    p.append(rich(parts.join("\n")));
    if (ask) p.append(richEl("span", "ask", ask));
    return p;
  }

  function figureNodes(q) {
    return q.figures.map(f => {
      const fig = el("figure");
      const img = el("img");
      img.src = f.src;
      img.alt = f.caption || "Figure";
      img.loading = "lazy";
      img.addEventListener("click", () => zoom(f.src));
      fig.append(img);
      if (f.caption) fig.append(el("figcaption", null, f.caption));
      return fig;
    });
  }

  function metaNode(q) {
    const m = el("div", "meta");
    m.append(el("span", "tag", `M${q.module} · Q${q.n}`), el("span", null, q.section));
    return m;
  }

  function whyNode(q, outcome) {
    const w = el("div", "why");
    const label =
      outcome === true ? "Correct" :
      outcome === false ? `Answer · ${q.answer}` :
      `Answer · ${q.answer}`;
    w.append(el("span", "lbl " + (outcome === false ? "no" : "ok"), label), rich(q.why));
    return w;
  }

  function optionNodes(q, onPick) {
    const ul = el("ul", "opts");
    const buttons = q.options.map(o => {
      const li = el("li");
      const b = el("button", "opt");
      b.dataset.key = o.key;
      b.append(el("span", "k", q.type === "TF" ? o.key[0] : o.key), richEl("span", null, o.text));
      if (onPick) b.addEventListener("click", () => onPick(o.key));
      li.append(b);
      ul.append(li);
      return b;
    });
    return { ul, buttons };
  }

  function markOptions(buttons, q, picked) {
    buttons.forEach(b => {
      b.disabled = true;
      const k = b.dataset.key;
      if (k === q.answer) b.classList.add("right");
      else if (k === picked) b.classList.add("wrong", "shake");
      else b.classList.add("dim");
    });
  }

  let current = null; // { q, buttons, answered }

  function renderQuiz() {
    const card = $("card");
    card.replaceChildren();
    card.classList.remove("enter");
    void card.offsetWidth;
    card.classList.add("enter");

    if (!deck.length) {
      card.append(el("p", "empty", state.missed ? "Nothing missed here. Nice." : "No questions."));
      current = null;
      updateChrome();
      return;
    }

    const q = deck[idx];
    card.append(metaNode(q), stemNode(q), ...figureNodes(q));
    const { ul, buttons } = optionNodes(q, key => answer(key));
    card.append(ul);
    const reveal = el("button", "reveal", "Show answer");
    reveal.addEventListener("click", () => answer(null));
    card.append(reveal);
    current = { q, buttons, answered: false, reveal };
    updateChrome();
  }

  function answer(key) {
    if (!current || current.answered) return;
    const { q, buttons, reveal } = current;
    current.answered = true;
    reveal.remove();
    markOptions(buttons, q, key);
    const outcome = key == null ? null : key === q.answer;
    if (outcome !== null) {
      state.results[q.id] = outcome;
      save();
    }
    $("card").append(whyNode(q, outcome));
    updateChrome();
  }

  function renderRead() {
    const root = $("read");
    root.replaceChildren();
    let section = null;
    const qs = state.missed ? pool().filter(q => state.results[q.id] === false) : pool();
    if (!qs.length) root.append(el("p", "empty", "Nothing missed here. Nice."));
    for (const q of qs) {
      const head = `M${q.module} · ${q.section}`;
      if (head !== section) {
        section = head;
        root.append(el("h2", null, q.section));
      }
      const card = el("article", "card");
      const { ul, buttons } = optionNodes(q, null);
      card.append(metaNode(q), stemNode(q), ...figureNodes(q), ul);
      markOptions(buttons, q, null);
      card.append(whyNode(q, null));
      root.append(card);
    }
  }

  function updateChrome() {
    const qs = pool();
    const right = qs.filter(q => state.results[q.id] === true).length;
    const wrong = qs.filter(q => state.results[q.id] === false).length;
    const score = $("score");
    score.replaceChildren(el("b", null, `${right} right`), " · ", el("i", null, `${wrong} missed`), ` · ${qs.length - right - wrong} new`);
    $("barFill").style.width = `${((right + wrong) / qs.length) * 100}%`;

    const quiz = state.mode === "quiz";
    $("quiz").hidden = !quiz;
    $("read").hidden = quiz;
    $("pos").textContent = deck.length ? `${idx + 1} / ${deck.length}` : "";
    $("prev").disabled = idx <= 0;
    $("next").disabled = idx >= deck.length - 1;

    document.querySelectorAll("#modules button").forEach(b => b.classList.toggle("on", +b.dataset.m === state.module));
    document.querySelectorAll("#modeSeg button").forEach(b => b.classList.toggle("on", b.dataset.mode === state.mode));
    $("shuffle").checked = state.shuffle;
    $("missed").checked = state.missed;
  }

  function go(delta) {
    const n = idx + delta;
    if (n < 0 || n >= deck.length) return;
    idx = n;
    if (!state.shuffle && !state.missed) { state.pos[state.module] = idx; save(); }
    renderQuiz();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function refresh() {
    buildDeck();
    save();
    if (state.mode === "quiz") renderQuiz();
    else { renderRead(); updateChrome(); }
  }

  // ---- zoom --------------------------------------------------------------

  const dlg = $("zoom");
  function zoom(src) { dlg.querySelector("img").src = src; dlg.showModal(); }
  dlg.addEventListener("click", () => dlg.close());

  // ---- wiring ------------------------------------------------------------

  const nav = $("modules");
  [...MODULES.map(m => ({ n: m.n, label: `M${m.n}`, title: m.title })), { n: 0, label: "All", title: "All modules" }]
    .forEach(({ n, label, title }) => {
      const b = el("button", null, label);
      b.dataset.m = n;
      b.title = title;
      b.addEventListener("click", () => { state.module = n; refresh(); });
      nav.append(b);
    });

  document.querySelectorAll("#modeSeg button").forEach(b =>
    b.addEventListener("click", () => { state.mode = b.dataset.mode; refresh(); }));
  $("shuffle").addEventListener("change", e => { state.shuffle = e.target.checked; refresh(); });
  $("missed").addEventListener("change", e => { state.missed = e.target.checked; refresh(); });
  $("prev").addEventListener("click", () => go(-1));
  $("next").addEventListener("click", () => go(1));
  $("reset").addEventListener("click", () => {
    if (!confirm("Clear all right/missed history?")) return;
    state.results = {};
    state.pos = {};
    state.missed = false;
    refresh();
  });

  document.addEventListener("keydown", e => {
    if (state.mode !== "quiz" || e.metaKey || e.ctrlKey || e.altKey || dlg.open) return;
    const k = e.key.toLowerCase();
    if (k === "arrowright" || (current?.answered && (k === "enter" || k === " "))) { e.preventDefault(); go(1); return; }
    if (k === "arrowleft") { go(-1); return; }
    if (!current || current.answered) return;
    const { q } = current;
    let key = null;
    if (q.type === "TF") key = k === "t" || k === "1" ? "True" : k === "f" || k === "2" ? "False" : null;
    else if ("abcd".includes(k) && k.length === 1) key = k.toUpperCase();
    else if ("1234".includes(k) && k.length === 1) key = "ABCD"[+k - 1];
    else if (k === " " || k === "enter") { e.preventDefault(); answer(null); return; }
    if (key && q.options.some(o => o.key === key)) answer(key);
  });

  refresh();
})();
