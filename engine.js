/* Interview and voice engine. The UI talks only to these interfaces, so an AI interviewer
   can replace the scripted one later without touching the screens (see README.md).

   Voice       speak(text, {role}) -> Promise<{via}>, stop(), setRate(n)
   Interviewer next(lastAnswer) -> Promise<Turn | null>, plus progress()
   AnswerInput listen() -> Promise<{text} or {blob}>  (ManualAnswer returns no text, RecordingAnswer returns the audio)
   Turn        {id, say:[de,en], reply:[de,en], keys?, starter?, note?}
*/
(function () {
  "use strict";

  const shuffle = (list) => {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  /* ---------- Voice: neural clips first, browser German voice as fallback ---------- */
  const el = new Audio();
  el.preload = "auto";
  let rate = 1, finish = null;

  const settle = (result) => {
    const done = finish;
    finish = null;
    if (done) done(result);
  };

  function bestBrowserVoice() {
    if (!("speechSynthesis" in window)) return null;
    // Only voices that run on this device. Online voices (such as Chrome's "Google" ones) would send the text to a server.
    const german = speechSynthesis.getVoices().filter((v) => /^de(-|_|$)/i.test(v.lang) && v.localService !== false);
    const score = (v) => (/(premium|enhanced|neural|natural)/i.test(v.name) ? 2 : 0) + (/de[-_]DE/i.test(v.lang) ? 1 : 0);
    return german.sort((a, b) => score(b) - score(a))[0] || null;
  }

  function speakBrowser(text) {
    return new Promise((resolve) => {
      const voice = bestBrowserVoice();
      if (!voice) return resolve({ via: "none" });
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = rate;
      finish = resolve;
      u.onend = u.onerror = () => settle({ via: "browser" });
      speechSynthesis.speak(u);
    });
  }

  function playSource(src, via) {
    return new Promise((resolve, reject) => {
      finish = resolve;
      el.onended = () => settle({ via });
      el.onerror = () => { finish = null; reject(new Error("clip failed")); };
      el.src = src;
      el.playbackRate = rate;
      el.preservesPitch = true;
      el.play().catch((err) => { finish = null; reject(err); });
    });
  }

  async function speakClip(path) {
    try {
      return await playSource(path, "neural");
    } catch (first) {
      // Some hosts only allow media from a blob, so retry through fetch once.
      const res = await fetch(path);
      if (!res.ok) throw first;
      return playSource(URL.createObjectURL(await res.blob()), "neural");
    }
  }

  const Voice = {
    lastVia: null,
    hasClip: (text, role) => !!(window.AUDIO_MANIFEST || {})[`${role}|${text}`],
    setRate(n) {
      rate = n;
      el.playbackRate = n;
    },
    stop() {
      el.onended = el.onerror = null;
      el.pause();
      if ("speechSynthesis" in window) speechSynthesis.cancel();
      settle({ via: "stopped" });
    },
    async speak(text, { role = "officer" } = {}) {
      Voice.stop();
      const path = (window.AUDIO_MANIFEST || {})[`${role}|${text}`];
      let result;
      if (path) {
        try {
          result = await speakClip(path);
        } catch (err) {
          result = await speakBrowser(text);
        }
      } else {
        result = await speakBrowser(text);
      }
      if (result.via !== "stopped") Voice.lastVia = result.via;
      return result;
    }
  };
  if ("speechSynthesis" in window) speechSynthesis.getVoices();

  /* ---------- Scripted interviewer: the same flow as the appointment, new questions each run ---------- */
  class ScriptedInterviewer {
    constructor(content, length = "kurz") {
      const I = content.interview, L = I.lengths[length];
      const pool = (topic, n) => shuffle(content.open.filter((q) => q.t === topic)).slice(0, n).map((q) => ({
        id: q.id, say: q.q, reply: q.model, keys: q.keys, starter: q.starter
      }));
      this.queue = [
        ...I.opening,
        ...shuffle(I.personal).slice(0, L.personal),
        I.toFdgo,
        ...pool("fdgo", L.fdgo),
        ...pool("geschichte", L.geschichte),
        I.declaration,
        I.toMerk,
        ...pool("merk", L.merk),
        ...I.closing
      ];
      this.index = -1;
    }
    async next(/* lastAnswer: an AI interviewer would use this for follow-up questions */) {
      this.index += 1;
      return this.queue[this.index] || null;
    }
    progress() {
      return { current: this.index + 1, total: this.queue.length };
    }
  }

  /* ---------- Answer input: for now, you speak and tap "done" ---------- */
  class ManualAnswer {
    listen() {
      return new Promise((resolve) => { this._done = resolve; });
    }
    finish() {
      if (this._done) this._done({ text: null });
      this._done = null;
    }
    cancel() {
      this._done = null;
    }
  }

  /* ---------- Listening: the microphone, for the version running on this computer ---------- */
  class RecordingAnswer {
    constructor({ silenceMs = 3500, maxMs = 150000 } = {}) {
      this.silenceMs = silenceMs;
      this.maxMs = maxMs;
    }
    async prepare() {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      await this.ctx.resume();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    }
    listen({ onLevel } = {}) {
      return new Promise((resolve) => {
        const chunks = [], rec = new MediaRecorder(this.stream), buf = new Float32Array(this.analyser.fftSize);
        const started = performance.now();
        let floor = 0, heard = false, lastLoud = started, done = false, cancelled = false, frame = 0;
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        rec.onstop = () => {
          this.active = null;
          resolve(cancelled ? { cancelled: true } : { blob: new Blob(chunks, { type: rec.mimeType }), heardSpeech: heard });
        };
        let timer = null;
        const stop = () => { if (!done) { done = true; clearInterval(timer); if (rec.state !== "inactive") rec.stop(); } };
        this.active = { stop, cancel: () => { cancelled = true; stop(); } };
        const tick = () => {
          this.analyser.getFloatTimeDomainData(buf);
          const rms = Math.sqrt(buf.reduce((sum, v) => sum + v * v, 0) / buf.length);
          const now = performance.now();
          if (now - started < 400) floor = Math.max(floor, rms);
          else if (rms > Math.max(0.012, floor * 2.5)) { heard = true; lastLoud = now; }
          if (onLevel && frame++ % 3 === 0) onLevel(Math.min(1, rms * 8));
          if ((this.silenceMs && heard && now - lastLoud > this.silenceMs) || now - started > this.maxMs) stop();
        };
        rec.start();
        timer = setInterval(tick, 50); // Unlike animation frames, this keeps running if the tab is in the background.
      });
    }
    finish() { if (this.active) this.active.stop(); }
    cancel() { if (this.active) this.active.cancel(); }
    close() {
      this.cancel();
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.ctx) this.ctx.close();
    }
  }

  const Listening = {
    /* Answers only when served by server/app.py. The published page has no server and no microphone. */
    async health() {
      if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return null;
      try {
        const res = await fetch("/api/health");
        return res.ok ? await res.json() : null;
      } catch (e) {
        return null;
      }
    },
    async analyze(blob, { reference, context } = {}) {
      const form = new FormData();
      form.append("audio", blob, "answer");
      if (reference) form.append("reference", reference);
      if (context) form.append("context", context);
      const res = await fetch("/api/listen", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "analysis_failed");
      return data;
    },
    async evaluate(payload) {
      const res = await fetch("/api/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "feedback_failed");
      return data;
    }
  };

  /* ---------- Local answer check: looks for key ideas, it does not grade grammar ---------- */
  const normalize = (s) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");

  function checkAnswer(text, keys) {
    const t = normalize(text || "");
    return (keys || []).map((k) => ({ label: k.l, hit: k.any.some((a) => t.includes(a)) }));
  }

  window.Engine = { Voice, ScriptedInterviewer, ManualAnswer, RecordingAnswer, Listening, checkAnswer, shuffle };
})();
