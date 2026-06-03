/* =====================================================================
   APP — HUD telemetry, magnetic reticle cursor, decode typography,
   scrollspy, reveals, scroll progress.
   ===================================================================== */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var coarse = window.matchMedia("(pointer: coarse)").matches;

  /* ---------------- scroll progress ---------------- */
  var bar = document.getElementById("progress");
  var pctOut = document.querySelector("[data-scrollpct]");
  function onScroll() {
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    var p = max > 0 ? (h.scrollTop || window.pageYOffset) / max : 0;
    if (bar) bar.style.transform = "scaleX(" + p.toFixed(4) + ")";
    if (pctOut) pctOut.textContent = String(Math.round(p * 100)).padStart(3, "0");
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------------- live clock (UTC) ---------------- */
  var clock = document.querySelector("[data-clock]");
  function tick() {
    if (!clock) return;
    var d = new Date();
    function pad(n) { return String(n).padStart(2, "0"); }
    clock.textContent = pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
  }
  tick(); setInterval(tick, 1000);

  /* ---------------- decode / scramble text ---------------- */
  var GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%$><*/+=";
  function scramble(el, opts) {
    opts = opts || {};
    var final = el.getAttribute("data-text") != null ? el.getAttribute("data-text") : el.textContent;
    el.setAttribute("data-text", final);
    if (reduce) { el.textContent = final; return; }
    var speed = opts.speed || 1;
    var chars = final.split("");
    var frame = 0;
    var totalFrames = Math.max(14, Math.round(chars.length * 1.6)) / speed;
    function step() {
      var out = "";
      for (var i = 0; i < chars.length; i++) {
        var revealAt = (i / chars.length) * totalFrames * 0.62;
        if (chars[i] === " ") { out += " "; continue; }
        if (frame >= revealAt + 6) {
          out += chars[i];
        } else if (frame >= revealAt) {
          out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        } else {
          out += chars[i] === "\u00a0" ? "\u00a0" : (Math.random() < 0.5 ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : "");
        }
      }
      el.textContent = out;
      frame++;
      if (frame <= totalFrames + 8) requestAnimationFrame(step);
      else el.textContent = final;
    }
    step();
  }
  // expose for reveal triggers
  window.__scramble = scramble;

  /* ---------------- count-up metrics ---------------- */
  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function countUp(el) {
    if (el.dataset.counted) return;
    el.dataset.counted = "1";
    var target = parseFloat(el.getAttribute("data-count"));
    var prefix = el.getAttribute("data-prefix") || "";
    var suffix = el.getAttribute("data-suffix") || "";
    if (isNaN(target)) return;
    if (reduce) { el.textContent = prefix + fmt(target) + suffix; return; }
    var dur = 1500, start = null;
    function step(ts) {
      if (start === null) start = ts;
      var t = Math.min((ts - start) / dur, 1);
      el.textContent = prefix + fmt(target * easeOutCubic(t)) + suffix;
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = prefix + fmt(target) + suffix;
    }
    requestAnimationFrame(step);
  }

  /* ---------------- reveal on scroll ---------------- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target;
      // stagger siblings sharing a .stagger parent
      el.classList.add("in");
      // count up any metrics revealed
      if (el.querySelectorAll) {
        el.querySelectorAll(".num[data-count]").forEach(function (n) { countUp(n); });
      }
      // decode any [data-decode] inside on first reveal
      el.querySelectorAll && el.querySelectorAll("[data-decode]").forEach(function (d) {
        if (!d.dataset.done) { d.dataset.done = "1"; scramble(d); }
      });
      if (el.hasAttribute && el.hasAttribute("data-decode") && !el.dataset.done) {
        el.dataset.done = "1"; scramble(el);
      }
      io.unobserve(el);
    });
  }, { threshold: 0.16, rootMargin: "0px 0px -7% 0px" });

  document.querySelectorAll(".reveal, [data-decode]").forEach(function (el) { io.observe(el); });

  /* ---------------- scrollspy sidenav ---------------- */
  var navItems = Array.prototype.slice.call(document.querySelectorAll("[data-spy]"));
  var sections = navItems.map(function (n) { return document.getElementById(n.getAttribute("data-spy")); });
  var labelOut = document.querySelector("[data-section-label]");
  function spy() {
    var y = window.scrollY + window.innerHeight * 0.4;
    var active = 0;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i] && sections[i].offsetTop <= y) active = i;
    }
    navItems.forEach(function (n, i) { n.classList.toggle("on", i === active); });
    if (labelOut && navItems[active]) labelOut.textContent = navItems[active].getAttribute("data-label") || "";
  }
  window.addEventListener("scroll", function () { onScroll(); spy(); }, { passive: true });
  onScroll(); spy();

  /* ---------------- magnetic reticle cursor ---------------- */
  if (!coarse && !reduce) {
    var ring = document.querySelector(".reticle");
    var dot = document.querySelector(".reticle-dot");
    if (ring && dot) {
      document.body.classList.add("has-reticle");
      var rx = 0, ry = 0, dx = 0, dy = 0, tx = 0, ty = 0, hot = null;
      window.addEventListener("pointermove", function (e) {
        tx = e.clientX; ty = e.clientY;
        dot.style.transform = "translate(" + tx + "px," + ty + "px)";
        // magnet check
        var el = document.elementFromPoint(tx, ty);
        hot = el ? el.closest("[data-magnetic]") : null;
        document.body.classList.toggle("reticle-lock", !!hot);
      }, { passive: true });

      function loop() {
        var targetX = tx, targetY = ty, scale = 1;
        if (hot) {
          var r = hot.getBoundingClientRect();
          targetX = r.left + r.width / 2;
          targetY = r.top + r.height / 2;
          ring.style.width = (r.width + 18) + "px";
          ring.style.height = (r.height + 18) + "px";
        } else {
          ring.style.width = "34px";
          ring.style.height = "34px";
        }
        rx += (targetX - rx) * 0.18;
        ry += (targetY - ry) * 0.18;
        ring.style.transform = "translate(" + rx + "px," + ry + "px) translate(-50%,-50%)";
        requestAnimationFrame(loop);
      }
      loop();

      window.addEventListener("pointerdown", function () { document.body.classList.add("reticle-down"); });
      window.addEventListener("pointerup", function () { document.body.classList.remove("reticle-down"); });
      document.addEventListener("pointerleave", function () { document.body.classList.add("reticle-hide"); });
      document.addEventListener("pointerenter", function () { document.body.classList.remove("reticle-hide"); });
    }
  }

  /* ---------------- hero name decode on load ---------------- */
  window.addEventListener("load", function () {
    document.querySelectorAll("[data-decode-load]").forEach(function (el, i) {
      setTimeout(function () { scramble(el); }, 140 + i * 120);
    });
  });
  // also fire shortly even if load is slow
  setTimeout(function () {
    document.querySelectorAll("[data-decode-load]").forEach(function (el, i) {
      if (!el.dataset.done) { el.dataset.done = "1"; setTimeout(function () { scramble(el); }, i * 120); }
    });
  }, 600);
})();
