const state = {
  tree: null,
  species: null,       // Map<taxon_id (number), species object>
  currentNodeId: null,
  history: []          // [{ nodeId, choiceLabel }, ...]
};

const ESTIMATED_MAX_DEPTH = 8;

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
    state.currentNodeId = treeData.start;
    state.history = [];

    loadingEl.style.display = 'none';
    appEl.style.display = 'block';
    render();
  } catch (err) {
    loadingEl.style.display = 'none';
    appEl.style.display = 'block';
    appEl.innerHTML = renderErrorCard('Could not load identification data. Please refresh the page.');
  }
}

function render() {
  const appEl = document.getElementById('app');
  const node = state.tree.nodes[state.currentNodeId];

  if (!node) {
    appEl.innerHTML = renderErrorCard(`Unknown node: "${state.currentNodeId}". Please restart.`);
    return;
  }

  const breadcrumbHTML = buildBreadcrumb();
  const progressHTML = buildProgressBar();
  const backHTML = buildBackButton();

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
      <h1>Arhopala Identifier</h1>
      <p>Malaysian Oak Blue Butterflies</p>
    </div>
    ${breadcrumbHTML}
    ${progressHTML}
    ${bodyHTML}
  `;

  // Attach event listeners after render
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
}

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
  const species = state.species.get(node.taxon_id);

  const commonName = species ? (species.common_name || species.name) : 'Unknown Species';
  const sciName = species ? species.name : '';
  const inatUrl = species ? species.inat_url : `https://www.inaturalist.org/search?q=${encodeURIComponent(sciName || 'Arhopala')}`;
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

  return `
    <div class="card card--group">
      ${buildBackButton()}
      <span class="result-badge result-badge--group">Group Identified</span>
      <h2 class="species-common">${escapeHtml(node.group_name)}</h2>
      <p class="group-description">${escapeHtml(node.description)}</p>
      ${featuresHTML}
      <div class="species-pending">
        ${iconPending()} Species-level keys for this group will be added in the next update.
      </div>
      <div class="action-row">
        <button class="btn-restart">
          ${iconRestart()} Start Over
        </button>
      </div>
    </div>
  `;
}

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

// ===== Inline SVG icons =====

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
