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
