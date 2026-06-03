#!/usr/bin/env python3
"""
audit_paths.py — Audit canonical paths used by both the ID Key and Feature Scoring.

BACKGROUND
----------
The app has two identification tools that both derive from data/tree.json:

  1. ID Key (index.html / js/app.js)
     A step-by-step decision tree. For each result species it displays:
       • Direct path   — the canonical route with the fewest ambiguities
       • CD path       — an alternative route using "Cannot determine" answers
                         when a feature is hidden in the photo

  2. Feature Scoring (checklist.html / js/checklist.js)
     A parallel scoring mode. Each species is pre-mapped to a set of
     observable features (question → expected answer) derived from its
     canonical path. When the user marks features in their photo the species
     whose features match best rises to the top.

Both tools select the same "canonical path" using the same scoring algorithm.
This script checks that every species' canonical path is clean and consistent.

SCORING ALGORITHM
-----------------
Each path through the tree receives a penalty score:

  +1  per "Cannot determine" answer
      (user had to skip an observable feature)
  +1  per escape-hatch answer
      (camdeo-group bypass — routes a non-camdeo species back into the
       main key without answering the camdeo diagnostic question)
  +100 contradiction penalty — any of:
      • path starts "tailed" but contains a "tailless" answer later
      • path starts "tailless" but the result note begins "Tailed."
      • path starts "tailed"  but the result note begins "Tailless."

The lowest-score path is canonical. Paths scoring ≥100 are excluded from
canonical consideration (they represent structurally wrong routes through the
tree and should never be shown).

PATH QUALITY FLAGS
------------------
  [CD]           canonical path contains a Cannot-determine answer.
                 This is expected only for unresolved species groups where
                 two species are too similar to separate with certainty.
  [ESC]          canonical path uses the camdeo escape-hatch choice.
                 Should not occur; indicates a tree routing bug.
  [TAILED-CONTR] the path's starting branch contradicts the result note.
                 Should never appear; indicates a severe tree structural error.
  [FEAT]         the result node carries an explicit `features` override map.
                 These are intentional manual corrections to the feature
                 matrix (e.g. to fix DFS-order artefacts). Not a problem.

ESCAPE-HATCH LABELS
-------------------
The camdeo escape-hatch is a special "none of these" choice in q_camdeo_sub
that routes non-camdeo species back into the main key. Its label text has
been revised over time; the ESCAPE_HATCHES list below covers all versions.

USAGE
-----
    python scripts/audit_paths.py              # uses data/tree.json
    python scripts/audit_paths.py path/to/tree.json

Exit code: 0 = all canonical paths are clean (score 0).
           1 = one or more paths are imperfect or contradictory.

EXPECTED BASELINE (June 2026)
------------------------------
  score 0 (clean)      : 108 / 114
  score 1–99 (CD/ESC)  :   6 / 114  — all unresolved species groups
  score ≥100 (error)   :   0 / 114
"""

import json
import re
import sys
from pathlib import Path
from collections import defaultdict

REPO_ROOT = Path(__file__).resolve().parent.parent
TREE_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / 'data' / 'tree.json'

# All known label prefixes for the camdeo escape-hatch choice in q_camdeo_sub.
# Add new entries here whenever q_camdeo_sub's last choice is reworded.
ESCAPE_HATCHES = [
    'None of the camdeo features present',
    'HW spot 6 appears midway between spot 5 and the end-cell bar',
]


def is_escape(choice: str) -> bool:
    """Return True if `choice` is a camdeo escape-hatch label."""
    return any(choice.startswith(eh) for eh in ESCAPE_HATCHES) if choice else False


# ── Tree traversal ────────────────────────────────────────────────────────────

def build_all_paths(nodes: dict, start: str) -> dict:
    """
    DFS from `start`; return {species_name: [path, ...]} where each path is a
    list of step dicts:
        {'question': str, 'choice': str}   — for question nodes
        {'group':    str}                  — for group nodes (unresolved clusters)

    The DFS tracks visited node IDs per branch (not globally) so that questions
    reachable from multiple parent paths are recorded once per distinct route.
    Cycles are broken by the per-branch visited set.
    """
    result_paths: dict[str, list] = {}

    def dfs(node_id: str, path: list, visited: frozenset):
        if node_id in visited:
            return
        node = nodes.get(node_id)
        if not node:
            return
        visited = visited | {node_id}

        ntype = node['type']

        if ntype == 'result':
            name = node.get('name', '')
            if name:
                result_paths.setdefault(name, []).append(list(path))
            return

        if ntype == 'question':
            for c in node.get('choices') or []:
                if c.get('next'):
                    dfs(c['next'],
                        path + [{'question': node['question'], 'choice': c['label']}],
                        visited)
            return

        if ntype == 'group':
            if node.get('next'):
                # Group with a continuation — append a group marker and keep going.
                dfs(node['next'], path + [{'group': node.get('group_name', '')}], visited)
            elif node.get('member_results'):
                # Terminal group — register the path for each member result.
                for rid in node['member_results']:
                    rn = nodes.get(rid)
                    if rn and rn.get('name'):
                        result_paths.setdefault(rn['name'], []).append(
                            list(path) + [{'group': node.get('group_name', '')}])

    dfs(start, [], frozenset())
    return result_paths


def collect_result_nodes(nodes: dict) -> dict:
    """Return {species_name: result_node} for all result nodes that have a name."""
    return {n['name']: n
            for n in nodes.values()
            if n.get('type') == 'result' and n.get('name')}


# ── Path scoring ──────────────────────────────────────────────────────────────

def path_score(path: list, note: str) -> int:
    """
    Score a candidate path. Lower is better; ≥100 means the path is invalid.

    Mirrors the skipCount function in js/app.js (buildPathDisplay) and the
    pathScore function in js/checklist.js (initData). Keep all three in sync.
    """
    lc = (note or '').lower()
    result_is_tailed     = lc.startswith('tailed')
    result_is_not_tailed = lc.startswith('tailless')

    # Base penalties: CD steps and escape-hatch choices.
    score = sum(1 for s in path if s.get('choice', '').startswith('Cannot determine'))
    score += sum(1 for s in path if is_escape(s.get('choice', '')))

    # Contradiction penalties.
    first_choice  = path[0].get('choice', '') if path else ''
    starts_tailed = first_choice == 'Yes — hindwing is tailed'
    starts_notail = first_choice == 'No — hindwing is tailless'

    if starts_tailed and any(re.search(r'tailless', s.get('choice', ''), re.I)
                              for s in path):
        score += 100  # tailed branch contains a "tailless" answer

    if starts_notail and result_is_tailed:
        score += 100  # tailless branch but result is a tailed species

    if starts_tailed and result_is_not_tailed:
        score += 100  # tailed branch but result is a tailless species

    return score


def pick_canonical(paths: list, note: str) -> list:
    """
    Select the best (lowest-score) path from all DFS-discovered routes.
    Paths scoring ≥100 (contradictions) are excluded when any valid path exists.
    """
    scored = sorted(((path_score(p, note), i, p) for i, p in enumerate(paths)),
                    key=lambda x: x[0])
    # Prefer non-contradicting paths.
    best = next((p for s, _, p in scored if s < 100), None)
    return best if best is not None else (scored[0][2] if scored else [])


# ── Path inspection helpers ───────────────────────────────────────────────────

def path_flags(path: list, note: str) -> list[str]:
    """Return quality flags for a canonical path (see module docstring)."""
    flags = []
    if any(s.get('choice', '').startswith('Cannot determine') for s in path):
        flags.append('CD')
    if any(is_escape(s.get('choice', '')) for s in path):
        flags.append('ESC')
    lc    = (note or '').lower()
    first = path[0].get('choice', '') if path else ''
    if first == 'Yes — hindwing is tailed'  and lc.startswith('tailless'):
        flags.append('TAILED-CONTR')
    if first == 'No — hindwing is tailless' and lc.startswith('tailed'):
        flags.append('TAILED-CONTR')
    return flags


def cd_questions(path: list) -> list[str]:
    """Return question text for every Cannot-determine step in the path."""
    return [s['question'][:80] for s in path
            if s.get('choice', '').startswith('Cannot determine')]


def escape_questions(path: list) -> list[str]:
    """Return question text for every escape-hatch step in the path."""
    return [s['question'][:80] for s in path if is_escape(s.get('choice', ''))]


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    with open(TREE_PATH) as f:
        tree = json.load(f)

    nodes      = tree['nodes']
    start      = tree['start']
    all_paths  = build_all_paths(nodes, start)
    result_map = collect_result_nodes(nodes)

    # Group results by score bucket for the summary.
    by_score: dict[int, list] = defaultdict(list)
    total = 0

    for name in sorted(all_paths):
        paths    = all_paths[name]
        rnode    = result_map.get(name, {})
        note     = rnode.get('note', '')
        has_feat = bool(rnode.get('features'))   # manual feature overrides present
        total   += 1

        canon = pick_canonical(paths, note)
        score = path_score(canon, note)
        flags = path_flags(canon, note)
        if has_feat:
            flags.append('FEAT')

        # Clamp score to 100 for bucketing (any contradiction goes in the same bucket).
        by_score[min(score, 100)].append((name, score, len(canon), flags, canon))

    # ── Summary line ──────────────────────────────────────────────────────────
    clean  = len(by_score.get(0, []))
    impure = sum(len(v) for k, v in by_score.items() if 0 < k < 100)
    contra = len(by_score.get(100, []))

    print(f'Canonical path audit — {total} species\n')
    print(f'  score 0  (clean direct path)  : {clean}')
    print(f'  score 1–99 (CD or ESC step)   : {impure}')
    print(f'  score ≥100 (contradiction)    : {contra}')
    print()

    if impure == 0 and contra == 0:
        print('✓ All canonical paths are clean.')
        return 0

    # ── Detail: imperfect paths ───────────────────────────────────────────────
    # Gather all score buckets between 1 and 99 inclusive.
    impure_entries = []
    for k, v in by_score.items():
        if 1 <= k < 100:
            impure_entries.extend(v)

    if impure_entries:
        print('── Imperfect paths (score 1–99) ─────────────────────────────────────────\n')
        for name, score, length, flags, canon in sorted(impure_entries):
            tag = ' '.join(f'[{f}]' for f in flags)
            print(f'  {name}  {tag}  (score={score}, len={length})')
            for q in cd_questions(canon):
                print(f'    CD:  {q}')
            for q in escape_questions(canon):
                print(f'    ESC: {q}')
        print()

    # ── Detail: contradictions ────────────────────────────────────────────────
    if contra:
        print('── Contradictions (score ≥100) ──────────────────────────────────────────\n')
        for name, score, length, flags, canon in by_score[100]:
            tag   = ' '.join(f'[{f}]' for f in flags)
            first = canon[0].get('choice', '') if canon else '—'
            print(f'  {name}  {tag}')
            print(f'    starts with: {first[:80]}')
        print()

    return 1


if __name__ == '__main__':
    sys.exit(main())
