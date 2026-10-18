/* The Shortlist Atlas: map engine and motion.
   One projected SVG world (see build/geo.mjs). The camera moves by animating the viewBox,
   pins keep a constant on-screen size, and a vector lens magnifies the map under it.
   Everything degrades: without JS the pages are complete, the maps are extras. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const NS = "http://www.w3.org/2000/svg";
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FINE = matchMedia("(hover: hover) and (pointer: fine)").matches;
  // page furniture that map labels must never sit under
  const AVOID = ".hdr .in>*, .hero .copy>*, .phero .copy>*, .tourlabel, .story-panel, .story .step.active>div, .mapcard.show, .strip";
  const ROOT = document.documentElement.dataset.root || "/";
  // Map metadata is content, never markup or an executable navigation target.
  const localPage = path => {
    if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*\/$/.test(path)) throw new Error('Invalid Atlas route');
    return ROOT + path + 'index.html';
  };
  const textNode = (tag, text, className) => {
    const node = document.createElement(tag); node.textContent = String(text);
    if (className) node.className = className;
    return node;
  };
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const cache = {};
  const load = url => (cache[url] ||= location.protocol==='file:' ? new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=ROOT+url.replace(/\.json$/,'.js');
    script.onload=()=>{const value=window.__atlasGeo?.[url];value?resolve(value):reject(new Error('Map data unavailable'))};
    script.onerror=reject;document.head.append(script);
  }) : fetch(ROOT+url).then(r=>{if(!r.ok)throw new Error('Map data unavailable');return r.json()}));
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const pad = ([x0, y0, x1, y1], f, aspect) => {
    let w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    w *= 1 + f; h *= 1 + f;
    if (aspect) { if (w / h < aspect) w = h * aspect; else h = w / aspect; }
    return [cx - w / 2, cy - h / 2, w, h];
  };

  /* ------------------------------------------------------------------ Map */
  class AtlasMap {
    constructor(host, opts) {
      this.host = host; this.o = opts; this.vb = null; this.anim = 0;
      this.svg = el("svg", { class: "amap", role: "group", "aria-label": opts.label || "Map", preserveAspectRatio: "xMidYMid meet" }, host);
      const defs = el("defs", {}, this.svg);
      const glow = el("filter", { id: "glow" + opts.uid, x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs);
      el("feGaussianBlur", { stdDeviation: "2", result: "b" }, glow);
      const m = el("feMerge", {}, glow); el("feMergeNode", { in: "b" }, m); el("feMergeNode", { in: "SourceGraphic" }, m);
      this.clip = el("clipPath", { id: "lens" + opts.uid }, defs);
      this.clipC = el("circle", { r: 0 }, this.clip);
      this.base = el("g", { id: "base" + opts.uid, class: "base" }, this.svg);
      this.land = el("g", { class: "land" }, this.base);
      this.pins = el("g", { class: "pins" }, this.svg);
      this.lens = el("g", { class: "lens", "clip-path": `url(#lens${opts.uid})` }, this.svg);
      this.lensLand = el("g", { class: "land" }, this.lens);
      this.lensPins = el("g", { class: "lpins" }, this.lens);
      this.lensRing = el("circle", { class: "ring", r: 0 }, this.svg);
      this.lensHandle = el("line", { class: "handle" }, this.svg);
      this.lensOn = false;
      new ResizeObserver(() => { if(this.targetBox) this.cam(this.targetBox,{f:this.targetPadding,dur:0}); else if(this.vb)this.apply(this.vb); }).observe(host);
      // re-place labels as the page scrolls under the header and story cards
      let queued = false;
      addEventListener("scroll", () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; const r = host.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) { this.avoidAt = 0; this.layout(); } }); }, { passive: true });
      document.fonts && document.fonts.ready.then(() => { for (const t of this.svg.querySelectorAll(".lbl")) t.__w = 0; this.layout(); });
    }
    draw(paths, cls) {
      for (const p of paths) {
        const a = el("path", { d: p.d, class: cls(p) }, this.land);
        a.dataset.id = p.slug || p.id; if (p.slug) a.dataset.slug = p.slug;
        a.appendChild(document.createElementNS(NS, "title")).textContent = p.name;
        const b = el("path", { d: p.d, class: cls(p) }, this.lensLand);
        if (p.slug) b.dataset.slug = p.slug;
      }
    }
    aspect() { const r = this.host.getBoundingClientRect(); return r.width / Math.max(1, r.height); }
    k() { return this.vb ? 1 / Math.max(.000001,this.svg.getScreenCTM()?.a || 1) : 1; }
    apply(vb) {
      this.vb = vb; this.svg.setAttribute("viewBox", vb.join(" "));
      const k = this.k();
      this.svg.style.setProperty("--k", k);
      for (const g of this.pinEls || []) g.setAttribute("transform", `translate(${g.dataset.x} ${g.dataset.y}) scale(${k})`);
      if (this.lensOn) this.lensAt(this.lx, this.ly);
      this.layout();
    }
    // Place every label where it fits: right, left, above or below its dot, never on another
    // label, another dot, the page copy or the header. If nothing fits, the numbered dot stays.
    layout() {
      if (!this.pinEls?.length || !this.vb) return;
      const matrix=this.svg.getScreenCTM(); if(!matrix)return;
      const host=this.host.getBoundingClientRect(), margin=8;
      const clip={l:host.left+margin,r:host.right-margin,t:host.top+margin,b:host.bottom-margin};
      const overlap=(a,b)=>a.l<b.r&&a.r>b.l&&a.t<b.b&&a.b>b.t;
      const points=this.pinEls.map(g=>({g,t:g.querySelector('.lbl'),bg:g.querySelector('.label-bg'),line:g.querySelector('.label-leader'),x:matrix.a*+g.dataset.x+matrix.e,y:matrix.d*+g.dataset.y+matrix.f}));
      const taken=points.map(p=>({l:p.x-11,r:p.x+11,t:p.y-11,b:p.y+11}));
      const header=document.querySelector('.hdr').getBoundingClientRect();
      if(header.bottom>clip.t)taken.push({l:header.left,r:header.right,t:header.top,b:header.bottom});
      points.sort((a,b)=>Number(b.g.classList.contains('on'))-Number(a.g.classList.contains('on')));
      for(const p of points){
        p.g.classList.remove('under'); if(!p.t)continue;
        p.t.classList.remove('off');
        const width=(p.t.__w||(p.t.__w=p.t.getComputedTextLength()))+14,height=24;
        const candidates=[];
        for(const gap of [14,30,48,70]){
          candidates.push([gap,-height/2],[-gap-width,-height/2],[-width/2,-gap-height],[-width/2,gap]);
          if(gap>14)candidates.push([gap,-gap-height],[-gap-width,-gap-height],[gap,gap],[-gap-width,gap]);
        }
        let found=null;
        if(p.x>=clip.l&&p.x<=clip.r&&p.y>=clip.t&&p.y<=clip.b){
          for(const [x,y] of candidates){const box={l:p.x+x,r:p.x+x+width,t:p.y+y,b:p.y+y+height};
            if(box.l<clip.l||box.r>clip.r||box.t<clip.t||box.b>clip.b||taken.some(t=>overlap(box,t)))continue;
            found={x,y,box};break;
          }
        }
        p.t.classList.toggle('off',!found);p.bg?.classList.toggle('off',!found);
        if(p.line)p.line.style.display=found?'':'none';
        if(found){
          p.t.setAttribute('x',found.x+7);p.t.setAttribute('y',found.y+16);p.t.setAttribute('text-anchor','start');
          for(const [key,value] of Object.entries({x:found.x,y:found.y,width,height}))p.bg.setAttribute(key,value);
          p.line.setAttribute('x2',Math.max(found.x,Math.min(0,found.x+width)));p.line.setAttribute('y2',Math.max(found.y,Math.min(0,found.y+height)));
          taken.push({l:found.box.l-3,r:found.box.r+3,t:found.box.t-3,b:found.box.b+3});
        }
      }
    }
    cam(box, { f = 0.12, dur = 1100, aspect } = {}) {
      this.targetBox=box; this.targetPadding=f;
      const to = pad(box, f, aspect || this.aspect());
      cancelAnimationFrame(this.anim);
      if(this.resolveCam){this.resolveCam();this.resolveCam=null;}
      if (!this.vb || REDUCED || dur === 0) { this.apply(to); return Promise.resolve(); }
      const from = this.vb.slice(), t0 = performance.now();
      // zoom out a little mid-flight when travelling far: feels like a camera, not a slide
      const dist = Math.hypot(to[0] - from[0], to[1] - from[1]) / Math.max(from[2], to[2]);
      const lift = Math.min(0.9, dist * 0.35);
      return new Promise(res => {
        this.resolveCam=res;
        const step = now => {
          const t = Math.min(1, (now - t0) / dur), e = ease(t), arc = 1 + lift * Math.sin(Math.PI * t);
          const w = (from[2] + (to[2] - from[2]) * e) * arc, h = (from[3] + (to[3] - from[3]) * e) * arc;
          const cx = from[0] + from[2] / 2 + (to[0] + to[2] / 2 - from[0] - from[2] / 2) * e;
          const cy = from[1] + from[3] / 2 + (to[1] + to[3] / 2 - from[1] - from[3] / 2) * e;
          this.apply([cx - w / 2, cy - h / 2, w, h]);
          if (t < 1) this.anim = requestAnimationFrame(step); else {this.resolveCam=null;res();}
        };
        this.anim = requestAnimationFrame(step);
      });
    }
    frameRight(box, { frac = 0.56, f = 0.18 } = {}) {
      const r = this.host.getBoundingClientRect();
      if (r.width < 900) return this.cam(box, { f, ...arguments[2] });
      let [x0, y0, x1, y1] = box; const bw = (x1 - x0) * (1 + f), bh = (y1 - y0) * (1 + f);
      const A = r.width / r.height;
      let W = bw / frac, H = W / A;
      if (bh > H * 0.78) { H = bh / 0.78; W = H * A; }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const left = cx - W * (1 - frac / 2 - 0.03);
      return this.cam([left, cy - H / 2, left + W, cy + H / 2], { f: 0, aspect: A, ...arguments[2] });
    }
    setPins(list, { labels = 99, stagger = 70, href } = {}) {
      this.pins.textContent = ""; this.lensPins.textContent = ""; this.lzk = 0;
      this.pinEls = list.map((p, i) => {
        const g = el("g", { class: "pin" + (p.cls ? " " + p.cls : ""), transform: `translate(${p.x} ${p.y}) scale(${this.k()})` }, this.pins);
        g.dataset.x = p.x; g.dataset.y = p.y; g.dataset.slug = p.slug;
        const a = href ? el("a", { href: href(p), "aria-label": p.name || p.slug }, g) : g;
        el("line", { class: "leader", x1: 0, y1: 0, x2: 0, y2: 0 }, a);
        const off = el("g", { class: "pin-off" }, a);
        const inner = el("g", { class: "pin-in" }, off);
        inner.style.animationDelay = (REDUCED ? 0 : i * stagger) + "ms";
        el("ellipse", { class: "shadow", cx: 0, cy: 1, rx: 6, ry: 2.2 }, inner);
        el("circle", { class: "halo", r: 11 }, inner);
        el("circle", { class: "dot", r: p.rank <= labels ? 8.5 : 5 }, inner);
        if (p.rank && p.rank <= labels) el("text", { class: "num", y: 3.4 }, inner).textContent = p.rank;
        if (p.name) {
          el("line", {class:"label-leader",x1:0,y1:0,x2:0,y2:0,stroke:"#abc3b6","stroke-width":1}, inner);
          el("rect", {class:"label-bg",x:10,y:-12,width:80,height:24,rx:3}, inner);
          const t = el("text", { class: "lbl", x: 17, y: 4 }, inner); t.textContent = p.name;
        }
        a.appendChild(document.createElementNS(NS, "title")).textContent = p.name || "";
        // lens copy: plain dots and labels in map units, magnified by the lens transform
        const lg = el("g", { class: "lpin" + (p.cls ? " " + p.cls : "") }, this.lensPins);
        lg.dataset.x = p.x; lg.dataset.y = p.y;
        el("circle", { cx: p.x, cy: p.y, r: 0 }, lg);
        if (p.lensName || p.name) el("text", { x: p.x, y: p.y }, lg).textContent = p.lensName || p.name;
        return g;
      });
      this.pinEls.forEach(g=>{g.addEventListener("pointerenter",()=>{this.highlight(g.dataset.slug);this.layout()});g.addEventListener("focusin",()=>{this.highlight(g.dataset.slug);this.layout()})});
      this.pinsData = list;
      this.layout();
    }
    highlight(slug) {
      for (const g of this.pinEls || []) g.classList.toggle("on", g.dataset.slug === slug);
      $$("path[data-slug]", this.svg).forEach(p => p.classList.toggle("on", p.dataset.slug === slug));
      this.layout();
    }
    showLens(on) { this.lensOn = on; this.svg.classList.toggle("lensing", on); if (!on) { this.clipC.setAttribute("r", 0); this.lensRing.setAttribute("r", 0); this.lensHandle.setAttribute("x1", 0); this.lensHandle.setAttribute("x2", 0); this.layout(); } }
    lensAt(x, y, zoom = 3.2, rpx = 84) {
      this.lx = x; this.ly = y;
      const r = rpx * this.k();
      this.clipC.setAttribute("cx", x); this.clipC.setAttribute("cy", y); this.clipC.setAttribute("r", r);
      this.lensRing.setAttribute("cx", x); this.lensRing.setAttribute("cy", y); this.lensRing.setAttribute("r", r);
      if (!this.inLayout) { this.inLayout = true; requestAnimationFrame(() => { this.inLayout = false; this.layout(); }); }
      const d = r * 0.72;
      this.lensHandle.setAttribute("x1", x + d); this.lensHandle.setAttribute("y1", y + d);
      this.lensHandle.setAttribute("x2", x + d * 1.75); this.lensHandle.setAttribute("y2", y + d * 1.75);
      const t = `translate(${x} ${y}) scale(${zoom}) translate(${-x} ${-y})`;
      this.lensLand.setAttribute("transform", t); this.lensPins.setAttribute("transform", t);
      if (this.lzk !== this.k() / zoom) {
        const u = (this.lzk = this.k() / zoom);
        for (const g of this.lensPins.children) {
          g.firstChild.setAttribute("r", 4.2 * u);
          const tx = g.lastChild; if (tx && tx.tagName === "text") { tx.setAttribute("font-size", 11 * u); tx.setAttribute("x", +g.dataset.x + 7 * u); tx.setAttribute("y", +g.dataset.y + 3.6 * u); }
        }
      }
    }
    toMap(ev) {
      const r = this.svg.getBoundingClientRect(), [x, y, w, h] = this.vb;
      const s = Math.max(w / r.width, h / r.height), ox = (r.width - w / s) / 2, oy = (r.height - h / s) / 2;
      return [x + (ev.clientX - r.left - ox) * s, y + (ev.clientY - r.top - oy) * s];
    }
    glide(points, { hold = 1600, zoom = 3.2 } = {}) {
      // idle lens tour across points; stops for good once the visitor takes the lens
      if (REDUCED || !points.length) return;
      let i = 0, t0 = 0, from = points[0], to = points[0];
      this.showLens(true); this.lensAt(...from, zoom);
      const step = now => {
        if (this.userLens) return;
        if (!t0) t0 = now;
        const t = Math.min(1, (now - t0) / hold);
        const e = ease(Math.min(1, t * 1.6));
        this.lensAt(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e, zoom);
        if (t >= 1) { from = to; i = (i + 1) % points.length; to = points[i]; t0 = now; this.onGlide && this.onGlide(i); }
        this.glideRaf = requestAnimationFrame(step);
      };
      this.glideRaf = requestAnimationFrame(step);
    }
  }
  let uid = 0;

  /* --------------------------------------------------- world (home, atlas) */
  async function worldMap(host) {
    const g = await load("assets/geo/world.json");
    const m = new AtlasMap(host, { uid: ++uid, label: host.dataset.label || "World map of the Atlas countries" });
    m.draw(g.world, p => (p.slug ? "c dossier" : "c"));
    m.g = g;
    const card = host.parentElement.querySelector(".mapcard");
    // country hover and click
    $$("path.dossier", m.land).forEach(p => {
      const c = g.countries[p.dataset.slug];
      p.setAttribute("tabindex", "0"); p.setAttribute("role", host.classList.contains("interactive-map")?"button":"link"); p.setAttribute("aria-label", `${c.name}, ${c.n} ${c.noun}`);
      const go = () => host.classList.contains("interactive-map") ? host.dispatchEvent(new CustomEvent("selectcountry",{detail:p.dataset.slug})) : (location.href = localPage(c.url));
      p.addEventListener("click", go);
      p.addEventListener("keydown", e => {if(e.key === "Enter"||(e.key === " "&&host.classList.contains("interactive-map"))){e.preventDefault();go()}});
      p.addEventListener("pointerenter", () => { m.highlight(p.dataset.slug); showCard(card, c, p); host.dispatchEvent(new CustomEvent("country", { detail: p.dataset.slug })); });
      p.addEventListener("pointerleave", () => { m.highlight(null); card && card.classList.remove("show"); });
    });
    return m;
  }
  function showCard(card, c, path) {
    if (!card) return;
    card.replaceChildren(textNode('span', c.series, 'k'), textNode('b', c.name), textNode('span', `${c.n} ${c.noun} · ${c.pages} pages`), textNode('em', 'Open the Shortlist →'));
    const r = path.getBoundingClientRect(), h = card.parentElement.getBoundingClientRect();
    card.style.left = Math.min(h.width - 230, Math.max(8, r.left - h.left + r.width / 2 - 110)) + "px";
    card.style.top = Math.max(8, r.top - h.top - 96) + "px";
    card.classList.add("show");
  }
  const allPins = g => Object.entries(g.towns).map(([slug, t]) => ({ slug, x: t.x, y: t.y, rank: t.rank, name: t.name, country: t.country, cls: "c-" + t.country }));

  async function heroWorld(host) {
    const m = await worldMap(host);
    const g = m.g;
    const order = Object.entries(g.countries).sort((a, b) => a[1].order - b[1].order).map(e => e[0]);
    m.cam([0, 0, g.W, g.H], { f: -0.02, dur: 0 });
    $$("path.dossier", m.svg).forEach((p, i) => setTimeout(() => p.classList.add("lit"), REDUCED ? 0 : 300 + i * 90));
    const label = $(".hero .tourlabel");
    let i = 0, paused = false, timer;
    const show = async () => {
      if (paused) return;
      const slug = order[i], c = g.countries[slug];
      m.showLens(false); m.setPins([]); m.highlight(slug);
      if (label) {
        const a = document.createElement('a'); a.href = localPage(c.url);
        a.append(textNode('b', String(c.order + 1).padStart(2, '0')), document.createTextNode(` ${c.name} · ${c.n} ${c.noun} `), textNode('span', '→'));
        label.replaceChildren(a); label.classList.remove('flash'); void label.offsetWidth; label.classList.add('flash');
      }
      await m.frameRight(c.box, { frac: 0.5, f: 0.22 }, { dur: REDUCED ? 0 : 1900 });
      if (paused) return;
      const pins = allPins(g).filter(p => p.country === slug);
      m.setPins(pins, { labels: 99, stagger: 90, href: p => localPage(`${slug}/${p.slug}/`) });
      const top = pins.find(p => p.rank === 1);
      if (FINE && innerWidth > 900 && top && !REDUCED) setTimeout(() => { if (!paused && !m.userLens) { m.showLens(true); m.lensAt(top.x, top.y, 3.4, 92); } }, 900 + pins.length * 90);
      i = (i + 1) % order.length;
      timer = setTimeout(show, REDUCED ? 6000 : 5200 + pins.length * 90);
    };
    setTimeout(show, REDUCED ? 0 : 900);
    // the visitor takes over: pause the tour while they explore, resume when they leave
    host.addEventListener("pointerenter", () => { if (!FINE) return; paused = true; clearTimeout(timer); });
    host.addEventListener("pointerleave", () => { if (!FINE) return; m.showLens(false); m.userLens = false; paused = false; timer = setTimeout(show, 1200); });
    if (FINE) m.svg.addEventListener("pointermove", e => { if (innerWidth <= 900) return; m.userLens = true; m.showLens(true); m.lensAt(...m.toMap(e), 3.4, 92); });
    host.addEventListener("country", e => { const k = order.indexOf(e.detail); if (k >= 0) { i = k; } });
    return m;
  }

  /* ------------------------------------------------------ the scroll story */
  async function story(section) {
    const host = $(".story-map", section);
    const m = await worldMap(host);
    const g = m.g;
    m.cam([0, 0, g.W, g.H], { dur: 0 });
    const panel = $(".story-panel", section);
    const bars = $$(".meter i", section);
    const steps = $$(".step", section);
    const run = async s => {
      steps.forEach(x => x.classList.toggle("active", x === s));
      const cam = s.dataset.cam, [kind, key] = cam.split(":");
      section.dataset.step = s.dataset.n;
      $$("path.dossier", m.svg).forEach(p => p.classList.toggle("lit", kind === "world" || kind === "region" || p.dataset.slug === (s.dataset.country || key)));
      m.showLens(false);
      if (kind === "world") { m.setPins([]); await m.cam([0, 0, g.W, g.H], { f: -0.02 }); }
      if (kind === "region") { m.setPins(allPins(g).map(p => ({ ...p, name: null, rank: 99 })), { labels: 0, stagger: 12 }); await m.cam(g.regions[key], { f: 0.3 }); }
      if (kind === "country") {
        const c = g.countries[key];
        m.setPins(allPins(g).filter(p => p.country === key), { labels: 99, stagger: 110 });
        await m.cam(c.box, { f: 0.2 });
      }
      if (kind === "town") {
        const t = g.towns[key], c = g.countries[t.country];
        m.setPins(allPins(g).filter(p => p.country === t.country), { labels: 99, stagger: 0 });
        m.highlight(key);
        await m.cam(c.box, { f: 0.2 });
        m.showLens(true); m.lensAt(t.x, t.y, 3.6, 96);
      }
      panel && panel.classList.toggle("show", s.dataset.meter === "1");
      bars.forEach((b, i) => { b.style.transitionDelay = i * 140 + "ms"; b.closest(".meter").classList.toggle("fill", s.dataset.meter === "1"); });
      const prog = $(".story-prog i", section);
      if (prog) prog.style.transform = `scaleX(${(+s.dataset.n + 1) / steps.length})`;
    };
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && run(e.target)), { rootMargin: "-45% 0px -45% 0px" });
    steps.forEach(s => io.observe(s));
  }

  /* ------------------------------------------------ country and town maps */
  async function countryMap(host) {
    const slug = host.dataset.country, focus = host.dataset.town;
    const g = await load(`assets/geo/${slug}.json`);
    const m = new AtlasMap(host, { uid: ++uid, label: host.dataset.label });
    m.draw(g.near, p => (p.self ? "c self" : "c"));
    const pins = g.towns.map(t => ({ ...t, cls: focus && t.slug !== focus ? "dim" : "" }));
    const box = [Math.min(g.box[0],...g.towns.map(t=>t.x)),Math.min(g.box[1],...g.towns.map(t=>t.y)),Math.max(g.box[2],...g.towns.map(t=>t.x)),Math.max(g.box[3],...g.towns.map(t=>t.y))];
    m.cam(box,{f:.4,dur:0});
    m.setPins(pins,{labels:99,stagger:0,href:p=>localPage(`${slug}/${p.slug}/`)});
    if(focus)m.highlight(focus);
    m.layout();
    // list rows <-> pins
    $$("[data-pin]").forEach(r => {
      r.addEventListener("pointerenter", () => m.highlight(r.dataset.pin));
      r.addEventListener("pointerleave", () => m.highlight(focus || null));
      r.addEventListener("focusin", () => m.highlight(r.dataset.pin));
    });
    return m;
  }

  /* ------------------------------------------------------------- Atlas overlay */
  function atlasOverlay() {
    const dlg=$("#atlas"); let dialogMap,opener;
    const attachSearch=(root,getMap)=>{
      if(!root)return;
      const input=$(".atlas-search input",root),buttons=$$(".chips button",root),rows=$$(".atlas-list>li[data-region]",root);
      const empty=document.createElement('p');empty.className='atlas-empty';empty.textContent='No places match. Try another name, or choose All.';empty.hidden=true;$(".atlas-side",root).append(empty);
      let selected='all';
      const filter=()=>{
        const q=input.value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        let total=0;
        rows.forEach(li=>{
          const country=li.dataset.name.includes(q),towns=$$('[data-town]',li);let any=false;
          towns.forEach(t=>{const hit=!q||country||t.dataset.name.includes(q);t.hidden=!hit;any ||= hit});
          li.hidden=!((!q||country||any)&&(selected==='all'||selected===li.dataset.region));
          if(!li.hidden)total++;li.classList.toggle('open',!!q&&!li.hidden);
        });
        empty.hidden=total!==0;
        const map=getMap();if(map){
          const hits=rows.filter(r=>!r.hidden);
          if(q&&hits.length===1){const slug=hits[0].dataset.slug;map.cam(map.g.countries[slug].box,{f:.5});map.setPins(allPins(map.g).filter(p=>p.country===slug),{href:p=>localPage(`${slug}/${p.slug}/`)});}
          else{map.cam(selected==='all'?[0,0,map.g.W,map.g.H]:map.g.regions[selected],{f:.18});map.setPins([]);}
        }
      };
      input.addEventListener('input',filter);
      buttons.forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.region;buttons.forEach(x=>x.setAttribute('aria-pressed',String(x===b)));filter()}));
      rows.forEach(li=>li.addEventListener('pointerenter',()=>{const m=getMap();if(m){m.highlight(li.dataset.slug);m.cam(m.g.countries[li.dataset.slug].box,{f:.45});m.setPins(allPins(m.g).filter(p=>p.country===li.dataset.slug),{href:p=>localPage(`${p.country}/${p.slug}/`)})}}));
    };
    if(dlg){
      const open=async e=>{opener=e?.currentTarget||document.activeElement;dlg.showModal();document.body.classList.add('noscroll');$('.atlas-search input',dlg).focus({preventScroll:true});
        if(!dialogMap&&innerWidth>820){dialogMap=await worldMap($('.atlas-map',dlg));dialogMap.cam([0,0,dialogMap.g.W,dialogMap.g.H],{dur:0})}
      };
      const close=()=>{dlg.close();document.body.classList.remove('noscroll');opener?.focus()};
      $$('[data-atlas]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();open(e)}));
      dlg.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close()}});
      $('.atlas-close',dlg).addEventListener('click',close);dlg.addEventListener('close',()=>{document.body.classList.remove('noscroll');opener?.focus()});dlg.addEventListener('click',e=>e.target===dlg&&close());
      document.addEventListener('keydown',e=>{if(e.key==='/'&&!dlg.open&&!/input|textarea|select/i.test(document.activeElement.tagName)){e.preventDefault();open()}});
      attachSearch(dlg,()=>dialogMap);
    }
    const standalone=$('.atlas-page');if(standalone){let map;attachSearch(standalone,()=>map);if(innerWidth>820)worldMap($('.atlas-page-map',standalone)).then(m=>{map=m;m.cam([0,0,m.g.W,m.g.H],{dur:0})})}
  }

  async function explorer(section){
    const host=$('.interactive-map',section),m=await worldMap(host),g=m.g;
    const buttons=$$('[data-map-country]',section),heading=$('[data-map-heading]',section),townList=$('.map-town-list',section),link=$('[data-map-link]',section),tour=$('[data-map-tour]',section),select=$('[data-map-select]',section);
    let selected=buttons[0].dataset.mapCountry,playing=false,timer,visible=false,seq=0;
    const render=async(slug,animate=true)=>{
      selected=slug;const token=++seq,c=g.countries[slug];buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mapCountry===slug)));
      if(select)select.value=slug;
      const listDetails=townList.closest('details');if(listDetails){listDetails.hidden=false;listDetails.open=true;listDetails.querySelector('summary').firstChild.textContent='Explore the Shortlisted Towns ';}
      section.dataset.selectedCountry=slug;heading.textContent=c.name;link.textContent=`Explore ${c.name} →`;link.href=localPage(c.url);link.hidden=false;
      const pins=allPins(g).filter(p=>p.country===slug);
      townList.replaceChildren(...pins.map(p=>{
        const a=document.createElement('a');a.href=localPage(c.url+p.slug+'/');a.dataset.focus=p.slug;
        a.style.setProperty('--order',p.rank-1);a.append(textNode('b',p.rank),textNode('span',p.name),textNode('i','↗'));return a;
      }));
      townList.querySelectorAll('a').forEach(a=>{a.addEventListener('pointerenter',()=>{m.highlight(a.dataset.focus);m.layout()});a.addEventListener('focus',()=>{m.highlight(a.dataset.focus);m.layout()})});
      m.setPins([]);m.highlight(slug);await m.cam(c.box,{f:.42,dur:animate?1050:0});if(token!==seq)return;
      m.setPins(pins,{labels:99,stagger:0,href:p=>localPage(`${slug}/${p.slug}/`)});m.layout();
    };
    const overview=async(kind,animate=true)=>{
      const token=++seq;buttons.forEach(b=>b.setAttribute('aria-pressed','false'));
      heading.textContent=kind==='europe'?'Europe · Eight Country Atlases':'The Whole Atlas';
      link.hidden=true;m.setPins([]);m.highlight(null);
      const countries=Object.entries(g.countries).filter(([slug,c])=>kind==='world'||c.region==='Europe');
      const details=townList.closest('details');if(details){details.hidden=false;details.open=true;details.querySelector('summary').firstChild.textContent='Choose a Country Atlas ';}
      townList.replaceChildren(...countries.map(([slug,c])=>{const b=document.createElement('button');b.type='button';b.dataset.atlasCountry=slug;b.append(textNode('b',c.n),textNode('span',c.name),textNode('i','↗'));b.addEventListener('click',()=>{stop();render(slug)});return b}));
      await m.cam(kind==='europe'?g.regions.Europe:[0,0,g.W,g.H],{f:.08,dur:animate?1050:0});
      if(token!==seq)return;
      m.setPins(countries.map(([slug,c])=>({slug,name:c.name,x:c.center[0],y:c.center[1]})),{stagger:35});
      m.pinEls.forEach(p=>{p.setAttribute('tabindex','0');p.setAttribute('role','button');p.setAttribute('aria-label','Explore '+g.countries[p.dataset.slug].name+' map');p.style.cursor='pointer';const go=()=>{stop();render(p.dataset.slug)};p.addEventListener('click',go);p.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}})});
    };
    const stop=()=>{playing=false;clearTimeout(timer);tour.textContent='Play Tour';tour.setAttribute('aria-pressed','false')};
    const schedule=()=>{clearTimeout(timer);if(playing&&visible&&!document.hidden)timer=setTimeout(()=>{const i=buttons.findIndex(b=>b.dataset.mapCountry===selected);render(buttons[(i+1)%buttons.length].dataset.mapCountry);schedule()},6500)};
    buttons.forEach(b=>b.addEventListener('click',()=>{stop();render(b.dataset.mapCountry)}));
    host.addEventListener('selectcountry',e=>{stop();render(e.detail)});
    select?.addEventListener('change',()=>{if(select.value==='world')$('[data-map-world]',section).click();else{stop();render(select.value)}});
    $('[data-map-world]',section).addEventListener('click',()=>{stop();overview('world')});
    $('[data-map-europe]',section)?.addEventListener('click',()=>{stop();overview('europe')});
    matchMedia('(min-width:701px)').addEventListener('change',e=>{if(townList.closest('details'))townList.closest('details').open=e.matches});
    tour.addEventListener('click',()=>{if(playing)stop();else{playing=true;tour.textContent='Pause Tour';tour.setAttribute('aria-pressed','true');render(selected);schedule()}});
    new IntersectionObserver(es=>{visible=es[0].isIntersecting;schedule()},{threshold:.15}).observe(section);
    document.addEventListener('visibilitychange',schedule);overview('europe',false);
  }

  /* ------------------------------------------------------------- motion kit */
  function reveals() {
    const io = new IntersectionObserver(es => es.forEach(e => {
      e.target.classList.toggle("in",e.isIntersecting);
      if (!e.isIntersecting) return;
      if (e.target.dataset.count) count(e.target);
    }), { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    $$("[data-reveal],[data-count],.split-lines").forEach(n => io.observe(n));
  }
  function count(n) {
    // Facts stay readable immediately; motion belongs to the map and compass.
    n.textContent = Math.round(+n.dataset.count).toLocaleString("en-US");
  }
  function splitLines() {
    // Animate complete headings; word masks clipped serif ascenders and accents.
    $$(".split-lines").forEach(h => h.setAttribute('data-reveal',''));
  }
  function header() {
    const h = $(".hdr"); if (!h) return;
    let last = 0;
    addEventListener("scroll", () => {
      const y = scrollY; h.classList.toggle("solid", y > 24); h.classList.toggle("tuck", y > 480 && y > last); last = y;
      const p = $(".readbar i"); if (p) p.style.transform = `scaleX(${Math.min(1, y / Math.max(1, document.body.scrollHeight - innerHeight))})`;
    }, { passive: true });
  }
  function tilt() {
    if (!FINE || REDUCED) return;
    $$("[data-tilt]").forEach(c => {
      c.addEventListener("pointermove", e => {
        const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        c.style.setProperty("--rx", (-y * 6).toFixed(2) + "deg"); c.style.setProperty("--ry", (x * 8).toFixed(2) + "deg");
        c.style.setProperty("--mx", (x + 0.5) * 100 + "%"); c.style.setProperty("--my", (y + 0.5) * 100 + "%");
      });
      c.addEventListener("pointerleave", () => { c.style.setProperty("--rx", "0deg"); c.style.setProperty("--ry", "0deg"); });
    });
  }
  function parallax() {
    const items = $$("[data-parallax]"); if (!items.length || REDUCED) return;
    const tick = () => { items.forEach(n => { const r = n.getBoundingClientRect(); const v = (r.top + r.height / 2 - innerHeight / 2) / innerHeight; n.style.setProperty("--py", (v * -1 * +n.dataset.parallax).toFixed(1) + "px"); }); };
    addEventListener("scroll", () => requestAnimationFrame(tick), { passive: true }); tick();
  }
  function tabs() {
    $$("[data-tabs]").forEach(t => {
      const btns = $$("[role=tab]", t), panes = $$("[role=tabpanel]", t);
      const pick = b => { btns.forEach(x => {x.setAttribute("aria-selected", x === b);x.tabIndex=x===b?0:-1;}); panes.forEach(p => (p.hidden = p.id !== b.getAttribute("aria-controls"))); };
      btns.forEach(b => b.addEventListener("click", () => pick(b)));
      t.addEventListener("keydown", e => {
        const i = btns.indexOf(document.activeElement); if (i < 0) return;
        const n = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
        if (n) { e.preventDefault(); const b = btns[(i + n + btns.length) % btns.length]; b.focus(); pick(b); }
      });
    });
    $$("[data-regions]").forEach(t => $$("button", t).forEach(b => b.addEventListener("click", () => {
      $$("button", t).forEach(x => x.setAttribute("aria-pressed", x === b));
      $$(t.dataset.regions).forEach(card => { const hit = b.dataset.region === "all" || card.dataset.region === b.dataset.region; card.hidden = !hit; if (hit) { card.classList.remove("in"); void card.offsetWidth; card.classList.add("in"); } });
    })));
  }

  /* ------------------------------------------------------------------ boot */
  document.documentElement.classList.add("js");
  splitLines(); reveals(); header(); tilt(); parallax(); tabs(); atlasOverlay();
  const hero = $(".hero-map"); if (hero) heroWorld(hero);
  const st = $(".story"); if (st) story(st);
  $$(".country-map").forEach(countryMap);
  const ex = $(".atlas-explorer"); if(ex) explorer(ex).catch(()=>{$(".interactive-map",ex).textContent="The map didn’t load. Every country and town profile is still listed below."});
})();
