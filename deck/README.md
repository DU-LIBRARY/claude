# Motion decks

Animated slide decks built with Reveal.js (navigation), GSAP (timelines), Three.js (3D backgrounds).
Each deck builds into one self-contained HTML file.

```
npm install
DECK=sarf npm run dev       # live preview
npm run build:all           # → dist/<deck>/index.html
```

- `lib/engine.js`: shared runtime. Each slide's `data-anim` names a scene in the deck's `main.js`.
  A scene builds one GSAP timeline, labelling the entrance `in` and each click step `f1`, `f2`…
  Add one `<span class="fragment step"></span>` to the slide for each step.
- `decks/sarf`: *The Fiqh of Forex* (Fiqh al-Buyūʿ §312–337), with 3D dinars and dirhams.
- `decks/demo`: generic showcase (particle morphs, counters, charts).
