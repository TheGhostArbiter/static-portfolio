/* =========================================================
   Brandon S. Clark — Portfolio interactions
   ========================================================= */
(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- scroll progress ---------- */
  var bar = document.getElementById("progressBar");
  function onScroll() {
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    var p = max > 0 ? (h.scrollTop || window.pageYOffset) / max : 0;
    bar.style.width = (p * 100).toFixed(2) + "%";
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- count up ---------- */
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function runCount(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    var prefix = el.getAttribute("data-prefix") || "";
    var suffix = el.getAttribute("data-suffix") || "";
    if (reduce) {
      el.textContent = prefix + format(target) + suffix;
      return;
    }
    var dur = 1500, start = null;
    function format(n) {
      return Math.round(n).toLocaleString("en-US");
    }
    function step(ts) {
      if (start === null) start = ts;
      var t = Math.min((ts - start) / dur, 1);
      var v = target * easeOut(t);
      el.textContent = prefix + format(v) + suffix;
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = prefix + format(target) + suffix;
    }
    requestAnimationFrame(step);
  }
  function format(n) { return Math.round(n).toLocaleString("en-US"); }

  /* ---------- reveal + trigger ---------- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add("in-view");
      var nums = e.target.querySelectorAll ? e.target.querySelectorAll(".num[data-count]") : [];
      nums.forEach(function (n) {
        if (!n.dataset.done) { n.dataset.done = "1"; runCount(n); }
      });
      io.unobserve(e.target);
    });
  }, { threshold: 0.18, rootMargin: "0px 0px -8% 0px" });

  document.querySelectorAll(".reveal, .card, .bar, .ba").forEach(function (el) {
    io.observe(el);
  });

  /* ---------- hero spotlight follows cursor ---------- */
  var spot = document.getElementById("heroSpot");
  var hero = document.querySelector(".hero");
  if (spot && hero && !reduce) {
    hero.addEventListener("pointermove", function (e) {
      var r = hero.getBoundingClientRect();
      spot.style.transform = "translate(" + (e.clientX - r.left) + "px," + (e.clientY - r.top) + "px)";
    });
  } else if (spot) {
    spot.style.transform = "translate(38%, 36%)";
  }

  /* =========================================================
     HERO NETWORK CANVAS — node/integration graph
     ========================================================= */
  var canvas = document.getElementById("net");
  if (!canvas || reduce) {
    if (canvas) canvas.style.display = reduce ? "none" : canvas.style.display;
    return;
  }

  var ctx = canvas.getContext("2d");
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, nodes = [], raf = null;
  var EMBER = "240,132,58";
  var BONE = "210,205,195";

  function size() {
    var r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
  }

  function build() {
    var density = Math.max(28, Math.min(70, Math.floor((W * H) / 26000)));
    nodes = [];
    for (var i = 0; i < density; i++) {
      nodes.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.6 + 0.6,
        ember: Math.random() < 0.16,
        pulse: Math.random() * Math.PI * 2
      });
    }
  }

  var mouse = { x: -999, y: -999 };
  if (hero) {
    hero.addEventListener("pointermove", function (e) {
      var rr = hero.getBoundingClientRect();
      mouse.x = e.clientX - rr.left; mouse.y = e.clientY - rr.top;
    });
    hero.addEventListener("pointerleave", function () { mouse.x = -999; mouse.y = -999; });
  }

  var LINK = 132;
  function frame() {
    ctx.clearRect(0, 0, W, H);
    var i, j, a, b, dx, dy, d;

    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      a.x += a.vx; a.y += a.vy;
      if (a.x < 0 || a.x > W) a.vx *= -1;
      if (a.y < 0 || a.y > H) a.vy *= -1;

      // mouse attraction
      dx = mouse.x - a.x; dy = mouse.y - a.y; d = Math.hypot(dx, dy);
      if (d < 160 && d > 0.1) {
        a.x += (dx / d) * 0.5; a.y += (dy / d) * 0.5;
      }
      a.pulse += 0.02;
    }

    // links
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      for (j = i + 1; j < nodes.length; j++) {
        b = nodes[j];
        dx = a.x - b.x; dy = a.y - b.y; d = Math.hypot(dx, dy);
        if (d < LINK) {
          var o = (1 - d / LINK) * 0.42;
          var col = (a.ember || b.ember) ? EMBER : BONE;
          ctx.strokeStyle = "rgba(" + col + "," + o.toFixed(3) + ")";
          ctx.lineWidth = (a.ember || b.ember) ? 0.8 : 0.5;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // nodes
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      var glow = a.ember ? (0.5 + 0.5 * Math.sin(a.pulse)) : 1;
      var col = a.ember ? EMBER : BONE;
      if (a.ember) {
        ctx.shadowColor = "rgba(" + EMBER + ",0.9)";
        ctx.shadowBlur = 12 * glow;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = "rgba(" + col + "," + (a.ember ? 0.85 : 0.5) + ")";
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.r * (a.ember ? 1.5 : 1), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    raf = requestAnimationFrame(frame);
  }

  var visible = true;
  document.addEventListener("visibilitychange", function () {
    visible = !document.hidden;
    if (visible && !raf) raf = requestAnimationFrame(frame);
    else if (!visible && raf) { cancelAnimationFrame(raf); raf = null; }
  });

  var resizeT;
  window.addEventListener("resize", function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(size, 200);
  });

  size();
  raf = requestAnimationFrame(frame);
})();
