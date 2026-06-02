# Species ID Notes — Notebook Source

Running record of underside identification notes provided from notebook sources,
used to verify and correct tree.json entries. Each entry records the original
source text, which question/answer it affects, and what fix was applied.

---

## A. agrata agrata

**Question affected:** Q10 — `q_tailed_epimuta` (tailed branch)
> "On the hindwing underside, is the postdiscal spot in space 6 positioned roughly midway between the postdiscal spot in space 5 and the end-cell bar?"

**Notebook source:**
Spot 6 is displaced well past midway — inner edge of spot 6 is in line with or inside the inner edge of spot 7. Spot 6 touches or overlaps the end-cell bar. Spots 5, 6 and 7 widely out of line.

**Fix applied:**
- `r_agrata_agrata`: added `features` override → Q10 = "No — spot 6 displaced past midway; touching or overlapping the end-cell bar; spots 5, 6 and 7 widely out of line"

---

## A. stinga

**Question affected:** Q10 — `q_tailed_epimuta` (tailed branch)

**Notebook source:**
Ground colour hair brown with a distinct purple wash. HW cell notably long — more than half the total wing length. Short stout tail at vein 2, just under 2.0 mm. All observations show spot 6 touches or exceeds the end-cell bar; the end-cell bar is notably long.

**Fix applied:**
- `r_stinga`: added `features` override → Q10 = "No — spot 6 displaced past midway; touching or overlapping the end-cell bar; spots 5, 6 and 7 widely out of line"
- Note updated: HW cell notably long; end-cell bar notably long; spot 6 touches or overlaps end-cell bar.

---

## A. trogon

**Question affected:** Q10 — `q_tailed_epimuta` (tailed branch)

**Notebook source (inferred from same aurea group as stinga):**
HW end-cell bar notably long; postdiscal spot 6 touches or overlaps the end-cell bar (same structural character as A. stinga — both are purple-washed aurea-group species with long end-cell bars).

**Fix applied:**
- `r_trogon`: added `features` override → Q10 = "No — spot 6 displaced past midway; touching or overlapping the end-cell bar; spots 5, 6 and 7 widely out of line"
- Note updated: end-cell bar notably long; spot 6 touches or overlaps end-cell bar.

---

## A. wildeyana wildeyana

**Question affected:** Q92 — `q_tailless_epimuta` (tailless branch)
> "On the hindwing underside, is postdiscal spot 6 displaced from the postdiscal row — shifted toward the end-cell bar rather than aligned with the level of spot 5?"

**Notebook source (Plate 92, Figure 10):**
> "Yes, in Arhopala wildeyana, the centres of the postdiscal spots in spaces 7, 6, and 5 on the hindwing underside are widely out of line. Postdiscal spot 6 is displaced from the postdiscal row and shifted inward toward the wing base and the end-cell bar, which it typically touches or overlaps.
>
> As a member of the agelastus group, Arhopala wildeyana falls under the major key division for species where spot 6 is shifted toward the end-cell bar rather than being aligned in an echelon with the spots in spaces 5 and 7. In species where these centres are 'more or less in line,' spot 6 is positioned nearer to spot 5 than to the end-cell bar.
>
> Plate 92, Figure 10: Arhopala wildeyana wildeyana"

**Fix applied:**
- `r_wildeyana`: added `features` override → Q92 = "Yes — spot 6 displaced well past midway; usually touching or overlapping the end-cell bar; spots 5, 6 and 7 widely out of line"
- Note updated: spot 6 displaced inward, touches or overlaps end-cell bar; spots 5, 6, 7 widely out of line (agelastus group character).

**Structural note:**
Q92 choice 2 currently carries the label "(A. antimuta)" which routes to `g_amphimuta_perimuta`. Wildeyana reaches its correct result via Q92 "No" branch (routed to `q_tailless_agelastus_check`). The `features` override corrects the display without changing routing. Q92 restructuring is pending (see below).

---

## Q92 Restructuring — Pending

**Current Q92 (`q_tailless_epimuta`) Yes-choices:**
1. Yes — spot 6 approximately midway → `g_epimuta` (A. atosia, A. epimuta, A. lurida)
2. Yes — spot 6 displaced past midway, touching bar → `g_amphimuta_perimuta` (A. antimuta, A. metamuta, A. perimuta)
3. Yes — spot 6 shifted toward cell, agesilaus group → `g_agesilaus` (A. agesilaus, A. avatha)

**Proposed restructure:**
Collapse 3 Yes choices into 1 ("spot 6 displaced toward end-cell bar"), then add follow-up question(s) to split the 8 species into their current groups.

**Species requiring underside info for redesign (8 species):**
- ~~A. atosia malayana~~ ✓ (see below)
- ~~A. epimuta epiala~~ ✓ (see below)
- ~~A. lurida~~ ✓ (see below)
- A. antimuta antimuta
- A. metamuta metamuta
- A. perimuta regina
- A. agesilaus gesa
- A. avatha

---

## Q92 Epimuta Group — A. atosia / A. epimuta / A. lurida

**Notebook source:**

Shared character (epimuta group): HW postdiscal spot 6 is positioned approximately midway between spot 5 and the end-cell bar.

**1. Arhopala epimuta epiala (Common Disc Oakblue)**
- Tail: **Tailless** — the only tailless species in the epimuta group; unique among the three.
- Markings: Lighter and less defined (similar to A. atosia).

**2. Arhopala atosia malayana (Tailed Disc Oakblue)**
- Tail: Tailed; filamentous tail at HW vein 2.
- Markings: Lighter and less defined than A. lurida.

**3. Arhopala lurida**
- Tail: Tailed; filamentous tail at HW vein 2.
- Markings: Darker and better defined than A. atosia.

**Key split logic:**
1. Tailed? → No = A. epimuta epiala (only tailless member)
2. If tailed → Markings darker and better defined? → Yes = A. lurida; No = A. atosia malayana

**Notes for Q92 restructuring:**
- A. epimuta epiala is tailless — in a restructured Q92, it arrives via the tailless branch (Q1=No), so it reaches Q92 already knowing it's tailless. The tailed/tailless split at Q1 already separates A. epimuta from A. atosia and A. lurida before Q92.
- After collapsing Q92 Yes choices, the epimuta group follow-up only needs to split A. atosia vs A. lurida (both tailed, same spot 6 position). The distinguishing character is marking intensity: darker/better defined = A. lurida.

---

## Q92 Perimuta Subgroup — A. antimuta / A. metamuta / A. perimuta

**Notebook source:**

Shared subgroup character: FW underside postdiscal spots in spaces 2 and 3 are in line (may be oblique), not staggered in echelon.

**1. Arhopala perimuta regina**
- HW tornal scales: **No green tornal scales** — immediately diagnostic.
- HW: Diagnostic central yellowish area; overall markings obscure.

**2. Arhopala antimuta antimuta**
- HW tornal scales: Green tornal scales present.
- HW spot 6 position: Widely out of line with spots 5 and 7. Inner edge of spot 6 in line with or inside the inner edge of spot 7. Spot 6 typically overlaps the end-cell bar.
- Postdiscal band: Usually completely dislocated at vein 2.

**3. Arhopala metamuta metamuta**
- HW tornal scales: Green tornal scales present.
- HW spot 6 position: Spots 5, 6 and 7 more or less in line. Spot 6 positioned **nearer to spot 5 than to the end-cell bar**.
- Ground colour: Uniform hair brown.

**Key split logic:**
1. Green tornal scales present? → No = A. perimuta regina (+ central yellowish area, obscure markings)
2. If green tornal scales: Spot 6 inner edge in line with/inside inner edge of spot 7; overlaps end-cell bar; spots widely out of line? → Yes = A. antimuta; No = A. metamuta

**Critical observation for Q92 restructuring:**
- A. antimuta: spot 6 overlaps end-cell bar — fits the "displaced past midway, touching bar" description.
- A. metamuta: spot 6 **nearer to spot 5 than to end-cell bar** — this is closer to "spot 6 at same level as spot 5" than to "touching bar." A. metamuta may belong structurally in a "slight displacement" category, distinct from both the epimuta-midway group and the antimuta-touching group.
- A. perimuta: separated by absence of green tornal scales; spot 6 position is secondary.
- All three share the FW spots 2–3 in-line character (not echelon) — usable as a group-entry diagnostic.

**Current tree issue:**
All three reach `g_amphimuta_perimuta` via Q92 choice 2 ("spot 6 displaced past midway, touching bar"), but A. metamuta does not match that description. The restructured Q92 will need to accommodate metamuta's intermediate spot 6 position.

---

## Q92 Agesilaus Group — A. agesilaus / A. avatha

**Notebook source:**

Shared agesilaus group characters:
- Both species are **tailless**.
- HW underside: spot 6 positioned **roughly midway (equidistantly)** between spot 5 and the end-cell bar.
- HW underside: postdiscal band **only partially dislocated at vein 2** (not fully separated).

**1. Arhopala agesilaus gesa**
- FW underside: **Basal cell spot present**.
- General appearance: Resembles a small individual of A. major.

**2. Arhopala avatha**
- FW underside: **Basal cell spot absent**.
- General appearance: Rather like A. antimuta.

**Key split logic:**
- FW underside basal cell spot present? → Yes = A. agesilaus gesa; No = A. avatha

**Notes for Q92 restructuring:**
- The agesilaus group's spot 6 position ("midway") is visually identical to the epimuta group's. The only discriminating character at the group level is the HW band dislocation at vein 2 (partial in agesilaus; not mentioned for epimuta). This must be the primary question separating the two "midway" groups after Q92 Yes.

---

## Q92 Restructuring — Full Analysis

All 8 species documented. Summary of spot 6 positions and key characters:

| Species | Tail | Spot 6 position | Key additional character |
|---|---|---|---|
| A. epimuta epiala | Tailless | Midway | Only tailless epimuta member |
| A. atosia malayana | Tailed | Midway | Lighter markings |
| A. lurida | Tailed | Midway | Darker, better defined markings |
| A. agesilaus gesa | Tailless | Midway (equidistant) | HW band partially dislocated at vein 2; FW basal cell spot present |
| A. avatha | Tailless | Midway (equidistant) | HW band partially dislocated at vein 2; FW basal cell spot absent |
| A. antimuta antimuta | Tailless | Past midway; inner edge of spot 6 in line with/inside inner edge of spot 7; overlaps end-cell bar | Green tornal scales; HW band usually completely dislocated at vein 2 |
| A. metamuta metamuta | Tailless | Nearer to spot 5 than to end-cell bar (less than midway?) | Green tornal scales; spots 5,6,7 more or less in line; uniform hair brown |
| A. perimuta regina | Tailless | Not specified | No green tornal scales; central yellowish area; obscure markings |

**Proposed restructured Q92 tree:**

**FW spots 2–3 in line vs echelon — NOT USABLE:** These spots are almost always hidden under the hindwing in perched field photographs. Cannot be used as a key character.

**Confirmed:** A. antimuta, A. metamuta, and A. perimuta are all tailless.

**Revised proposed restructuring — without FW spots 2–3:**

Without FW spots 2–3, the first-level split after Q92 Yes must use HW characters. The most practical visible split is the **degree of spot 6 displacement combined with HW vein 2 band dislocation**:

```
Q92: Is spot 6 displaced from the postdiscal row toward the end-cell bar?
  ├── Yes → Q_A
  └── No → q_tailless_agelastus_check (unchanged)

Q_A: Is the HW postdiscal band only partially dislocated at vein 2
     (band still connected/shifted, not fully separated)?
  ├── Yes → agesilaus group → Q_B
  └── No → Q_C

Q_B: Is there a basal cell spot on the forewing underside?
  ├── Yes → A. agesilaus gesa
  └── No → A. avatha

Q_C: Are green tornal scales present on the HW underside?
  ├── No → A. perimuta regina (central yellowish area; obscure markings)
  └── Yes → Q_D

Q_D: Are spots 5, 6 and 7 widely out of line, with spot 6 inner edge
     in line with or inside the inner edge of spot 7?
  ├── Yes (spot 6 overlaps end-cell bar) → A. antimuta antimuta
  └── No (spot 6 nearer to spot 5; spots more or less in line) → Q_E

Q_E: Is spot 6 roughly midway between spot 5 and the end-cell bar?
  ├── Yes (midway) → epimuta group → Q_F
  └── No (nearer to spot 5 than midway) → A. metamuta metamuta

Q_F: (tailed/tailless already split at Q1; both branches reach this point)
  Is the underside markings darker and better defined than typical?
  ├── Yes → A. lurida
  └── No → A. atosia malayana
  [tailless path has already eliminated atosia/lurida → A. epimuta epiala]
```

**Confirmed:**
- A. metamuta spot 6: slight forward displacement — less than midway. Confirmed usable as "No" at Q_E (midway check).
- A. perimuta: immediately distinguished by absence of green tornal scales + central yellowish area + obscure markings. Spot 6 position not needed — separated at Q_C.

**Confirmed:**
- A. epimuta epiala, A. atosia malayana, A. lurida: all have green tornal scales. Q_C (green tornal check) correctly separates only A. perimuta.

**Confirmed — all open questions resolved:**
- A. epimuta epiala, A. atosia malayana, A. lurida: HW postdiscal band **fully dislocated** at vein 2 (two clearly separated portions). Agesilaus group has only PARTIAL dislocation. Q_A (vein 2 partial vs full) is confirmed as a valid split between the two "midway" groups.

**Implementation status: COMPLETE.**
Restructured Q92 implemented in `data/tree.json` as of 2026-06-02:
- `q_tailless_epimuta`: collapsed to 2 choices (Yes → `q_tailless_epimuta_vein2`; No → `q_tailless_agelastus_check`)
- `q_tailless_epimuta_vein2`: partial vs full vein 2 dislocation → agesilaus group vs continue
- `q_tailless_epimuta_tornal`: green tornal scales → No = A. perimuta regina; Yes = continue
- `q_tailless_epimuta_spot6_pos`: spots widely out of line / spot 6 overlaps bar → Yes = A. antimuta antimuta; No = continue
- `q_tailless_epimuta_midway`: spot 6 midway → Yes = g_epimuta; No = A. metamuta metamuta
