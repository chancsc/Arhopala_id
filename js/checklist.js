// checklist.js — Feature scoring mode for Arhopala ID

const cs = {
  featureMatrix: null,    // Map<name, Map<questionText, choiceLabel>>
  questionMeta: null,     // Map<questionText, {choices: string[], hint: string}>
  questionCoverage: null, // Map<questionText, number> — species count using it
  questionNumbers: null,  // Map<questionText, number> — stable Q-numbers by DFS order
  resultNotes: null,      // Map<name, string>
  speciesInfo: null,      // Map<name, {common_name, inat_url}>
  treeNodes: null,        // raw nodes map from tree.json — used for CD-followup lookup
  answers: new Map(),     // Map<questionText, choiceLabel>
  everAnswered: new Set(), // Set<questionText> — answered at least once this session (even if since toggled off)
  scores: [],
  showAll: false,
  expandedName: null,     // species name currently expanded in detail panel
  questionOrder: null,    // stable display order; null = not yet initialised
  positionMemo: new Map(), // Map<questionText, number> — last known index before a question was pruned for irrelevance, so it can be restored near its old spot if it becomes relevant again
};

// buildTreePaths, buildQuestionNumbers, pathScore, pickCanonicalPath etc. live in path-utils.js

// ── Persistence ──────────────────────────────────────────────────────────────
// Mobile browsers often discard a backgrounded tab and reload it from scratch
// when the user switches back, which would otherwise wipe the in-memory
// answers Map. Persist to localStorage so selections survive that — they only
// go away when the user explicitly hits Reset.

const ANSWERS_KEY = 'arhopala-cl-answers';

function saveAnswers() {
  try {
    localStorage.setItem(ANSWERS_KEY, JSON.stringify([...cs.answers]));
  } catch (e) { /* storage unavailable (private mode, quota, etc.) — ignore */ }
}

function loadAnswers() {
  try {
    const raw = localStorage.getItem(ANSWERS_KEY);
    if (!raw) return new Map();
    const pairs = JSON.parse(raw);
    if (!Array.isArray(pairs)) return new Map();
    // Drop entries whose question/choice no longer exist in the current tree
    // (e.g. after a data update) so stale storage can't corrupt scoring.
    return new Map(pairs.filter(([q, c]) => {
      const meta = cs.questionMeta.get(q);
      return meta && meta.choices.includes(c);
    }));
  } catch (e) {
    return new Map();
  }
}

function clearSavedAnswers() {
  try { localStorage.removeItem(ANSWERS_KEY); } catch (e) { /* ignore */ }
}

// ── Data initialisation ──────────────────────────────────────────────────────

function initData(treeData, speciesData) {
  cs.treeNodes = treeData.nodes;
  const pathsMap = buildTreePaths(treeData);
  const matrix = new Map();
  const qMeta = new Map();
  const qCov = new Map();
  const resultNotes = new Map();

  // Collect question metadata; merge choices when the same question text appears
  // in multiple subtrees
  for (const node of Object.values(treeData.nodes)) {
    if (node.type === 'question') {
      const allChoices = node.choices.map(c => c.label);
      if (!qMeta.has(node.question)) {
        qMeta.set(node.question, { choices: allChoices, hint: node.hint || '' });
      } else {
        const existing = qMeta.get(node.question);
        for (const l of allChoices)
          if (!existing.choices.includes(l)) existing.choices.push(l);
      }
    }
    if (node.type === 'result' && node.name)
      resultNotes.set(node.name, node.note || '');
  }

  // Build species info lookup
  const sp2Map = new Map();
  for (const s of speciesData.species) {
    sp2Map.set(s.name.split(' ').slice(0, 2).join(' '), s);
  }
  const spInfo = new Map();

  // Build feature matrix using pickCanonicalPath from path-utils.js —
  // guaranteed to match the canonical path shown in the ID-key display.
  const resultFeaturesMap = new Map();
  for (const node of Object.values(treeData.nodes)) {
    if (node.type === 'result' && node.name && node.features)
      resultFeaturesMap.set(node.name, node.features);
  }

  for (const [name, paths] of pathsMap) {
    const note = resultNotes.get(name) || '';
    const rf = resultFeaturesMap.get(name) || {};
    const canonical = pickCanonicalPath(paths, note, rf) || [];

    const features = new Map();
    const covSeen = new Set();
    for (const step of canonical) {
      if (step.question && step.choice && !step.choice.startsWith('Cannot determine')) {
        features.set(step.question, step.choice);
        if (!covSeen.has(step.question)) {
          covSeen.add(step.question);
          qCov.set(step.question, (qCov.get(step.question) || 0) + 1);
        }
      }
    }
    // Merge explicit features from result node.
    // "Cannot determine" values neutralise that question for this species (remove from scoring).
    // All other values override or add features — explicit features take precedence over
    // the canonical path answer (e.g. to correct a DFS-order artefact).
    if (Object.keys(rf).length > 0) {
      for (const [q, c] of Object.entries(rf)) {
        if (c.startsWith('Cannot determine')) {
          features.delete(q);
        } else {
          if (!features.has(q)) qCov.set(q, (qCov.get(q) || 0) + 1);
          features.set(q, c);
        }
      }
    }

    matrix.set(name, features);

    const sp2 = name.split(' ').slice(0, 2).join(' ');
    const sp = sp2Map.get(sp2);
    spInfo.set(name, {
      common_name: sp ? (sp.common_name || '') : '',
      inat_url: sp ? sp.inat_url : `https://www.inaturalist.org/search?q=${encodeURIComponent(sp2)}`,
    });
  }

  cs.featureMatrix = matrix;
  cs.questionMeta = qMeta;
  cs.questionCoverage = qCov;
  cs.questionNumbers = buildQuestionNumbers(treeData);
  cs.resultNotes = resultNotes;
  cs.speciesInfo = spInfo;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

// Thin wrapper: delegates to scoreAllPure() in path-utils.js.
function scoreAll() {
  cs.scores = scoreAllPure(cs.answers, cs.featureMatrix);
}

// ── Question selection ───────────────────────────────────────────────────────

// Thin wrapper: delegates to getDisplayQuestionsPure() in path-utils.js so the
// browser and the Node.js sim script share exactly one implementation.
function getDisplayQuestions() {
  if (!cs.questionOrder) cs.questionOrder = [];
  getDisplayQuestionsPure(cs.answers, cs.scores, cs.featureMatrix, cs.treeNodes, cs.questionOrder, cs.everAnswered, cs.positionMemo);
  return cs.questionOrder;
}

// ── Render ───────────────────────────────────────────────────────────────────

function esc(s) {
  return (s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s) {
  return (s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderHint(str) {
  if (!str) return '';
  const re = /\[([^\]]+)\]\((https:\/\/[^)]+)\)/g;
  const out = [];
  let last = 0, m;
  while ((m = re.exec(str)) !== null) {
    out.push(esc(str.slice(last, m.index)));
    out.push(`<a href="${escAttr(m[2])}" target="_blank" rel="noopener">${esc(m[1])}</a>`);
    last = m.index + m[0].length;
  }
  out.push(esc(str.slice(last)));
  return out.join('');
}

// Phrases in question text that link to Visual Guide sections
const GUIDE_LINKS = new Map([
  ['hindwing space 6', 'guide.html#hw-space6-basal-spot'],
  ['extreme base of forewing underside space 10', 'guide.html#fw-space10-base-spot'],
  ['spot at the base of FW space 10', 'guide.html#fw-space10-base-spot'],
  ['forewing underside space 10', 'guide.html#fw-spots'],
  ['costal spot in forewing space 10', 'guide.html#fw-spots'],
  ['forewing postdiscal spot in space 9', 'guide.html#fw-spots'],
  ['forewing underside space 11', 'guide.html#fw-space-11'],
  ['forewing space 11', 'guide.html#fw-space-11'],
  ['FW space 11', 'guide.html#fw-space-11'],
  ['3 spots in space 11', 'guide.html#fw-space-11'],
  ['position of postdiscal spot 6 relative to the postdiscal row and the end-cell bar', 'guide.html#hw-spot6-position'],
  ['HW postdiscal spot 6 overlap the end-cell bar', 'guide.html#hw-spot6-position'],
  ['postdiscal spot 6 widely overlap the end-cell bar', 'guide.html#hw-spot6-position'],
  ['position of the hindwing postdiscal spot 6', 'guide.html#hw-spot6-position'],
  ['postdiscal spot 6', 'guide.html#spot6-end-cell-bar'],
  ['forming a straight line', 'guide.html#spot6-end-cell-bar'],
  ['postdiscal spot in space 6', 'guide.html#hw-spot6-position'],
  ['not in echelon with spots 5 and 7', 'guide.html#hw-spot6-position'],
  ['gap between spot 5 and the end-cell bar', 'guide.html#hw-spot6-position'],
  ['widely out of line — with the inner edge of spot 6 in line with or inside the inner edge of spot 7, and spot 6 touching or overlapping the end-cell bar', 'guide.html#hw-spot6-position'],
  ['echelon HW spots 5–7', 'guide.html#hw-tail-spots-fw-spaces'],
  ['5-6-7 echelon', 'guide.html#hw-tail-spots-fw-spaces'],
  ['postdiscal spot 4', 'guide.html#fw-spot4-distad'],
  ['FW postdiscal spot in space 4 shifted distad (out of line)', 'guide.html#fw-spot4-distad'],
  ['spots above the forewing cell', 'guide.html#fw-spots-above-cell'],
  ['weak tooth at vein 2', 'guide.html#wing-regions'],
  ['inner submarginal spots', 'guide.html#wing-regions'],
  ['hindwing underside central cell spot', 'guide.html#hw-central-cell-spot'],
  ['gap between the outer and central spots in hindwing space 7', 'guide.html#wing-spaces'],
  ['shifted distad (outward, out of line with spots 5 and 6)', 'guide.html#fw-spot4-distad'],
  ['dislocated at vein 4', 'guide.html#fw-band-vein4'],
  ['tail located at vein 3', 'guide.html#tail-vein2-vs-vein3'],
  ['very rounded tornus, and are tornal green scales absent', 'guide.html#hw-tornus-rounded'],
  ['cell spots on the forewing underside outlined in greenish silver', 'guide.html#fw-cell-silver'],
]);

const MD_LINK_RE = /\[([^\]]+)\]\((https:\/\/[^)]+)\)/g;

function linkifyQ(text) {
  const claimed = [];
  let m;
  MD_LINK_RE.lastIndex = 0;
  while ((m = MD_LINK_RE.exec(text)) !== null) {
    claimed.push({
      start: m.index,
      end: m.index + m[0].length,
      html: `<a href="${escAttr(m[2])}" target="_blank" rel="noopener">${esc(m[1])}</a>`,
    });
  }
  for (const [phrase, url] of GUIDE_LINKS) {
    const start = text.indexOf(phrase);
    if (start === -1) continue;
    const end = start + phrase.length;
    if (claimed.some(r => start < r.end && end > r.start)) continue;
    claimed.push({ start, end, html: `<a href="${url}" class="guide-link" target="_blank" rel="noopener">${esc(phrase)}</a>` });
  }
  claimed.sort((a, b) => a.start - b.start);
  let html = '', last = 0;
  for (const r of claimed) {
    html += esc(text.slice(last, r.start));
    html += r.html;
    last = r.end;
  }
  html += esc(text.slice(last));
  return html;
}

// Phrases in choice labels that link out — to iNaturalist (species) or to
// Visual Guide sections (feature descriptions)
const CHOICE_LINKS = new Map([
  ['A. corinda', 'https://www.inaturalist.org/search?q=Arhopala+corinda'],
  ['A. overdijkinki', 'https://www.inaturalist.org/observations?verifiable=true&taxon_id=1390509&preferred_place_id=6734'],
  ['A. aedias', 'https://www.inaturalist.org/observations?verifiable=true&taxon_id=498179&preferred_place_id=6734'],
  ['A. delta', 'https://www.inaturalist.org/observations?verifiable=true&taxon_id=896391&preferred_place_id=6734'],
  ['A. kurzi', 'https://www.inaturalist.org/observations?verifiable=true&taxon_id=1149928&preferred_place_id=6734'],
  ['A. avathina avathina', 'https://www.inaturalist.org/observations?verifiable=true&taxon_id=888416&preferred_place_id=6734'],
  ['A. alica', 'https://www.inaturalist.org/observations?verifiable=true&taxon_id=1495881&preferred_place_id=6734'],
  ['A. labuana', 'https://www.inaturalist.org/search?q=Arhopala+labuana'],
  ['A. norda', 'https://www.inaturalist.org/observations?verifiable=true&taxon_id=887831&preferred_place_id=6734'],
  ['A. amphimuta', 'https://www.inaturalist.org/observations?verifiable=true&taxon_id=498183&preferred_place_id=6734'],
  ['A. major', 'https://www.inaturalist.org/observations?verifiable=true&taxon_id=429756&preferred_place_id=6734'],
  ['A. moolaiana', 'https://www.inaturalist.org/observations?verifiable=true&taxon_id=549326&preferred_place_id=6734'],
  ['A. stubbsi', 'https://www.inaturalist.org/search?q=Arhopala+stubbsi'],
  ['A. zylda', 'https://www.inaturalist.org/observations?verifiable=true&taxon_id=1340244&preferred_place_id=6734'],
  ['A. sceva', 'https://www.inaturalist.org/observations?verifiable=true&taxon_id=888422&preferred_place_id=6734'],
  ['A. baluensis', 'https://www.inaturalist.org/observations?verifiable=true&taxon_id=888417&preferred_place_id=6734'],
  ['central cell spot is band-like, stretching entirely across the cell', 'guide.html#hw-central-cell-spot'],
  ["spot 6 is displaced above spot 5's level toward the end-cell bar", 'guide.html#spot6-upward-endcell'],
]);

function linkifyChoice(text) {
  let html = esc(text);
  for (const [phrase, url] of CHOICE_LINKS) {
    html = html.replace(esc(phrase),
      `<a href="${url}" class="guide-link" target="_blank" rel="noopener">${esc(phrase)}</a>`);
  }
  return html;
}


function renderCandidates() {
  const listEl = document.getElementById('cl-candidates');
  const detailEl = document.getElementById('cl-detail');

  if (cs.answers.size === 0) {
    listEl.innerHTML = '<p class="cl-empty">Answer questions below to rank candidates.</p>';
    detailEl.style.display = 'none';
    return;
  }

  const top = cs.scores.slice(0, 8);
  const medals = ['🥇', '🥈', '🥉'];

  listEl.innerHTML = top.map((s, i) => {
    const info = cs.speciesInfo.get(s.name) || {};
    const barW = s.max > 0 ? Math.round(Math.max(0, s.score) / s.max * 100) : 0;
    const isExpanded = cs.expandedName === s.name;
    const inatHref = info.inat_url ? esc(info.inat_url) : '';
    return `
      <div class="cl-cand${isExpanded ? ' expanded' : ''}" data-name="${esc(s.name)}">
        <div class="cl-cand-row" role="button" tabindex="0" aria-expanded="${isExpanded}">
          <span class="cl-rank">${medals[i] || i + 1}</span>
          <span class="cl-cname">
            <em class="cl-sci">${esc(s.name)}</em>
            ${info.common_name ? `<span class="cl-common">${esc(info.common_name)}</span>` : ''}
          </span>
          <span class="cl-bar-wrap">
            <span class="cl-bar-bg">
              <span class="cl-bar${s.score < 0 ? ' neg' : ''}" style="width:${barW}%"></span>
            </span>
            <span class="cl-score-num${s.score < 0 ? ' neg' : ''}">${s.score > 0 ? '+' : ''}${s.score}</span>
          </span>
          ${inatHref ? `<a class="cl-inat-icon" href="${inatHref}" target="_blank" rel="noopener" title="View on iNaturalist" aria-label="View ${esc(s.name)} on iNaturalist">🔗</a>` : ''}
        </div>
        ${isExpanded ? renderCandidateDetail(s.name) : ''}
      </div>`;
  }).join('');

  // If expanded candidate fell off top-8, collapse it
  if (cs.expandedName && !top.some(s => s.name === cs.expandedName)) {
    cs.expandedName = null;
  }
}

function renderCandidateDetail(name) {
  const note = cs.resultNotes.get(name) || '';
  const info = cs.speciesInfo.get(name) || {};
  return `
    <div class="cl-cand-detail">
      ${note ? `<p class="cl-note">${renderHint(note)}</p>` : ''}
      <a class="cl-inat-link" href="${esc(info.inat_url)}" target="_blank" rel="noopener">
        View on iNaturalist →
      </a>
    </div>`;
}

function renderQuestions() {
  const el = document.getElementById('cl-questions');
  const qs = getDisplayQuestions();

  // Show questions in their stable order. Cap the unanswered tail at 15 so the
  // initial list isn't overwhelming; answered questions are always shown regardless.
  const unansweredSeen = [];
  const visible = qs.filter(q => {
    if (cs.answers.has(q)) return true;
    unansweredSeen.push(q);
    return cs.showAll || unansweredSeen.length <= 15;
  });
  const unansweredQs = qs.filter(q => !cs.answers.has(q));

  el.innerHTML = visible.map((q, idx) => {
    const meta = cs.questionMeta.get(q) || { choices: [], hint: '' };
    const sel = cs.answers.get(q) || null;

    const btns = meta.choices.map(c => {
      const isCD = c.startsWith('Cannot determine');
      return `<button class="cl-cbtn${sel === c ? ' sel' : ''}${isCD ? ' cd' : ''}"
              data-q="${esc(q)}" data-c="${esc(c)}"
              title="${esc(c)}">
        ${linkifyChoice(c)}
      </button>`;
    }).join('');

    const hintId = `hint-${idx}`;
    const hintHTML = meta.hint
      ? `<details class="cl-hint" id="${hintId}">
           <summary>Hint</summary>
           <p>${renderHint(meta.hint)}</p>
         </details>`
      : '';

    const qNum = cs.questionNumbers && cs.questionNumbers.has(q)
      ? `<span class="cl-qnum">Q${cs.questionNumbers.get(q)}</span> `
      : '';
    return `
      <div class="cl-q${sel ? ' answered' : ''}">
        <p class="cl-qtext">${qNum}${linkifyQ(q)}</p>
        ${hintHTML}
        <div class="cl-choices">${btns}</div>
      </div>`;
  }).join('');

  if (unansweredQs.length > 15) {
    el.insertAdjacentHTML('beforeend', `
      <button class="cl-more" id="cl-show-more">
        ${cs.showAll ? '▲ Show fewer' : `▼ Show all ${unansweredQs.length} features`}
      </button>`);
  }
}

function render() {
  scoreAll();
  renderCandidates();
  renderQuestions();

  // Update answered-count badge
  const badge = document.getElementById('cl-answered-count');
  const meaningful = [...cs.answers.values()].filter(v => !v.startsWith('Cannot determine')).length;
  if (badge) badge.textContent = meaningful > 0
    ? `${meaningful} feature${meaningful !== 1 ? 's' : ''} marked`
    : '';
}

// ── Event handlers ───────────────────────────────────────────────────────────

function onQuestionClick(e) {
  if (e.target.id === 'cl-show-more' || e.target.closest('#cl-show-more')) {
    cs.showAll = !cs.showAll;
    renderQuestions();
    return;
  }
  // Let embedded iNaturalist links navigate without toggling the choice
  if (e.target.closest('a')) return;
  const btn = e.target.closest('.cl-cbtn');
  if (!btn) return;
  const q = btn.dataset.q;
  const c = btn.dataset.c;
  // Toggle: clicking the selected choice clears it
  if (cs.answers.get(q) === c) {
    cs.answers.delete(q);
    // Force a fresh sort: getDisplayQuestionsPure only appends newly-relevant
    // questions at the tail of the existing order, so questions that were
    // filtered out while this answer was set would otherwise reappear at the
    // bottom instead of their natural sorted position.
    cs.questionOrder = null;
  } else {
    cs.answers.set(q, c);
    cs.everAnswered.add(q);
  }
  saveAnswers();
  render();
}

function onCandidateClick(e) {
  if (e.target.closest('.cl-inat-icon')) return;
  const row = e.target.closest('.cl-cand-row');
  if (!row) return;
  const cand = row.closest('.cl-cand');
  if (!cand) return;
  const name = cand.dataset.name;
  cs.expandedName = cs.expandedName === name ? null : name;
  renderCandidates();
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const [treeData, speciesData] = await Promise.all([
      fetch('data/tree.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('tree.json'); return r.json(); }),
      fetch('data/species.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('species.json'); return r.json(); }),
    ]);

    initData(treeData, speciesData);
    cs.answers = loadAnswers();
    cs.everAnswered = new Set(cs.answers.keys());
    render();

    document.getElementById('loading').style.display = 'none';
    document.getElementById('cl-app').style.display = 'block';

    document.getElementById('cl-questions').addEventListener('click', onQuestionClick);
    document.getElementById('cl-candidates').addEventListener('click', onCandidateClick);
    document.getElementById('cl-candidates').addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') onCandidateClick(e);
    });
    document.getElementById('cl-reset').addEventListener('click', () => {
      cs.answers.clear();
      cs.everAnswered.clear();
      cs.showAll = false;
      cs.expandedName = null;
      cs.questionOrder = null;
      cs.positionMemo.clear();
      clearSavedAnswers();
      render();
    });
  } catch (err) {
    document.getElementById('loading').innerHTML =
      `<p style="padding:2rem;color:#c0392b">Could not load data: ${esc(err.message)}</p>`;
  }
}

init();
