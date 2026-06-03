// checklist.js — Feature scoring mode for Arhopala ID

const cs = {
  featureMatrix: null,    // Map<name, Map<questionText, choiceLabel>>
  questionMeta: null,     // Map<questionText, {choices: string[], hint: string}>
  questionCoverage: null, // Map<questionText, number> — species count using it
  questionNumbers: null,  // Map<questionText, number> — stable Q-numbers by DFS order
  resultNotes: null,      // Map<name, string>
  speciesInfo: null,      // Map<name, {common_name, inat_url}>
  answers: new Map(),     // Map<questionText, choiceLabel>
  scores: [],
  showAll: false,
  expandedName: null,     // species name currently expanded in detail panel
  questionOrder: null,    // stable display order; null = not yet initialised
};

// ── Tree utilities (mirrors app.js) ─────────────────────────────────────────

function buildQuestionNumbers(td) {
  const nodes = td.nodes;
  const numbers = new Map();
  let n = 0;
  const seen = new Set();
  function dfs(id) {
    if (seen.has(id)) return;
    const node = nodes[id];
    if (!node) return;
    seen.add(id);
    if (node.type === 'question') {
      if (!numbers.has(node.question)) numbers.set(node.question, ++n);
      for (const c of (node.choices || [])) if (c.next) dfs(c.next);
    } else if (node.type === 'group') {
      if (node.next) dfs(node.next);
    }
  }
  dfs(td.start);
  return numbers;
}

function buildTreePaths(td) {
  const nodes = td.nodes;
  const map = new Map();
  function dfs(id, path, vis) {
    if (vis.has(id)) return;
    const node = nodes[id];
    if (!node) return;
    const v2 = new Set(vis); v2.add(id);
    if (node.type === 'result') {
      const n = node.name || '';
      if (n) { if (!map.has(n)) map.set(n, []); map.get(n).push([...path]); }
      return;
    }
    if (node.type === 'question') {
      for (const c of (node.choices || []))
        if (c.next) dfs(c.next, [...path, { question: node.question, choice: c.label }], v2);
      return;
    }
    if (node.type === 'group' && node.next)
      dfs(node.next, [...path, { group: node.group_name }], v2);
  }
  dfs(td.start, [], new Set());
  return map;
}

// ── Data initialisation ──────────────────────────────────────────────────────

function initData(treeData, speciesData) {
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

  // Build feature matrix: canonical = shortest path with no Cannot-determine steps
  for (const [name, paths] of pathsMap) {
    const noSkip = paths.filter(p =>
      !p.some(s => s.choice && s.choice.startsWith('Cannot determine')));
    const pool = noSkip.length > 0 ? noSkip : paths;
    const canonical = pool.reduce((b, p) => (!b || p.length < b.length) ? p : b, null) || [];

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
    const resultNode = Object.values(treeData.nodes).find(
      n => n.type === 'result' && n.name === name && n.features);
    if (resultNode) {
      for (const [q, c] of Object.entries(resultNode.features)) {
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

function scoreAll() {
  if (cs.answers.size === 0) {
    cs.scores = [...cs.featureMatrix.keys()].map(n => ({ name: n, score: 0, max: 0 }));
    return;
  }
  cs.scores = [...cs.featureMatrix.entries()].map(([name, features]) => {
    let score = 0, max = 0;
    for (const [q, ans] of cs.answers) {
      if (ans.startsWith('Cannot determine')) continue; // treated as unanswered; no score effect
      max += 2;
      if (features.has(q)) score += features.get(q) === ans ? 2 : -1;
      // 0 if the question is not on this species' canonical path (not applicable)
    }
    return { name, score, max };
  }).sort((a, b) => {
    // Sort by match percentage (score/max) so species with fewer applicable
    // questions aren't disadvantaged vs species with longer canonical paths.
    // max=0 means no applicable questions were answered → treat as 0% (neutral).
    const pctA = a.max > 0 ? a.score / a.max : 0;
    const pctB = b.max > 0 ? b.score / b.max : 0;
    return pctB - pctA || a.name.localeCompare(b.name);
  });
}

// ── Question selection ───────────────────────────────────────────────────────

function getDisplayQuestions() {
  // Build diversity pool: all species tied at the leading score percentage.
  // A hard top-30 cut would exclude tied species alphabetically (e.g. ijanensis
  // at rank 47 when 70+ species all match Q1/Q2/Q4 at 100%), causing diagnostic
  // questions for those species to disappear from the list.
  let topNames;
  if (cs.answers.size === 0 || cs.scores.every(s => s.score === 0)) {
    topNames = [...cs.featureMatrix.keys()];
  } else {
    const topPct = cs.scores[0].max > 0 ? cs.scores[0].score / cs.scores[0].max : 0;
    topNames = cs.scores
      .filter(s => (s.max > 0 ? s.score / s.max : 0) >= topPct)
      .map(s => s.name);
  }

  // Build diversity map: question → set of distinct answers among top candidates
  // Also build filtered coverage: count of top candidates that have each question.
  const diversity = new Map();
  const filteredCov = new Map();
  for (const name of topNames) {
    for (const [q, c] of (cs.featureMatrix.get(name) || new Map())) {
      if (!diversity.has(q)) diversity.set(q, new Set());
      diversity.get(q).add(c);
      filteredCov.set(q, (filteredCov.get(q) || 0) + 1);
    }
  }

  const touched = q => cs.answers.has(q);

  // Candidate pool: touched questions + questions that still discriminate (≥2 distinct answers)
  const allQ = [...diversity.entries()]
    .filter(([q, choices]) => touched(q) || choices.size >= 2)
    .map(([q]) => q);
  const allQSet = new Set(allQ);

  // Sort helper for new questions: morphology before upperside, then by filtered coverage
  const newQSort = (a, b) => {
    const aUpper = /upperside/i.test(a);
    const bUpper = /upperside/i.test(b);
    if (aUpper !== bUpper) return aUpper ? 1 : -1;
    return (filteredCov.get(b) || 0) - (filteredCov.get(a) || 0);
  };

  if (!cs.questionOrder) {
    // First render: establish initial stable order
    cs.questionOrder = allQ.slice().sort(newQSort);
  } else {
    // Keep existing order; remove un-touched questions that are no longer relevant
    cs.questionOrder = cs.questionOrder.filter(q => touched(q) || allQSet.has(q));
    // Append any newly relevant questions at the end
    const existing = new Set(cs.questionOrder);
    const newQs = allQ.filter(q => !existing.has(q)).sort(newQSort);
    if (newQs.length) cs.questionOrder.push(...newQs);
  }

  return cs.questionOrder;
}

// ── Render ───────────────────────────────────────────────────────────────────

function esc(s) {
  return (s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Phrases in question text that link to Visual Guide sections
const GUIDE_LINKS = new Map([
  ['hindwing space 6', 'guide.html#hw-space6-basal-spot'],
  ['central spot in FW space 11', 'guide.html#fw-space-11'],
]);

function linkifyQ(text) {
  let html = esc(text);
  for (const [phrase, url] of GUIDE_LINKS) {
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
      ${note ? `<p class="cl-note">${esc(note)}</p>` : ''}
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
        ${esc(c)}
      </button>`;
    }).join('');

    const hintId = `hint-${idx}`;
    const hintHTML = meta.hint
      ? `<details class="cl-hint" id="${hintId}">
           <summary>Hint</summary>
           <p>${esc(meta.hint)}</p>
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
  const btn = e.target.closest('.cl-cbtn');
  if (!btn) return;
  const q = btn.dataset.q;
  const c = btn.dataset.c;
  // Toggle: clicking the selected choice clears it
  if (cs.answers.get(q) === c) {
    cs.answers.delete(q);
  } else {
    cs.answers.set(q, c);
  }
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
      fetch('data/tree.json').then(r => { if (!r.ok) throw new Error('tree.json'); return r.json(); }),
      fetch('data/species.json').then(r => { if (!r.ok) throw new Error('species.json'); return r.json(); }),
    ]);

    initData(treeData, speciesData);
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
      cs.showAll = false;
      cs.expandedName = null;
      cs.questionOrder = null;
      render();
    });
  } catch (err) {
    document.getElementById('loading').innerHTML =
      `<p style="padding:2rem;color:#c0392b">Could not load data: ${esc(err.message)}</p>`;
  }
}

init();
