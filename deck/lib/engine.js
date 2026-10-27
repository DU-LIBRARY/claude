import Reveal from 'reveal.js';
import 'reveal.js/reveal.css';
import gsap from 'gsap';

// Split text into word + char spans so each letter can animate on its own.
// Inline <em>/<i> wrappers are kept around their characters.
export function splitText(el) {
  const out = [];
  for (const [, tag, inner, plain] of el.innerHTML.matchAll(/<(em|i)>(.*?)<\/\1>|([^<]+)/g)) {
    const text = tag ? inner : plain;
    for (const w of text.split(/(\s+)/)) {
      if (!w) continue;
      if (/^\s+$/.test(w)) { out.push(' '); continue; }
      const chars = [...w].map((c) => `<span class="ch">${c}</span>`).join('');
      out.push(`<span class="wd">${tag ? `<${tag}>${chars}</${tag}>` : chars}</span>`);
    }
  }
  el.innerHTML = out.join('');
}

// Each slide gets a paused timeline built by scenes[slide.dataset.anim].
// The builder marks stage ends with labels: 'in' for the entrance, then
// 'f1', 'f2'… for each step. A slide holds one empty `.fragment.step`
// marker per step, so → / ← walk the stages forwards and backwards.
export function startDeck({ scenes, onSlide, revealOptions = {} }) {
  document.querySelectorAll('.split').forEach(splitText);

  const deck = new Reveal({
    width: 1920, height: 1080, margin: 0, minScale: 0.1,
    hash: true, controls: true, progress: false, center: false,
    transition: 'fade', transitionSpeed: 'slow', backgroundTransition: 'none',
    ...revealOptions,
  });

  const built = new Map();
  let current;

  function timelineFor(slide) {
    if (!built.has(slide)) {
      const tl = gsap.timeline({ paused: true });
      scenes[slide.dataset.anim]?.(tl, slide);
      if (!('in' in tl.labels)) tl.addLabel('in');
      built.set(slide, tl);
    }
    return built.get(slide);
  }

  const stepsShown = (slide) => slide.querySelectorAll('.fragment.step.visible').length;
  const labelFor = (tl, n) => (n === 0 ? 'in' : (`f${n}` in tl.labels ? `f${n}` : tl.duration()));

  function enter(slide) {
    if (current && current !== slide) timelineFor(current).pause();
    current = slide;
    const tl = timelineFor(slide);
    const n = stepsShown(slide);
    if (n === 0) tl.tweenFromTo(0, 'in');
    else tl.seek(labelFor(tl, n)); // arrived backwards: show the finished state
    onSlide?.(slide, deck);
  }

  function step() {
    const tl = timelineFor(current);
    tl.tweenTo(labelFor(tl, stepsShown(current)));
  }

  deck.initialize().then(() => enter(deck.getCurrentSlide()));
  deck.on('slidechanged', (e) => enter(e.currentSlide));
  deck.on('fragmentshown', step);
  deck.on('fragmenthidden', step);
  return deck;
}
