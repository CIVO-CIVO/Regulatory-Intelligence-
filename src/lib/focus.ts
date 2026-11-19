// Focus settings: the user's plain-language priorities, turned by the LLM into a plan, applied here
// in code to the ORIGINAL checklist (never cumulative, always reversible).

import type { Criticality, FocusChange, Requirement } from './types';

export interface FocusPlanItem {
  id: string;
  priority: Criticality | 'unchanged';
  muted: boolean;
  rank: number; // 1 = most important in its category, 0 = unchanged
  topic: string; // "" = unchanged
  complies: string; // "" = unchanged
  conflicts: string; // "" = unchanged
  reason: string;
}

export interface FocusPlan {
  summary: string;
  notes: string[];
  categoryOrder: string[];
  requirements: FocusPlanItem[];
}

const CRIT_ORDER: Record<Criticality, number> = { critical: 0, major: 1, minor: 2 };

export function applyFocus(
  base: Requirement[],
  baseCategories: string[],
  plan: FocusPlan,
): { requirements: Requirement[]; categories: string[]; changes: FocusChange[] } {
  const reqs: Requirement[] = structuredClone(base).map((r: Requirement) => ({ ...r, muted: undefined, rank: undefined, focusNote: undefined }));
  const byId = new Map(reqs.map((r) => [r.id, r]));
  const changes: FocusChange[] = [];

  for (const item of plan.requirements) {
    const r = byId.get(item.id);
    if (!r) continue;
    const what: string[] = [];
    if (item.priority !== 'unchanged' && item.priority !== r.criticality) {
      what.push(`priority ${r.criticality} → ${item.priority}`);
      r.criticality = item.priority;
    }
    if (item.muted) {
      r.muted = true;
      what.push('muted');
    }
    if (item.rank > 0) r.rank = Math.round(item.rank);
    if (item.topic.trim()) {
      r.topic = item.topic.trim();
      what.push('applies to different text');
    }
    if (item.complies.trim()) {
      r.complies = item.complies.trim();
      what.push('what counts as following it changed');
    }
    if (item.conflicts.trim()) {
      r.conflicts = item.conflicts.trim();
      what.push('what counts as breaking it changed');
    }
    if (what.length || item.rank > 0) {
      r.focusNote = item.reason.trim() || undefined;
      if (what.length) changes.push({ reqId: r.id, title: r.title, what: what.join('; ') });
    }
  }

  const known = new Set(baseCategories);
  const ordered = plan.categoryOrder.filter((c, i, a) => known.has(c) && a.indexOf(c) === i);
  const categories = [...ordered, ...baseCategories.filter((c) => !ordered.includes(c))];

  const pos = new Map(base.map((r, i) => [r.id, i]));
  const sorted = categories.flatMap((c) =>
    reqs
      .filter((r) => r.category === c)
      .sort(
        (a, b) =>
          (a.rank ?? 999) - (b.rank ?? 999) ||
          CRIT_ORDER[a.criticality] - CRIT_ORDER[b.criticality] ||
          (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0),
      ),
  );
  if (ordered.length && ordered.join('|') !== baseCategories.slice(0, ordered.length).join('|')) {
    changes.unshift({ reqId: '', title: 'Category order', what: categories.join(', ') });
  }
  return { requirements: sorted, categories, changes };
}
