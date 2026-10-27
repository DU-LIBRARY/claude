import Reveal from 'reveal.js';
import 'reveal.js/reveal.css';
import gsap from 'gsap';
import './style.css';
import { startBackground } from './background.js';

// Split text into word + char spans so each letter can animate independently.
function splitText(el) {
  const words = el.innerHTML.split(/(<em>.*?<\/em>|\s+)/).filter(Boolean);
  el.innerHTML = words.map((w) => {
    if (/^\s+$/.test(w)) return ' ';
    const em = w.startsWith('<em>');
    const text = em ? w.slice(4, -5) : w;
    const chars = [...text].map((c) => `<span class="ch">${c}</span>`).join('');
    return `<span class="wd">${em ? `<em>${chars}</em>` : chars}</span>`;
  }).join('');
}
document.querySelectorAll('.split').forEach(splitText);

const ease = 'expo.out';
const timelines = {
  title(s) {
    return gsap.timeline()
      .from(s.querySelector('.eyebrow'), { y: 20, opacity: 0, duration: 0.8, ease })
      .from(s.querySelectorAll('.ch'), { yPercent: 110, rotate: 8, duration: 1.2, stagger: 0.035, ease }, '<0.1')
      .from(s.querySelectorAll('.fade-up'), { y: 30, opacity: 0, duration: 1, stagger: 0.15, ease }, '-=0.8');
  },
  statement(s) {
    const words = s.querySelectorAll('.w');
    return gsap.timeline()
      .fromTo(words, { opacity: 0.08, y: 24, filter: 'blur(8px)' },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.9, stagger: 0.07, ease })
      .fromTo(s.querySelectorAll('.hl'), { '--s': 0 }, { '--s': 1, duration: 0.7, stagger: 0.08, ease: 'power3.inOut' }, '-=0.3');
  },
  stats(s) {
    const tl = gsap.timeline();
    tl.from(s.querySelectorAll('.stat'), { y: 60, opacity: 0, duration: 1, stagger: 0.12, ease });
    s.querySelectorAll('.arc').forEach((arc, i) => {
      const len = 2 * Math.PI * 52;
      gsap.set(arc, { strokeDasharray: len });
      tl.fromTo(arc, { strokeDashoffset: len }, { strokeDashoffset: len * (1 - arc.dataset.pct), duration: 2, ease: 'power3.out' }, 0.2 + i * 0.12);
    });
    s.querySelectorAll('.count').forEach((el, i) => {
      const o = { v: 0 }, dec = +(el.dataset.dec || 0);
      tl.to(o, { v: +el.dataset.to, duration: 2, ease: 'power3.out', onUpdate: () => { el.textContent = o.v.toFixed(dec); } }, 0.2 + i * 0.12);
    });
    return tl;
  },
  timeline(s) {
    const path = s.querySelector('.line');
    const len = path.getTotalLength();
    gsap.set(path, { strokeDasharray: len });
    return gsap.timeline()
      .from(s.querySelectorAll('.eyebrow, .ch'), { yPercent: 110, opacity: 0, duration: 1, stagger: 0.02, ease })
      .fromTo(path, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: 2.2, ease: 'power2.inOut' }, 0.3)
      .from(s.querySelectorAll('.node'), { y: 40, opacity: 0, scale: 0.8, duration: 0.9, stagger: 0.45, ease: 'back.out(2)' }, 0.6);
  },
  chart(s) {
    const tl = gsap.timeline()
      .from(s.querySelectorAll('.eyebrow, .ch'), { yPercent: 110, opacity: 0, duration: 1, stagger: 0.015, ease });
    s.querySelectorAll('.bar').forEach((b, i) => {
      const h = `${b.dataset.v}%`;
      tl.fromTo(b.querySelector('i'), { height: 0 }, { height: h, duration: 1.4, ease: 'power4.out' }, 0.3 + i * 0.12)
        .fromTo(b.querySelector('em'), { bottom: 0, opacity: 0 }, { bottom: `calc(${h} + 12px)`, opacity: 1, duration: 1.4, ease: 'power4.out' }, '<');
    });
    return tl;
  },
  cards(s) {
    return gsap.timeline()
      .from(s.querySelector('.eyebrow'), { y: 20, opacity: 0, duration: 0.8, ease })
      .from(s.querySelectorAll('.card'), { rotateY: -70, rotateX: 15, z: -400, opacity: 0, duration: 1.4, stagger: 0.14, ease, transformOrigin: 'left center' }, 0.1)
      .from(s.querySelectorAll('.card h3, .card p'), { y: 20, opacity: 0, duration: 0.8, stagger: 0.06, ease }, 0.6);
  },
  close(s) {
    return gsap.timeline()
      .from(s.querySelector('.blob'), { scale: 0.2, opacity: 0, duration: 2, ease })
      .from(s.querySelectorAll('.ch'), { yPercent: 110, rotate: -8, duration: 1.2, stagger: 0.04, ease }, 0.1)
      .from(s.querySelectorAll('.fade-up'), { y: 30, opacity: 0, duration: 1, ease }, '-=0.7');
  },
};

// Card spotlight follows the cursor.
document.querySelectorAll('.card').forEach((c) => c.addEventListener('pointermove', (e) => {
  const r = c.getBoundingClientRect();
  c.style.setProperty('--mx', `${e.clientX - r.left}px`);
  c.style.setProperty('--my', `${e.clientY - r.top}px`);
}));

// Organic blob on the closing slide.
const blobPath = document.querySelector('.blob path');
gsap.ticker.add((t) => {
  const pts = 8, R = 220, pts2 = [];
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const r = R + Math.sin(t * 0.9 + i * 1.7) * 40 + Math.cos(t * 0.6 + i) * 25;
    pts2.push([300 + Math.cos(a) * r, 300 + Math.sin(a) * r]);
  }
  let d = '';
  for (let i = 0; i < pts; i++) {
    const p0 = pts2[(i - 1 + pts) % pts], p1 = pts2[i], p2 = pts2[(i + 1) % pts], p3 = pts2[(i + 2) % pts];
    if (i === 0) d += `M${p1[0]},${p1[1]}`;
    d += `C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  blobPath.setAttribute('d', d);
});

const deck = new Reveal({
  width: 1920, height: 1080, margin: 0.06,
  hash: true, controls: true, progress: false, center: false,
  transition: 'fade', transitionSpeed: 'slow', backgroundTransition: 'none',
});

const bg = startBackground(document.getElementById('bg'));
const bar = document.querySelector('.progress span');
let active;

function play(slide) {
  active?.progress(1).kill();
  const make = timelines[slide.dataset.anim];
  active = make?.(slide);
  bar.style.width = `${(deck.getIndices().h / (deck.getTotalSlides() - 1)) * 100}%`;
  bg.setScene(deck.getIndices().h);
}

deck.initialize().then(() => play(deck.getCurrentSlide()));
deck.on('slidechanged', (e) => play(e.currentSlide));
