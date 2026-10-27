import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One folder per deck under decks/. Pick it with DECK=<name> (default: sarf).
// Each builds into one self-contained dist/<name>/index.html, shareable anywhere.
const deck = process.env.DECK || 'sarf';

export default defineConfig({
  root: `decks/${deck}`,
  build: { outDir: `../../dist/${deck}`, emptyOutDir: true },
  plugins: [viteSingleFile()],
});
