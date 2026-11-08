# ShoeWall

Plan a sneaker collection as a **textural wallpaper** on 16" U-shaped floating
shoe brackets, then get a printable install sheet with a drill position for
every bracket.

Everything runs in the browser. No backend, no account, nothing uploaded —
your photos and your catalog live in this browser's IndexedDB.

---

## Live site

<https://thathimbo.github.io/shoewall/>

Every push to `claude/sneaker-wall-layout-app-ftat6l` runs the tests, builds and
deploys. **One-time setup:** in the repository, go to Settings → Pages → Build
and deployment → Source and choose **GitHub Actions**, then re-run the latest
workflow. The workflow cannot switch that on by itself — its token is refused
with "Resource not accessible by integration".

## Get it running locally

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL. On a phone, the Capture tab opens the camera directly.

To build a copy you can host anywhere static:

```bash
npm run build
```

`npm install`, `npm run dev` and `npm run build` all copy OpenCV.js into
`public/vendor/` first, so the capture screen has it locally and never calls a CDN.

---

## The hardware this assumes

A bracket is a U of iron, mounted by a single plate at the bottom centre of
the U. Each one holds **two pairs**: one on the left arm, one on the right.
Each pair is a shoe standing on the arm with its mirror image hanging
underneath, heels facing the bracket centre and toes pointing outward. So one
loaded bracket is about **two shoe lengths wide and two shoe heights tall** —
for a men's 15 that is well past the 16" of iron, which is why the shoes, not
the brackets, set the spacing.

Every dimension is editable in **Settings**, because they come off your actual
brackets:

| Setting | Default | Notes |
| --- | --- | --- |
| Bracket width | 16" | overall width of the U |
| Arm depth | 2" | off the wall; recorded for reference |
| Mounting plate | 2" square | |
| **Plate centre → top of arms** | **not set** | **measure this** — install-sheet heights need it |
| Heel inset from centre | 0" | 0 means the two heels meet at the centre |
| Gap between the two shoes of a pair | 0" | usually the thickness of the arm bar |

Until the plate-to-arm-top offset is measured, the install sheet says
`NOT MEASURED` in the plate-Y column rather than printing a number. Nothing in
this app invents a measurement.

---

## Working through it

### 1. Capture — one photo per pair

1. Lay one shoe on its side on a sheet of US Letter, **or right beside it**.
   A men's 15 is longer than the sheet, which is fine either way.
2. Shoot from directly above with the whole sheet in frame.
3. Check the measurements, then save.

What happens to the photo:

- **OpenCV.js finds the sheet** and corrects the perspective. The sheet is the
  only object of known size in the picture, so it is what turns pixels into
  inches. Candidates are scored on size, how much lighter they are than the
  surface around them, how close their proportions are to the paper, and how
  rectangular they are — because the photo's own border is usually the biggest
  four-sided shape in an edge map, and a shoe lying across the sheet breaks its
  outline in two. **If no sheet is found it says so and lets you place the four
  corners by hand.** It never guesses a scale.
- **The background is removed** in the browser to get a clean cutout.
- **You confirm the measurements** on a screen with four draggable handles —
  heel, toe, sole, collar. Drag with a finger or a mouse, or nudge a selected
  handle with the arrow keys (Shift for bigger steps). The pair is marked
  *adjusted by hand* once you move one.
- **Two or three dominant colours** are pulled out with k-means in Lab space.
  Edit any swatch, drop one that caught a shadow, or re-read them after moving
  the handles.
- Height class (low / mid / high-top) is set from the height and can be
  overridden.

If background removal cannot fetch its model, capture still works: the warning
says so, the handles still measure correctly against the sheet, and colours are
sampled from the box between the handles instead.

### 2. Walls

Per wall: width, the bottom and top of the usable band, and whether each end
is a corner shared with another wall. Band heights start **blank** — the
generator refuses to run until you enter them. The pattern hangs from the top
of the band, so that line is the one that matters most; spare height is left at
the bottom.

At a shared corner, one of the two walls keeps 8" clear (configurable) so the
shoes do not collide. Tick *this wall keeps the clearance clear* on whichever
side should yield.

Also enter how many brackets you own. Each one is two slots.

### 3. Layout

Spacing: 1.25" between the toes of neighbouring columns, 0.5" between rows.

- **Pattern** — straight grid, or half-drop with every other column dropped
  half a row like brickwork. Each row is centred so the left and right margins
  match, and each wall's stack **hangs from the top of its usable band** — the
  ceiling is the fixed reference, so any spare height is left down at the floor
  end.
- **Rows group by height.** Tallest pairs go in the bottom rows, so high-tops
  sit together and low down, and row heights stay even.
- **Colour** — *spread colours apart* runs a greedy pass then simulated
  annealing, maximising CIEDE2000 distance between neighbours: left, right,
  above, below, and across each bracket. *Gradient* runs dark to light instead.
  **Shuffle** re-rolls with a new seed.
- If there are more slots than pairs, or more pairs than brackets, it says so
  plainly and lists what did not fit so you can choose who stays off.

The mockup draws each wall to scale with the real cutouts, the lower shoe
flipped, on a wall-coloured background. Toggle measurement overlays. **Tap a
pair then tap another to swap them, or drag one onto another** — positions and
the install sheet update immediately.

### 4. Install

Every bracket numbered per wall, with the mounting-plate centre X (inches from
the left wall edge) and Y (inches from the floor), the arm-top height, and
which pair goes on each arm. Print it or export CSV.

> Brackets will often land between studs. Where a plate does not hit a stud,
> use heavy-duty toggle anchors rated for the load.

---

## Catalog

Every captured pair is a catalog entry. Optional fields: brand, model,
colourway, style code, size, purchase date, price, where bought, condition,
status, notes, tags. Extra photos from any angle. A **tongue-label photo** is
run through OCR in the browser, which *suggests* a style code and size — you
confirm or edit before anything is saved.

Nothing identifies the shoe model from a photo, and brand and model are never
filled in from anything but your own typing or OCR text you confirmed.

**Wall location** (wall, bracket number, arm) is filled in from the current
layout and updated whenever it changes. It is never typed by hand.

**Wear log**: a *Wore today* button, with last-worn date and total count.

Views: cutout grid or list, search across every text field, filter by brand,
colour (pick a swatch to find similar ones by CIEDE2000 distance), height
class, status, condition and tag, and sort by brand, last worn, times worn,
purchase date or colour. Stats cover totals, counts by brand and status, and
pairs not worn in the last six months.

---

## Backup

**Settings → Export project JSON** writes one self-contained file with every
setting, wall, catalog field, layout and photo. Import replaces everything in
the browser. There is also a catalog CSV and an install-sheet CSV.

Clearing site data in your browser wipes the project, so export before you
reset anything or move to another device.

---

## Tests

```bash
npm test
```

Covers the layout geometry the install sheet depends on. The capture pipeline
has its own browser-based suite — see `tests/README.md`.

---

## Stack

Vite, React, TypeScript. [OpenCV.js](https://docs.opencv.org/) for paper
detection, [@imgly/background-removal](https://github.com/imgly/background-removal-js)
for cutouts, [tesseract.js](https://tesseract.projectnaptha.com/) for label OCR,
[idb](https://github.com/jakearchibald/idb) for storage. Colour maths (sRGB↔Lab,
CIEDE2000, k-means) is implemented in `src/lib/color.ts` and checked against the
Sharma–Wu–Dalal reference values.
