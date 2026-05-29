const state = {
  tree: null,
  species: null,       // Map<taxon_id (number), species object>
  speciesIndex: [],    // [{name, common_name, note, taxon_photos, inat_url}] sorted A-Z
  currentNodeId: null,
  history: []          // [{ nodeId, choiceLabel }, ...]
};

const ESTIMATED_MAX_DEPTH = 8;

// ===== Init =====

async function init() {
  const loadingEl = document.getElementById('loading');
  const appEl = document.getElementById('app');

  try {
    const [treeRes, speciesRes] = await Promise.all([
      fetch('data/tree.json'),
      fetch('data/species.json')
    ]);

    if (!treeRes.ok || !speciesRes.ok) throw new Error('Failed to load data files');

    const [treeData, speciesData] = await Promise.all([
      treeRes.json(),
      speciesRes.json()
    ]);

    state.tree = treeData;
    state.species = new Map(speciesData.species.map(s => [s.id, s]));
    state.speciesIndex = buildSpeciesIndex(treeData, speciesData);
    state.currentNodeId = treeData.start;
    state.history = [];

    loadingEl.style.display = 'none';
    appEl.style.display = 'block';
    render();
    initMenuListeners();
  } catch (err) {
    loadingEl.style.display = 'none';
    appEl.style.display = 'block';
    appEl.innerHTML = renderErrorCard('Could not load identification data. Please refresh the page.');
  }
}

// DFS from tree root; builds Map<resultName, Array<path>> where each path is
// an array of {question, choice} steps (group milestones are noted inline).
function buildTreePaths(treeData) {
  const nodes = treeData.nodes;
  const pathsMap = new Map();

  function dfs(nodeId, path, visited) {
    if (visited.has(nodeId)) return;
    const node = nodes[nodeId];
    if (!node) return;

    const vis2 = new Set(visited);
    vis2.add(nodeId);

    if (node.type === 'result') {
      const name = node.name || '';
      if (name) {
        if (!pathsMap.has(name)) pathsMap.set(name, []);
        pathsMap.get(name).push([...path]);
      }
      return;
    }

    if (node.type === 'question') {
      for (const c of (node.choices || [])) {
        if (c.next) dfs(c.next, [...path, { question: node.question, choice: c.label }], vis2);
      }
      return;
    }

    if (node.type === 'group') {
      const step = { group: node.group_name };
      if (node.next) dfs(node.next, [...path, step], vis2);
    }
  }

  dfs(treeData.start, [], new Set());
  return pathsMap;
}

// Build a flat sorted array of all result nodes enriched with species photo/url data
function buildSpeciesIndex(treeData, speciesData) {
  const seen = new Set();
  const index = [];
  const pathsMap = buildTreePaths(treeData);

  for (const node of Object.values(treeData.nodes)) {
    if (node.type !== 'result') continue;
    const name = node.name || '';
    if (!name || seen.has(name)) continue;
    seen.add(name);

    // Match species entry by first two words (genus + species)
    const sp2 = name.split(' ').slice(0, 2).join(' ');
    let spData = null;
    for (const s of speciesData.species) {
      if (s.name.split(' ').slice(0, 2).join(' ') === sp2) { spData = s; break; }
    }

    // For tailless species, sort so tailless-branch paths come first.
    // buildPathDisplay then picks the lowest-score path, which will be the tailless one.
    let paths = pathsMap.get(name) || [];
    if ((node.note || '').includes('Tailless')) {
      paths = [...paths].sort((a, b) => {
        const aOk = a.length > 0 && (a[0].choice || '').toLowerCase().includes('tailless');
        const bOk = b.length > 0 && (b[0].choice || '').toLowerCase().includes('tailless');
        return (bOk ? 1 : 0) - (aOk ? 1 : 0);
      });
    }

    index.push({
      name,
      common_name: node.common_name || (spData && spData.common_name) || '',
      note: node.note || '',
      taxon_photos: (spData && spData.taxon_photos) || [],
      inat_url: (spData && spData.inat_url)
        || `https://www.inaturalist.org/search?q=${encodeURIComponent(sp2)}`,
      paths
    });
  }

  return index.sort((a, b) => a.name.localeCompare(b.name));
}

// ===== Main render =====

function render() {
  const appEl = document.getElementById('app');
  const node = state.tree.nodes[state.currentNodeId];

  if (!node) {
    appEl.innerHTML = renderErrorCard(`Unknown node: "${state.currentNodeId}". Please restart.`);
    return;
  }

  const breadcrumbHTML = buildBreadcrumb();
  const progressHTML = buildProgressBar();

  let bodyHTML;
  if (node.type === 'question') {
    bodyHTML = renderQuestion(node);
  } else if (node.type === 'result') {
    bodyHTML = renderResult(node);
  } else if (node.type === 'group') {
    bodyHTML = renderGroup(node);
  } else {
    bodyHTML = renderErrorCard(`Unknown node type: "${node.type}"`);
  }

  appEl.innerHTML = `
    <div class="app-header">
      <div class="header-row">
        <div class="header-titles">
          <h1>Arhopala Identifier</h1>
          <p>Malaysian Oak Blue Butterflies</p>
        </div>
        <button class="menu-btn" id="menu-btn" aria-label="Open species search">
          ${iconMenu()}
        </button>
      </div>
    </div>
    ${breadcrumbHTML}
    ${progressHTML}
    ${bodyHTML}
  `;

  // Attach event listeners after render
  const menuBtn = appEl.querySelector('#menu-btn');
  if (menuBtn) menuBtn.addEventListener('click', openMenu);

  const backBtn = appEl.querySelector('.back-btn');
  if (backBtn) backBtn.addEventListener('click', handleBack);

  const restartBtn = appEl.querySelector('.btn-restart');
  if (restartBtn) restartBtn.addEventListener('click', restart);

  const choicesEl = appEl.querySelector('.choices');
  if (choicesEl) {
    choicesEl.addEventListener('click', e => {
      const btn = e.target.closest('.choice-btn');
      if (btn) handleChoice(btn.dataset.label, btn.dataset.next);
    });
  }

  const speciesIdBtn = appEl.querySelector('.btn-species-id');
  if (speciesIdBtn) {
    speciesIdBtn.addEventListener('click', () => {
      handleChoice('Identify to species', speciesIdBtn.dataset.next);
    });
  }
}

// ===== Node renderers =====

function renderQuestion(node) {
  const hintHTML = node.hint
    ? `<p class="question-hint">${escapeHtml(node.hint)}</p>`
    : '';

  const choicesHTML = node.choices
    .map(c => `<button class="choice-btn" data-label="${escapeAttr(c.label)}" data-next="${escapeAttr(c.next)}">${escapeHtml(c.label)}</button>`)
    .join('');

  return `
    <div class="card">
      ${buildBackButton()}
      <h2 class="question-text">${escapeHtml(node.question)}</h2>
      ${hintHTML}
      <div class="choices">${choicesHTML}</div>
    </div>
  `;
}

function renderResult(node) {
  const species = node.taxon_id ? state.species.get(node.taxon_id) : null;

  const commonName = (species && species.common_name) || node.common_name
    || (species && species.name) || node.name || 'Unknown Species';
  const sciName = (species && species.name) || node.name || '';
  const inatUrl = (species && species.inat_url)
    || (node.taxon_id ? `https://www.inaturalist.org/taxa/${node.taxon_id}` : null)
    || `https://www.inaturalist.org/search?q=${encodeURIComponent(sciName || 'Arhopala')}`;

  const noteHTML = node.note
    ? `<div class="id-note">${escapeHtml(node.note)}</div>`
    : '';

  const galleryHTML = buildPhotoGallery(species);

  return `
    <div class="card card--result">
      ${buildBackButton()}
      <span class="result-badge">Identification</span>
      <h2 class="species-common">${escapeHtml(commonName)}</h2>
      ${sciName ? `<p class="species-name">${escapeHtml(sciName)}</p>` : ''}
      ${noteHTML}
      ${galleryHTML}
      <div class="action-row">
        <a class="btn-inat" href="${escapeAttr(inatUrl)}" target="_blank" rel="noopener noreferrer">
          ${iconExternal()} View on iNaturalist
        </a>
        <button class="btn-restart">
          ${iconRestart()} Start Over
        </button>
      </div>
    </div>
  `;
}

function renderGroup(node) {
  const featuresHTML = node.key_features && node.key_features.length
    ? `<ul class="key-features">${node.key_features.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`
    : '';

  const continueOrPending = node.next
    ? `<button class="btn-species-id" data-next="${escapeAttr(node.next)}">
         Identify to species ${iconArrowRight()}
       </button>`
    : `<div class="species-pending">
         ${iconPending()} Species-level keys for this group will be added in the next update.
       </div>`;

  return `
    <div class="card card--group">
      ${buildBackButton()}
      <span class="result-badge result-badge--group">Group Identified</span>
      <h2 class="species-common">${escapeHtml(node.group_name)}</h2>
      <p class="group-description">${escapeHtml(node.description)}</p>
      ${featuresHTML}
      ${continueOrPending}
      <div class="action-row">
        <button class="btn-restart">
          ${iconRestart()} Start Over
        </button>
      </div>
    </div>
  `;
}

// ===== Hamburger menu =====

function initMenuListeners() {
  const overlay  = document.getElementById('menu-overlay');
  const closeBtn = document.getElementById('menu-close');
  const backBtn  = document.getElementById('back-to-search');
  const input    = document.getElementById('search-input');
  const results  = document.getElementById('search-results');

  // Close on backdrop click or close button
  closeBtn.addEventListener('click', closeMenu);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });

  // Keyboard: Escape closes
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeMenu();
  });

  // Tab switching
  document.getElementById('tab-search').addEventListener('click', () => switchMenuTab('search'));
  document.getElementById('tab-about').addEventListener('click',  () => switchMenuTab('about'));

  // Live search
  let debounceTimer;
  input.addEventListener('input', e => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => renderSearchList(e.target.value), 120);
  });

  // Tap a result → show detail
  results.addEventListener('click', e => {
    const btn = e.target.closest('.search-item');
    if (!btn) return;
    const sp = state.speciesIndex.find(s => s.name === btn.dataset.name);
    if (sp) showSpeciesDetail(sp);
  });

  // Back from detail to search list
  backBtn.addEventListener('click', () => {
    switchMenuTab('search');
    document.getElementById('species-detail').style.display = 'none';
    backBtn.style.display = 'none';
  });
}

function switchMenuTab(tab) {
  const searchPane  = document.getElementById('search-pane');
  const aboutPane   = document.getElementById('about-pane');
  const tabSearch   = document.getElementById('tab-search');
  const tabAbout    = document.getElementById('tab-about');
  const menuTitle   = document.getElementById('menu-title');

  // Always dismiss species detail when switching tabs
  document.getElementById('species-detail').style.display = 'none';
  document.getElementById('back-to-search').style.display = 'none';

  if (tab === 'search') {
    searchPane.style.display = '';
    aboutPane.style.display  = 'none';
    tabSearch.classList.add('active');
    tabSearch.setAttribute('aria-selected', 'true');
    tabAbout.classList.remove('active');
    tabAbout.setAttribute('aria-selected', 'false');
    menuTitle.textContent = 'Species Search';
  } else {
    searchPane.style.display = 'none';
    aboutPane.style.display  = '';
    tabAbout.classList.add('active');
    tabAbout.setAttribute('aria-selected', 'true');
    tabSearch.classList.remove('active');
    tabSearch.setAttribute('aria-selected', 'false');
    menuTitle.textContent = 'About';
  }
}

function openMenu() {
  const overlay = document.getElementById('menu-overlay');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  // Reset to search tab
  switchMenuTab('search');
  document.getElementById('species-detail').style.display = 'none';
  document.getElementById('back-to-search').style.display = 'none';
  // Render full list and focus input
  renderSearchList(document.getElementById('search-input').value);
  setTimeout(() => document.getElementById('search-input').focus(), 150);
}

function closeMenu() {
  document.getElementById('menu-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function renderSearchList(query) {
  const q = (query || '').trim().toLowerCase();
  const countEl  = document.getElementById('search-count');
  const resultsEl = document.getElementById('search-results');

  const matches = q
    ? state.speciesIndex.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.common_name && s.common_name.toLowerCase().includes(q)))
    : state.speciesIndex;

  countEl.textContent = q
    ? `${matches.length} match${matches.length !== 1 ? 'es' : ''}`
    : `${state.speciesIndex.length} species`;

  if (matches.length === 0) {
    resultsEl.innerHTML = `<p class="search-empty">No species found for "${escapeHtml(query)}"</p>`;
    return;
  }

  resultsEl.innerHTML = matches.map(s => `
    <button class="search-item" role="listitem" data-name="${escapeAttr(s.name)}">
      <span class="search-item-sci">${escapeHtml(s.name)}</span>
      ${s.common_name ? `<span class="search-item-common">${escapeHtml(s.common_name)}</span>` : ''}
    </button>
  `).join('');
}

function showSpeciesDetail(sp) {
  document.getElementById('search-pane').style.display = 'none';
  document.getElementById('about-pane').style.display = 'none';
  document.getElementById('back-to-search').style.display = '';

  const detailEl = document.getElementById('species-detail');
  detailEl.style.display = 'block';
  detailEl.scrollTop = 0;

  const noteHTML = sp.note
    ? `<div class="id-note">${escapeHtml(sp.note)}</div>`
    : '';

  const galleryHTML = buildPhotoGallery(sp);
  const pathHTML = buildPathDisplay(sp.paths);

  detailEl.innerHTML = `
    <span class="result-badge">Species Info</span>
    <h2 class="species-common">${escapeHtml(sp.common_name || sp.name)}</h2>
    ${sp.common_name ? `<p class="species-name">${escapeHtml(sp.name)}</p>` : ''}
    ${noteHTML}
    ${pathHTML}
    ${galleryHTML}
    <a class="btn-inat" href="${escapeAttr(sp.inat_url)}" target="_blank" rel="noopener noreferrer">
      ${iconExternal()} View on iNaturalist
    </a>
  `;
}

function buildPathDisplay(paths) {
  if (!paths || paths.length === 0) return '';

  // Canonical path: fewest "Cannot determine" choices.
  // Contradiction penalty: starting "Yes — tailed" but later hitting a "Tailless" choice.
  const skipCount = p => {
    let score = p.filter(s => s.choice && s.choice.startsWith('Cannot determine')).length;
    const startsTailed = p.length > 0 && p[0].choice === 'Yes — hindwing is tailed';
    const hasContradiction = p.some(s => s.choice && /^Tailless[;,\s]/.test(s.choice));
    if (startsTailed && hasContradiction) score += 100;
    return score;
  };

  const renderSteps = path => path.map(step => {
    if (step.group) {
      return `<li class="path-step path-step--group"><span class="path-group">● ${escapeHtml(step.group)}</span></li>`;
    }
    const isCd = step.choice && step.choice.startsWith('Cannot determine');
    return `
      <li class="path-step${isCd ? ' path-step--skip' : ''}">
        <span class="path-q">${escapeHtml(step.question)}</span>
        <span class="path-a">↳ ${escapeHtml(step.choice)}</span>
      </li>`;
  }).join('');

  const sorted = [...paths].sort((a, b) => skipCount(a) - skipCount(b));
  const canonical = sorted[0];

  // Fallback path: most "Cannot determine" steps, no contradiction.
  const validPaths = sorted.filter(p => skipCount(p) < 100);
  const fallback = validPaths.length > 1 ? validPaths[validPaths.length - 1] : null;
  const showFallback = fallback && JSON.stringify(fallback) !== JSON.stringify(canonical);

  let html = `
    <details class="path-details">
      <summary class="path-summary">Direct path — ${canonical.length} step${canonical.length !== 1 ? 's' : ''}</summary>
      <div class="path-content">
        <ol class="path-steps">${renderSteps(canonical)}</ol>
      </div>
    </details>
  `;

  if (showFallback) {
    html += `
      <details class="path-details path-details--skip">
        <summary class="path-summary">Via "Cannot determine" — ${fallback.length} step${fallback.length !== 1 ? 's' : ''}</summary>
        <div class="path-content">
          <p class="path-skip-note">Steps where a feature is unclear or not visible in the photo.</p>
          <ol class="path-steps">${renderSteps(fallback)}</ol>
        </div>
      </details>
    `;
  }

  return html;
}

// ===== Photo gallery =====

function buildPhotoGallery(species) {
  if (!species || !species.taxon_photos || species.taxon_photos.length === 0) {
    return `
      <div class="photo-gallery">
        <div class="photo-placeholder">
          ${iconButterfly()}
          <span>No photo available</span>
        </div>
      </div>
    `;
  }

  const photos = species.taxon_photos.slice(0, 5);
  const items = photos.map(p => `
    <div class="photo-item">
      <img src="${escapeAttr(p.url)}" alt="${escapeAttr(species.name)}" loading="lazy">
      <span class="photo-attr">${escapeHtml(p.attribution)}</span>
    </div>
  `).join('');

  return `<div class="photo-gallery">${items}</div>`;
}

// ===== Navigation helpers =====

function buildBackButton() {
  const disabled = state.history.length === 0 ? ' disabled' : '';
  return `
    <button class="back-btn"${disabled}>
      ${iconBack()} Back
    </button>
  `;
}

function buildBreadcrumb() {
  if (state.history.length === 0) {
    return `<div class="breadcrumb-wrap"><div class="breadcrumb"><span class="crumb-start">Start</span></div></div>`;
  }

  const crumbs = state.history.map(h =>
    `<span class="sep">›</span><span class="crumb" title="${escapeAttr(h.choiceLabel)}">${escapeHtml(h.choiceLabel)}</span>`
  ).join('');

  return `
    <div class="breadcrumb-wrap">
      <div class="breadcrumb">
        <span class="crumb-start">Start</span>
        ${crumbs}
      </div>
    </div>
  `;
}

function buildProgressBar() {
  const pct = Math.min((state.history.length / ESTIMATED_MAX_DEPTH) * 100, 100);
  return `
    <div class="progress-bar-track">
      <div class="progress-bar-fill" style="width: ${pct}%"></div>
    </div>
  `;
}

function renderErrorCard(message) {
  return `
    <div class="card card--error">
      <div class="error-icon">⚠️</div>
      <h2>Something went wrong</h2>
      <p>${escapeHtml(message)}</p>
      <button class="btn-restart" onclick="restart()">
        ${iconRestart()} Start Over
      </button>
    </div>
  `;
}

function handleChoice(label, nextNodeId) {
  state.history.push({ nodeId: state.currentNodeId, choiceLabel: label });
  state.currentNodeId = nextNodeId;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleBack() {
  if (state.history.length === 0) return;
  const prev = state.history.pop();
  state.currentNodeId = prev.nodeId;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function restart() {
  state.history = [];
  state.currentNodeId = state.tree.start;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Helpers =====

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ===== SVG icons =====

function iconMenu() {
  return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
    <path d="M3 6h16M3 11h16M3 16h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

function iconBack() {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function iconExternal() {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M10 2h4v4M14 2L8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function iconRestart() {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 8a6 6 0 106-6H5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M2 4v4h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function iconArrowRight() {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="vertical-align:-2px">
    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function iconPending() {
  return `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="vertical-align:-2px">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/>
    <path d="M8 5v3.5l2 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function iconButterfly() {
  return `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <ellipse cx="11" cy="16" rx="8" ry="6" fill="#d4e2d0" opacity="0.8"/>
    <ellipse cx="29" cy="16" rx="8" ry="6" fill="#d4e2d0" opacity="0.8"/>
    <ellipse cx="12" cy="26" rx="6" ry="5" fill="#d4e2d0" opacity="0.6"/>
    <ellipse cx="28" cy="26" rx="6" ry="5" fill="#d4e2d0" opacity="0.6"/>
    <line x1="20" y1="10" x2="20" y2="32" stroke="#6b7c6b" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M18 11 Q20 9 22 11" stroke="#6b7c6b" stroke-width="1.2" stroke-linecap="round" fill="none"/>
  </svg>`;
}

document.addEventListener('DOMContentLoaded', init);
