# Replicating for another genus

The app is genus-agnostic at the data layer: `index.html`, `checklist.html`, `species.html`, `guide.html`, and the shared scoring engine in `js/path-utils.js` work entirely from `data/tree.json` and `data/species.json`. To adapt the project for a different genus (or a different region):

## 1. Get the project into your own repo

1. **Download this project locally**:
   ```
   git clone https://github.com/chancsc/Arhopala_id.git my-genus-id
   cd my-genus-id
   ```
   To start from a clean history rather than a fork, drop the existing git history: `rm -rf .git`.

2. **Create a new, empty GitHub repository** for your project (e.g. `my-genus-id`). Don't initialize it with a README, `.gitignore`, or license — leave it empty so the push below doesn't conflict.

3. **Point the local copy at your new repo and push**:
   ```
   git init                     # only needed if you removed .git above
   git add -A
   git commit -m "Initial import from Arhopala_id"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

4. **Work with Claude on the new repo** from here. Open a Claude Code session in the project directory (or connect it to your new GitHub repo), describe your genus's identification key and reference material, and work through steps 2–7 below conversationally — Claude can edit `data/tree.json`, run the validation scripts, build the Visual Guide, and commit/push to `main` as the work progresses.

## 2. Rebrand

"Arhopala" / "Arhopala ID" are hardcoded as page titles, headings, and menu labels in `index.html`, `about.html`, `checklist.html`, `guide.html`, `species.html`, `key.html`. Search-and-replace:

- `Arhopala ID` → your app name
- `Arhopala` → your genus name (also used as the default iNaturalist search term in `js/app.js`)
- `js/checklist.js`'s `ANSWERS_KEY` localStorage key (`'arhopala-cl-answers'`) — rename so saved answers don't collide if both apps share a domain

## 3. Regenerate `data/species.json`

Edit `scripts/fetch_species.py`:

- `get_arhopala_taxon_id()` — change the `q` param from `"Arhopala"` to your genus name
- `MALAYSIA_PLACE_ID` — change to your target region's iNaturalist place ID (look up via `https://api.inaturalist.org/v1/places/autocomplete?q=<region>`)
- Update the `User-Agent` header to point at your fork

Then run `python scripts/fetch_species.py` to generate `data/species.json`.

## 4. Build `data/tree.json` from your identification key

This is the bulk of the work — transcribe your morphological key into the flat node-map format described in the [Data](README.md#data) section of the README: `question`, `result`, and `group` node types. Each `result` node's `taxon_id` must match an entry in `data/species.json`.

Tips:

- Keep each question scoped to a single observable character, so Feature Scoring can score it independently of the others.
- Give any question whose feature is hard to see in typical photos (e.g. upperside-only characters) a "Cannot determine — ..." choice, so the ID Key can offer a fallback path and Feature Scoring can skip it without penalising candidates.
- For species pairs the key can't separate from photographs alone, route both into a `group` node with a descriptive `group_name`.

## 5. Validate the tree

```
python scripts/audit_paths.py            # canonical path quality, CD coverage, orphans
node scripts/compute_sim_cd_paths.js      # regenerate data/sim_cd_paths.json
node scripts/validate_sim_cd_paths.js     # confirm it matches the live simulation
```

Run all three after any edit to `data/tree.json` — see the `scripts/audit_paths.py` section of the README for what each check covers.

## 6. Build the Visual Guide

`guide.html` is a series of self-contained `<section class="guide-section" id="...">` blocks, each pairing an annotated photo with a `guide-terms` definition list. Add one section per diagnostic character your key relies on, then link to it from the relevant question in `data/tree.json` via `question_link` (inline text link) or `guide_link` (standalone button), and add a matching entry to the `GUIDE_LINKS` map in `js/checklist.js` so Feature Scoring's question text links to the same section.

## 7. Deploy

Enable GitHub Pages on `main` (root). All asset paths are relative, so the app works under any repo subpath.
