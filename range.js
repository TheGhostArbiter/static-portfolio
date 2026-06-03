/* =====================================================================
   RANGE MODE — an opt-in HUD targeting range that overlays the site.
   Self-contained easter egg: remove this file + its <script> tag to
   delete the whole feature. Nothing else depends on it.

   Toggle:  the "◎ RANGE" chip in the top bar, or press  R .   Esc exits.
   Hostiles (ember) = points.  "HOLD FIRE" allies (bone) = penalty.
   ===================================================================== */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- config ---------------- */
  var LIFE      = 3400;   // ms a target lives before it expires
  var MAX_LIVE  = 4;      // max concurrent targets
  var GAP_MIN   = 750;    // ms between spawns (min)
  var GAP_MAX   = 1500;   // ms between spawns (max)
  var ALLY_RATE = 0.12;   // chance a target is a "hold fire" ally
  var HOSTILES  = ["CONTACT", "BOGEY", "TANGO", "SIGNAL", "MARK", "TRACE", "TARGET"];
  var HI_KEY    = "bsc_range_hi";

  /* Pool of REAL accomplishments (recognition + impact/experience already on
     the page — nothing fabricated). Shooting a recognition tile cycles it to
     a different one of these. */
  var RECON = [
    { code: "A1", html: 'The <strong>only engineer across two teams</strong> to earn an AWS certification by self-study.' },
    { code: "A2", html: '<strong>\u201cExceeds Expectations\u201d</strong> on leadership behaviors in formal review.' },
    { code: "A3", html: 'Repeatedly the <strong>sole / lead engineer</strong> trusted on critical integrations.' },
    { code: "A4", html: 'Called a <strong>\u201cRockstar\u201d</strong> by leadership \u2014 and by Oracle.' },
    { code: "A5", html: 'Led a <strong>4-person innovation sprint</strong> from concept to demo.' },
    { code: "A6", html: 'Cut <strong>new-engineer onboarding ~30%</strong> with better docs and tooling.' },
    { code: "B1", html: 'Built &amp; scaled a <strong>$85M+ payment platform</strong> across ~250K payments.' },
    { code: "B2", html: 'Shrank device payloads <strong>~97%</strong> (476\u00a0B \u2192 15\u00a0B) with MQTT delta updates.' },
    { code: "B3", html: 'Cut IoT provisioning from ~10\u00a0min to <strong>under 2\u00a0minutes</strong> via a secure CLI + API.' },
    { code: "B4", html: 'Automated <strong>1,200+ hours</strong> of manual work \u2014 roughly $40K recovered.' },
    { code: "B5", html: '<strong>Promoted within 4 months</strong> of joining.' },
    { code: "B6", html: 'Shipped on <strong>AWS serverless</strong> \u2014 Lambda, Step Functions, API Gateway, IoT Core.' }
  ];

  /* ---------------- state ---------------- */
  var active = false;
  var score = 0, combo = 0, hits = 0, shots = 0;
  var hi = parseInt(localStorage.getItem(HI_KEY) || "0", 10) || 0;
  var spawnTimer = null;
  var live = [];          // {el, timer, ally, dead}
  var lastScore = 0;
  var modalOpen = false;
  var modal = null;

  /* =====================================================================
     LEADERBOARD ADAPTER
     Both methods return Promises, so swapping the local store for a
     network backend (Firebase, Supabase, etc.) is a ONE-LINE change:
     just `return firebase;` instead of `return local;` at the bottom.
     ===================================================================== */
  var Leaderboard = (function () {
    var KEY = "bsc_range_board";
    function read() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }

    /* ---- LOCAL adapter (active) — stores on this device only ---- */
    var local = {
      submit: function (entry) {
        var list = read();
        list.push(entry);
        list.sort(function (a, b) { return b.score - a.score; });
        list = list.slice(0, 50);
        localStorage.setItem(KEY, JSON.stringify(list));
        return Promise.resolve(list);
      },
      top: function (n) { return Promise.resolve(read().slice(0, n)); }
    };

    /* ---- FIREBASE adapter (swap-in template) -----------------------------
       1. Create a Firebase project → Firestore Database (test mode is fine
          to start; tighten the rules later).
       2. Paste your projectId below.
       3. Change the final line of this IIFE to `return firebase;`.
       Uses the Firestore REST API, so NO SDK / <script> import is needed.

    var PROJECT = "YOUR_PROJECT_ID";
    var BASE = "https://firestore.googleapis.com/v1/projects/" + PROJECT +
               "/databases/(default)/documents";
    var firebase = {
      submit: function (entry) {
        return fetch(BASE + "/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields: {
            name:  { stringValue: entry.name },
            score: { integerValue: entry.score },
            ts:    { integerValue: entry.ts }
          } })
        }).then(function (r) { return r.json(); });
      },
      top: function (n) {
        return fetch(BASE + ":runQuery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ structuredQuery: {
            from: [{ collectionId: "scores" }],
            orderBy: [{ field: { fieldPath: "score" }, direction: "DESCENDING" }],
            limit: n
          } })
        }).then(function (r) { return r.json(); }).then(function (rows) {
          return (rows || []).filter(function (x) { return x.document; }).map(function (x) {
            var f = x.document.fields;
            return { name: f.name.stringValue, score: parseInt(f.score.integerValue, 10),
                     ts: parseInt(f.ts.integerValue, 10), id: x.document.name };
          });
        });
      }
    };
    ------------------------------------------------------------------------ */

    return local;   // <-- swap to `return firebase;` to go global
  })();

  function escHTML(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------------- styles (injected) ---------------- */
  var css = document.createElement("style");
  css.textContent = [
    ".range-toggle{ cursor:pointer; -webkit-user-select:none; user-select:none; transition:color .2s,opacity .2s; opacity:.78; }",
    ".range-toggle:hover{ opacity:1; color:var(--ember-2); }",
    "body.range-on .range-toggle{ color:var(--ember); opacity:1; }",
    "body.range-on .range-toggle .rt-live{ animation:rt-blink 1.1s steps(2,end) infinite; }",
    "@keyframes rt-blink{ 50%{ opacity:.25; } }",

    /* the play layer — pointer-events pass through except on targets */
    ".range-layer{ position:fixed; inset:0; z-index:62; pointer-events:none; }",
    "body.range-on .reticle{ border-color:var(--ember); box-shadow:0 0 34px -3px var(--ember), inset 0 0 12px -5px var(--ember); }",

    /* target */
    ".rt{ position:fixed; width:var(--sz,96px); height:var(--sz,96px); padding:0; border:0; background:none;",
    "  pointer-events:auto; cursor:none; color:var(--ember);",
    "  transform:translate(-50%,-50%) scale(1); animation:rt-in .2s var(--ease,ease) both; }",
    ".rt--ally{ color:var(--bone); }",
    ".rt__svg{ position:absolute; inset:0; width:100%; height:100%; overflow:visible; }",
    ".rt__rim{ fill:none; stroke:currentColor; stroke-width:1.5; opacity:.28; }",
    ".rt__rim2{ fill:none; stroke:currentColor; stroke-width:1; opacity:.5; }",
    ".rt__timer{ fill:none; stroke:currentColor; stroke-width:3; stroke-linecap:round;",
    "  stroke-dasharray:289; stroke-dashoffset:0; transform:rotate(-90deg); transform-origin:50% 50%;",
    "  animation:rt-timer var(--life,2600ms) linear forwards; }",
    ".rt__spin{ position:absolute; inset:9%; }",
    ".rt__spin::before,.rt__spin::after{ content:''; position:absolute; inset:0; }",
    /* corner brackets on the spinner */
    ".rt__b{ position:absolute; width:24%; height:24%; border:1.5px solid currentColor; opacity:.85; }",
    ".rt__b--tl{ top:0; left:0; border-right:0; border-bottom:0; }",
    ".rt__b--tr{ top:0; right:0; border-left:0; border-bottom:0; }",
    ".rt__b--bl{ bottom:0; left:0; border-right:0; border-top:0; }",
    ".rt__b--br{ bottom:0; right:0; border-left:0; border-top:0; }",
    ".rt__dot{ position:absolute; top:50%; left:50%; width:7px; height:7px; margin:-3.5px 0 0 -3.5px;",
    "  border-radius:50%; background:currentColor; box-shadow:0 0 14px 1px currentColor; }",
    ".rt__tag{ position:absolute; left:50%; bottom:-20px; transform:translateX(-50%); white-space:nowrap;",
    "  font-size:9px; letter-spacing:.14em; color:currentColor; opacity:.9; }",
    ".rt:not(.rt--ally) .rt__dot{ animation:rt-pulse 1.1s ease-in-out infinite; }",

    ".rt.is-hit{ animation:rt-hit .42s var(--ease,ease) forwards; }",
    ".rt.is-lost{ animation:rt-lost .38s ease forwards; }",

    "@keyframes rt-in{ from{ opacity:0; transform:translate(-50%,-50%) scale(.4);} to{ opacity:1; transform:translate(-50%,-50%) scale(1);} }",
    "@keyframes rt-hit{ 0%{ transform:translate(-50%,-50%) scale(1);} 26%{ transform:translate(-50%,-50%) scale(1.3);} 100%{ opacity:0; transform:translate(-50%,-50%) scale(1.5);} }",
    "@keyframes rt-lost{ to{ opacity:0; transform:translate(-50%,-50%) scale(.66);} }",
    "@keyframes rt-timer{ to{ stroke-dashoffset:289; } }",
    "@keyframes rt-pulse{ 50%{ transform:scale(1.6); opacity:.6; } }",
    "@keyframes rt-spin{ to{ transform:rotate(360deg); } }",
    reduce ? "" : ".rt__spin{ animation:rt-spin 6s linear infinite; }",

    /* hit marker + floating score */
    ".hitmark{ position:fixed; z-index:95; width:22px; height:22px; margin:-11px 0 0 -11px; pointer-events:none; color:var(--ember); animation:hm .34s ease forwards; }",
    ".hitmark--ally{ color:#ff5a44; }",
    ".hitmark--miss{ color:var(--faint); }",
    ".hitmark::before,.hitmark::after{ content:''; position:absolute; top:50%; left:0; width:100%; height:2px; margin-top:-1px; background:currentColor; }",
    ".hitmark::before{ transform:rotate(45deg); } .hitmark::after{ transform:rotate(-45deg); }",
    "@keyframes hm{ 0%{ transform:scale(.4); opacity:0; } 35%{ transform:scale(1.15); opacity:1; } 100%{ transform:scale(1.4); opacity:0; } }",
    ".rt-float{ position:fixed; z-index:94; pointer-events:none; font-family:var(--f-mono,monospace); font-size:14px; font-weight:700;",
    "  letter-spacing:.04em; color:var(--ember); text-shadow:0 0 12px var(--ember); animation:rt-fl .7s ease forwards; }",
    ".rt-float--neg{ color:#ff5a44; text-shadow:0 0 12px #ff5a44; }",
    "@keyframes rt-fl{ 0%{ transform:translate(-50%,-2px); opacity:0; } 18%{ opacity:1; } 100%{ transform:translate(-50%,-34px); opacity:0; } }",

    /* score panel */
    ".range-hud{ position:fixed; right:16px; bottom:54px; z-index:70; display:none; min-width:188px;",
    "  padding:11px 14px 12px; background:var(--panel-2,rgba(22,20,24,.82)); -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);",
    "  border:1px solid var(--ember-line,rgba(255,106,43,.5)); box-shadow:0 0 34px -10px rgba(255,106,43,.6); }",
    "body.range-on .range-hud{ display:block; }",
    ".range-hud__top{ display:flex; align-items:baseline; justify-content:space-between; gap:14px; margin-bottom:8px; }",
    ".range-hud__score{ font-family:var(--f-display,sans-serif); font-weight:700; font-size:26px; line-height:1; color:var(--bone); }",
    ".range-hud__combo{ font-family:var(--f-mono,monospace); font-size:11px; font-weight:700; color:var(--ember); letter-spacing:.06em; }",
    ".range-hud__row{ display:flex; justify-content:space-between; font-family:var(--f-mono,monospace); font-size:10px; letter-spacing:.08em; color:var(--muted,#8c8678); padding:2px 0; }",
    ".range-hud__row b{ color:var(--text,#cfc9bd); font-weight:600; }",
    ".range-hud__x{ display:block; width:100%; margin-top:9px; padding:6px 0; cursor:pointer; text-align:center;",
    "  font-family:var(--f-mono,monospace); font-size:10px; letter-spacing:.12em; color:var(--muted,#8c8678);",
    "  background:none; border:1px solid var(--line,rgba(240,132,58,.22)); transition:color .15s,border-color .15s; }",
    ".range-hud__x:hover{ color:var(--ember); border-color:var(--ember-line,rgba(255,106,43,.5)); }",
    "@media (pointer:coarse){ .rt,.range-toggle{ cursor:pointer; } }",

    /* ---- submit modal + leaderboard ---- */
    ".range-modal{ position:fixed; inset:0; z-index:120; display:none; align-items:center; justify-content:center; padding:24px;",
    "  background:rgba(6,6,8,.74); -webkit-backdrop-filter:blur(7px); backdrop-filter:blur(7px); }",
    ".range-modal.is-open{ display:flex; }",
    ".rm__card{ width:min(420px,100%); background:var(--panel-2,rgba(22,20,24,.94)); border:1px solid var(--ember-line,rgba(255,106,43,.5));",
    "  box-shadow:0 0 70px -18px rgba(255,106,43,.7); padding:22px 22px 18px; animation:rm-in .24s var(--ease,ease) both; }",
    "@keyframes rm-in{ from{ opacity:0; transform:translateY(12px) scale(.98);} to{ opacity:1; transform:none;} }",
    ".rm__kicker{ font-family:var(--f-mono,monospace); font-size:10px; letter-spacing:.16em; color:var(--ember); }",
    ".rm__score{ font-family:var(--f-display,sans-serif); font-weight:700; font-size:44px; line-height:1; color:var(--bone); margin:5px 0 2px; }",
    ".rm__score small{ font-family:var(--f-mono,monospace); font-size:12px; font-weight:500; letter-spacing:.12em; color:var(--muted); }",
    ".rm__form{ display:flex; gap:8px; margin:16px 0 16px; }",
    ".rm__input{ flex:1; min-width:0; padding:10px 12px; background:rgba(0,0,0,.32); border:1px solid var(--line,rgba(240,132,58,.22));",
    "  color:var(--bone); font-family:var(--f-mono,monospace); font-size:13px; letter-spacing:.12em; text-transform:uppercase; }",
    ".rm__input::placeholder{ color:var(--faint); letter-spacing:.12em; } .rm__input:focus{ outline:none; border-color:var(--ember); }",
    ".rm__send{ padding:0 16px; background:var(--ember); color:#0a0a0d; border:0; cursor:pointer; white-space:nowrap;",
    "  font-family:var(--f-mono,monospace); font-weight:700; font-size:11px; letter-spacing:.1em; transition:opacity .15s; }",
    ".rm__send:disabled{ opacity:.55; cursor:default; }",
    ".rm__bh{ display:flex; justify-content:space-between; font-family:var(--f-mono,monospace); font-size:9px; letter-spacing:.14em; color:var(--faint); margin-bottom:4px; }",
    ".rm__board{ border-top:1px solid var(--line-2,rgba(232,228,220,.12)); }",
    ".rm__row{ display:grid; grid-template-columns:26px 1fr auto; gap:10px; align-items:baseline; padding:6px 2px;",
    "  font-family:var(--f-mono,monospace); font-size:12px; border-bottom:1px solid rgba(232,228,220,.05); }",
    ".rm__row em{ color:var(--faint); font-style:normal; } .rm__row b{ color:var(--bone); font-weight:600; overflow:hidden; text-overflow:ellipsis; }",
    ".rm__row span{ color:var(--ember); } .rm__row.is-me{ background:rgba(255,106,43,.12); }",
    ".rm__row.is-me em,.rm__row.is-me b{ color:var(--ember); }",
    ".rm__empty{ font-family:var(--f-mono,monospace); font-size:11px; color:var(--faint); padding:14px 0; text-align:center; }",
    ".rm__close{ display:block; width:100%; margin-top:14px; padding:8px 0; background:none; cursor:pointer;",
    "  border:1px solid var(--line,rgba(240,132,58,.22)); color:var(--muted); font-family:var(--f-mono,monospace); font-size:10px; letter-spacing:.12em; transition:color .15s,border-color .15s; }",
    ".rm__close:hover{ color:var(--ember); border-color:var(--ember-line,rgba(255,106,43,.5)); }",
    /* modal restores a real cursor + hides the reticle so the form is usable */
    ".range-modal, .range-modal *{ cursor:auto !important; }",
    ".range-modal .rm__input{ cursor:text !important; }",
    ".range-modal button{ cursor:pointer !important; }",
    "body.modal-open .reticle, body.modal-open .reticle-dot{ opacity:0 !important; }",
    /* ---- content tiles armed as targets (range mode only) ---- */
    "body.tiles-armed .rt-tile{ position:relative; box-shadow:inset 0 0 0 1px var(--ember-line,rgba(255,106,43,.5)); transition:box-shadow .2s, background .2s; }",
    "body.tiles-armed .rt-tile::after{ content:'\\25CE HIT'; position:absolute; top:8px; right:10px; z-index:3; font-family:var(--f-mono,monospace); font-size:8px; letter-spacing:.18em; color:var(--ember); opacity:0; transition:opacity .2s; pointer-events:none; }",
    "body.tiles-armed .rt-tile:hover{ box-shadow:inset 0 0 0 1px var(--ember); }",
    "body.tiles-armed .rt-tile:hover::after{ opacity:.85; }",
    ".rt-tile.is-swapping{ animation:tile-glitch .44s steps(1,end); }",
    "@keyframes tile-glitch{ 0%{ clip-path:inset(0); transform:none; } 18%{ clip-path:inset(44% 0 30% 0); transform:translateX(3px); } 34%{ clip-path:inset(8% 0 64% 0); transform:translateX(-3px); } 52%{ clip-path:inset(34% 0 14% 0); transform:translateX(2px); } 70%{ clip-path:inset(0); transform:none; } }"
  ].join("\n");
  document.head.appendChild(css);

  /* ---------------- DOM scaffold ---------------- */
  var layer = document.createElement("div");
  layer.className = "range-layer";
  layer.setAttribute("aria-hidden", "true");

  var hud = document.createElement("div");
  hud.className = "range-hud";
  hud.setAttribute("aria-hidden", "true");
  hud.innerHTML =
    '<div class="range-hud__top"><span class="range-hud__score" data-rng="score">0</span>' +
    '<span class="range-hud__combo" data-rng="combo">x1</span></div>' +
    '<div class="range-hud__row"><span>HITS</span><b data-rng="hits">0</b></div>' +
    '<div class="range-hud__row"><span>ACCURACY</span><b data-rng="acc">100%</b></div>' +
    '<div class="range-hud__row"><span>HI-SCORE</span><b data-rng="hi">0</b></div>' +
    '<button class="range-hud__x" type="button" data-rng="board">◆ LEADERBOARD</button>' +
    '<button class="range-hud__x" type="button" data-rng="exit">EXIT RANGE · ESC</button>';

  function ready() {
    document.body.appendChild(layer);
    document.body.appendChild(hud);
    buildModal();
    injectToggle();
    bind();
    setVal("hi", hi);
  }

  /* ---------------- submit modal ---------------- */
  function buildModal() {
    modal = document.createElement("div");
    modal.className = "range-modal";
    modal.innerHTML =
      '<div class="rm__card">' +
        '<div class="rm__kicker" data-rm="kicker">RANGE COMPLETE // LOG YOUR RUN</div>' +
        '<div class="rm__score" data-rm="score">0 <small>PTS</small></div>' +
        '<div class="rm__form" data-rm="form">' +
          '<input class="rm__input" data-rm="input" maxlength="16" placeholder="ENTER CALLSIGN" aria-label="Callsign" />' +
          '<button class="rm__send" type="button" data-rm="send">SCORE IT</button>' +
        '</div>' +
        '<div class="rm__bh"><span>RANK · CALLSIGN</span><span>SCORE</span></div>' +
        '<div class="rm__board" data-rm="board"></div>' +
        '<button class="rm__close" type="button" data-rm="close">CLOSE</button>' +
      '</div>';
    document.body.appendChild(modal);
    modal.querySelector('[data-rm="send"]').addEventListener("click", submitScore);
    modal.querySelector('[data-rm="close"]').addEventListener("click", closeModal);
    modal.querySelector('[data-rm="input"]').addEventListener("keydown", function (e) {
      if (e.key === "Enter") submitScore();
    });
    modal.addEventListener("pointerdown", function (e) { if (e.target === modal) closeModal(); });
  }

  function openModal(scoreToLog) {
    modalOpen = true;
    // freeze the range: stop spawns and clear any live targets so the
    // firefight doesn't keep running around the pop-up.
    clearTimeout(spawnTimer);
    clearLive();
    document.body.classList.add("modal-open");
    modal.classList.add("is-open");
    lastScore = scoreToLog || 0;
    var canSubmit = lastScore > 0;
    modal.querySelector('[data-rm="kicker"]').textContent =
      canSubmit ? "RANGE COMPLETE // LOG YOUR RUN" : "ENTER CALLSIGN · PLAY TO LOG A SCORE";
    modal.querySelector('[data-rm="score"]').innerHTML =
      lastScore.toLocaleString("en-US") + ' <small>PTS</small>';
    // the callsign field is ALWAYS shown so there's always a place to enter
    // your name; TRANSMIT just disables until there's a score to log.
    var input = modal.querySelector('[data-rm="input"]');
    var send = modal.querySelector('[data-rm="send"]');
    input.value = localStorage.getItem("bsc_range_call") || "";
    send.disabled = !canSubmit;
    send.textContent = canSubmit ? "SCORE IT" : "NO SCORE YET";
    renderBoard(null);
    setTimeout(function () { input.focus(); }, 60);
  }

  function closeModal() {
    modalOpen = false;
    document.body.classList.remove("modal-open");
    modal.classList.remove("is-open");
    if (active) loop();   // resume spawning if a run is still in progress
  }

  function renderBoard(highlightId) {
    var box = modal.querySelector('[data-rm="board"]');
    Leaderboard.top(10).then(function (list) {
      if (!list || !list.length) {
        box.innerHTML = '<div class="rm__empty">NO TRANSMISSIONS YET — BE THE FIRST.</div>';
        return;
      }
      box.innerHTML = list.map(function (e, i) {
        var me = highlightId && e.id === highlightId ? " is-me" : "";
        return '<div class="rm__row' + me + '"><em>' + String(i + 1).padStart(2, "0") +
          '</em><b>' + escHTML(e.name) + '</b><span>' + (e.score || 0).toLocaleString("en-US") + '</span></div>';
      }).join("");
    });
  }

  function submitScore() {
    var input = modal.querySelector('[data-rm="input"]');
    var send = modal.querySelector('[data-rm="send"]');
    var name = (input.value || "").trim().toUpperCase().slice(0, 16) || "ANON";
    localStorage.setItem("bsc_range_call", name);
    var entry = { name: name, score: lastScore, ts: Date.now(),
                  id: Date.now() + "-" + Math.floor(Math.random() * 1e4) };
    send.disabled = true; send.textContent = "…";
    Leaderboard.submit(entry).then(function () {
      send.textContent = "✓ LOGGED";
      renderBoard(entry.id);
    }).catch(function () { send.disabled = false; send.textContent = "RETRY"; });
  }

  function injectToggle() {
    var feed = document.querySelector(".topbar__feed");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "feed__item range-toggle mono";
    btn.title = "Targeting range — press R";
    btn.innerHTML = '◎ RANGE<span class="rt-live"></span>';
    btn.addEventListener("click", toggle);
    if (feed) feed.insertBefore(btn, feed.firstChild);
  }

  /* ---------------- helpers ---------------- */
  function setVal(key, v) {
    var el = hud.querySelector('[data-rng="' + key + '"]');
    if (el) el.textContent = v;
  }
  function refresh() {
    setVal("score", score.toLocaleString("en-US"));
    setVal("combo", "x" + (combo || 1));
    setVal("hits", hits);
    setVal("acc", (shots ? Math.round((hits / shots) * 100) : 100) + "%");
    if (score > hi) { hi = score; localStorage.setItem(HI_KEY, String(hi)); setVal("hi", hi); }
  }
  function rand(a, b) { return a + Math.random() * (b - a); }

  /* ---------------- spawning ---------------- */
  function safeSpawn() {
    var W = window.innerWidth, H = window.innerHeight;
    var wide = W > 900;
    var sz = Math.round(rand(92, 140));
    var padL = wide ? 96 : 22, padR = 22, padT = 70, padB = 70;
    var panel = hud.getBoundingClientRect();
    for (var t = 0; t < 12; t++) {
      var x = rand(padL + sz / 2, W - padR - sz / 2);
      var y = rand(padT + sz / 2, H - padB - sz / 2);
      // reject overlap with the score panel
      if (active && panel.width &&
          x + sz / 2 > panel.left - 14 && x - sz / 2 < panel.right + 14 &&
          y + sz / 2 > panel.top - 14 && y - sz / 2 < panel.bottom + 14) continue;
      return { x: x, y: y, sz: sz };
    }
    return null;
  }

  function spawn() {
    if (!active || document.hidden || live.length >= MAX_LIVE) return;
    var p = safeSpawn();
    if (!p) return;
    var ally = Math.random() < ALLY_RATE;
    var tag = ally ? "HOLD FIRE" : HOSTILES[Math.floor(Math.random() * HOSTILES.length)];

    var el = document.createElement("button");
    el.type = "button";
    el.className = "rt" + (ally ? " rt--ally" : "");
    el.style.left = p.x + "px";
    el.style.top = p.y + "px";
    el.style.setProperty("--sz", p.sz + "px");
    el.style.setProperty("--life", LIFE + "ms");
    el.innerHTML =
      '<svg class="rt__svg" viewBox="0 0 100 100" aria-hidden="true">' +
        '<circle class="rt__rim" cx="50" cy="50" r="46"></circle>' +
        '<circle class="rt__rim2" cx="50" cy="50" r="30"></circle>' +
        '<circle class="rt__timer" cx="50" cy="50" r="46"></circle>' +
      '</svg>' +
      '<span class="rt__spin"><span class="rt__b rt__b--tl"></span><span class="rt__b rt__b--tr"></span>' +
      '<span class="rt__b rt__b--bl"></span><span class="rt__b rt__b--br"></span></span>' +
      '<span class="rt__dot"></span>' +
      '<span class="rt__tag mono">' + tag + '</span>';

    var rec = { el: el, ally: ally, dead: false, timer: 0 };
    rec.timer = setTimeout(function () { expire(rec); }, LIFE);
    live.push(rec);
    layer.appendChild(el);
  }

  function loop() {
    spawn();
    spawnTimer = setTimeout(loop, rand(GAP_MIN, GAP_MAX));
  }

  /* ---------------- resolve a target ---------------- */
  function remove(rec) {
    var i = live.indexOf(rec);
    if (i > -1) live.splice(i, 1);
    clearTimeout(rec.timer);
  }
  function expire(rec) {
    if (rec.dead) return;
    rec.dead = true;
    rec.el.classList.add("is-lost");
    if (!rec.ally) combo = 0;          // letting a hostile escape breaks the streak
    refresh();
    setTimeout(function () { rec.el.remove(); }, 380);
    remove(rec);
  }
  function shoot(rec, x, y) {
    if (rec.dead) return;
    rec.dead = true;
    shots++; 
    rec.el.classList.add("is-hit");
    if (rec.ally) {
      score = Math.max(0, score - 15);
      combo = 0;
      hitmark(x, y, "ally");
      floatTxt(x, y, "-15", true);
    } else {
      combo++;
      var pts = 10 * combo;
      score += pts; hits++;
      hitmark(x, y, "hit");
      floatTxt(x, y, "+" + pts, false);
    }
    refresh();
    setTimeout(function () { rec.el.remove(); }, 420);
    remove(rec);
  }

  /* ---------------- effects ---------------- */
  function hitmark(x, y, kind) {
    var m = document.createElement("span");
    m.className = "hitmark hitmark--" + kind;
    m.style.left = x + "px"; m.style.top = y + "px";
    layer.appendChild(m);
    setTimeout(function () { m.remove(); }, 340);
  }
  function floatTxt(x, y, txt, neg) {
    var f = document.createElement("span");
    f.className = "rt-float" + (neg ? " rt-float--neg" : "");
    f.textContent = txt;
    f.style.left = x + "px"; f.style.top = (y - 26) + "px";
    layer.appendChild(f);
    setTimeout(function () { f.remove(); }, 700);
  }

  /* ---------------- shooting input ---------------- */
  /* In range mode the page's content tiles double as targets. Shooting one
     scores points + glitches, with a reaction that suits the tile type:
        .rec__item  cycle to a different real accomplishment
        .panel      re-scan (re-run) its metric count-up
        .skg        shuffle its skill chips
        .entry      glitch pulse only (no content change)                   */
  var TILE_SEL = ".panel, .rec__item, .entry, .skg";
  var tileSnap = [];
  function tileType(el) {
    if (el.classList.contains("rec__item")) return "rec";
    if (el.classList.contains("panel"))     return "panel";
    if (el.classList.contains("entry"))     return "entry";
    if (el.classList.contains("skg"))       return "skg";
    return "tile";
  }
  function armTiles() {
    if (!tileSnap.length) {
      document.querySelectorAll(TILE_SEL).forEach(function (el) {
        var type = tileType(el);
        var snap = { el: el, type: type };
        if (type === "rec") {
          var no = el.querySelector(".rec__no"), p = el.querySelector("p");
          snap.html = p ? p.innerHTML : ""; snap.code = no ? no.textContent.trim() : "";
          if (no && !el.dataset.code) el.dataset.code = snap.code;
        } else if (type === "skg") {
          var list = el.querySelector(".skg__list"); snap.html = list ? list.innerHTML : "";
        }
        el.classList.add("rt-tile");
        tileSnap.push(snap);
      });
    }
    document.body.classList.add("tiles-armed");
  }
  function disarmTiles() {
    document.body.classList.remove("tiles-armed");
    tileSnap.forEach(function (s) {        // restore anything we mutated
      if (s.type === "rec") {
        var p = s.el.querySelector("p"); if (p) p.innerHTML = s.html;
        var no = s.el.querySelector(".rec__no"); if (no) no.textContent = s.code;
        s.el.dataset.code = s.code;
      } else if (s.type === "skg") {
        var list = s.el.querySelector(".skg__list"); if (list && s.html) list.innerHTML = s.html;
      }
      s.el.classList.remove("is-swapping");
      delete s.el.dataset.swapping;
    });
  }

  function hitTile(tile, x, y) {
    if (tile.dataset.swapping) return;          // cooldown so you can't farm one tile
    tile.dataset.swapping = "1";
    shots++; combo++; hits++;
    var pts = 10 * combo;
    score += pts;
    refresh();
    hitmark(x, y, "hit");
    floatTxt(x, y, "+" + pts, false);
    tile.classList.add("is-swapping");
    var type = tileType(tile);
    setTimeout(function () { tileReact(tile, type); }, 170);
    setTimeout(function () { tile.classList.remove("is-swapping"); delete tile.dataset.swapping; }, 470);
  }

  function tileReact(tile, type) {
    if (type === "rec")   return cycleRec(tile);
    if (type === "panel") return rescanPanel(tile);
    if (type === "skg")   return shuffleSkg(tile);
    /* entry + generic: the glitch pulse is the whole effect */
  }

  function cycleRec(tile) {
    var cur = tile.dataset.code || "";
    var pick;
    do { pick = RECON[Math.floor(Math.random() * RECON.length)]; } while (RECON.length > 1 && pick.code === cur);
    tile.dataset.code = pick.code;
    var p = tile.querySelector("p"); if (p) p.innerHTML = pick.html;
    var no = tile.querySelector(".rec__no");
    if (no && window.__scramble) { no.setAttribute("data-text", pick.code); window.__scramble(no, { speed: 1.7 }); }
    else if (no) no.textContent = pick.code;
    // safety net so the label lands even if the rAF scramble is throttled
    setTimeout(function () { var n = tile.querySelector(".rec__no"); if (n) n.textContent = pick.code; }, 560);
  }

  function rescanPanel(tile) {
    var n = tile.querySelector(".num[data-count]");
    if (!n) return;
    var target = parseFloat(n.getAttribute("data-count"));
    if (isNaN(target)) return;
    var prefix = n.getAttribute("data-prefix") || "", suffix = n.getAttribute("data-suffix") || "";
    function fmt(v) { return Math.round(v).toLocaleString("en-US"); }
    function ease(t) { return 1 - Math.pow(1 - t, 3); }
    var dur = 850, s0 = null;
    (function step(ts) {
      if (s0 === null) s0 = ts;
      var t = Math.min((ts - s0) / dur, 1);
      n.textContent = prefix + fmt(target * ease(t)) + suffix;
      if (t < 1) requestAnimationFrame(step);
    })(performance.now());
    // safety net: ensure the final figure is correct even if rAF throttles
    setTimeout(function () { n.textContent = prefix + fmt(target) + suffix; }, dur + 250);
  }

  function shuffleSkg(tile) {
    var list = tile.querySelector(".skg__list");
    if (!list) return;
    var items = Array.prototype.slice.call(list.children);
    for (var i = items.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = items[i]; items[i] = items[j]; items[j] = tmp;
    }
    items.forEach(function (it) { list.appendChild(it); });
  }

  function onShoot(e) {
    if (!active || modalOpen) return;
    var t = e.target;
    var rt = t.closest ? t.closest(".rt") : null;
    if (rt) {
      var rec = null;
      for (var i = 0; i < live.length; i++) if (live[i].el === rt) { rec = live[i]; break; }
      if (rec) shoot(rec, e.clientX, e.clientY);
      e.preventDefault();
      return;
    }
    // any armed content tile → score + react
    var tile = t.closest ? t.closest(TILE_SEL) : null;
    if (tile) { hitTile(tile, e.clientX, e.clientY); e.preventDefault(); return; }
    // ignore clicks on real site UI / the score panel — those aren't "shots"
    if (t.closest && t.closest("a,button:not(.rt),input,textarea,select,.range-hud,.range-toggle")) return;
    // empty-space shot = a miss
    shots++; combo = 0; refresh();
    hitmark(e.clientX, e.clientY, "miss");
  }

  /* ---------------- on / off ---------------- */
  function clearLive() {
    live.slice().forEach(function (rec) { clearTimeout(rec.timer); rec.el.remove(); });
    live.length = 0;
  }
  function start() {
    if (active) return;
    active = true;
    document.body.classList.add("range-on");
    armTiles();
    score = combo = hits = shots = 0;
    refresh();
    loop();
  }
  function stop(showResult) {
    var final = score;
    active = false;
    document.body.classList.remove("range-on");
    clearTimeout(spawnTimer);
    clearLive();
    disarmTiles();
    if (showResult && final > 0) { openModal(final); }
  }
  function toggle() { active ? stop(true) : start(); }

  function bind() {
    document.addEventListener("pointerdown", onShoot, true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (modalOpen) { closeModal(); return; }
        if (active) { stop(true); return; }
      }
      var tag = (e.target.tagName || "").toLowerCase();
      if ((e.key === "r" || e.key === "R") && !modalOpen && tag !== "input" && tag !== "textarea") toggle();
    });
    hud.querySelector('[data-rng="exit"]').addEventListener("click", function () { stop(true); });
    hud.querySelector('[data-rng="board"]').addEventListener("click", function () { openModal(active ? score : lastScore); });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && active) { clearTimeout(spawnTimer); }
      else if (active) { loop(); }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else { ready(); }
})();
