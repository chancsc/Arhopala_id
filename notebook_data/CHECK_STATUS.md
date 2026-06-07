# Notebook data cross-check status

Tracks verification of `notebook_data/*.txt` (extracted underside ID-key
descriptions) against the existing decision-tree data in `data/tree.json`
(canonical routing answers, result-node `note`/`features`, and the visual
guide where relevant).

This folder gets further updates over time — update this table as new
files appear or get re-checked. For each species, focus especially on the
**hindwing postdiscal spot 6 position** (the emphasized character in the
extraction queries), plus any other notable underside keys.

Status legend: ✅ checked & consistent · 🛠️ checked & fixed · 🚩 conflict found, needs human review · ⏳ pending

| File | Species (tree.json result node) | Status | Notes |
|---|---|---|---|
| arhopala_abseus.txt | Arhopala abseus | ✅ | spot-6 echelon/widely-out-of-line + touches end-cell bar description, costal/space-12 spot, FW border — all consistent with note & q_abseus_species routing |
| arhopala_achelous.txt | Arhopala achelous achelous | 🚩 | **CONFLICT needs human review**: notebook says HW spot 6 "arranged in echelon, centres more or less in a straight line" and "nearer to spot 5 than to end-cell bar"; tree.json note/features (added as "field observations", commit 9a4d0b0) say spot 6 is "very small, situated directly below spot 7 ... distinctly displaced toward the end-cell bar" — opposite placements, and this is the diagnostic separating achelous from anthelus grahami. Left tree.json untouched pending source verification — please confirm which description is correct |
| arhopala_aedias.txt | Arhopala aedias | ✅ | spot 6 "in echelon, nearer to spot 5 than end-cell bar"; FW spot 4 shifted distad; long filamentous tail ~6mm — all match q_long_tail_spot4/note |
| arhopala_agaba.txt | Arhopala agaba | 🛠️ | sim-CD path fixed earlier this session (Q38–Q41 stop-condition) |
| arhopala_agelastus.txt | Arhopala agelastus agelastus | ✅ | spot-6 "widely out of line, inner edge in line with/inside 7, touches/overlaps end-cell bar, outwardly convex" matches q_agelastus_s4/q_97 + note |
| arhopala_agesias.txt | Arhopala agesias | ✅ | spot 6 echelon/nearer-to-5 description consistent with tailless routing; FW space 11 single subcostal spot, hair-brown ground colour match note |
| arhopala_agrata.txt | Arhopala agrata agrata | ✅ | spot 6 "wider than 7, inner edge in/inside 7's, touches/overlaps end-cell bar, widely out of line" matches q_tailed_epimuta features override + note |
| arhopala_aida.txt | Arhopala aida | ✅ | alitaeus-group spot-6 placement (midway, touches/overlaps bar) matches q_tailed_epimuta "Yes" routing; note's "outwardly straight/convex" + "band completely dislocated at vein 2" not contradicted, just not extracted in txt |
| arhopala_alaconia.txt | Arhopala alaconia media | ✅ | spot 6 "outer edge concave/sinuous" (vs convex in other agelastus-group), tornal green scales, f. kempi tailed form ~2.5mm — all match q_agelastus_s4 + note exactly |
| arhopala_alitaeus.txt | Arhopala alitaeus | ✅ | spot 6 "rounded, overlaps end-cell bar, inner edge in/inside 7" matches q_tailed_epimuta + q_alitaeus_s1_marks; FW space-10 base spot, annular markings, slatey-purple glaze match note |
| arhopala_ammonides.txt | Arhopala ammonides chunsu | ✅ | spot 6 "inner edge in line with/inside 7, touches/overlaps end-cell bar" matches q_tailed_epimuta; white area filling space-7 gap, no tornal green scales, ~14mm — match note |
| arhopala_amphimuta.txt | Arhopala amphimuta amphimuta | ⏳ | |
| arhopala_anthelus.txt | Arhopala anthelus grahami | ⏳ | |
| arhopala_antimuta.txt | Arhopala antimuta antimuta | ⏳ | |
| arhopala_athada.txt | Arhopala athada athada | ⏳ | |
| arhopala_atosia.txt | Arhopala atosia malayana | ✅ | note enriched (ground colour, echelon, tail/size); Q81 spot-6 "midway" already correct; guide Q-number ref fixed (Q9→Q81) |
| arhopala_aurea.txt | Arhopala aurea | ⏳ | |
| arhopala_barami.txt | Arhopala barami penanga | ⏳ | |
| arhopala_bazalus.txt | Arhopala bazalus zalinda | ⏳ | |
| arhopala_borneensis.txt | Arhopala borneensis | ⏳ | |
| arhopala_buddha.txt | Arhopala buddha cooperi | ⏳ | |
| arhopala_centaurus.txt | Arhopala centaurus nakula | ⏳ | |
| arhopala_corinda.txt | Arhopala corinda acestes | ⏳ | |
| arhopala_delta.txt | Arhopala delta | ⏳ | |
| arhopala_democritus.txt | Arhopala democritus democritus / lycaenaria | ⏳ | |
| arhopala_elopura.txt | Arhopala elopura | ✅ | full note rewritten + Q81 features override added from supplied description |
| arhopala_epimuta.txt | Arhopala epimuta epiala | ⏳ | |
| arhopala_eumolphus.txt | Arhopala eumolphus maxwelli | ⏳ | |
| arhopala_fulla.txt | Arhopala fulla intaca | ⏳ | |
| arhopala_hellenore.txt | Arhopala hellenore siroes | 🛠️ | spot-6 position consistent; fixed unrelated Q57/Q89 wording conflict surfaced while checking |
| arhopala_horsfieldi.txt | Arhopala horsfieldi basiviridis | ⏳ | |
| arhopala_hypomuta.txt | Arhopala hypomuta hypomuta | ⏳ | |
| arhopala_ijanensis.txt | Arhopala ijanensis | ⏳ | |
| arhopala_inornata.txt | Arhopala inornata inornata | ⏳ | |
| arhopala_kinabala.txt | Arhopala kinabala | ⏳ | |
| arhopala_lurida.txt | Arhopala lurida | ⏳ | |
| arhopala_major.txt | Arhopala major major | ⏳ | |
| arhopala_moolaiana.txt | Arhopala moolaiana yajuna | ⏳ | |
| arhopala_moorei.txt | Arhopala moorei busa | ⏳ | |
| arhopala_muta.txt | Arhopala muta maranda | ⏳ | |
| arhopala_myrzala.txt | Arhopala myrzala lammas | ⏳ | |
| arhopala_myrzalina.txt | Arhopala myrzalina | ⏳ | |
| arhopala_norda.txt | Arhopala norda | ⏳ | |
| arhopala_opalina.txt | Arhopala opalina azata | ⏳ | |
| arhopala_perimuta.txt | Arhopala perimuta regina | ⏳ | |
| arhopala_pseudomuta.txt | Arhopala pseudomuta | ⏳ | |
| arhopala_selta.txt | Arhopala selta selta | ⏳ | |
| arhopala_silhetensis.txt | Arhopala silhetensis adorea | ⏳ | |
| arhopala_stinga.txt | Arhopala stinga | ⏳ | |
| arhopala_trogon.txt | Arhopala trogon | ⏳ | |
| arhopala_vihara.txt | Arhopala vihara | ⏳ | |
| arhopala_wildeyana.txt | Arhopala wildeyana wildeyana | ⏳ | |
| flos_morphina.txt | *(no matching result node — different genus)* | ⏳ | likely a confusable/lookalike reference; check whether it's mentioned anywhere in tree.json notes/hints |
