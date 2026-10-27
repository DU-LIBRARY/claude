import gsap from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { startDeck } from '../../lib/engine.js';
import { startCoins } from './coins.js';
import './style.css';

gsap.registerPlugin(MotionPathPlugin);

const ease = 'expo.out';
const $ = (s, el) => el.querySelector(s);
const $$ = (s, el) => [...el.querySelectorAll(s)];

// Wrap each word of an element in a span so it can fade in word by word.
function wordify(el) {
  el.innerHTML = el.innerHTML.replace(/(<[^>]+>)|([^\s<]+)/g, (m, tag, word) => (tag ? tag : `<span class="w">${word}</span>`));
}
document.querySelectorAll('.cover-quote, .translation').forEach(wordify);

const charsIn = (tl, el, at = 0) =>
  tl.from($$('.ch', el), { yPercent: 115, rotate: 6, duration: 1.1, stagger: 0.022, ease }, at);
const rise = (targets, extra = {}) => ({ y: 40, opacity: 0, duration: 1, ease, stagger: 0.1, ...extra });
// Arabic reveals right-to-left, like a pen stroke.
const inkIn = (tl, el, at, duration = 1.6) =>
  tl.fromTo(el, { clipPath: 'inset(0 0 0 100%)', opacity: 1 }, { clipPath: 'inset(0 0 0 0%)', duration, ease: 'power2.inOut' }, at);

function drawIn(tl, path, at, duration = 1.2, e = 'power2.inOut') {
  const len = path.getTotalLength();
  gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
  return tl.to(path, { strokeDashoffset: 0, duration, ease: e }, at);
}

// Pills: only one of a slide's verdicts shows at a time.
const showPill = (tl, pill, at) =>
  tl.fromTo(pill, { opacity: 0, scale: 0.6, y: 20, xPercent: -50, x: 0 }, { opacity: 1, scale: 1, y: 0, xPercent: -50, duration: 0.7, ease: 'back.out(2)' }, at);
const hidePill = (tl, pill, at) => tl.to(pill, { opacity: 0, scale: 0.8, duration: 0.3 }, at);

const scenes = {
  cover(tl, s) {
    tl.from($('.eyebrow', s), rise(), 0.2);
    inkIn(tl, $('.cover-ar', s), 0.4, 2);
    charsIn(tl, $('.display', s), 1.2);
    tl.from($$('.cover-quote .w', s), { opacity: 0, y: 14, filter: 'blur(6px)', duration: 0.8, stagger: 0.035, ease }, 1.9);
    tl.from($('.cite', s), rise(), 3);
  },

  define(tl, s) {
    tl.from($('.eyebrow', s), rise(), 0);
    charsIn(tl, $('.h2', s), 0.1);
    tl.from($('.lede', s), rise(), 0.6);
    $$('.pair', s).forEach((p, i) => {
      const at = 0.9 + i * 0.25;
      const [a, b] = $$('.coin', p);
      tl.from(p, { y: 80, opacity: 0, rotateX: -30, duration: 1.2, ease }, at)
        .from(a, { x: -200, rotate: -360, opacity: 0, duration: 1.3, ease }, at + 0.2)
        .from(b, { x: 200, rotate: 360, opacity: 0, duration: 1.3, ease }, at + 0.2);
      drawIn(tl, $('.swap path', p), at + 0.6, 1);
      tl.from($('p', p), rise(), at + 0.7);
    });
    tl.addLabel('in');
    // keep the coins trading places, forever
    $$('.pair', s).forEach((p, i) => {
      const [a, b] = $$('.coin', p);
      const dist = () => b.offsetLeft - a.offsetLeft;
      gsap.timeline({ repeat: -1, repeatDelay: 1.6, delay: 4 + i * 0.5 })
        .to(a, { x: dist, y: -50, duration: 0.7, ease: 'power2.inOut' })
        .to(b, { x: () => -dist(), y: 50, duration: 0.7, ease: 'power2.inOut' }, '<')
        .to([a, b], { y: 0, duration: 0.3, ease: 'power2.in' }, '-=0.3')
        .to([a, b], { x: 0, duration: 0.7, ease: 'power2.inOut', delay: 1.4 });
    });
  },

  taqabud(tl, s) {
    const [ok, bad] = $$('.verdict', s);
    const cg = $('.cg', s), cs = $('.cs', s), pb = $('.pb', s);
    tl.from($('.eyebrow', s), rise(), 0);
    inkIn(tl, $('.ar-label', s), 0.1, 1.2);
    charsIn(tl, $('.h2', s), 0.3);
    tl.from($('.lede', s), rise(), 0.8)
      .from($('.hadith', s), { x: -40, opacity: 0, duration: 1.2, ease }, 1.1);
    drawIn(tl, $('.majlis', s), 0.5, 1.6);
    tl.from($('.cap', s), { opacity: 0, duration: 0.6 }, 1.6)
      .from($$('.person', s), { opacity: 0, y: 40, duration: 0.9, stagger: 0.15, ease: 'back.out(1.6)' }, 1)
      .from([cg, cs], { scale: 0, transformOrigin: 'center', duration: 0.6, stagger: 0.1, ease: 'back.out(3)' }, 1.5)
      // the swap: gold arcs over, silver arcs under
      .to(cg, { motionPath: { path: [{ x: 250, y: 330 }, { x: 400, y: 200 }, { x: 550, y: 330 }], curviness: 1.4 }, duration: 1.4, ease: 'power2.inOut' }, 2.2)
      .to(cs, { motionPath: { path: [{ x: 550, y: 330 }, { x: 400, y: 450 }, { x: 250, y: 330 }], curviness: 1.4 }, duration: 1.4, ease: 'power2.inOut' }, 2.2);
    showPill(tl, ok, 3.4);
    tl.addLabel('in');

    // step: one party walks away before possession
    hidePill(tl, ok, '>');
    tl.to(cg, { x: 250, y: 330, duration: 0.5, ease: 'power2.inOut' }, '<')
      .to(cs, { x: 550, y: 330, duration: 0.5, ease: 'power2.inOut' }, '<')
      .to(pb, { x: 900, opacity: 0.35, duration: 1.6, ease: 'power2.in' }, '>')
      .to(cs, { x: 900, opacity: 0.35, duration: 1.6, ease: 'power2.in' }, '<')
      .to(cg, { motionPath: { path: [{ x: 250, y: 330 }, { x: 340, y: 250 }, { x: 420, y: 300 }], curviness: 1.2 }, duration: 1.2, ease: 'power2.out' }, '<0.3')
      .to($('.majlis', s), { stroke: '#e8875b', duration: 0.6 }, '-=0.4')
      .to($('.broken', s), { opacity: 1, attr: { x2: 760 }, duration: 0.5 }, '<')
      .to(cg, { y: 410, opacity: 0.5, duration: 0.6, ease: 'bounce.out' }, '>');
    showPill(tl, bad, '-=0.3');
    tl.addLabel('f1');
  },

  tamathul(tl, s) {
    const [ok, bad] = $$('.verdict', s);
    const beam = $('.beam', s), pl = $('.pl', s), pr = $('.pr', s);
    const pivot = { x: 400, y: 210 }, L = 270;
    const st = { a: 0 };
    const place = () => {
      const r = (st.a * Math.PI) / 180;
      gsap.set(beam, { attr: { transform: `translate(${pivot.x} ${pivot.y}) rotate(${st.a})` } });
      gsap.set(pl, { attr: { transform: `translate(${pivot.x - L * Math.cos(r)} ${pivot.y - L * Math.sin(r)})` } });
      gsap.set(pr, { attr: { transform: `translate(${pivot.x + L * Math.cos(r)} ${pivot.y + L * Math.sin(r)})` } });
    };
    place();
    // stacks of gold coins: 10 per pan, 2 extra on the right for the step
    const mk = (pan, n) => {
      const g = $('.stack', pan);
      g.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const e = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        e.setAttribute('cx', 0); e.setAttribute('cy', 186 - i * 10); e.setAttribute('rx', 54); e.setAttribute('ry', 14);
        e.setAttribute('fill', i % 2 ? '#c99a3a' : '#e8c66e');
        g.appendChild(e);
      }
      return [...g.children];
    };
    const left = mk(pl, 10), right = mk(pr, 12);
    const extra = right.slice(10);
    gsap.set(extra, { opacity: 0 });

    tl.from($('.eyebrow', s), rise(), 0);
    inkIn(tl, $('.ar-label', s), 0.1, 1.2);
    charsIn(tl, $('.h2', s), 0.3);
    tl.from($$('.lede', s), rise({ stagger: 0.2 }), 0.8)
      .from($$('.post, .foot', s), { opacity: 0, scaleY: 0, transformOrigin: '50% 100%', duration: 0.9, ease }, 0.4)
      .from([beam, pl, pr], { opacity: 0, duration: 0.6 }, 0.9);
    tl.set(st, { a: -14, onUpdate: place }, 0.9);
    tl.from(left, { y: -260, opacity: 0, duration: 0.5, stagger: 0.07, ease: 'bounce.out' }, 1.2)
      .from(right.slice(0, 10), { y: -260, opacity: 0, duration: 0.5, stagger: 0.07, ease: 'bounce.out' }, 1.25)
      .to(st, { a: 0, duration: 2.2, ease: 'elastic.out(1, 0.35)', onUpdate: place }, 1.6);
    showPill(tl, ok, 2.6);
    tl.addLabel('in');

    hidePill(tl, ok, '>');
    tl.to(extra, { opacity: 1, duration: 0.01 }, '<')
      .from(extra, { y: -300, duration: 0.6, stagger: 0.25, ease: 'bounce.out', immediateRender: false }, '<')
      .to(st, { a: 9, duration: 1.8, ease: 'elastic.out(1, 0.4)', onUpdate: place }, '<0.5');
    showPill(tl, bad, '<0.6');
    tl.addLabel('f1');
    // keep the label right when stepping back
    tl.eventCallback('onUpdate', () => { $('.w', pr).textContent = tl.time() > tl.labels.in + 0.2 ? '12 g gold' : '10 g gold'; });
  },

  option(tl, s) {
    const c = $('.contract', s);
    tl.from($('.eyebrow', s), rise(), 0);
    inkIn(tl, $('.ar-label', s), 0.1, 1.2);
    charsIn(tl, $('.h2', s), 0.3);
    tl.from($$('.lede', s), rise({ stagger: 0.2 }), 0.8)
      .from(c, { y: 120, rotate: 4, opacity: 0, duration: 1.4, ease }, 0.5)
      .from($$('.c-head, .c-ar', c), rise({ stagger: 0.1 }), 1)
      .from($$('li', c), { x: 40, opacity: 0, duration: 0.8, stagger: 0.35, ease }, 1.3)
      .to($('.clause', c), { backgroundColor: '#e8875b22', duration: 0.6, repeat: 3, yoyo: true }, 2.6);
    tl.addLabel('in');
    drawIn(tl, $('.clause svg path', c), '>', 0.6, 'power3.out');
    tl.to($('.clause span', c), { opacity: 0.45, duration: 0.4 }, '<0.3')
      .fromTo($('.stamp', c), { scale: 2.6, opacity: 0, rotate: -20 }, { scale: 1, opacity: 1, rotate: -9, duration: 0.45, ease: 'power4.in' }, '<0.2')
      .to(c, { x: 8, duration: 0.05, repeat: 5, yoyo: true }, '>');
    tl.addLabel('f1');
  },

  matrix(tl, s) {
    tl.from($('.eyebrow', s), rise(), 0);
    charsIn(tl, $('.h2', s), 0.1);
    tl.from($$('.mh', s), { y: 30, opacity: 0, duration: 0.9, stagger: 0.12, ease }, 0.5)
      .from($$('.mr', s), { x: -60, opacity: 0, duration: 1, stagger: 0.5, ease }, 0.9)
      .from($$('.mr .coin', s), { scale: 0, rotate: -180, duration: 0.8, stagger: 0.12, ease: 'back.out(2)' }, 1)
      .from($$('.mc', s), { opacity: 0, x: -20, duration: 0.7, stagger: 0.3, ease }, 1.4);
    $$('.mc path', s).forEach((p, i) => drawIn(tl, p, 1.55 + i * 0.3, 0.5, 'power2.out'));
    tl.from($('.foot-note', s), rise(), 2.8);
  },

  positions(tl, s) {
    const cards = $$('.pos', s);
    tl.from($('.eyebrow', s), rise(), 0);
    charsIn(tl, $('.h2', s), 0.1);
    tl.from(cards, { y: 120, rotateX: -35, opacity: 0, duration: 1.3, stagger: 0.18, ease, transformOrigin: '50% 100%' }, 0.5)
      .from($$('.pos > *', s), { y: 20, opacity: 0, duration: 0.7, stagger: 0.04, ease }, 0.9);
    tl.addLabel('in');
    tl.to(cards.slice(0, 2), { opacity: 0.35, scale: 0.94, filter: 'grayscale(1)', duration: 0.9, ease: 'power3.inOut' }, '>')
      .to(cards[2], { scale: 1.08, y: -20, boxShadow: '0 30px 120px #d9b45a55', duration: 1, ease: 'power3.inOut' }, '<')
      .fromTo($('.badge', s), { opacity: 0, y: 20, scale: 0.6 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(2)' }, '-=0.4');
    tl.addLabel('f1');
  },

  tree(tl, s) {
    const edges = $$('.edges path', s);
    tl.from($('.eyebrow', s), rise(), 0);
    charsIn(tl, $('.h2', s), 0.1);
    $$('.node', s).forEach((n) => gsap.set(n, { transformOrigin: '50% 50%' }));
    tl.from($('.root', s), { scale: 0.6, opacity: 0, transformOrigin: 'center', duration: 0.8, ease: 'back.out(2)' }, 0.5);
    edges.slice(0, 2).forEach((p) => drawIn(tl, p, 1.0, 0.9));
    tl.from($$('.node:not(.root):not(.leaf)', s), { scale: 0.6, opacity: 0, duration: 0.8, stagger: 0.15, ease: 'back.out(2)' }, 1.6);
    edges.slice(2).forEach((p, i) => drawIn(tl, p, 2.2 + i * 0.15, 0.9));
    tl.from($$('.leaf', s), { y: 40, opacity: 0, duration: 0.9, stagger: 0.2, ease: 'back.out(1.6)' }, 2.8);

    // particles flowing down each branch
    const flow = $('.flow', s);
    const colors = { blue: '#6f9fd8', gold: '#d9b45a', orange: '#e8875b' };
    edges.forEach((p, i) => {
      for (let k = 0; k < 4; k++) {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('r', 5);
        dot.setAttribute('fill', colors[p.dataset.c]);
        dot.style.color = colors[p.dataset.c];
        dot.setAttribute('opacity', 0);
        flow.appendChild(dot);
        gsap.timeline({ repeat: -1, delay: 3.6 + k * 0.6 + i * 0.15 })
          .to(dot, { motionPath: { path: p, align: p, alignOrigin: [0.5, 0.5] }, duration: 2.4, ease: 'none' })
          .fromTo(dot, { attr: { opacity: 0 } }, { attr: { opacity: 1 }, duration: 0.4, yoyo: true, repeat: 1, repeatDelay: 1.6 }, 0);
      }
    });
  },

  quote(tl, s) {
    tl.from($('.eyebrow', s), rise(), 0.3);
    inkIn(tl, $('.big-quote', s), 0.4, 2);
    tl.fromTo($$('.big-quote span', s), { '--u': 0 }, { '--u': 1, duration: 0.6, stagger: 0.3, ease: 'power3.inOut' }, 2.2)
      .from($('.rule', s), { scaleX: 0, duration: 1.2, ease: 'power3.inOut' }, 2.2)
      .from($$('.translation .w', s), { opacity: 0, y: 16, filter: 'blur(6px)', duration: 0.8, stagger: 0.04, ease }, 2.6);
  },

  market(tl, s) {
    const count = $('.count', s), n = { v: 0 };
    tl.from($('.candles', s), { opacity: 0, duration: 2 }, 0)
      .from($('.eyebrow', s), rise(), 0.2);
    inkIn(tl, $('.ar-label', s), 0.3, 1.4);
    charsIn(tl, $('.h2', s), 0.5);
    tl.from($('.bignum', s), { scale: 0.85, opacity: 0, transformOrigin: 'left center', duration: 1.2, ease }, 1.1)
      .to(n, { v: 3.8, duration: 2.6, ease: 'power3.out', onUpdate: () => { count.textContent = n.v.toFixed(1); } }, 1.2)
      .from($('.lede', s), rise(), 2.2);
  },

  problems(tl, s) {
    const items = $$('.problems li', s);
    tl.from($('.eyebrow', s), rise(), 0);
    charsIn(tl, $('.h2', s), 0.1);
    tl.from(items, { y: 50, opacity: 0, duration: 1, stagger: 0.12, ease }, 0.5)
      .from($$('.problems b', s), { scale: 0.3, opacity: 0, duration: 0.8, stagger: 0.12, ease: 'back.out(3)' }, 0.7);
    tl.set(items[0], { attr: { class: 'on' } }, '>');
    tl.to(items.slice(1), { opacity: 0.4, duration: 0.5 }, '<');
    tl.addLabel('in');
    // each step lights the next problem
    for (let i = 1; i < items.length; i++) {
      tl.set(items[i - 1], { attr: { class: '' }, opacity: 0.55 }, '>')
        .set(items[i], { attr: { class: 'on' }, opacity: 1 }, '<')
        .fromTo(items[i], { scale: 0.97 }, { scale: 1, duration: 0.6, ease: 'back.out(3)' }, '<')
        .addLabel(`f${i}`);
    }
  },

  verdict(tl, s) {
    tl.from($('.eyebrow', s), rise(), 0.2);
    inkIn(tl, $('.verdict-ar', s), 0.5, 2.4);
    tl.from($('.verdict-ar', s), { textShadow: '0 0 0px #d9b45a00', duration: 2 }, 0.5);
    charsIn(tl, $('.verdict-en', s), 2.2);
    tl.from($('.verdict-alt', s), rise(), 3.4);
  },

  recap(tl, s) {
    tl.from($('.eyebrow', s), rise(), 0);
    charsIn(tl, $('.h2', s), 0.1);
    tl.from($$('.recap li', s), { x: -60, opacity: 0, duration: 1.1, stagger: 0.25, ease }, 0.7)
      .from($('.cite', s), rise(), 1.8);
  },
};

// Live candlestick tape behind the Forex slide.
function candles(canvas) {
  const x = canvas.getContext('2d');
  const W = (canvas.width = 1920), H = (canvas.height = 1080);
  let p = 0.5, off = 0, last = 0;
  const C = [];
  const add = () => {
    const o = p;
    p += (Math.random() - 0.5) * 0.06 + (0.5 - p) * 0.04;
    C.push({ o, c: p, hi: Math.max(o, p) + Math.random() * 0.025, lo: Math.min(o, p) - Math.random() * 0.025 });
  };
  for (let i = 0; i < 80; i++) add();
  const Y = (v) => H * 0.12 + (1 - v) * H * 0.76;
  gsap.ticker.add((t) => {
    if (!canvas.closest('section.present')) return;
    const ms = t * 1000, dt = Math.min(50, ms - last), cw = 26;
    last = ms;
    off += dt * 0.03;
    while (off > cw) { off -= cw; C.shift(); add(); }
    x.clearRect(0, 0, W, H);
    x.strokeStyle = 'rgba(169,180,198,.06)';
    for (let i = 0; i <= 8; i++) { const y = H * 0.12 + H * 0.76 * i / 8; x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
    C.forEach((k, i) => {
      const cx = i * cw - off + cw / 2, col = k.c >= k.o ? '111,195,178' : '232,135,91';
      x.strokeStyle = `rgba(${col},.45)`; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(cx, Y(k.hi)); x.lineTo(cx, Y(k.lo)); x.stroke();
      x.fillStyle = `rgba(${col},.35)`;
      const y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c));
      x.fillRect(cx - 8, y1, 16, Math.max(2, y2 - y1));
    });
    x.strokeStyle = 'rgba(217,180,90,.5)'; x.lineWidth = 2.5;
    x.beginPath(); C.forEach((k, i) => { const cx = i * cw - off + cw / 2; i ? x.lineTo(cx, Y(k.c)) : x.moveTo(cx, Y(k.c)); }); x.stroke();
  });
}
candles(document.querySelector('.candles'));

const wash = document.createElement('div');
wash.className = 'light-wash';
document.body.prepend(wash);

const coins = startCoins(document.getElementById('coins'));
const bar = document.querySelector('.progress span');
const chapter = document.querySelector('.chrome .chapter');
const counter = document.querySelector('.chrome .count');

startDeck({
  scenes,
  onSlide(slide, deck) {
    const i = deck.getIndices().h, total = deck.getTotalSlides();
    coins.setMode(slide.dataset.coins || 'deep');
    document.body.classList.toggle('is-light', slide.classList.contains('light'));
    bar.style.width = `${((i + 1) / total) * 100}%`;
    chapter.textContent = slide.dataset.chapter || '';
    counter.innerHTML = `<b>${String(i + 1).padStart(2, '0')}</b> / ${total}`;
  },
});
