#!/usr/bin/env python3
"""
Compute Simulation CD paths for all species via Feature Scoring simulation.

For each species, simulates the Feature Scoring (checklist.js) flow answering:
- "Cannot determine" for any question about upperside features or space 1–3
- The canonical answer for all other questions

Outputs data/sim_cd_paths.json  — a dict keyed by result name, each value a list
of {question, choice} steps in the order Feature Scoring would present them.

Usage: python scripts/compute_sim_cd_paths.py
"""

import json
import re
import sys
from collections import defaultdict

TREE_PATH   = 'data/tree.json'
SPECIES_PATH = 'data/species.json'
OUTPUT_PATH  = 'data/sim_cd_paths.json'

ESCAPE_HATCHES = [
    'None of the camdeo features present',
    'HW spot 6 appears midway between spot 5 and the end-cell bar',
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def is_escape_hatch(c):
    return c and any(c.startswith(eh) for eh in ESCAPE_HATCHES)

def is_sim_cd_question(q):
    lq = (q or '').lower()
    return ('upperside' in lq or 'upper side' in lq or
            bool(re.search(r'\bspace [123][ab]?\b', lq)))

def path_score(p, note):
    lc = (note or '').lower()
    result_is_tailed     = lc.startswith('tailed')
    result_is_not_tailed = lc.startswith('tailless')
    score = sum(1 for s in p if s.get('choice', '').startswith('Cannot determine'))
    score += sum(1 for s in p if is_escape_hatch(s.get('choice', '')))
    if p:
        starts_tailed     = p[0].get('choice', '') == 'Yes — hindwing is tailed'
        starts_not_tailed = p[0].get('choice', '') == 'No — hindwing is tailless'
        if starts_tailed and any('tailless' in s.get('choice', '').lower() for s in p):
            score += 100
        if starts_not_tailed and result_is_tailed:
            score += 100
        if starts_tailed and result_is_not_tailed:
            score += 100
    return score

def is_inconsistent(p, rf):
    for step in p:
        q, c = step.get('question'), step.get('choice', '')
        if not q or not c or c.startswith('Cannot determine'):
            continue
        expected = rf.get(q)
        if expected and not expected.startswith('Cannot determine') and c != expected:
            return 1
    return 0

def pick_canonical(paths, note, rf):
    if not paths:
        return []
    scored = sorted(paths, key=lambda p: (path_score(p, note), is_inconsistent(p, rf), len(p)))
    best = next((p for s, p in ((path_score(p, note), p) for p in scored) if s < 100), scored[0])
    return best

# ── Tree helpers ──────────────────────────────────────────────────────────────

def build_tree_paths(td):
    nodes = td['nodes']
    result_map = defaultdict(list)
    def dfs(node_id, path, vis):
        if node_id in vis:
            return
        node = nodes.get(node_id)
        if not node:
            return
        v2 = set(vis); v2.add(node_id)
        ntype = node.get('type')
        if ntype == 'result':
            name = node.get('name', '')
            if name:
                result_map[name].append(list(path))
            return
        if ntype == 'question':
            for c in (node.get('choices') or []):
                if c.get('next'):
                    dfs(c['next'], path + [{'question': node['question'], 'choice': c['label']}], v2)
            return
        if ntype == 'group' and node.get('next'):
            dfs(node['next'], path + [{'group': node.get('group_name', '')}], v2)
    dfs(td['start'], [], set())
    return dict(result_map)

def build_question_numbers(td):
    nodes = td['nodes']
    numbers = {}
    n = [0]
    seen = set()
    def dfs(node_id):
        if node_id in seen:
            return
        node = nodes.get(node_id)
        if not node:
            return
        seen.add(node_id)
        if node.get('type') == 'question':
            q = node['question']
            if q not in numbers:
                n[0] += 1
                numbers[q] = n[0]
            for c in (node.get('choices') or []):
                if c.get('next'):
                    dfs(c['next'])
        elif node.get('type') == 'group' and node.get('next'):
            dfs(node['next'])
    dfs(td['start'])
    return numbers

def get_cd_choice_for_question(tree_nodes, question_text):
    """Return the label of the CD choice for this question, or None."""
    for node in tree_nodes.values():
        if node.get('type') == 'question' and node.get('question') == question_text:
            for c in (node.get('choices') or []):
                if c.get('label', '').startswith('Cannot determine'):
                    return c['label']
    return None

# ── Feature Scoring (mirrors checklist.js) ────────────────────────────────────

def build_feature_matrix(tree_data, paths_map):
    nodes = tree_data['nodes']
    q_meta = {}
    q_cov  = {}
    result_notes = {}
    result_features_map = {}

    for node in nodes.values():
        if node.get('type') == 'question':
            q = node['question']
            all_choices = [c['label'] for c in (node.get('choices') or [])]
            if q not in q_meta:
                q_meta[q] = {'choices': all_choices, 'hint': node.get('hint', '')}
            else:
                for l in all_choices:
                    if l not in q_meta[q]['choices']:
                        q_meta[q]['choices'].append(l)
        if node.get('type') == 'result' and node.get('name'):
            result_notes[node['name']] = node.get('note', '')
            if node.get('features'):
                result_features_map[node['name']] = node['features']

    matrix = {}
    for name, paths in paths_map.items():
        note = result_notes.get(name, '')
        rf   = result_features_map.get(name, {})
        canonical = pick_canonical(paths, note, rf)

        features = {}
        cov_seen = set()
        for step in canonical:
            q = step.get('question')
            c = step.get('choice', '')
            if q and c and not c.startswith('Cannot determine') and not step.get('group'):
                features[q] = c
                if q not in cov_seen:
                    cov_seen.add(q)
                    q_cov[q] = q_cov.get(q, 0) + 1

        for q, c in rf.items():
            if c.startswith('Cannot determine'):
                features.pop(q, None)
            else:
                if q not in features:
                    q_cov[q] = q_cov.get(q, 0) + 1
                features[q] = c

        matrix[name] = features

    return matrix, q_meta, q_cov, result_notes

def score_all(answers, feature_matrix):
    if not answers:
        return [{'name': n, 'score': 0, 'max': 0} for n in feature_matrix]
    results = []
    for name, features in feature_matrix.items():
        score, max_ = 0, 0
        for q, ans in answers.items():
            if ans.startswith('Cannot determine'):
                continue
            max_ += 2
            if q in features:
                score += 2 if features[q] == ans else -1
        results.append({'name': name, 'score': score, 'max': max_})
    results.sort(key=lambda x: (-(x['score'] / x['max']) if x['max'] > 0 else 0, x['name']))
    return results

def get_display_questions(answers, scores, feature_matrix, q_meta, q_cov, tree_nodes,
                          question_order_ref):
    if not answers or all(s['score'] == 0 for s in scores):
        top_names = list(feature_matrix.keys())
    else:
        top = scores[0]
        top_pct = top['score'] / top['max'] if top['max'] > 0 else 0
        top_names = [s['name'] for s in scores
                     if (s['score'] / s['max'] if s['max'] > 0 else 0) >= top_pct]

    diversity    = {}
    filtered_cov = {}
    for name in top_names:
        for q, c in feature_matrix.get(name, {}).items():
            diversity.setdefault(q, set()).add(c)
            filtered_cov[q] = filtered_cov.get(q, 0) + 1

    touched       = set(answers.keys())
    top1_features = set(feature_matrix.get(scores[0]['name'], {}).keys()) if answers and scores else set()

    cd_followups = set()
    if tree_nodes:
        for q, choice in answers.items():
            if not choice.startswith('Cannot determine'):
                continue
            # Collect next-questions from every node sharing this question text;
            # only add when all agree (ambiguous multi-node cases must not inject
            # a spurious followup from the wrong tree branch).
            candidates = set()
            for node in tree_nodes.values():
                if node.get('type') != 'question' or node.get('question') != q:
                    continue
                cd_choice = next((c for c in (node.get('choices') or []) if c['label'] == choice), None)
                if not cd_choice or not cd_choice.get('next'):
                    continue
                follow = tree_nodes.get(cd_choice['next'])
                if follow and follow.get('type') == 'question':
                    candidates.add(follow['question'])
            if len(candidates) == 1:
                cd_followups.update(candidates)

    all_q = [q for q, choices in diversity.items()
             if q in touched or len(choices) >= 2 or q in top1_features or q in cd_followups]
    all_q_set = set(all_q)

    def new_q_sort_key(q):
        is_upper = 'upperside' in q.lower()
        return (1 if is_upper else 0, -(filtered_cov.get(q, 0)))

    if not question_order_ref:
        question_order_ref[:] = sorted(all_q, key=new_q_sort_key)
    else:
        question_order_ref[:] = [q for q in question_order_ref if q in touched or q in all_q_set]
        existing = set(question_order_ref)
        if cd_followups:
            cd_positions = [question_order_ref.index(aq)
                            for aq, ac in answers.items()
                            if ac.startswith('Cannot determine') and aq in question_order_ref]
            if cd_positions:
                insert_at = max(cd_positions) + 1
                for q in list(cd_followups):
                    if q not in all_q_set:
                        continue
                    cur_idx = question_order_ref.index(q) if q in question_order_ref else -1
                    if cur_idx == -1:
                        question_order_ref.insert(insert_at, q)
                        existing.add(q)
                    elif cur_idx > insert_at:
                        question_order_ref.pop(cur_idx)
                        question_order_ref.insert(insert_at, q)
        new_qs = sorted([q for q in all_q if q not in existing], key=new_q_sort_key)
        question_order_ref.extend(new_qs)

    return list(question_order_ref), cd_followups

# ── Sim-CD path computation ───────────────────────────────────────────────────

def compute_sim_cd_path(result_name, feature_matrix, q_meta, q_cov, tree_nodes,
                        canonical_answers):
    """
    Simulate Feature Scoring for result_name, answering CD for sim-CD questions.
    Returns list of {question, choice} steps (in Feature Scoring display order),
    or None if the path is identical to the direct path or cannot be computed.
    """
    if not canonical_answers:
        return None

    # Build sim-CD answers
    sim_answers = {}
    has_cd = False
    for q, answer in canonical_answers.items():
        if is_sim_cd_question(q):
            cd_label = get_cd_choice_for_question(tree_nodes, q)
            if cd_label:
                sim_answers[q] = cd_label
                has_cd = True
            else:
                sim_answers[q] = answer  # No CD available for this question
        else:
            sim_answers[q] = answer

    if not has_cd:
        return None  # No sim-CD questions in path; identical to direct path

    # Simulate Feature Scoring, answering questions in display order.
    # Continue until:
    # - rank #1 achieved with strict score lead AND no more sim-CD questions remain unshown
    # - OR Feature Scoring shows no more answerable questions
    answers        = {}
    question_order = []
    path           = []
    sim_cd_qs      = {q for q, a in sim_answers.items() if a.startswith('Cannot determine')}
    MAX_STEPS      = 50

    for step_num in range(MAX_STEPS):
        scores   = score_all(answers, feature_matrix)
        qs, _    = get_display_questions(answers, scores, feature_matrix, q_meta, q_cov,
                                          tree_nodes, question_order)

        # Find the first unanswered question in the visible window (15-cap) that
        # this species knows how to answer.  Canonical-path questions are answered
        # from sim_answers.  Sim-CD questions that appear in the display but are NOT
        # on the canonical path are answered as "Cannot determine" — Feature Scoring
        # shows them (because they discriminate competing species), and a user who
        # can't see the upperside/space 1-3 would answer them CD too.
        unanswered_seen = 0
        next_q          = None
        next_q_answer   = None
        for q in qs:
            if q not in answers:
                unanswered_seen += 1
                if unanswered_seen > 15:
                    break
                if q in sim_answers:
                    next_q        = q
                    next_q_answer = sim_answers[q]
                    break
                elif is_sim_cd_question(q):
                    cd_label = get_cd_choice_for_question(tree_nodes, q)
                    if cd_label:
                        next_q        = q
                        next_q_answer = cd_label
                        sim_cd_qs.add(q)   # track for stop condition
                        break

        if next_q is None:
            break  # No more answerable questions in the visible window

        answers[next_q] = next_q_answer
        path.append({'question': next_q, 'choice': next_q_answer})

        # Stop when species is ranked #1 with strictly better score than #2
        # AND all sim-CD questions that are in the feature pool have been answered.
        scores = score_all(answers, feature_matrix)
        if (scores and scores[0]['name'] == result_name and
                (len(scores) < 2 or scores[0]['score'] > scores[1]['score'])):
            # Check if any sim-CD questions still haven't appeared yet
            answered_qs = set(answers.keys())
            remaining_cd = sim_cd_qs - answered_qs
            # Only stop if no remaining sim-CD questions are expected
            if not remaining_cd:
                break
            # Otherwise keep going to show the CD steps

    if not path:
        return None

    # Compare with canonical path (same questions/answers in same order?)
    canonical_path = [{'question': q, 'choice': canonical_answers[q]}
                      for q in [s['question'] for s in path]
                      if q in canonical_answers]
    if path == canonical_path:
        return None  # Identical to direct path; nothing to show

    return path

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    with open(TREE_PATH) as f:
        tree_data = json.load(f)
    with open(SPECIES_PATH) as f:
        species_data = json.load(f)

    print("Building tree paths and feature matrix...")
    paths_map = build_tree_paths(tree_data)
    matrix, q_meta, q_cov, result_notes = build_feature_matrix(tree_data, paths_map)
    print(f"  {len(matrix)} species, {len(q_meta)} questions")

    tree_nodes = tree_data['nodes']
    q_numbers  = build_question_numbers(tree_data)

    result_features_map = {}
    for node in tree_nodes.values():
        if node.get('type') == 'result' and node.get('name') and node.get('features'):
            result_features_map[node['name']] = node['features']

    sim_cd_paths = {}
    has_path = 0

    # Process each unique result name (sorted for stable output)
    seen_names = set()
    for node in tree_nodes.values():
        if node.get('type') != 'result':
            continue
        name = node.get('name', '')
        if not name or name in seen_names:
            continue
        seen_names.add(name)

        canonical_answers = matrix.get(name)
        if not canonical_answers:
            continue

        path = compute_sim_cd_path(name, matrix, q_meta, q_cov, tree_nodes, canonical_answers)

        if path:
            sim_cd_paths[name] = path
            has_path += 1

    print(f"\nSim-CD paths: {has_path} of {len(seen_names)} species\n")

    # Print sample for A. major major
    test_name = 'Arhopala major major'
    if test_name in sim_cd_paths:
        print(f"=== Sample: {test_name} ===")
        for step in sim_cd_paths[test_name]:
            qn = q_numbers.get(step['question'], '?')
            cd_flag = ' [CD]' if step['choice'].startswith('Cannot determine') else ''
            print(f"  Q{qn}: {step['question'][:65]}{cd_flag}")
            print(f"       -> {step['choice'][:70]}")
    else:
        print(f"{test_name}: no sim-CD path")

    with open(OUTPUT_PATH, 'w') as f:
        json.dump(sim_cd_paths, f, ensure_ascii=False, indent=2)

    print(f"\nWrote {len(sim_cd_paths)} paths to {OUTPUT_PATH}")

if __name__ == '__main__':
    main()
