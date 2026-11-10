/* Screens and interaction. Learning content is in content.js, interview and voice logic in engine.js. */
(function () {
  "use strict";
  const C = window.CONTENT;
  const { Voice, ScriptedInterviewer, ManualAnswer, RecordingAnswer, Listening, checkAnswer, shuffle } = window.Engine;
  const view = document.getElementById("view");

  /* ---------- Storage (per browser, safe to lose) ---------- */
  const KEY = "vorsprache.v1";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const saved = Object.assign({ lang: "de", speed: 1, wrong: {}, seen: {}, boxes: {}, packed: {}, tests: [], interviews: 0, appt: "", claudeOk: false }, load());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* page still works */ } };
  Voice.setRate(saved.speed);

  /* ---------- State ---------- */
  const TABS = {
    start: ["Start", "Start"], lernen: ["Lernen", "Learn"], test: ["Test", "Test"],
    offen: ["Offene Fragen", "Open questions"], schriftlich: ["Interview schriftlich", "Written interview"], audio: ["Interview Audio", "Audio interview"]
  };
  const initialTab = () => { const h = location.hash.slice(1); return TABS[h] ? h : "start"; };
  const S = {
    tab: initialTab(), learn: "grund",
    test: null, testResult: null, topic: "fdgo",
    open: { topic: "all", cur: null, text: "", checked: null, hint: false },
    w: null, wLength: "kurz",
    a: null, aLength: "kurz", aShowText: false, aReadSample: true, aAuto: 0,
    server: null, aListen: true, aPause: 3500
  };

  /* ---------- Translation helpers ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const glossTerms = C.glossary.slice().sort((a, b) => b[2].length - a[2].length);
  const glossRe = new RegExp("(?<![\\p{L}])(?:" + glossTerms.map((g) => "(" + g[2].replace(/\((?!\?)/g, "(?:") + ")").join("|") + ")(?![\\p{L}])", "gu");
  const gloss = (text) => esc(text).replace(glossRe, (m, ...groups) => {
    const i = groups.findIndex((g) => typeof g === "string" && g === m);
    return i < 0 || !glossTerms[i] ? m : `<span class="g" tabindex="0" data-tip="${esc(glossTerms[i][1])}">${m}</span>`;
  });

  /* A sentence of content: German with an EN tooltip, both stacked, or English with a DE tooltip. */
  function T(pair, opts = {}) {
    const de = opts.gloss === false ? esc(pair[0]) : gloss(pair[0]);
    if (saved.lang === "both") return `<span class="tx both"><span lang="de">${de}</span><span class="sub" lang="en">${esc(pair[1])}</span></span>`;
    if (saved.lang === "en") return `<span class="tx"><span lang="en">${esc(pair[1])}</span>${chip("DE", pair[0])}</span>`;
    return `<span class="tx"><span lang="de">${de}</span>${chip("EN", pair[1])}</span>`;
  }
  const chip = (label, text) => `<button type="button" class="chip" data-tip="${esc(text)}" aria-label="${label === "EN" ? "English translation" : "Deutscher Text"}: ${esc(text)}">${label}</button>`;
  /* A short label inside a button or link, where a nested chip is not allowed. */
  function L(de, en) {
    if (saved.lang === "both") return `<span lang="de">${esc(de)}</span>&nbsp;<small lang="en" style="font-weight:400;opacity:.75">${esc(en)}</small>`;
    if (saved.lang === "en") return `<span lang="en" data-tip="${esc(de)}">${esc(en)}</span>`;
    return `<span lang="de" data-tip="${esc(en)}">${esc(de)}</span>`;
  }
  const pick = (de, en) => (saved.lang === "en" ? en : de);

  const ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z"/></svg>';
  const play = (text, role = "officer") => `<button type="button" class="play" data-act="say" data-say="${esc(text)}" data-role="${role}" aria-label="${pick("Vorlesen", "Listen")}">${ICON}</button>`;
  const line = (pair, role = "officer") => `<div class="line">${play(pair[0], role)}<div class="body">${T(pair)}</div></div>`;

  /* ---------- Shell ---------- */
  function renderShell() {
    document.getElementById("tabs").innerHTML = Object.entries(TABS).map(([id, name]) =>
      `<a href="#${id}" data-tab="${id}" ${S.tab === id ? 'aria-current="page"' : ""}>${esc(saved.lang === "en" ? name[1] : name[0])}${saved.lang === "both" ? `<small>${esc(name[1])}</small>` : ""}</a>`).join("");
    document.getElementById("lang-seg").innerHTML = [["de", "DE"], ["both", "DE+EN"], ["en", "EN"]].map(([v, l]) =>
      `<button type="button" data-act="lang" data-v="${v}" aria-pressed="${saved.lang === v}">${l}</button>`).join("");
    document.getElementById("speed-seg").innerHTML = [[1, "1×"], [0.85, "0,85×"], [0.7, "0,7×"]].map(([v, l]) =>
      `<button type="button" data-act="speed" data-v="${v}" aria-pressed="${saved.speed === v}">${l}</button>`).join("");
    document.getElementById("lang-label").textContent = pick("Sprache", "Language");
    document.getElementById("speed-label").textContent = pick("Tempo", "Speed");
    const nav = document.getElementById("tabs"), active = nav.querySelector('[aria-current="page"]');
    if (active) nav.scrollLeft = Math.max(0, active.offsetLeft - nav.offsetLeft - 16);
  }
  function render() {
    hideTip();
    renderShell();
    view.innerHTML = VIEWS[S.tab]();
    document.documentElement.lang = saved.lang === "en" ? "en" : "de";
  }
  function go(tab) {
    Voice.stop();
    S.tab = tab;
    try { history.replaceState(null, "", "#" + tab); } catch (e) { /* fine */ }
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- Start ---------- */
  const berlinToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const validDate = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || "") && !isNaN(Date.parse(iso + "T00:00:00Z"));
  const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  function daysLeft() {
    const toDay = (iso) => Date.parse(iso + "T00:00:00Z");
    return Math.round((toDay(saved.appt) - toDay(berlinToday())) / 864e5);
  }
  function longDate(iso, lang) {
    return new Date(iso + "T12:00:00Z").toLocaleDateString(lang === "en" ? "en-GB" : "de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  }
  function viewStart() {
    const hasDate = validDate(saved.appt), left = hasDate ? daysLeft() : null, today = berlinToday();
    const countLabel = left > 1 ? pick("Tage", "days") : left === 1 ? pick("Tag", "day") : left === 0 ? pick("heute", "today") : pick("vorbei", "past");
    const tests = saved.tests, best = tests.length ? Math.max(...tests.map((t) => t.score)) : null;
    const sure = C.open.filter((q) => (saved.boxes[q.id] || 0) >= 2).length;
    const fmt = (iso) => { const [, m, d] = iso.split("-"); return `${d}.${m}.`; };
    const planRows = C.plan.map((p) => {
      const date = hasDate ? addDays(saved.appt, p.day) : null;
      const label = date ? fmt(date) : p.day === 0 ? pick("Termin", "Day") : `${pick("Tag", "Day")} ${p.day + 7}`;
      return { ...p, date, label };
    });
    return `<div class="stack">
      <section class="hero">
        ${hasDate ? `<div class="count">${Math.max(left, 0)}<small>${countLabel}</small></div>` : ""}
        <div style="min-width:0;display:grid;gap:8px">
          <h1>${hasDate ? T([`Ihr Termin: ${longDate(saved.appt, "de")}`, `Your appointment: ${longDate(saved.appt, "en")}`], { gloss: false }) : T(["Ihr Einbürgerungstermin", "Your naturalisation appointment"], { gloss: false })}</h1>
          <p class="muted">${esc(C.appointment.place)}</p>
          <div class="row"><label class="small" for="appt">${esc(pick("Datum Ihres Termins", "Date of your appointment"))}</label>
            <input type="date" class="sel" id="appt" data-act="appt" value="${esc(hasDate ? saved.appt : "")}"></div>
          <p class="small muted">${T(["Das Datum bleibt nur in diesem Browser gespeichert.", "The date is stored only in this browser."], { gloss: false })}</p>
        </div>
      </section>
      <section class="modes" aria-label="${pick("Übungen", "Exercises")}">
        ${modeCard("test", ["Test", "Test"], ["33 Fragen wie beim Einbürgerungstest, oder Training nach Thema.", "33 questions like the citizenship test, or training by topic."], best === null ? pick("noch kein Test", "no test yet") : pick(`bestes Ergebnis ${best}/33`, `best score ${best}/33`))}
        ${modeCard("offen", ["Offene Fragen", "Open questions"], ["Tippen Sie Ihre Antwort auf Deutsch und vergleichen Sie sie mit einer Musterantwort.", "Type your answer in German and compare it with a model answer."], pick(`${sure} von ${C.open.length} sicher`, `${sure} of ${C.open.length} secure`))}
        ${modeCard("schriftlich", ["Interview schriftlich", "Written interview"], ["Das Gespräch im Amt als Chat, Schritt für Schritt.", "The conversation at the office as a chat, step by step."], pick(`${saved.interviews} Interviews geübt`, `${saved.interviews} interviews practised`))}
        ${modeCard("audio", ["Interview Audio", "Audio interview"], ["Die Sachbearbeiterin spricht, Sie antworten laut.", "The caseworker speaks, you answer out loud."], pick("deutsche Neural-Stimmen", "German neural voices"))}
      </section>
      <div class="grid-2">
        <section class="sheet">
          <div class="label">${L("Plan für die letzten sieben Tage", "Plan for the last seven days")}</div>
          <ol class="plan">${planRows.map((p) => `<li class="${!p.date ? "" : p.date === today ? "today" : p.date < today ? "past" : ""}">
            <span class="d">${esc(p.label)}</span><span>${T(p.t)}</span>
            <a class="link small" href="#${p.go}" data-tab="${p.go}">${esc(pick("Öffnen", "Open"))}</a></li>`).join("")}</ol>
        </section>
        <div class="stack">
          <section class="sheet">
            <div class="label">${L("Mitbringen", "What to bring")}</div>
            <div>${C.appointment.bring.map((b, i) => `<label class="check"><input type="checkbox" id="pack-${i}" data-act="pack" data-i="${i}" ${saved.packed[i] ? "checked" : ""}><span>${T(b)}</span></label>`).join("")}</div>
          </section>
          <section class="sheet">
            <div class="label">${L("Gut zu wissen", "Good to know")}</div>
            ${C.appointment.notes.map((n) => `<p class="small">${T(n)}</p>`).join("")}
          </section>
        </div>
      </div>
      ${hasDate && saved.appt.slice(5) === "11-09" ? `<section class="sheet">
        <div class="label">${L("Ihr Datum ist besonders", "Your date is special")}</div>
        <p>${T(["Der 9. November ist ein wichtiger Tag der deutschen Geschichte: 1918 wurde die Republik ausgerufen, 1938 griffen die Nationalsozialisten jüdische Menschen an, und 1989 fiel die Berliner Mauer. Es ist gut möglich, dass jemand das erwähnt.", "9 November is an important day in German history: in 1918 the republic was proclaimed, in 1938 the National Socialists attacked Jewish people, and in 1989 the Berlin Wall fell. It may well come up."])}</p>
      </section>` : ""}
      <section class="note small">
        <p>${T(["Es gibt keine offizielle Fragenliste für dieses Gespräch. Die Fragen hier stammen aus den Berliner Unterlagen zum Termin und aus § 16 StAG. Die Testfragen sind eigene Fragen im Stil des offiziellen Tests.", "There is no official question list for this conversation. The questions here come from the Berlin appointment documents and § 16 StAG. The test questions are my own, written in the style of the official test."], { gloss: false })}</p>
      </section>
    </div>`;
  }
  function modeCard(tab, title, text, stat) {
    return `<a class="mode" href="#${tab}" data-tab="${tab}"><h3>${esc(pick(title[0], title[1]))}${saved.lang === "both" ? `<br><small class="muted" style="font:400 13px var(--body)">${esc(title[1])}</small>` : ""}</h3>
      <span class="small">${esc(pick(text[0], text[1]))}${saved.lang === "both" ? `<br><span class="muted">${esc(text[1])}</span>` : ""}</span><span class="stat">${esc(stat)}</span></a>`;
  }

  /* ---------- Lernen ---------- */
  const LEARN = {
    grund: ["Grundordnung", "Basic order"], erklaerung: ["Ihre Erklärung", "Your declaration"], merk: ["Merkblätter", "Leaflets"],
    saetze: ["Hilfreiche Sätze", "Helpful phrases"], glossar: ["Wörter", "Words"], aemter: ["Aktuelle Ämter", "Office-holders"]
  };
  function viewLearn() {
    const tabs = Object.entries(LEARN).map(([id, n]) => `<button type="button" class="pill" data-act="learn" data-v="${id}" aria-pressed="${S.learn === id}">${L(n[0], n[1])}</button>`).join("");
    return `<div class="stack"><div class="subtabs">${tabs}</div>${LEARN_VIEWS[S.learn]()}</div>`;
  }
  const blockList = (blocks) => blocks.map((d) => `<section class="sheet"><h3>${T(d.h)}</h3>${d.items.map((i) => line(i)).join("")}</section>`).join("");
  const LEARN_VIEWS = {
    grund: () => `<p>${T(["Diese acht Prinzipien stehen in Ihrem Dokument „Bekenntnis zur freiheitlichen demokratischen Grundordnung“. Lernen Sie zuerst die einfache Fassung.", "These eight principles are in your document on the free democratic basic order. Learn the simple version first."])}</p>
      <div class="grid-2">${C.principles.map((p) => `<section class="sheet"><h3>${T(p.name)}</h3>
        <div class="label">${L("Einfach gesagt", "In simple terms")}</div>${line(p.simple)}
        <div class="label">${L("Aus dem Dokument", "From the document")}</div><div class="small">${line(p.official)}</div></section>`).join("")}</div>`,
    erklaerung: () => `<p>${T(["Das unterschreiben Sie beim Termin. Hier steht der Inhalt in einfacherem Deutsch. Die Fassung zum Unterschreiben ist in Ihren Unterlagen.", "You sign this at the appointment. The content is shown here in simpler German. The version you sign is in your documents."])}</p>${blockList(C.declaration)}`,
    merk: () => blockList(C.leaflets),
    saetze: () => `<p>${T(["Nachfragen ist erlaubt und ganz normal. Das Dokument sagt selbst: „Bitte stellen Sie Fragen, wenn Ihnen hierzu etwas unklar ist.“", "Asking is allowed and completely normal. The document itself says: \"Please ask questions if anything is unclear.\""])}</p>
      <div class="grid-2">${C.phrases.map((g) => `<section class="sheet"><h3>${T(g.group)}</h3>${g.items.map((i) => line(i, "answer")).join("")}</section>`).join("")}</div>`,
    glossar: () => `<section class="sheet"><div>${C.glossary.map((g) => `<div class="gl"><div class="line" style="align-items:center">${play(g[0])}<strong lang="de">${esc(g[0])}</strong></div><span>${esc(g[1])}</span></div>`).join("")}</div></section>`,
    aemter: () => `<section class="sheet"><div class="label">${L("Stand", "As of")} ${esc(C.offices.asOf)}</div>
      ${C.offices.items.map((o) => `<div class="gl"><span>${T(o[0], { gloss: false })}</span><strong>${esc(o[1])}</strong></div>`).join("")}<p class="note small">${T(C.offices.note)}</p></section>`
  };

  /* ---------- Test ---------- */
  const SIM = { count: 33, general: 30, state: 3, pass: 17, minutes: 60 };
  const mcById = Object.fromEntries(C.mc.map((q) => [q.id, q]));
  const startRun = (mode, qs) => {
    Voice.stop();
    S.testResult = null;
    S.test = {
      mode, i: 0, answers: {}, flags: {}, reveal: false,
      items: qs.map((q) => ({ q, order: shuffle([0, 1, 2, 3]) })),
      endAt: mode === "sim" ? Date.now() + SIM.minutes * 60000 : null
    };
    render();
  };
  function startSimulation() {
    const general = shuffle(C.mc.filter((q) => ["fdgo", "staat", "rechte", "geschichte"].includes(q.t))).slice(0, SIM.general);
    const state = shuffle(C.mc.filter((q) => q.t === "berlin")).slice(0, SIM.state);
    startRun("sim", [...general, ...state]);
  }
  function startPractice(topic) {
    const list = topic === "wrong" ? Object.keys(saved.wrong).map((id) => mcById[id]).filter(Boolean) : C.mc.filter((q) => q.t === topic);
    if (list.length) startRun("practice", shuffle(list));
  }
  function finishTest() {
    const t = S.test;
    if (!t) return;
    let score = 0;
    t.items.forEach(({ q }, i) => {
      const correct = t.answers[i] === 0;
      if (correct) { score++; delete saved.wrong[q.id]; } else saved.wrong[q.id] = 1;
      saved.seen[q.id] = 1;
    });
    if (t.mode === "sim") saved.tests.push({ score, at: Date.now() });
    save();
    S.testResult = { mode: t.mode, score, items: t.items, answers: t.answers };
    S.test = null;
    Voice.stop();
    render();
    window.scrollTo(0, 0);
  }
  function viewTest() {
    if (S.test) return viewTestRun();
    if (S.testResult) return viewTestResult();
    const wrong = Object.keys(saved.wrong).length;
    return `<div class="stack">
      <h1>${T(["Test", "Test"], { gloss: false })}</h1>
      <div class="grid-2">
        <section class="sheet">
          <h2>${T(["Prüfungssimulation", "Exam simulation"], { gloss: false })}</h2>
          <p>${T(["Wie beim Einbürgerungstest: 33 Fragen, davon 3 zu Berlin, 60 Minuten. Mit 17 richtigen Antworten haben Sie bestanden. Das Ergebnis sehen Sie erst am Ende.", "As in the citizenship test: 33 questions, 3 of them on Berlin, 60 minutes. You pass with 17 correct answers. You only see the result at the end."])}</p>
          <div><button type="button" class="btn primary" data-act="sim">${L("Simulation starten", "Start simulation")}</button></div>
          ${saved.tests.length ? `<p class="small muted">${esc(pick("Ihre letzten Ergebnisse", "Your latest results"))}: <span style="font-family:var(--mono)">${saved.tests.slice(-5).map((t) => t.score + "/33").join("  ")}</span></p>` : ""}
        </section>
        <section class="sheet">
          <h2>${T(["Training nach Thema", "Training by topic"], { gloss: false })}</h2>
          <p>${T(["Sie sehen nach jeder Frage sofort die Lösung und eine Erklärung.", "You see the answer and an explanation straight after each question."])}</p>
          <div class="subtabs">${Object.entries(C.topics).map(([id, n]) => `<button type="button" class="pill" data-act="practice" data-v="${id}">${L(n[0], n[1])}<small>${C.mc.filter((q) => q.t === id).length}</small></button>`).join("")}
          ${wrong ? `<button type="button" class="pill" data-act="practice" data-v="wrong">${L("Meine Fehler", "My mistakes")}<small>${wrong}</small></button>` : ""}</div>
        </section>
      </div>
      <p class="small muted">${T(["Dies sind eigene Übungsfragen. Den offiziellen Katalog mit 310 Fragen finden Sie beim BAMF:", "These are my own practice questions. The official catalogue of 310 questions is at BAMF:"], { gloss: false })} <a class="link" href="https://oet.bamf.de/ords/oetut/f?p=514:1:0" target="_blank" rel="noopener noreferrer">oet.bamf.de</a></p>
    </div>`;
  }
  function viewTestRun() {
    const t = S.test, item = t.items[t.i], q = item.q, ans = t.answers[t.i], isSim = t.mode === "sim", last = t.i === t.items.length - 1;
    const shown = !isSim && t.reveal;
    const opts = item.order.map((idx) => {
      const cls = shown ? (idx === 0 ? "right" : idx === ans ? "wrong" : "") : ans === idx ? "sel" : "";
      const o = q.o[idx];
      const text = saved.lang === "en" ? esc(o[1]) : saved.lang === "both" ? `${esc(o[0])}<br><span class="muted small">${esc(o[1])}</span>` : esc(o[0]);
      const tipBtn = saved.lang === "both" ? "" : chip(saved.lang === "en" ? "DE" : "EN", saved.lang === "en" ? o[0] : o[1]);
      return `<div class="opt ${cls}"><button type="button" class="pick" data-act="answer" data-v="${idx}" ${shown ? "disabled" : ""}><span class="box"></span><span>${text}</span></button>${tipBtn}</div>`;
    }).join("");
    const answered = Object.keys(t.answers).length;
    return `<div class="stack">
      <div class="row spread">
        <span class="label">${isSim ? L("Prüfungssimulation", "Exam simulation") : L("Training", "Training")} · ${L(C.topics[q.t][0], C.topics[q.t][1])}</span>
        ${isSim ? `<span class="timer" id="timer">${fmtClock(t.endAt - Date.now())}</span>` : ""}
      </div>
      ${isSim ? `<div class="dots">${t.items.map((_, i) => `<button type="button" data-act="jump" data-v="${i}" class="${t.answers[i] !== undefined ? "ans" : ""} ${t.flags[i] ? "flag-on" : ""} ${i === t.i ? "cur" : ""}" aria-label="${pick("Frage", "Question")} ${i + 1}">${i + 1}</button>`).join("")}</div>`
        : `<div class="meter"><i style="width:${((t.i + 1) / t.items.length) * 100}%"></i></div>`}
      <section class="sheet">
        <div class="label">${L("Frage", "Question")} ${t.i + 1} / ${t.items.length}</div>
        <div class="line">${play(q.q[0])}<div class="body q-title">${T(q.q)}</div></div>
        <div class="opts">${opts}</div>
        ${shown ? `<div class="feedback ${ans === 0 ? "right" : "wrong"}"><strong>${esc(ans === 0 ? pick("Richtig.", "Correct.") : pick("Nicht richtig.", "Not correct."))}</strong><span>${T(q.ex)}</span></div>` : ""}
      </section>
      <div class="row spread">
        <div class="row">
          ${isSim ? `<button type="button" class="btn quiet" data-act="prev" ${t.i === 0 ? "disabled" : ""}>${L("Zurück", "Back")}</button>
          <button type="button" class="btn quiet" data-act="flag">${t.flags[t.i] ? L("Markierung entfernen", "Remove mark") : L("Markieren", "Mark")}</button>` : ""}
        </div>
        <div class="row">
          ${isSim ? (t.confirm
            ? `<span class="small">${esc(pick(`${answered} von ${t.items.length} beantwortet. Wirklich abgeben?`, `${answered} of ${t.items.length} answered. Hand in now?`))}</span>
               <button type="button" class="btn quiet" data-act="confirm-no">${L("Weiter üben", "Keep going")}</button><button type="button" class="btn primary" data-act="finish">${L("Abgeben", "Hand in")}</button>`
            : `${last ? "" : `<button type="button" class="btn" data-act="next">${L("Weiter", "Next")}</button>`}<button type="button" class="btn ${last ? "primary" : "quiet"}" data-act="confirm">${L("Test abgeben", "Hand in test")}</button>`)
          : `<button type="button" class="btn quiet" data-act="finish">${L("Beenden", "Finish")}</button>${shown ? `<button type="button" class="btn primary" data-act="${last ? "finish" : "next"}">${last ? L("Ergebnis", "Result") : L("Nächste Frage", "Next question")}</button>` : ""}`}
        </div>
      </div>
    </div>`;
  }
  function viewTestResult() {
    const r = S.testResult, total = r.items.length, isSim = r.mode === "sim", passed = r.score >= SIM.pass;
    const wrong = r.items.map((it, i) => ({ q: it.q, a: r.answers[i] })).filter((x) => x.a !== 0);
    const byTopic = {};
    r.items.forEach((it, i) => { const b = byTopic[it.q.t] = byTopic[it.q.t] || [0, 0]; b[1]++; if (r.answers[i] === 0) b[0]++; });
    return `<div class="stack">
      <section class="sheet">
        ${isSim
          ? `<div class="stamp ${passed ? "pass" : ""}">${esc(pick(passed ? "Bestanden" : "Nicht bestanden", passed ? "Passed" : "Not passed"))}<small>${r.score} / ${total} · ${pick("nötig", "needed")} ${SIM.pass}</small></div>`
          : `<h2>${r.score} / ${total} ${esc(pick("richtig", "correct"))}</h2>`}
        ${Object.entries(byTopic).map(([t, b]) => `<div class="row spread small"><span>${L(C.topics[t][0], C.topics[t][1])}</span><span style="font-family:var(--mono)">${b[0]}/${b[1]}</span></div>`).join("")}
        <div class="row"><button type="button" class="btn primary" data-act="sim">${L("Neue Simulation", "New simulation")}</button><button type="button" class="btn" data-act="back-tests">${L("Zur Übersicht", "Back to overview")}</button></div>
      </section>
      ${wrong.length ? `<section class="sheet"><h2>${T(["Das sollten Sie wiederholen", "Worth going over again"], { gloss: false })}</h2>
        ${wrong.map((x) => `<div class="review"><strong>${T(x.q.q)}</strong>
          ${x.a !== undefined ? `<span class="small no">${esc(pick("Ihre Antwort", "Your answer"))}: ${esc(pick(x.q.o[x.a][0], x.q.o[x.a][1]))}</span>` : `<span class="small no">${esc(pick("Nicht beantwortet", "Not answered"))}</span>`}
          <span class="small yes">${esc(pick("Richtig", "Correct"))}: ${esc(pick(x.q.o[0][0], x.q.o[0][1]))}</span><span class="small">${T(x.q.ex)}</span></div>`).join("")}</section>` : ""}
    </div>`;
  }
  const fmtClock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

  /* ---------- Answer field shared by open questions and the written interview ---------- */
  const answerField = (id, value, label) => `<div class="field">
    <label class="label" for="${id}">${label}</label>
    <textarea class="answer" id="${id}" data-input="${id}" lang="de" spellcheck="true" placeholder="${esc(pick("Schreiben Sie hier auf Deutsch …", "Write here in German …"))}">${esc(value)}</textarea>
    <div class="keys">${["ä", "ö", "ü", "ß", "Ä", "Ö", "Ü"].map((k) => `<button type="button" data-act="key" data-v="${k}" data-target="${id}" aria-label="${k}">${k}</button>`).join("")}</div>
  </div>`;
  const keyList = (res) => `<ul class="keylist">${res.map((r) => `<li><span class="mark ${r.hit ? "yes" : "muted"}" aria-label="${r.hit ? "gefunden" : "fehlt"}">${r.hit ? "✓" : "○"}</span><span class="${r.hit ? "" : "muted"}">${T(r.label, { gloss: false })}</span></li>`).join("")}</ul>`;
  const LOCAL_NOTE = ["Diese Prüfung sucht nur nach Stichwörtern. Sie bewertet weder Grammatik noch Sinn.", "This check only looks for keywords. It judges neither grammar nor meaning."];
  /* ---------- Offene Fragen: least-secure questions come first ---------- */
  function nextOpen() {
    const o = S.open;
    const pool = C.open.filter((q) => o.topic === "all" || q.t === o.topic);
    const rank = shuffle(pool).sort((a, b) => (saved.boxes[a.id] || 0) - (saved.boxes[b.id] || 0));
    const pickQ = rank.find((q) => !o.cur || q.id !== o.cur.id) || rank[0];
    Object.assign(o, { cur: pickQ, text: "", checked: null, hint: false });
  }
  function viewOpen() {
    const o = S.open;
    if (!o.cur) nextOpen();
    const q = o.cur;
    const topics = ["fdgo", "geschichte", "merk", "staat", "rechte"];
    const sure = C.open.filter((x) => (saved.boxes[x.id] || 0) >= 2).length;
    const res = o.checked;
    const hits = res ? res.filter((r) => r.hit).length : 0;
    return `<div class="stack">
      <div class="row spread"><h1>${T(TABS.offen, { gloss: false })}</h1><span class="small muted" style="font-family:var(--mono)">${sure}/${C.open.length} ${esc(pick("sicher", "secure"))}</span></div>
      <div class="subtabs"><button type="button" class="pill" data-act="open-topic" data-v="all" aria-pressed="${o.topic === "all"}">${L("Alle", "All")}</button>
        ${topics.map((t) => `<button type="button" class="pill" data-act="open-topic" data-v="${t}" aria-pressed="${o.topic === t}">${L(C.topics[t][0], C.topics[t][1])}</button>`).join("")}</div>
      <section class="sheet">
        <div class="label">${L(C.topics[q.t][0], C.topics[q.t][1])}</div>
        <div class="line">${play(q.q[0])}<div class="body q-title">${T(q.q)}</div></div>
        ${res ? `<div class="field"><span class="label">${L("Ihre Antwort", "Your answer")}</span><p class="written" lang="de">${esc(o.text) || `<span class="muted">${esc(pick("(keine Antwort)", "(no answer)"))}</span>`}</p></div>`
          : answerField("open-answer", o.text, L("Ihre Antwort", "Your answer"))}
        ${!res ? `<div class="row">
          <button type="button" class="btn primary" data-act="open-check">${L("Antwort prüfen", "Check answer")}</button>
          <button type="button" class="btn quiet" data-act="open-hint">${L("Satzanfang zeigen", "Show a sentence starter")}</button>
          <button type="button" class="btn quiet" data-act="open-skip">${L("Andere Frage", "Different question")}</button></div>
          ${o.hint ? `<p class="note">${T(q.starter, { gloss: false })}</p>` : ""}` : ""}
        ${res ? `
          <div class="feedback"><strong>${esc(pick(`${hits} von ${res.length} Stichpunkten gefunden`, `${hits} of ${res.length} key ideas found`))}</strong>${keyList(res)}<span class="small muted">${T(LOCAL_NOTE, { gloss: false })}</span></div>
          <div class="field"><span class="label">${L("Musterantwort", "Model answer")}</span>${line(q.model, "answer")}</div>
          <div class="field"><span class="label">${L("Wie sicher waren Sie?", "How confident were you?")}</span>
            <div class="row"><button type="button" class="btn" data-act="rate" data-v="2">${L("Konnte ich", "I knew it")}</button>
            <button type="button" class="btn" data-act="rate" data-v="1">${L("Teilweise", "Partly")}</button>
            <button type="button" class="btn" data-act="rate" data-v="0">${L("Noch einmal üben", "Practise again")}</button></div></div>` : ""}
      </section>
    </div>`;
  }

  /* ---------- Interview setup, shared ---------- */
  const lengthPicker = (act, cur) => `<div class="subtabs">${Object.entries(C.interview.lengths).map(([id, l]) =>
    `<button type="button" class="pill" data-act="${act}" data-v="${id}" aria-pressed="${cur === id}">${L(id === "kurz" ? "Kurz" : "Lang", id === "kurz" ? "Short" : "Long")}<small>${esc(pick(l.minutes[0], l.minutes[1]))}</small></button>`).join("")}</div>`;
  const INTRO = ["Das Gespräch folgt dem Ablauf des Termins: Begrüßung, Unterlagen, Ihre Angaben, Grundordnung, Geschichte, Merkblätter, Bekenntnis und Urkunde. Die Fragen wechseln bei jedem Durchgang. Die Antworten sind Beispiele: Sagen Sie beim Termin nur, was für Sie stimmt.", "The conversation follows the course of the appointment: greeting, documents, your details, basic order, history, leaflets, declaration and certificate. The questions change on each run. The answers are examples: at the appointment, only say what is true for you."];

  /* ---------- Written interview ---------- */
  async function wStart() {
    Voice.stop();
    S.w = { engine: new ScriptedInterviewer(C, S.wLength), log: [], cur: null, text: "", phase: "answer", done: false };
    await wNext();
  }
  async function wNext() {
    const w = S.w;
    const turn = await w.engine.next(w.log.length ? w.log[w.log.length - 1].answer : null);
    if (!turn) { w.done = true; saved.interviews++; save(); render(); window.scrollTo(0, 0); return; }
    Object.assign(w, { cur: turn, text: "", phase: "answer", check: null });
    render();
    const box = document.getElementById("w-answer");
    if (box) box.focus({ preventScroll: true });
    const anchor = document.getElementById("w-current");
    if (anchor) anchor.scrollIntoView({ block: "nearest" });
  }
  const turnPast = (e) => `<div class="turn"><span class="who">${L("Sachbearbeiterin", "Caseworker")}</span><div class="line">${play(e.turn.say[0])}<div class="body">${T(e.turn.say)}</div></div></div>
    <div class="turn you"><span class="who">${L("Sie", "You")}</span><p class="written" lang="de">${esc(e.answer) || `<span class="muted">${esc(pick("(übersprungen)", "(skipped)"))}</span>`}</p></div>`;
  function viewWritten() {
    const w = S.w;
    if (!w) return `<div class="stack"><h1>${T(TABS.schriftlich, { gloss: false })}</h1>
      <section class="sheet"><p>${T(INTRO)}</p>${lengthPicker("w-length", S.wLength)}
      <div><button type="button" class="btn primary" data-act="w-start">${L("Interview beginnen", "Begin interview")}</button></div></section></div>`;
    if (w.done) return `<div class="stack"><h1>${T(["Interview beendet", "Interview finished"], { gloss: false })}</h1>
      <div class="row"><button type="button" class="btn primary" data-act="w-start">${L("Noch ein Interview", "Another interview")}</button><button type="button" class="btn" data-tab="audio">${L("Jetzt mit Audio", "Now with audio")}</button></div>
      <section class="sheet">${w.log.map((e) => `<div class="review">${turnPast(e)}<div class="small"><span class="label">${L("Musterantwort", "Model answer")}</span>${line(e.turn.reply, "answer")}</div></div>`).join("")}</section></div>`;
    const t = w.cur, p = w.engine.progress();
    return `<div class="stack">
      <div class="row spread"><span class="label">${L("Interview schriftlich", "Written interview")} · ${p.current} / ${p.total}</span><button type="button" class="btn quiet" data-act="w-stop">${L("Beenden", "Stop")}</button></div>
      <div class="meter"><i style="width:${(p.current / p.total) * 100}%"></i></div>
      <section class="sheet">
        ${w.log.slice(-2).map(turnPast).join("")}
        <div class="turn" id="w-current"><span class="who">${L("Sachbearbeiterin", "Caseworker")}</span><div class="line">${play(t.say[0])}<div class="body q-title">${T(t.say)}</div></div></div>
        ${w.phase === "answer" ? `${answerField("w-answer", w.text, L("Ihre Antwort", "Your answer"))}
          ${w.hint && t.starter ? `<p class="note">${T(t.starter, { gloss: false })}</p>` : ""}
          <div class="row"><button type="button" class="btn primary" data-act="w-send">${L("Antworten", "Reply")}</button>
          ${t.starter ? `<button type="button" class="btn quiet" data-act="w-hint">${L("Satzanfang zeigen", "Show a sentence starter")}</button>` : ""}
          <button type="button" class="btn quiet" data-act="w-send">${L("Musterantwort zeigen", "Show model answer")}</button></div>`
        : `<div class="turn you"><span class="who">${L("Sie", "You")}</span><p class="written" lang="de">${esc(w.text) || `<span class="muted">${esc(pick("(übersprungen)", "(skipped)"))}</span>`}</p></div>
          ${w.check && w.check.length ? `<div class="feedback">${keyList(w.check)}<span class="small muted">${T(LOCAL_NOTE, { gloss: false })}</span></div>` : ""}
          <div class="field"><span class="label">${L("Musterantwort", "Model answer")}</span>${line(t.reply, "answer")}</div>
          ${t.note ? `<p class="note small">${T(t.note)}</p>` : ""}
          <div><button type="button" class="btn primary" data-act="w-next">${L("Weiter", "Continue")}</button></div>`}
      </section>
    </div>`;
  }

  /* ---------- Audio interview ---------- */
  async function aStart() {
    Voice.stop();
    const a = S.a = { engine: new ScriptedInterviewer(C, S.aLength), input: new ManualAnswer(), phase: "speaking", turn: null, hard: [], log: [], token: 0, showText: S.aShowText, showReply: false, t0: 0, silent: false, history: [] };
    if (serverReady() && S.aListen) {
      render();
      const rec = new RecordingAnswer({ silenceMs: S.aPause });
      try {
        await rec.prepare();
        a.rec = rec;
      } catch (err) {
        a.micError = true;
      }
    }
    if (S.a === a) aLoop(a);
  }
  async function aLoop(a) {
    for (;;) {
      const turn = await a.engine.next(null);
      if (S.a !== a) return;
      if (!turn) { aFinish(a); return; }
      a.turn = turn;
      a.log.push(turn);
      a.showReply = false;
      a.showText = S.aShowText;
      await aSay(a, turn.say[0], "officer", "speaking");
      if (S.a !== a) return;
      if (a.rec) {
        await aListenTurn(a, turn);
        if (S.a !== a) return;
        continue;
      }
      a.phase = "answer";
      a.t0 = Date.now();
      render();
      await a.input.listen();
      if (S.a !== a) return;
      if (S.aReadSample) {
        a.showReply = true;
        await aSay(a, turn.reply[0], "answer", "sample");
        if (S.a !== a) return;
      }
    }
  }
  const setLevel = (v) => { const el = document.getElementById("a-level"); if (el) el.style.width = v * 100 + "%"; };
  /* One question with listening: record, show what was heard, add feedback when it arrives, allow retries. */
  async function aListenTurn(a, turn) {
    for (;;) {
      a.phase = "listening";
      a.t0 = Date.now();
      a.result = null;
      render();
      const rec = await a.rec.listen({ onLevel: setLevel });
      if (S.a !== a) return;
      if (rec.cancelled) {
        await aSay(a, turn.say[0], "officer", "speaking");
        if (S.a !== a) return;
        continue;
      }
      a.phase = "analyzing";
      render();
      const result = a.result = { heard: null, review: null, reviewState: "none" };
      try {
        result.heard = await Listening.analyze(rec.blob, { context: `${turn.say[0]} ${turn.reply[0]}` });
      } catch (err) {
        result.error = true;
      }
      if (S.a !== a) return;
      if (result.heard && result.heard.text && S.server.claude && saved.claudeOk) aReview(a, turn, result);
      a.phase = "feedback";
      render();
      const choice = await new Promise((resolve) => { a.choose = resolve; });
      if (S.a !== a) return;
      Voice.stop();
      if (choice === "next") {
        a.history.push({ turn, result });
        a.showStarter = false;
        return;
      }
    }
  }
  function aReview(a, turn, result) {
    result.reviewState = "loading";
    Listening.evaluate({
      question: turn.say[0], model: turn.reply[0], key_ideas: (turn.keys || []).map((k) => k.l[1]),
      transcript: result.heard.text, heard_literally: result.heard.heard_literally,
      weak_words: result.heard.words.filter((w) => w.unclear).map((w) => w.word),
      maybe_incomplete: result.heard.maybe_incomplete
    }).then((review) => {
      result.review = review;
      result.reviewState = "done";
    }).catch(() => {
      result.reviewState = "failed";
    }).finally(() => {
      if (S.a === a && a.result === result) render();
    });
  }
  async function aShadow(a) {
    const result = a.result, turn = a.turn;
    a.phase = "shadow";
    a.t0 = Date.now();
    render();
    Voice.stop();
    const rec = await a.rec.listen({ onLevel: setLevel });
    if (S.a !== a) return;
    if (!rec.cancelled) {
      a.phase = "analyzing";
      render();
      try {
        result.shadow = await Listening.analyze(rec.blob, { reference: turn.reply[0] });
      } catch (err) {
        result.shadow = null;
      }
      if (S.a !== a) return;
    }
    a.phase = "feedback";
    render();
  }
  async function aSay(a, text, role, phase) {
    a.phase = phase;
    const id = ++a.token;
    render();
    const r = await Voice.speak(text, { role });
    if (id === a.token && r.via === "none") a.silent = true;
    return r;
  }
  function aFinish(a) {
    if (a.rec) a.rec.close();
    saved.interviews++;
    save();
    a.phase = "done";
    render();
    window.scrollTo(0, 0);
  }
  function aStop() {
    if (S.a && S.a.input) S.a.input.cancel();
    if (S.a && S.a.rec) S.a.rec.close();
    S.a = null;
    Voice.stop();
    render();
  }
  async function aRepeat() {
    const a = S.a;
    if (!a || !a.turn) return;
    if (a.rec) { a.rec.cancel(); return; } // aListenTurn replays the question, then listens again
    await aSay(a, a.turn.say[0], "officer", "speaking");
    if (S.a !== a) return;
    a.phase = "answer";
    a.t0 = Date.now();
    render();
  }
  function viewAudio() {
    const a = S.a;
    if (!a) return `<div class="stack"><h1>${T(TABS.audio, { gloss: false })}</h1>
      <section class="sheet"><p>${T(INTRO)}</p>
        ${serverReady() && S.aListen ? "" : `<p>${T(["Sprechen Sie Ihre Antworten laut. Die App hört nicht zu. Wenn Sie fertig sind, tippen Sie auf „Fertig“ oder drücken die Leertaste.", "Say your answers out loud. The app does not listen. When you have finished, tap \"Done\" or press the space bar."])}</p>`}
        ${lengthPicker("a-length", S.aLength)}
        ${listenSetup()}
        <label class="toggle"><input type="checkbox" id="a-text" data-act="a-text" ${S.aShowText ? "checked" : ""}><span>${T(["Text der Fragen anzeigen. Ohne Text ist es näher am echten Termin.", "Show the text of the questions. Without text it is closer to the real appointment."], { gloss: false })}</span></label>
        ${serverReady() && S.aListen ? "" : `<label class="toggle"><input type="checkbox" id="a-read" data-act="a-read" ${S.aReadSample ? "checked" : ""}><span>${T(["Nach jeder Antwort die Musterantwort vorlesen", "Read the model answer after each of your answers"], { gloss: false })}</span></label>`}
        ${serverReady() && S.aListen ? "" : `<div class="row"><label class="small" for="a-auto">${esc(pick("Automatisch weiter", "Move on automatically"))}</label>
          <select class="sel" id="a-auto" data-act="a-auto">${[[0, pick("Aus, ich tippe selbst", "Off, I tap myself")], [30, pick("nach 30 Sekunden", "after 30 seconds")], [45, pick("nach 45 Sekunden", "after 45 seconds")], [60, pick("nach 60 Sekunden", "after 60 seconds")]].map(([v, l]) => `<option value="${v}" ${S.aAuto === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`}
        <div class="row"><button type="button" class="btn primary" data-act="a-start">${L("Interview beginnen", "Begin interview")}</button>
        ${play(C.voiceTest[0])}<span class="small muted">${esc(pick("Stimme testen", "Test the voice"))}</span></div>
        <p class="small muted">${T(["Die Stimmen sind vorab erzeugte deutsche Neural-Stimmen (Microsoft Katja und Conrad). Das Tempo ändern Sie oben.", "The voices are pre-rendered German neural voices (Microsoft Katja and Conrad). Change the speed at the top."], { gloss: false })}</p>
      </section></div>`;
    if (a.phase === "done") {
      const hard = a.log.filter((t) => a.hard.includes(t.id));
      return `<div class="stack"><h1>${T(["Interview beendet. Gut gemacht!", "Interview finished. Well done!"], { gloss: false })}</h1>
        <div class="row"><button type="button" class="btn primary" data-act="a-start">${L("Noch einmal", "Once more")}</button><button type="button" class="btn" data-act="a-stop">${L("Zur Übersicht", "Back to overview")}</button></div>
        ${a.history.length ? listenSummary(a) : ""}
        <section class="sheet"><h2>${T(hard.length ? ["Diese Fragen waren schwer", "These questions were hard"] : ["Alle Fragen im Überblick", "All questions at a glance"], { gloss: false })}</h2>
        ${(hard.length ? hard : a.log).map((t) => `<div class="review"><div class="line">${play(t.say[0])}<div class="body"><strong>${T(t.say)}</strong></div></div><div class="small">${line(t.reply, "answer")}</div></div>`).join("")}</section></div>`;
    }
    if (!a.turn) return `<div class="sheet stage"><div class="q-title">${L("Mikrofon wird vorbereitet", "Getting the microphone ready")}</div></div>`;
    if (["listening", "shadow", "analyzing", "feedback"].includes(a.phase)) return viewListening(a);
    const t = a.turn, p = a.engine.progress(), speaking = a.phase === "speaking" || a.phase === "sample";
    const status = a.phase === "speaking" ? L("Die Sachbearbeiterin spricht", "The caseworker is speaking")
      : a.phase === "sample" ? L("Musterantwort", "Model answer") : L("Sie sind dran. Antworten Sie laut.", "Your turn. Answer out loud.");
    const marked = a.hard.includes(t.id);
    return `<div class="stack">
      <div class="row spread"><span class="label">${L("Interview Audio", "Audio interview")} · ${p.current} / ${p.total}</span><button type="button" class="btn quiet" data-act="a-stop">${L("Beenden", "Stop")}</button></div>
      <div class="meter"><i style="width:${(p.current / p.total) * 100}%"></i></div>
      <section class="sheet stage ${speaking ? "speaking" : ""}">
        <div class="bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
        <div class="q-title" aria-live="polite">${status}</div>
        ${a.phase === "answer" ? `<div class="clock" id="a-clock">0:00</div>` : ""}
        ${a.micError ? `<p class="small no">${T(["Kein Zugriff auf das Mikrofon. Erlauben Sie den Zugriff im Browser und starten Sie neu. Bis dahin läuft das Interview ohne Zuhören.", "No access to the microphone. Allow access in the browser and restart. Until then, the interview runs without listening."], { gloss: false })}</p>` : ""}
        ${a.silent ? `<p class="small no">${T(["Dieses Gerät konnte keine Stimme abspielen. Bitte lesen Sie die Frage.", "This device could not play a voice. Please read the question."], { gloss: false })}</p>` : ""}
        ${a.showText || a.silent ? `<div class="hint"><div class="label">${L("Frage", "Question")}</div>${T(t.say)}</div>` : ""}
        ${a.showReply ? `<div class="hint"><div class="label">${L("Musterantwort", "Model answer")}</div>${T(t.reply)}${t.note ? `<p class="note small" style="margin-top:8px">${T(t.note)}</p>` : ""}</div>` : ""}
        ${t.starter && a.phase === "answer" && a.showStarter ? `<div class="hint note">${T(t.starter, { gloss: false })}</div>` : ""}
        <div class="row" style="justify-content:center">
          ${a.phase === "answer" ? `<button type="button" class="btn primary" data-act="a-done">${L("Fertig", "Done")}</button>` : ""}
          ${a.phase === "sample" ? `<button type="button" class="btn primary" data-act="a-skip">${L("Weiter", "Continue")}</button>` : ""}
          ${a.phase === "answer" ? `<button type="button" class="btn quiet" data-act="a-repeat">${L("Wiederholen", "Repeat")}</button>` : ""}
          ${a.showText ? "" : `<button type="button" class="btn quiet" data-act="a-show">${L("Text zeigen", "Show text")}</button>`}
          ${t.starter && a.phase === "answer" && !a.showStarter ? `<button type="button" class="btn quiet" data-act="a-starter">${L("Satzanfang", "Sentence starter")}</button>` : ""}
          ${a.phase === "answer" && !a.showReply ? `<button type="button" class="btn quiet" data-act="a-reply">${L("Musterantwort zeigen", "Show model answer")}</button>` : ""}
          <button type="button" class="btn quiet" data-act="a-hard" aria-pressed="${marked}">${marked ? L("Als schwer markiert ✓", "Marked as hard ✓") : L("War schwer", "This was hard")}</button>
        </div>
      </section>
    </div>`;
  }

  function repoLink() {
    const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
    if (!m) return "";
    const repo = location.pathname.split("/").filter(Boolean)[0];
    const url = `https://github.com/${m[1]}/${repo || m[1] + ".github.io"}#run-it-on-your-computer`;
    return ` <a class="link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(pick("Anleitung", "Instructions"))}</a>`;
  }

  /* ---------- Listening screens ---------- */
  const serverReady = () => !!(S.server && S.server.pronunciation === "ready");
  const BANDS = {
    very_clear: ["Aussprache: sehr deutlich", "Pronunciation: very clear"],
    clear: ["Aussprache: gut verständlich", "Pronunciation: easy to understand"],
    accented: ["Aussprache: verständlich, mit hörbarem Akzent", "Pronunciation: understandable, with a noticeable accent"],
    hard: ["Aussprache: stellenweise schwer zu verstehen", "Pronunciation: hard to understand in places"]
  };
  const RATINGS = { good: ["Inhalt: gut", "Content: good"], partly: ["Inhalt: teilweise", "Content: partly there"], off_topic: ["Inhalt: passt nicht zur Frage", "Content: does not answer the question"] };
  function listenSetup() {
    if (!S.server) return `<p class="note small">${T(["Hier hört die App nicht zu. Dafür laden Sie die App herunter und starten sie auf Ihrem Computer. Ihre Stimme bleibt dann auf Ihrem Computer.", "The app does not listen here. For that, download the app and start it on your computer. Your voice then stays on your computer."], { gloss: false })}${repoLink()}</p>`;
    if (S.server.error) return `<p class="note small">${T(["Die Sprachmodelle konnten nicht geladen werden. Prüfen Sie die Internetverbindung und starten Sie die App neu.", "The speech models could not be loaded. Check your internet connection and restart the app."], { gloss: false })}</p>`;
    if (!serverReady()) return `<p class="note small">${T(["Die Sprachmodelle werden geladen. Beim allerersten Start werden etwa 3 GB heruntergeladen.", "The speech models are loading. The very first start downloads about 3 GB."], { gloss: false })}</p>`;
    return `<label class="toggle"><input type="checkbox" id="a-listen" data-act="a-listen" ${S.aListen ? "checked" : ""}><span>${T(["Die App hört zu und bewertet Inhalt, Grammatik und Aussprache", "The app listens and assesses content, grammar and pronunciation"], { gloss: false })}</span></label>
      ${S.aListen ? `<div class="row"><label class="small" for="a-pause">${esc(pick("Aufnahme beenden", "Stop recording"))}</label>
        <select class="sel" id="a-pause" data-act="a-pause">${[[3500, pick("nach 3,5 Sekunden Stille", "after 3.5 seconds of silence")], [6000, pick("nach 6 Sekunden Stille", "after 6 seconds of silence")], [0, pick("nur wenn ich tippe", "only when I tap")]].map(([v, l]) => `<option value="${v}" ${S.aPause === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
      <p class="small muted">${T(["Ihre Stimme wird nur auf diesem Computer verarbeitet und nicht gespeichert.", "Your voice is processed only on this computer and is not saved."], { gloss: false })}</p>
      ${S.server.claude ? `<label class="toggle"><input type="checkbox" id="a-claude" data-act="a-claude" ${saved.claudeOk ? "checked" : ""}><span>${T(["Zusätzlich Rückmeldung zu Inhalt und Grammatik von Claude. Dafür geht der erkannte Text (nie die Aufnahme) über Ihr Claude-Konto an Anthropic.", "Also get feedback on content and grammar from Claude. For this, the recognised text (never the recording) goes to Anthropic through your Claude account."], { gloss: false })}</span></label>` : ""}` : ""}`;
  }
  const heardWords = (words) => `<div class="heard" lang="de">${words.map((w) => {
    const clean = w.word.replace(/[.,!?;:„“"]/g, "");
    return `<button type="button" class="word ${w.unclear ? "unclear" : ""}" data-act="say" data-say="${esc(clean)}" data-role="officer" title="${esc(pick("Anhören", "Listen"))}">${esc(w.word)}</button>`;
  }).join("")}</div>`;
  function reviewBlock(r) {
    if (r.reviewState === "loading") return `<p class="small muted">${esc(pick("Claude bewertet Ihre Antwort. Das dauert etwa 20 Sekunden …", "Claude is assessing your answer. This takes about 20 seconds …"))}</p>`;
    if (r.reviewState === "failed") return `<p class="small no">${esc(pick("Die Bewertung durch Claude hat nicht geklappt. Transkript und Aussprache oben stimmen trotzdem.", "Claude's feedback failed. The transcript and pronunciation above are still valid."))}</p>`;
    if (r.reviewState !== "done" || !r.review) return "";
    const v = r.review, rating = RATINGS[v.rating] || RATINGS.partly;
    return `<div class="feedback">
      <div><span class="rating ${esc(v.rating)}">${L(rating[0], rating[1])}</span></div>
      <span>${esc(v.content_en)}</span>
      ${(v.missing_en || []).length ? `<div><span class="label">${L("Das fehlt noch", "Still missing")}</span>${v.missing_en.map((m) => `<div class="small">${esc(m)}</div>`).join("")}</div>` : ""}
      ${(v.grammar || []).map((g) => `<div class="corr small"><span><span class="no">${esc(g.said)}</span> → <span class="yes">${esc(g.better)}</span></span><span class="muted">${esc(g.why_en)}</span></div>`).join("")}
      ${v.better_de ? `<div class="corr"><span class="label">${L("So klingt Ihre Antwort korrekt", "Your answer, corrected")}</span><div class="line">${play(v.better_de, "answer")}<div class="body">${T([v.better_de, v.better_en || ""], { gloss: false })}</div></div></div>` : ""}
      ${(v.pronunciation || []).length ? `<div class="corr"><span class="label">${L("Tipps zur Aussprache", "Pronunciation tips")}</span>${v.pronunciation.map((p) => `<div class="small"><strong lang="de">${esc(p.word)}</strong>: ${esc(p.tip_en)}</div>`).join("")}</div>` : ""}
    </div>`;
  }
  function clarityBlock(heard) {
    const band = heard.clarity && BANDS[heard.clarity.band];
    const flagged = heard.words.some((w) => w.unclear);
    return `${band ? `<div class="band">${L(band[0], band[1])}</div>` : ""}
      ${heardWords(heard.words)}
      <span class="small muted">${esc(flagged
        ? pick("Rot markierte Wörter waren unklar. Tippen Sie auf ein Wort, um es zu hören.", "Words in red were unclear. Tap a word to hear it.")
        : pick("Tippen Sie auf ein Wort, um es zu hören.", "Tap a word to hear it."))}${heard.words_per_minute ? ` · ${heard.words_per_minute} ${esc(pick("Wörter pro Minute", "words per minute"))}` : ""}</span>`;
  }
  function viewListening(a) {
    const t = a.turn, p = a.engine.progress(), r = a.result;
    const head = `<div class="row spread"><span class="label">${L("Interview Audio", "Audio interview")} · ${p.current} / ${p.total}</span><button type="button" class="btn quiet" data-act="a-stop">${L("Beenden", "Stop")}</button></div>
      <div class="meter"><i style="width:${(p.current / p.total) * 100}%"></i></div>`;
    const question = a.showText ? `<div class="hint"><div class="label">${L("Frage", "Question")}</div>${T(t.say)}</div>` : "";
    if (a.phase === "listening" || a.phase === "shadow") {
      const shadow = a.phase === "shadow";
      return `<div class="stack">${head}<section class="sheet stage">
        <div class="q-title" aria-live="polite"><span class="rec-dot"></span>${shadow ? L("Sprechen Sie die Musterantwort nach", "Repeat the model answer") : L("Ich höre zu. Antworten Sie jetzt.", "I'm listening. Answer now.")}</div>
        <div class="level"><i id="a-level"></i></div>
        <div class="clock" id="a-clock">0:00</div>
        ${shadow ? `<div class="hint">${T(t.reply)}</div>` : question}
        ${t.starter && a.showStarter && !shadow ? `<div class="hint note">${T(t.starter, { gloss: false })}</div>` : ""}
        <div class="row" style="justify-content:center">
          <button type="button" class="btn primary" data-act="a-rec-done">${L("Fertig", "Done")}</button>
          ${shadow ? "" : `<button type="button" class="btn quiet" data-act="a-repeat">${L("Frage wiederholen", "Repeat question")}</button>
          ${a.showText ? "" : `<button type="button" class="btn quiet" data-act="a-show">${L("Text zeigen", "Show text")}</button>`}
          ${t.starter && !a.showStarter ? `<button type="button" class="btn quiet" data-act="a-starter">${L("Satzanfang", "Sentence starter")}</button>` : ""}`}
        </div></section></div>`;
    }
    if (a.phase === "analyzing") return `<div class="stack">${head}<section class="sheet stage speaking"><div class="bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="q-title" aria-live="polite">${L("Ich höre mir Ihre Antwort an", "Going through your answer")}</div>
      <p class="small muted">${esc(pick("Das dauert etwa so lange wie Ihre Antwort.", "This takes about as long as your answer did."))}</p></section></div>`;
    const heard = r && r.heard, empty = !r || r.error || !heard || !heard.text;
    return `<div class="stack">${head}<section class="sheet">
      <div class="turn"><span class="who">${L("Sachbearbeiterin", "Caseworker")}</span><div class="line">${play(t.say[0])}<div class="body">${T(t.say)}</div></div></div>
      ${empty
        ? `<p class="no">${esc(r && r.error
            ? pick("Die Auswertung hat nicht geklappt. Bitte versuchen Sie es noch einmal.", "The analysis failed. Please try again.")
            : pick("Ich habe nichts verstanden. Prüfen Sie das Mikrofon und sprechen Sie etwas lauter.", "I couldn't make out any words. Check the microphone and speak a little louder."))}</p>`
        : `<div class="field"><span class="label">${L("Das habe ich gehört", "What I heard")}</span>${clarityBlock(heard)}
            ${heard.maybe_incomplete ? `<p class="note small">${T(["Vielleicht habe ich nicht alles erkannt, zum Beispiel den Anfang. Das liegt eher an der Technik als an Ihnen. Antworten Sie gern noch einmal.", "I may not have caught everything, for example the beginning. This is more likely the technology than you. Feel free to answer again."], { gloss: false })}</p>` : ""}</div>${reviewBlock(r)}`}
      <div class="field"><span class="label">${L("Musterantwort", "Model answer")}</span>${line(t.reply, "answer")}</div>
      ${t.note ? `<p class="note small">${T(t.note)}</p>` : ""}
      ${r && r.shadow ? `<div class="feedback"><span class="label">${L("Beim Nachsprechen", "When you repeated it")}</span>${clarityBlock(r.shadow)}</div>` : ""}
      <p class="small muted">${T(["Die Aussprache ist eine automatische Schätzung. Ein Akzent ist beim Termin kein Problem, solange man Sie versteht.", "The pronunciation result is an automatic estimate. An accent is no problem at the appointment as long as you can be understood."], { gloss: false })}</p>
      <div class="row">
        <button type="button" class="btn primary" data-act="a-next">${L("Nächste Frage", "Next question")}</button>
        <button type="button" class="btn" data-act="a-retry">${L("Noch einmal antworten", "Answer again")}</button>
        <button type="button" class="btn" data-act="a-shadow">${L("Musterantwort nachsprechen", "Repeat the model answer")}</button>
      </div></section></div>`;
  }
  function listenSummary(a) {
    const heard = a.history.filter((h) => h.result.heard && h.result.heard.text);
    if (!heard.length) return "";
    const scores = heard.map((h) => h.result.heard.clarity && h.result.heard.clarity.score).filter((s) => s !== null && s !== undefined);
    const mean = scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null;
    const band = mean === null ? null : mean >= 0.92 ? "very_clear" : mean >= 0.84 ? "clear" : mean >= 0.72 ? "accented" : "hard";
    const counts = {};
    heard.forEach((h) => h.result.heard.words.filter((w) => w.unclear).forEach((w) => {
      const k = w.word.replace(/[.,!?;:„“"]/g, "");
      counts[k] = (counts[k] || 0) + 1;
    }));
    const trouble = Object.entries(counts).sort((x, y) => y[1] - x[1]).slice(0, 12);
    const rated = heard.map((h) => h.result.review && h.result.review.rating).filter(Boolean);
    const good = rated.filter((x) => x === "good").length;
    return `<section class="sheet"><h2>${T(["Ihre Auswertung", "Your results"], { gloss: false })}</h2>
      ${band ? `<div class="band">${L(BANDS[band][0], BANDS[band][1])}</div>` : ""}
      ${rated.length ? `<p>${esc(pick(`Inhalt: ${good} von ${rated.length} Antworten waren gut.`, `Content: ${good} of ${rated.length} answers were good.`))}</p>` : ""}
      ${trouble.length ? `<div class="field"><span class="label">${L("Diese Wörter üben", "Practise these words")}</span>${heardWords(trouble.map(([word]) => ({ word, unclear: true })))}</div>` : ""}
    </section>`;
  }

  const VIEWS = { start: viewStart, lernen: viewLearn, test: viewTest, offen: viewOpen, schriftlich: viewWritten, audio: viewAudio };

  /* ---------- Tooltip ---------- */
  const tip = document.getElementById("tip");
  let tipFor = null, tipPinned = false;
  function showTip(target, pinned) {
    tip.textContent = target.getAttribute("data-tip");
    tip.hidden = false;
    tipFor = target;
    tipPinned = !!pinned;
    target.classList.add("on");
    const r = target.getBoundingClientRect(), t = tip.getBoundingClientRect();
    const left = Math.max(12, Math.min(r.left + r.width / 2 - t.width / 2, innerWidth - t.width - 12));
    const top = r.top - t.height - 8 >= 8 ? r.top - t.height - 8 : r.bottom + 8;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  function hideTip() {
    if (tipFor) tipFor.classList.remove("on");
    tip.hidden = true;
    tipFor = null;
    tipPinned = false;
  }
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse" || tipPinned) return;
    const target = e.target.closest && e.target.closest("[data-tip]");
    if (target) showTip(target, false);
  });
  document.addEventListener("pointerout", (e) => {
    if (e.pointerType !== "mouse" || tipPinned) return;
    if (tipFor && e.target.closest && e.target.closest("[data-tip]") === tipFor) hideTip();
  });
  document.addEventListener("focusin", (e) => { if (e.target.matches && e.target.matches(".g[data-tip]")) showTip(e.target, false); });
  document.addEventListener("focusout", () => { if (!tipPinned) hideTip(); });
  addEventListener("scroll", () => { if (tipFor) hideTip(); }, { passive: true });

  /* ---------- Events ---------- */
  document.addEventListener("input", (e) => {
    const id = e.target.dataset && e.target.dataset.input;
    if (id === "open-answer") S.open.text = e.target.value;
    if (id === "w-answer" && S.w) S.w.text = e.target.value;
  });
  document.addEventListener("change", (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act === "pack") { saved.packed[e.target.dataset.i] = e.target.checked; save(); }
    if (act === "a-text") S.aShowText = e.target.checked;
    if (act === "a-read") S.aReadSample = e.target.checked;
    if (act === "a-auto") S.aAuto = Number(e.target.value);
    if (act === "a-listen") { S.aListen = e.target.checked; render(); }
    if (act === "a-pause") S.aPause = Number(e.target.value);
    if (act === "a-claude") { saved.claudeOk = e.target.checked; save(); }
    if (act === "appt") { saved.appt = validDate(e.target.value) ? e.target.value : ""; save(); render(); }
  });
  document.addEventListener("click", (e) => {
    const tipEl = e.target.closest("[data-tip]");
    const isChip = tipEl && (tipEl.classList.contains("chip") || tipEl.classList.contains("g"));
    if (isChip) {
      e.preventDefault();
      e.stopPropagation();
      if (tipFor === tipEl && tipPinned) hideTip(); else { hideTip(); showTip(tipEl, true); }
      return;
    }
    if (tipPinned) hideTip();

    const tabEl = e.target.closest("[data-tab]");
    if (tabEl) { e.preventDefault(); go(tabEl.dataset.tab); return; }
    const el = e.target.closest("[data-act]");
    if (!el || el.tagName === "INPUT" || el.tagName === "SELECT") return;
    const act = el.dataset.act, v = el.dataset.v;
    const handler = ACTIONS[act];
    if (handler) handler(v, el);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { hideTip(); return; }
    const typing = /^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName);
    if (typing || S.tab !== "audio" || !S.a) return;
    if (e.key === " " && e.target.tagName !== "BUTTON") {
      e.preventDefault();
      if (S.a.phase === "listening" || S.a.phase === "shadow") ACTIONS["a-rec-done"]();
      else if (S.a.phase === "feedback") ACTIONS["a-next"]();
      else if (S.a.phase === "answer") ACTIONS["a-done"]();
      else if (S.a.phase === "sample") ACTIONS["a-skip"]();
    }
    if (e.key.toLowerCase() === "r" && (S.a.phase === "answer" || S.a.phase === "listening")) ACTIONS["a-repeat"]();
  });
  addEventListener("hashchange", () => { const h = location.hash.slice(1); if (TABS[h] && h !== S.tab) go(h); });

  let playingBtn = null;
  const ACTIONS = {
    lang(v) { saved.lang = v; save(); render(); },
    speed(v) { saved.speed = Number(v); Voice.setRate(saved.speed); save(); renderShell(); },
    learn(v) { Voice.stop(); S.learn = v; render(); },
    async say(_, el) {
      if (playingBtn === el) { Voice.stop(); return; }
      if (playingBtn) playingBtn.classList.remove("playing");
      playingBtn = el;
      el.classList.add("playing");
      const r = await Voice.speak(el.dataset.say, { role: el.dataset.role });
      el.classList.remove("playing");
      if (playingBtn === el) playingBtn = null;
      if (r.via === "none") el.title = pick("Auf diesem Gerät ist keine deutsche Stimme verfügbar.", "No German voice is available on this device.");
    },
    key(v, el) {
      const box = document.getElementById(el.dataset.target);
      if (!box) return;
      const s = box.selectionStart ?? box.value.length, end = box.selectionEnd ?? s;
      box.setRangeText(v, s, end, "end");
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.focus();
    },

    sim() { startSimulation(); window.scrollTo(0, 0); },
    practice(v) { startPractice(v); window.scrollTo(0, 0); },
    answer(v) {
      const t = S.test;
      t.answers[t.i] = Number(v);
      if (t.mode === "practice") t.reveal = true;
      render();
    },
    next() { const t = S.test; if (t.i < t.items.length - 1) t.i++; t.reveal = false; t.confirm = false; Voice.stop(); render(); },
    prev() { const t = S.test; if (t.i > 0) t.i--; t.confirm = false; Voice.stop(); render(); },
    jump(v) { S.test.i = Number(v); S.test.confirm = false; Voice.stop(); render(); },
    flag() { const t = S.test; t.flags[t.i] = !t.flags[t.i]; render(); },
    confirm() { S.test.confirm = true; render(); },
    "confirm-no"() { S.test.confirm = false; render(); },
    finish() {
      const t = S.test;
      if (t && t.mode === "practice") {
        // Only questions actually attempted count in practice results.
        const done = t.items.map((it, i) => ({ it, a: t.answers[i] })).filter((x) => x.a !== undefined);
        if (!done.length) { S.test = null; render(); return; }
        t.items = done.map((x) => x.it);
        t.answers = Object.fromEntries(done.map((x, i) => [i, x.a]));
      }
      finishTest();
    },
    "back-tests"() { S.testResult = null; render(); },

    "open-topic"(v) { S.open.topic = v; S.open.cur = null; Voice.stop(); nextOpen(); render(); },
    "open-check"() { const o = S.open; o.checked = checkAnswer(o.text, o.cur.keys); Voice.stop(); render(); },
    "open-hint"() { S.open.hint = true; render(); },
    "open-skip"() { Voice.stop(); nextOpen(); render(); },
    rate(v) {
      const id = S.open.cur.id, box = saved.boxes[id] || 0;
      saved.boxes[id] = v === "2" ? box + 1 : v === "1" ? box : 0;
      save();
      Voice.stop();
      nextOpen();
      render();
      window.scrollTo(0, 0);
    },
    "w-length"(v) { S.wLength = v; render(); },
    "w-start"() { wStart(); window.scrollTo(0, 0); },
    "w-hint"() { S.w.hint = true; render(); },
    "w-send"() {
      const w = S.w;
      w.phase = "feedback";
      w.check = w.text.trim() ? checkAnswer(w.text, w.cur.keys) : null;
      Voice.stop();
      render();
    },
    "w-next"() {
      const w = S.w;
      w.log.push({ turn: w.cur, answer: w.text });
      w.hint = false;
      Voice.stop();
      wNext();
    },
    "w-stop"() { Voice.stop(); S.w = null; render(); },

    "a-length"(v) { S.aLength = v; render(); },
    "a-start"() { aStart(); window.scrollTo(0, 0); },
    "a-stop"() { aStop(); },
    "a-rec-done"() { if (S.a && S.a.rec) S.a.rec.finish(); },
    "a-next"() { if (S.a && S.a.choose) S.a.choose("next"); },
    "a-retry"() { if (S.a && S.a.choose) S.a.choose("retry"); },
    "a-shadow"() { if (S.a && S.a.rec) aShadow(S.a); },
    "a-done"() { if (S.a) { Voice.stop(); S.a.showStarter = false; S.a.input.finish(); } },
    "a-skip"() { Voice.stop(); },
    "a-repeat"() { aRepeat(); },
    "a-show"() { S.a.showText = true; render(); },
    "a-starter"() { S.a.showStarter = true; render(); },
    "a-reply"() { S.a.showReply = true; render(); },
    "a-hard"() { const a = S.a; const id = a.turn.id; a.hard = a.hard.includes(id) ? a.hard.filter((x) => x !== id) : [...a.hard, id]; render(); }
  };

  /* ---------- One-second tick: exam timer and the answer clock ---------- */
  setInterval(() => {
    const t = S.test;
    if (t && t.mode === "sim") {
      const left = t.endAt - Date.now();
      const el = document.getElementById("timer");
      if (el) { el.textContent = fmtClock(left); el.classList.toggle("low", left < 300000); }
      if (left <= 0) finishTest();
    }
    const a = S.a;
    if (a && (a.phase === "listening" || a.phase === "shadow")) {
      const s = Math.floor((Date.now() - a.t0) / 1000);
      const el = document.getElementById("a-clock");
      if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
    if (a && a.phase === "answer") {
      const s = Math.floor((Date.now() - a.t0) / 1000);
      const el = document.getElementById("a-clock");
      if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (S.aAuto && s >= S.aAuto) ACTIONS["a-done"]();
    }
  }, 1000);

  /* ---------- Boot ---------- */
  render();
  (async function watchServer() {
    const health = await Listening.health();
    if (!health) return;
    S.server = health;
    if (S.tab === "audio" && !S.a) render();
    if (health.pronunciation === "loading") setTimeout(watchServer, 3000);
  })();
})();
