# Tests

## `npm test` — layout engine

Pure Node, no extra dependencies. Covers the geometry that the install sheet
depends on: toe gaps, row stacking, centring, half-drop clearance, bracket
budgets, odd pair counts, determinism, manual swaps, and the refusal to invent
a plate height when the bracket offset has not been measured.

## `npm run test:browser` — capture pipeline

Needs a browser, because OpenCV.js and the canvas work only run in one:

```bash
npm i -D playwright
npx playwright install chromium
```

Then, in one terminal:

```bash
npm run dev
```

and in another:

```bash
npm run test:browser
```

Point it elsewhere with `SHOEWALL_URL=http://127.0.0.1:5178/`.

It measures the synthetic photos in `fixtures/` — whose true pixels-per-inch is
recorded in `fixtures/truth.json` — and asserts that the detected scale lands
within 2%, that a rectified US Letter sheet measures exactly 11" x 8.5", that
measurements are rotation-invariant, and that a photo with no sheet in it is
refused rather than guessed at.

Regenerate the fixtures with `npm run test:fixtures` (also needs playwright).
