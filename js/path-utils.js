// path-utils.js — canonical-path algorithm shared by app.js and checklist.js
//
// Both the ID-key direct path display and the Feature Scoring page must agree on
// which path is "canonical" for each species.  Keeping a single copy here ensures
// a change to the scoring logic is automatically reflected in both.

const ESCAPE_HATCHES = [
  'None of the camdeo features present',
  'HW spot 6 appears midway between spot 5 and the end-cell bar',
];

function isEscapeHatch(choice) {
  return choice && ESCAPE_HATCHES.some(eh => choice.startsWith(eh));
}

// Score a path — lower is better (canonical = lowest score).
// +1 per "Cannot determine" step, +1 per escape-hatch step.
// +100 when the path starts on the wrong tailed/tailless branch.
function pathScore(path, note) {
  const lc = (note || '').toLowerCase();
  const resultIsTailed    = /^tailed/.test(lc);
  const resultIsNotTailed = /^tailless/.test(lc);
  let score = path.filter(s => s.choice && s.choice.startsWith('Cannot determine')).length;
  score    += path.filter(s => isEscapeHatch(s.choice)).length;
  if (path.length > 0) {
    const startsTailed    = path[0].choice === 'Yes — hindwing is tailed';
    const startsNotTailed = path[0].choice === 'No — hindwing is tailless';
    if (startsTailed    && path.some(s => s.choice && /tailless/i.test(s.choice))) score += 100;
    if (startsNotTailed && resultIsTailed)    score += 100;
    if (startsTailed    && resultIsNotTailed) score += 100;
  }
  return score;
}

// Returns 1 if any definite answer in the path contradicts the result's explicit
// features; 0 otherwise.  Used as a tiebreaker so the biologically correct path
// beats a DFS-order artefact when two choices lead to the same next node.
function pathIsInconsistent(path, resultFeatures) {
  for (const step of path) {
    if (!step.question || !step.choice) continue;
    if (step.choice.startsWith('Cannot determine')) continue;
    const expected = resultFeatures[step.question];
    if (expected && !expected.startsWith('Cannot determine') && step.choice !== expected) return 1;
  }
  return 0;
}

// Override path display answers with explicit result-node features.
function pathApplyFeatures(path, resultFeatures) {
  if (!resultFeatures || Object.keys(resultFeatures).length === 0) return path;
  return path.map(step =>
    (step.question &&
     resultFeatures[step.question] &&
     !resultFeatures[step.question].startsWith('Cannot determine'))
      ? { ...step, choice: resultFeatures[step.question] }
      : step
  );
}

// Position of the first CD step in a path (used to prefer deeper CD paths).
function pathCdDepth(path) {
  return path.findIndex(s => s.choice && s.choice.startsWith('Cannot determine'));
}

// Select the canonical path: lowest (score, inconsistency, length).
function pickCanonicalPath(paths, note, resultFeatures) {
  if (!paths || paths.length === 0) return null;
  const rf = resultFeatures || {};
  const sorted = [...paths].sort((a, b) =>
    pathScore(a, note) - pathScore(b, note) ||
    pathIsInconsistent(a, rf) - pathIsInconsistent(b, rf) ||
    a.length - b.length
  );
  return sorted.find(p => pathScore(p, note) < 100) || sorted[0];
}

// Select the fallback (CD) path for display alongside the direct path.
// Picks the path with one more CD step than canonical, preferring the one
// whose CD step occurs deepest (= a designed bypass rather than an early skip).
function pickFallbackPath(paths, note, resultFeatures) {
  if (!paths || paths.length === 0) return null;
  const rf = resultFeatures || {};
  const canonical = pickCanonicalPath(paths, note, rf);
  if (!canonical) return null;
  const canonicalScore = pathScore(canonical, note);
  const pool = paths.filter(p =>
    pathScore(p, note) < 100 &&
    pathScore(p, note) > canonicalScore &&
    !p.some(s => isEscapeHatch(s.choice))
  );
  pool.sort((a, b) =>
    pathScore(a, note)          - pathScore(b, note)          ||
    pathIsInconsistent(a, rf)   - pathIsInconsistent(b, rf)   ||
    pathCdDepth(b)              - pathCdDepth(a)              ||
    a.length                    - b.length
  );
  const fallback = pool[0] || null;
  if (!fallback) return null;
  if (JSON.stringify(fallback) === JSON.stringify(canonical)) return null;
  return fallback;
}

// ── Tree traversal ────────────────────────────────────────────────────────────

// DFS from tree root; returns Map<resultName, Array<path>>.
// Each path is an array of {question, choice} steps (with {group} milestones).
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
      for (const c of (node.choices || []))
        if (c.next) dfs(c.next, [...path, { question: node.question, choice: c.label }], vis2);
      return;
    }
    if (node.type === 'group') {
      const step = { group: node.group_name };
      if (node.next) {
        dfs(node.next, [...path, step], vis2);
      } else if (node.member_results && node.member_results.length) {
        for (const resultId of node.member_results) {
          const rNode = nodes[resultId];
          if (rNode && rNode.name) {
            if (!pathsMap.has(rNode.name)) pathsMap.set(rNode.name, []);
            pathsMap.get(rNode.name).push([...path, step]);
          }
        }
      }
    }
  }

  dfs(treeData.start, [], new Set());
  return pathsMap;
}

// Assigns a stable Q-number to each unique question text in DFS encounter order.
function buildQuestionNumbers(treeData) {
  const nodes = treeData.nodes;
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

  dfs(treeData.start);
  return numbers;
}
