// id_keys.js — C&P Dichotomous Key sequential navigation for Arhopala ID
// Adapted from the generic sequential-key tool (see notebook_data key design).
// Presents one couplet at a time; A/B choices navigate the key while a
// feature-scoring (+1/-1) model ranks candidates in real time. Upperside
// couplets offer a Skip option so underside-only photos can continue.

const ks = {
  couplets: null,       // array from id_key.json
  leads: null,          // object {leadNum(str): text}
  speciesInfo: null,    // Map<name, {common_name, inat_url}>
  answers: [],          // [{coupletId, choice}] — history in order
  currentCouplet: null, // couplet currently shown (null when done)
  result: null,         // {leadNum, text, speciesName} when terminal, else null
  scores: [],
  expandedName: null,
};

const ANSWERS_KEY = 'arhopala-ks-answers-v1';
const GENUS_MARKER = 'Arhopala';

function ksSaveAnswers() {
  try { localStorage.setItem(ANSWERS_KEY, JSON.stringify({ answers: ks.answers })); } catch (e) {}
}

function ksClearAnswers() {
  try { localStorage.removeItem(ANSWERS_KEY); } catch (e) {}
}

function ksLoadAnswers() {
  try {
    const raw = localStorage.getItem(ANSWERS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.answers)) return [];
    const valid = new Set((ks.couplets || []).map(c => c.id));
    return data.answers.filter(a => valid.has(a.coupletId) && ['A', 'B', 'skip'].includes(a.choice));
  } catch (e) { return []; }
}

// ── Data init ────────────────────────────────────────────────────────────────

function ksInitData(keyData, speciesData) {
  ks.couplets = keyData.couplets;
  ks.leads = keyData.leads;

  const sp2Map = new Map();
  for (const s of speciesData.species)
    sp2Map.set(s.name.split(' ').slice(0, 2).join(' '), s);

  ks.speciesInfo = new Map();
  const allNames = new Set();
  for (const cp of ks.couplets) {
    for (const n of cp.species_a) allNames.add(n);
    for (const n of cp.species_b) allNames.add(n);
  }
  for (const name of allNames) {
    const sp2 = name.split(' ').slice(0, 2).join(' ');
    const sp = sp2Map.get(sp2);
    ks.speciesInfo.set(name, {
      common_name: sp ? (sp.common_name || '') : '',
      inat_url: sp ? sp.inat_url : `https://www.inaturalist.org/search?q=${encodeURIComponent(sp2)}`,
    });
  }
}

// ── Navigation (serial decision-node model) ──────────────────────────────────
// keys.txt is a serial-lead key: a lead can name a species AND still forward the
// trunk when the specimen isn't that species (it falls through to lead n+1). So
// resolve() walks forward from a lead until it hits a couplet-node (which wins
// over a terminal) or a terminal. This matches scripts/build_id_key.js /
// validate_id_key.js exactly, so every stored species_path replays here.

let ksCoupletNodes = null; // Set<num_a>
let ksCpByNode = null;     // Map<num_a, couplet>

function ksBuildNav() {
  ksCoupletNodes = new Set(ks.couplets.map(c => c.num_a));
  ksCpByNode = new Map(ks.couplets.map(c => [c.num_a, c]));
}

function ksPresent(t) { return ks.leads[String(t)] !== undefined; }

function ksIsTerminal(leadNum) {
  return (ks.leads[String(leadNum)] || '').includes(GENUS_MARKER);
}

function ksExtractSpecies(text) {
  const match = text.match(new RegExp('\\b' + GENUS_MARKER + '\\s+\\w+(?:\\s+\\w+)?'));
  return match ? match[0] : '';
}

// Returns { couplet } | { terminal: leadNum } | { dead: true }
function ksResolve(t) {
  let steps = 0;
  while (ksPresent(t)) {
    if (ksCoupletNodes.has(t)) return { couplet: ksCpByNode.get(t) };
    if (ksIsTerminal(t)) return { terminal: t };
    t += 1;
    if (++steps > 500) break;
  }
  return { dead: true };
}

// Result of choosing a side at a couplet: { couplet } | { terminal: leadNum } | { dead }
function ksChoose(cp, choice) {
  if (choice === 'A') {
    return ksIsTerminal(cp.num_a) ? { terminal: cp.num_a } : ksResolve(cp.num_a + 1);
  }
  return ksResolve(cp.num_b); // B
}

function ksSkipNext(cp) {
  // For skip (upperside couplets): advance via whichever branch continues to a couplet
  const a = ksChoose(cp, 'A');
  if (a.couplet) return a.couplet;
  const b = ksChoose(cp, 'B');
  if (b.couplet) return b.couplet;
  return null; // both branches terminal — skip not possible
}

function ksReplayHistory() {
  ksBuildNav();
  ks.currentCouplet = ks.couplets[0];
  ks.result = null;

  for (let i = 0; i < ks.answers.length; i++) {
    const a = ks.answers[i];
    const cp = ks.couplets.find(c => c.id === a.coupletId);
    if (!cp || cp !== ks.currentCouplet) {
      // History no longer matches current couplet — truncate
      ks.answers = ks.answers.slice(0, i);
      break;
    }

    if (a.choice === 'skip') {
      const next = ksSkipNext(cp);
      if (!next) { ks.answers = ks.answers.slice(0, i); break; }
      ks.currentCouplet = next;
      continue;
    }

    const r = ksChoose(cp, a.choice);
    if (r.terminal != null) {
      const text = ks.leads[String(r.terminal)] || '';
      ks.result = { leadNum: r.terminal, text, speciesName: ksExtractSpecies(text) };
      ks.currentCouplet = null;
      break;
    } else if (r.couplet) {
      ks.currentCouplet = r.couplet;
    } else {
      ks.answers = ks.answers.slice(0, i);
      break;
    }
  }
}

// ── Scoring (feature-scoring +1 / -1 model) ───────────────────────────────────

function ksScoreAll() {
  if (!ks.couplets) { ks.scores = []; return; }

  const allNames = new Set();
  for (const cp of ks.couplets) {
    for (const n of cp.species_a) allNames.add(n);
    for (const n of cp.species_b) allNames.add(n);
  }

  const answered = ks.answers.filter(a => a.choice !== 'skip');

  ks.scores = [...allNames].map(name => {
    let score = 0, max = 0;
    for (const a of answered) {
      const cp = ks.couplets.find(c => c.id === a.coupletId);
      if (!cp) continue;
      const inA = cp.species_a.includes(name);
      const inB = cp.species_b.includes(name);
      if (!inA && !inB) continue; // couplet neutral for this taxon
      max++;
      if (inA && a.choice === 'A') score++;
      else if (inA && a.choice === 'B') score--;
      else if (inB && a.choice === 'B') score++;
      else if (inB && a.choice === 'A') score--;
    }
    return { name, score, max };
  }).sort((a, b) => {
    const pA = a.max > 0 ? a.score / a.max : 0;
    const pB = b.max > 0 ? b.score / b.max : 0;
    // Rank by raw score (net couplets confirmed) first, then by match rate as a
    // tie-break. Raw score is the amount of evidence for a candidate; match rate
    // alone punishes species that go deep in the key (more couplets = more
    // chances for one contradiction to sink the rate), while a species that
    // exits early simply has fewer characters tested — not a genuinely better
    // match. e.g. following muta: amphimuta 12/12 (100%, exited early) should
    // NOT outrank muta 17/19 (89%, confirmed far more). Score first fixes that.
    return b.score - a.score || pB - pA || a.name.localeCompare(b.name);
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ksEsc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ksEscAttr(s) {
  return (s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function ksLinkify(text, phrase, url, cls) {
  if (!phrase || !url || !text) return ksEsc(text);
  const idx = text.indexOf(phrase);
  if (idx === -1) return ksEsc(text);
  return ksEsc(text.slice(0, idx))
    + `<a href="${ksEscAttr(url)}" class="${ksEsc(cls || 'ks-guide-link')}" target="_blank" rel="noopener">${ksEsc(phrase)}</a>`
    + ksEsc(text.slice(idx + phrase.length));
}

function ksRenderText(text, phrase, url) {
  return phrase ? ksLinkify(text, phrase, url) : ksEsc(text);
}

// epithet (lowercase second word) → iNaturalist URL, built once from speciesInfo.
let ksEpithetMap = null;
function ksBuildEpithetMap() {
  ksEpithetMap = new Map();
  for (const [name, info] of ks.speciesInfo) {
    const epithet = (name.split(' ')[1] || '').toLowerCase();
    if (epithet && info.inat_url && !ksEpithetMap.has(epithet))
      ksEpithetMap.set(epithet, info.inat_url);
  }
}

// Link species mentions in a hint ("A. amantes", "Arhopala hellada ozana") to
// the species' iNaturalist observations page. Matches "A."/"Arhopala" + a known
// epithet, plus an immediately following lowercase word when it's a subspecies
// (not a common English word), so trinomials link in full. Escapes all other text.
const KS_HINT_STOPWORDS = new Set([
  'and','by','is','with','the','or','not','but','has','have','its','in','at','on','of',
  'to','from','than','if','then','so','as','are','was','were','this','that','both','all',
  'no','yes','may','more','less','very','only','also','group','subgroup','vs','usually',
  'often','otherwise','while','when','which','a','an','it','he','she','they','same',
]);
function ksLinkifyHint(text) {
  if (!text) return '';
  if (!ksEpithetMap) ksBuildEpithetMap();
  const re = /\b(?:A\.|Arhopala)\s+([a-z][a-z-]+)(\s+([a-z][a-z-]+))?/g;
  let out = '', last = 0, m;
  while ((m = re.exec(text)) !== null) {
    const url = ksEpithetMap.get(m[1].toLowerCase());
    if (!url) continue;
    // include a following lowercase word only if it's a plausible subspecies
    let matchText = m[0], end = m.index + m[0].length;
    if (m[3] && KS_HINT_STOPWORDS.has(m[3].toLowerCase())) {
      matchText = text.slice(m.index, m.index + m[0].length - m[2].length);
      end = m.index + matchText.length;
    }
    out += ksEsc(text.slice(last, m.index));
    out += `<a href="${ksEscAttr(url)}" class="ks-hint-sp-link" target="_blank" rel="noopener">${ksEsc(matchText)}</a>`;
    last = end;
    re.lastIndex = end;
  }
  out += ksEsc(text.slice(last));
  return out;
}

// ── Render ───────────────────────────────────────────────────────────────────

function ksRenderCandidates() {
  const listEl = document.getElementById('ks-candidates');
  const nonSkip = ks.answers.filter(a => a.choice !== 'skip').length;
  if (nonSkip === 0) {
    listEl.innerHTML = '<p class="ks-empty">Answer key questions above to rank candidates.</p>';
    return;
  }

  const top = ks.scores.slice(0, 8);
  const medals = ['🥇', '🥈', '🥉'];
  // Bar length is relative to the leader's raw score, so it tracks the ranking
  // (score-primary) — the top candidate always shows the fullest bar.
  const topScore = top.length ? Math.max(1, top[0].score) : 1;

  listEl.innerHTML = top.map((s, i) => {
    const info = ks.speciesInfo.get(s.name) || {};
    const barW = Math.round(Math.max(0, s.score) / topScore * 100);
    const isExpanded = ks.expandedName === s.name;
    const inatHref = info.inat_url ? ksEscAttr(info.inat_url) : '';
    return `
      <div class="ks-cand${isExpanded ? ' expanded' : ''}" data-name="${ksEscAttr(s.name)}">
        <div class="ks-cand-row" role="button" tabindex="0" aria-expanded="${isExpanded}">
          <span class="ks-rank">${medals[i] || i + 1}</span>
          <span class="ks-cname">
            <em class="ks-sci">${ksEsc(s.name)}</em>
            ${info.common_name ? `<span class="ks-common">${ksEsc(info.common_name)}</span>` : ''}
          </span>
          <span class="ks-bar-wrap">
            <span class="ks-bar-bg">
              <span class="ks-bar${s.score < 0 ? ' neg' : ''}" style="width:${barW}%"></span>
            </span>
            <span class="ks-score-num${s.score < 0 ? ' neg' : ''}">${s.score > 0 ? '+' : ''}${s.score}</span>
          </span>
          ${inatHref ? `<a class="ks-inat-icon" href="${inatHref}" target="_blank" rel="noopener" title="View on iNaturalist" aria-label="View ${ksEscAttr(s.name)} on iNaturalist">&#128279;</a>` : ''}
        </div>
        ${isExpanded ? `<div class="ks-cand-detail">
          <a class="ks-inat-link" href="${inatHref}" target="_blank" rel="noopener">View on iNaturalist &#8594;</a>
        </div>` : ''}
      </div>`;
  }).join('');

  if (ks.expandedName && !top.some(s => s.name === ks.expandedName))
    ks.expandedName = null;
}

function ksRenderHistory() {
  const el = document.getElementById('ks-history');
  if (!el) return;
  if (ks.answers.length === 0) { el.innerHTML = ''; return; }

  const items = ks.answers.map((a, i) => {
    const cp = ks.couplets.find(c => c.id === a.coupletId);
    if (!cp) return '';
    let label;
    if (a.choice === 'skip') {
      label = `Key ${cp.num_a}: Skip`;
    } else {
      // Yes = choice A, unless the couplet is display-inverted (then Yes = B).
      const displayYes = cp.invert === true ? a.choice === 'B' : a.choice === 'A';
      label = `Key ${cp.num_a}: ${displayYes ? 'Yes' : 'No'}`;
    }
    return `<span class="ks-hist-item" data-step="${i}" role="button" tabindex="0" title="Back to Key ${ksEscAttr(String(cp.num_a))}">${ksEsc(label)}</span>`;
  }).filter(Boolean).join('<span class="ks-hist-sep">&#8250;</span>');

  el.innerHTML = `<div class="ks-hist">${items}</div>`;
}

function ksRenderCouplet() {
  const el = document.getElementById('ks-couplets');
  if (!el) return;

  if (ks.result) {
    const info = ks.speciesInfo.get(ks.result.speciesName) || {};
    const inatHref = info.inat_url ? ksEscAttr(info.inat_url) : '';
    el.innerHTML = `
      <div class="ks-result-card">
        <p class="ks-result-label">&#9658; Identification</p>
        <p class="ks-result-species">Key ${ksEsc(String(ks.result.leadNum))}: <em>${ksEsc(ks.result.speciesName)}</em></p>
        ${info.common_name ? `<p class="ks-result-common">${ksEsc(info.common_name)}</p>` : ''}
        <p class="ks-result-text">${ksEsc(ks.result.text)}</p>
        ${inatHref ? `<a class="ks-inat-link" href="${inatHref}" target="_blank" rel="noopener">View on iNaturalist &#8594;</a>` : ''}
      </div>`;
    return;
  }

  if (!ks.currentCouplet) {
    el.innerHTML = '<p class="ks-empty">Key complete.</p>';
    return;
  }

  const cp = ks.currentCouplet;
  // Optional group species list (cp.hint_group = {side, label}): show every
  // species reachable on that side of the couplet, each linked to iNaturalist.
  let groupHTML = '';
  if (cp.hint_group && (cp.hint_group.side === 'a' || cp.hint_group.side === 'b')) {
    const names = cp['species_' + cp.hint_group.side] || [];
    if (names.length) {
      const items = names.map(n => {
        const info = ks.speciesInfo.get(n);
        const href = info && info.inat_url ? info.inat_url : '';
        const label = `<em>${ksEsc(n)}</em>`;
        return `<li>${href
          ? `<a href="${ksEscAttr(href)}" target="_blank" rel="noopener">${label}</a>`
          : label}</li>`;
      }).join('');
      const lbl = cp.hint_group.label ? `<p class="ks-hint-group-label">${ksEsc(cp.hint_group.label)}</p>` : '';
      groupHTML = `${lbl}<ul class="ks-hint-group">${items}</ul>`;
    }
  }
  const hintHTML = (cp.hint || groupHTML)
    ? `<details class="ks-hint">
         <summary>Hint</summary>
         ${cp.hint ? `<p>${ksLinkifyHint(cp.hint)}</p>` : ''}
         ${groupHTML}
       </details>`
    : '';

  // Serial-lead key: each couplet is a SINGLE statement (the entry lead num_a).
  // "Yes" = the specimen matches it → advance to the next lead; "No" = it does
  // not → jump to lead num_b (shown as the next couplet). The statement is given
  // in full so the user decides from it alone, the way a printed key is worked.
  // When cp.invert is set, the couplet is phrased the other way round: it shows
  // cp.statement and Yes maps to choice B (jump), No to choice A (advance) — a
  // display-only flip (navigation/scoring read the data-v, so are unchanged).
  const inverted = cp.invert === true;
  const stmtText = inverted && cp.statement ? cp.statement : cp.a_text;
  const stmtHTML = ksRenderText(stmtText, cp.guide_phrase, cp.guide_link);
  const yesV = inverted ? 'B' : 'A';
  const noV = inverted ? 'A' : 'B';

  // Skip if the character can't be assessed from a photo (upperside, or a
  // couplet flagged skippable — e.g. a genitalia character) and at least one
  // branch is non-terminal so the key can still continue.
  const canSkip = (cp.upperside || cp.skippable) && ksSkipNext(cp) !== null;
  const skipLabel = cp.upperside ? 'Skip — upperside feature not visible' : 'Skip — cannot determine from photo';
  const skipRow = canSkip
    ? `<div class="ks-btn-row"><button class="ks-btn ks-btn-skip" data-id="${ksEscAttr(cp.id)}" data-v="skip">${skipLabel}</button></div>`
    : '';

  el.innerHTML = `
    <div class="ks-cp" id="ks-cp-current">
      <p class="ks-cp-label"><span class="ks-label-tag">Key ${ksEsc(String(cp.num_a))}</span></p>
      ${hintHTML}
      <p class="ks-cp-statement">${stmtHTML}</p>
      <div class="ks-btn-row ks-btn-row--yesno">
        <button class="ks-btn ks-btn-yes" data-id="${ksEscAttr(cp.id)}" data-v="${yesV}">Yes</button>
        <button class="ks-btn ks-btn-no" data-id="${ksEscAttr(cp.id)}" data-v="${noV}">No</button>
      </div>
      ${skipRow}
    </div>`;
}

function ksRender() {
  ksScoreAll();
  ksRenderHistory();
  ksRenderCouplet();
  ksRenderCandidates();

  const badge = document.getElementById('ks-answered-count');
  if (badge) {
    // Match the Feature Scoring counter: count meaningful answers (Yes/No),
    // excluding Skips (the C&P equivalent of "Cannot determine").
    const n = ks.answers.filter(a => a.choice !== 'skip').length;
    badge.textContent = n > 0 ? `${n} key${n !== 1 ? 's' : ''} answered` : '';
  }
}

// ── Event handlers ────────────────────────────────────────────────────────────

function ksOnCoupletClick(e) {
  if (e.target.closest('.ks-guide-link')) return;

  const btn = e.target.closest('.ks-btn');
  if (!btn || !btn.dataset.id) return;
  const id = btn.dataset.id;
  const choice = btn.dataset.v;

  if (!ks.currentCouplet || ks.currentCouplet.id !== id) return;
  const cp = ks.currentCouplet;

  if (choice === 'skip') {
    const next = ksSkipNext(cp);
    if (!next) return;
    ks.answers.push({ coupletId: id, choice: 'skip' });
    ks.currentCouplet = next;
    ksSaveAnswers();
    ksRender();
    return;
  }

  ks.answers.push({ coupletId: id, choice });

  const r = ksChoose(cp, choice);
  if (r.terminal != null) {
    const text = ks.leads[String(r.terminal)] || '';
    ks.result = { leadNum: r.terminal, text, speciesName: ksExtractSpecies(text) };
    ks.currentCouplet = null;
  } else if (r.couplet) {
    ks.currentCouplet = r.couplet;
  } else {
    // Dead end (shouldn't happen with valid data) — undo the answer
    ks.answers.pop();
    return;
  }

  ksSaveAnswers();
  ksRender();
}

function ksOnHistoryClick(e) {
  const item = e.target.closest('.ks-hist-item');
  if (!item) return;
  const step = parseInt(item.dataset.step, 10);
  if (isNaN(step)) return;

  // Truncate to just before this step so the user re-answers from here
  ks.answers = ks.answers.slice(0, step);
  ks.result = null;
  ksReplayHistory();
  ksSaveAnswers();
  ksRender();
}

function ksOnCandidateClick(e) {
  if (e.target.closest('.ks-inat-icon')) return;
  const row = e.target.closest('.ks-cand-row');
  if (!row) return;
  const cand = row.closest('.ks-cand');
  if (!cand) return;
  const name = cand.dataset.name;
  ks.expandedName = ks.expandedName === name ? null : name;
  ksRenderCandidates();
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function ksInit() {
  try {
    const [keyData, speciesData] = await Promise.all([
      fetch('data/id_key.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('id_key.json'); return r.json(); }),
      fetch('data/species.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('species.json'); return r.json(); }),
    ]);

    ksInitData(keyData, speciesData);
    ks.currentCouplet = ks.couplets[0];
    ks.answers = ksLoadAnswers();
    ksReplayHistory();
    ksRender();

    document.getElementById('loading').style.display = 'none';
    document.getElementById('ks-app').style.display = 'block';

    document.getElementById('ks-couplets').addEventListener('click', ksOnCoupletClick);

    const histEl = document.getElementById('ks-history');
    histEl.addEventListener('click', ksOnHistoryClick);
    histEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') ksOnHistoryClick(e);
    });

    document.getElementById('ks-candidates').addEventListener('click', ksOnCandidateClick);
    document.getElementById('ks-candidates').addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') ksOnCandidateClick(e);
    });

    document.getElementById('ks-reset').addEventListener('click', () => {
      ks.answers = [];
      ks.result = null;
      ks.expandedName = null;
      ks.currentCouplet = ks.couplets[0];
      ksClearAnswers();
      ksRender();
    });
  } catch (err) {
    document.getElementById('loading').innerHTML =
      `<p style="padding:2rem;color:#c0392b">Could not load data: ${ksEsc(err.message)}</p>`;
  }
}

ksInit();
