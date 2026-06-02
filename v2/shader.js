/* =====================================================================
   FX — WebGL ember energy field (domain-warped fbm)
   Fixed full-viewport background. Pauses when hero offscreen.
   Falls back silently to a CSS gradient if WebGL is unavailable.
   ===================================================================== */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var canvas = document.getElementById("fx");
  if (!canvas) return;

  var gl = null;
  try {
    gl = canvas.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false }) ||
         canvas.getContext("experimental-webgl");
  } catch (e) { gl = null; }

  if (!gl) {
    canvas.classList.add("fx--fallback");
    return;
  }

  var VERT = [
    "attribute vec2 p;",
    "void main(){ gl_Position = vec4(p,0.0,1.0); }"
  ].join("\n");

  var FRAG = [
    "precision highp float;",
    "uniform vec2 u_res;",
    "uniform float u_time;",
    "uniform vec2 u_mouse;",
    "uniform float u_mdown;",
    "float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }",
    "float noise(vec2 p){",
    "  vec2 i=floor(p), f=fract(p);",
    "  float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0,1.0));",
    "  vec2 u=f*f*(3.0-2.0*f);",
    "  return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y;",
    "}",
    "float fbm(vec2 p){",
    "  float v=0.0, a=0.5;",
    "  for(int i=0;i<6;i++){ v+=a*noise(p); p=p*2.02+vec2(1.7,9.2); a*=0.5; }",
    "  return v;",
    "}",
    "void main(){",
    "  vec2 uv=gl_FragCoord.xy/u_res.xy;",
    "  vec2 p=(gl_FragCoord.xy-0.5*u_res.xy)/u_res.y;",
    "  float t=u_time*0.045;",
    "  vec2 q=vec2(fbm(p*1.4+t), fbm(p*1.4+vec2(5.2,1.3)-t));",
    "  vec2 r=vec2(fbm(p*1.4+3.5*q+vec2(1.7,9.2)+t*0.6), fbm(p*1.4+3.5*q+vec2(8.3,2.8)-t*0.4));",
    "  float f=fbm(p*1.4+3.5*r);",
    "  float md=length(p-u_mouse);",
    "  float glow=smoothstep(0.55,0.0,md)*(0.35+0.5*u_mdown);",
    "  vec3 base=vec3(0.030,0.031,0.040);",
    "  vec3 deep=vec3(0.42,0.10,0.025);",
    "  vec3 ember=vec3(1.0,0.34,0.12);",
    "  vec3 hot=vec3(1.0,0.72,0.30);",
    "  vec3 col=mix(base,deep,smoothstep(0.18,0.62,f));",
    "  col=mix(col,ember,smoothstep(0.58,0.92,f+glow*0.6));",
    "  col=mix(col,hot,smoothstep(0.86,1.05,f+glow));",
    "  col+=ember*glow*0.6;",
    "  // filament lines",
    "  float fil=abs(sin((r.x-r.y)*9.0+u_time*0.4));",
    "  col+=ember*pow(1.0-fil,16.0)*0.18*smoothstep(0.35,0.75,f);",
    "  // vignette + scanline",
    "  col*=smoothstep(1.25,0.18,length(uv-0.5));",
    "  col*=0.93+0.07*sin(gl_FragCoord.y*1.6);",
    "  // subtle grain",
    "  col+=(hash(gl_FragCoord.xy+u_time)-0.5)*0.025;",
    "  gl_FragColor=vec4(max(col,0.0),1.0);",
    "}"
  ].join("\n");

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("shader compile failed:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { canvas.classList.add("fx--fallback"); return; }

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    canvas.classList.add("fx--fallback"); return;
  }
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  var uRes = gl.getUniformLocation(prog, "u_res");
  var uTime = gl.getUniformLocation(prog, "u_time");
  var uMouse = gl.getUniformLocation(prog, "u_mouse");
  var uMdown = gl.getUniformLocation(prog, "u_mdown");

  var SCALE = 0.62;
  var W = 0, H = 0;
  function resize() {
    W = Math.floor(window.innerWidth * SCALE);
    H = Math.floor(window.innerHeight * SCALE);
    canvas.width = W; canvas.height = H;
    gl.viewport(0, 0, W, H);
  }
  resize();
  var rt;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(resize, 160); });

  var mouse = { x: 0, y: 0, tx: 0, ty: 0, down: 0, tdown: 0 };
  window.addEventListener("pointermove", function (e) {
    mouse.tx = (e.clientX - 0.5 * window.innerWidth) / window.innerHeight;
    mouse.ty = -(e.clientY - 0.5 * window.innerHeight) / window.innerHeight;
  }, { passive: true });
  window.addEventListener("pointerdown", function () { mouse.tdown = 1; });
  window.addEventListener("pointerup", function () { mouse.tdown = 0; });

  var start = performance.now();
  var raf = null, running = false;

  function render(now) {
    var t = (now - start) / 1000;
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    mouse.down += (mouse.tdown - mouse.down) * 0.08;
    gl.uniform2f(uRes, W, H);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uMouse, mouse.x, mouse.y);
    gl.uniform1f(uMdown, mouse.down);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (running) raf = requestAnimationFrame(render);
  }

  function startLoop() {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(render);
  }
  function stopLoop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  // reduced motion → render one frame, no loop
  if (reduce) {
    resize();
    render(start + 1800); // a pleasant static frame
    return;
  }

  // Only animate while the hero (top) is on screen — saves battery deeper down
  var hero = document.querySelector(".hero");
  if (hero && "IntersectionObserver" in window) {
    var hio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.isIntersecting ? startLoop() : stopLoop(); });
    }, { threshold: 0 });
    hio.observe(hero);
  } else {
    startLoop();
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopLoop();
    else if (hero) { /* io will restart if visible */ startLoop(); }
  });

  startLoop();
})();
