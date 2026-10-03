import { DB, clubRank, seasonTotal } from "../data.js";
import { record, box, prefs } from "../store.js";
import { $, esc, clubTag, filterPanel, loadFilter, shuffle, ordinal } from "../ui.js";

export function render(el, params) {
  const filter = loadFilter("flashcards", params, 5);
  let opts = { order: "shuffle", onlyWeak: false, ...prefs.get("flash-opts", {}) };
  let deck = [], i = 0, known = 0, learning = 0;

  el.innerHTML = `
    <div class="studywrap">
      <div class="pagehead"><h1>Flashcards</h1><span class="sub">Click the card or press space to flip ·
        <span class="kbd">1</span> still learning · <span class="kbd">2</span> know it · <span class="kbd">←</span><span class="kbd">→</span> move</span></div>
      <div id="fc-filter"></div>
      <div id="fc-body"></div>
    </div>`;

  const extra = () => `
    <div class="ctl"><label for="fc-order">Order</label><select id="fc-order">
      <option value="shuffle"${opts.order === "shuffle" ? " selected" : ""}>Shuffled</option>
      <option value="goals"${opts.order === "goals" ? " selected" : ""}>Most goals first</option>
      <option value="season"${opts.order === "season" ? " selected" : ""}>By season & club</option>
    </select></div>
    <label class="ctl check"><input type="checkbox" id="fc-weak" ${opts.onlyWeak ? "checked" : ""}> Skip mastered</label>`;

  const panel = filterPanel($("#fc-filter", el), "flashcards", filter, (f, rows) => {
    build(rows);
    bindOpts();
  }, extra());

  function bindOpts() {
    const o = $("#fc-order", el), w = $("#fc-weak", el);
    if (!o) return;
    o.onchange = () => { opts.order = o.value; prefs.set("flash-opts", opts); panel.refresh(); };
    w.onchange = () => { opts.onlyWeak = w.checked; prefs.set("flash-opts", opts); panel.refresh(); };
  }

  function build(rows) {
    let d = opts.onlyWeak ? rows.filter((r) => box(r) < 3) : rows;
    if (opts.order === "shuffle") d = shuffle(d);
    else if (opts.order === "goals") d = [...d].sort((a, b) => b.g - a.g);
    else d = [...d].sort((a, b) => a.s - b.s || DB.clubs[a.c].localeCompare(DB.clubs[b.c]) || b.g - a.g);
    deck = d;
    i = 0; known = 0; learning = 0;
    show();
  }

  function show() {
    const body = $("#fc-body", el);
    if (!deck.length) {
      body.innerHTML = `<div class="empty">No cards in this deck — widen the filter${opts.onlyWeak ? " or untick “Skip mastered”" : ""}.</div>`;
      return;
    }
    if (i >= deck.length) {
      body.innerHTML = `
        <div class="qcard" style="text-align:center">
          <div class="qlabel">Deck complete</div>
          <div class="result-big">${known} / ${known + learning}</div>
          <p>marked as known this run.</p>
          <div class="btnrow" style="justify-content:center">
            <button class="btn" data-again>Go again</button>
            ${learning ? `<button class="btn ghost" data-weak>Study the ${learning} I missed</button>` : ""}
          </div>
        </div>`;
      $("[data-again]", body).onclick = () => build(deck);
      const weak = $("[data-weak]", body);
      if (weak) weak.onclick = () => build(deck.filter((r) => box(r) < 2));
      return;
    }
    const r = deck[i];
    const total = seasonTotal(r.p, r.s);
    body.innerHTML = `
      <div class="progressmeta"><span>Card ${i + 1} of ${deck.length}</span>
        <span><span style="color:var(--green)">${known} known</span> · <span style="color:var(--red)">${learning} learning</span></span></div>
      <div class="progressbar"><i style="width:${(i / deck.length) * 100}%"></i></div>
      <div class="flashcard" id="card">
        <div class="inner">
          <div class="face front">
            <div class="who">${esc(DB.players[r.p])}</div>
            <div class="ctx">${clubTag(r.c)} <span class="muted">·</span> <b>${DB.seasons[r.s]}</b></div>
            <div class="extra">How many Premier League goals?</div>
            <div class="hint">click or space to flip</div>
          </div>
          <div class="face back">
            <div class="goals">${r.g}</div>
            <div class="ctx">${esc(DB.players[r.p])} · ${clubTag(r.c)} · ${DB.seasons[r.s]}</div>
            <div class="extra">${ordinal(clubRank(r))} highest scorer at the club that season${total !== r.g ? ` · ${total} total that season across clubs` : ""}</div>
          </div>
        </div>
      </div>
      <div class="btnrow" style="justify-content:center">
        <button class="btn ghost" data-prev ${i === 0 ? "disabled" : ""}>‹ Back</button>
        <button class="btn red" data-no>Still learning <span class="kbd" style="color:#fff">1</span></button>
        <button class="btn" data-yes>Know it <span class="kbd" style="color:#fff">2</span></button>
        <button class="btn ghost" data-skip>Skip ›</button>
      </div>`;
    $("#card", body).onclick = flip;
    $("[data-no]", body).onclick = () => answer(false);
    $("[data-yes]", body).onclick = () => answer(true);
    $("[data-prev]", body).onclick = () => { i = Math.max(0, i - 1); show(); };
    $("[data-skip]", body).onclick = () => { i++; show(); };
  }

  function flip() {
    $("#card", el)?.classList.toggle("flipped");
  }

  function answer(ok) {
    if (i >= deck.length) return;
    record(deck[i], ok);
    ok ? known++ : learning++;
    i++;
    show();
  }

  function onKey(e) {
    if (e.target.matches("input, select, textarea")) return;
    if (e.key === " ") { e.preventDefault(); flip(); }
    else if (e.key === "1") answer(false);
    else if (e.key === "2") answer(true);
    else if (e.key === "ArrowRight") { if (i < deck.length) { i++; show(); } }
    else if (e.key === "ArrowLeft") { i = Math.max(0, i - 1); show(); }
  }
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}
