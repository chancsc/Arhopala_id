#!/usr/bin/env python3
"""
audit_paths.py — Audit canonical paths used by both the ID Key and Feature Scoring.

Both tools now use the same algorithm (unified in app.js + checklist.js).
This script checks the *quality* of each species' canonical path:

  score 0  — clean direct path (ideal)
  score 1  — one CD or escape-hatch step (bypasses one observable feature)
  score 2+ — multiple CD / escape-hatch steps
  score ≥100 — contradiction (tailed/tailless mismatch); shouldn't happen

Flags:
  [CD]     path contains a "Cannot determine" step
  [ESC]    path uses the camdeo escape-hatch
  [TAILED-CONTR]  starts tailed but result note says tailless (or vice versa)
  [FEAT]   result node has manual feature overrides

Usage:
    python scripts/audit_paths.py [tree.json]

Exit code: 0 = all paths are clean (score 0), 1 = some paths are imperfect.
"""

import json
import re
import sys
from pathlib import Path
from collections import defaultdict

REPO_ROOT = Path(__file__).resolve().parent.parent
TREE_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / 'data' / 'tree.json'

ESCAPE_HATCHES = [
    'None of the camdeo features present',
    'HW spot 6 appears midway between spot 5 and the end-cell bar',
]


def is_escape(choice: str) -> bool:
    return any(choice.startswith(eh) for eh in ESCAPE_HATCHES) if choice else False


# ── Tree traversal ────────────────────────────────────────────────────────────

def build_all_paths(nodes: dict, start: str) -> dict:
    result_paths: dict[str, list] = {}

    def dfs(node_id, path, visited):
        if node_id in visited:
            return
        node = nodes.get(node_id)
        if not node:
            return
        visited = visited | {node_id}

        if node['type'] == 'result':
            name = node.get('name', '')
            if name:
                result_paths.setdefault(name, []).append(list(path))
            return

        if node['type'] == 'question':
            for c in node.get('choices') or []:
                if c.get('next'):
                    dfs(c['next'],
                        path + [{'question': node['question'], 'choice': c['label']}],
                        visited)
            return

        if node['type'] == 'group':
            if node.get('next'):
                dfs(node['next'], path + [{'group': node.get('group_name', '')}], visited)
            elif node.get('member_results'):
                for rid in node['member_results']:
                    rn = nodes.get(rid)
                    if rn and rn.get('name'):
                        result_paths.setdefault(rn['name'], []).append(
                            list(path) + [{'group': node.get('group_name', '')}])

    dfs(start, [], frozenset())
    return result_paths


def collect_result_nodes(nodes: dict) -> dict:
    return {n['name']: n
            for n in nodes.values()
            if n.get('type') == 'result' and n.get('name')}


# ── Path scoring ──────────────────────────────────────────────────────────────

def path_score(path: list, note: str) -> int:
    lc = (note or '').lower()
    result_is_tailed     = lc.startswith('tailed')
    result_is_not_tailed = lc.startswith('tailless')

    score = sum(1 for s in path
                if s.get('choice', '').startswith('Cannot determine'))
    score += sum(1 for s in path if is_escape(s.get('choice', '')))

    first_choice = path[0].get('choice', '') if path else ''
    starts_tailed     = first_choice == 'Yes — hindwing is tailed'
    starts_not_tailed = first_choice == 'No — hindwing is tailless'

    if starts_tailed and any(re.search(r'tailless', s.get('choice', ''), re.I)
                              for s in path):
        score += 100
    if starts_not_tailed and result_is_tailed:
        score += 100
    if starts_tailed and result_is_not_tailed:
        score += 100

    return score


def pick_canonical(paths: list, note: str) -> list:
    scored = sorted(((path_score(p, note), i, p) for i, p in enumerate(paths)),
                    key=lambda x: x[0])
    best = next((p for s, _, p in scored if s < 100), None)
    return best if best is not None else (scored[0][2] if scored else [])


# ── Path inspection ───────────────────────────────────────────────────────────

def path_flags(path: list, note: str) -> list[str]:
    flags = []
    if any(s.get('choice', '').startswith('Cannot determine') for s in path):
        flags.append('CD')
    if any(is_escape(s.get('choice', '')) for s in path):
        flags.append('ESC')
    lc = (note or '').lower()
    first = path[0].get('choice', '') if path else ''
    if first == 'Yes — hindwing is tailed' and lc.startswith('tailless'):
        flags.append('TAILED-CONTR')
    if first == 'No — hindwing is tailless' and lc.startswith('tailed'):
        flags.append('TAILED-CONTR')
    return flags


def cd_questions(path: list) -> list[str]:
    return [s['question'][:80] for s in path
            if s.get('choice', '').startswith('Cannot determine')]


def escape_questions(path: list) -> list[str]:
    return [s['question'][:80] for s in path if is_escape(s.get('choice', ''))]


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    with open(TREE_PATH) as f:
        tree = json.load(f)

    nodes      = tree['nodes']
    start      = tree['start']
    all_paths  = build_all_paths(nodes, start)
    result_map = collect_result_nodes(nodes)

    by_score: dict[int, list] = defaultdict(list)
    total = 0

    for name in sorted(all_paths):
        paths  = all_paths[name]
        rnode  = result_map.get(name, {})
        note   = rnode.get('note', '')
        has_feat = bool(rnode.get('features'))
        total += 1

        canon = pick_canonical(paths, note)
        score = path_score(canon, note)
        flags = path_flags(canon, note)
        if has_feat:
            flags.append('FEAT')

        by_score[min(score, 100)].append((name, score, len(canon), flags, canon))

    # ── Summary ───────────────────────────────────────────────────────────────
    clean   = len(by_score.get(0, []))
    impure  = sum(len(v) for k, v in by_score.items() if 0 < k < 100)
    contra  = len(by_score.get(100, []))

    print(f'Canonical path audit — {total} species\n')
    print(f'  score 0 (clean direct path)  : {clean}')
    print(f'  score 1–99 (CD or ESC step)  : {impure}')
    print(f'  score ≥100 (contradiction)   : {contra}')
    print()

    if impure == 0 and contra == 0:
        print('✓ All canonical paths are clean.')
        return 0

    # ── Detail for imperfect paths ────────────────────────────────────────────
    if impure:
        print('── Imperfect paths (score 1–99) ─────────────────────────────────────────\n')
        for name, score, length, flags, canon in sorted(by_score[1] + by_score.get(2, []) +
                                                         by_score.get(3, [])):
            tag = ' '.join(f'[{f}]' for f in flags)
            print(f'  {name}  {tag}  (score={score}, len={length})')
            for q in cd_questions(canon):
                print(f'    CD:  {q}')
            for q in escape_questions(canon):
                print(f'    ESC: {q}')
        print()

    if contra:
        print('── Contradictions (score ≥100) ──────────────────────────────────────────\n')
        for name, score, length, flags, canon in by_score[100]:
            tag = ' '.join(f'[{f}]' for f in flags)
            first = canon[0].get('choice', '') if canon else '—'
            print(f'  {name}  {tag}')
            print(f'    starts with: {first[:80]}')
        print()

    return 1 if (impure or contra) else 0


if __name__ == '__main__':
    sys.exit(main())
