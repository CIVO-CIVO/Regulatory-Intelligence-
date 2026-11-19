// Focus settings: the user's plain-language priorities, turned by the LLM into a plan, applied here
// in code to the ORIGINAL checklist (never cumulative, always reversible).

import { lintElement } from './lint';
import type { Criticality, FocusChange, Requirement } from './types';

export interface FocusPlanItem {
  id: string;
  priority: Criticality | 'unchanged';
  muted: boolean;
  rank: number; // 1 = most important in its category, 0 = unchanged
  sharpen: { questionId: string; trueWhen: string; falseWhen: string }[];
  addQuestions: { element: string; trueWhen: string; falseWhen: string }[];
  reason: string;
}

export interface FocusPlan {
  summary: string;
  notes: string[];
  categoryOrder: string[];
  requirements: FocusPlanItem[];
}

const MAX_QUESTIONS = 5;
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
    for (const sh of item.sharpen) {
      const q = r.questions.find((x) => x.id === sh.questionId);
      if (!q) continue;
      if (sh.trueWhen.trim()) q.trueWhen = sh.trueWhen.trim();
      if (sh.falseWhen.trim()) q.falseWhen = sh.falseWhen.trim();
      what.push(`criteria changed for "${q.element}"`);
    }
    let n = 0;
    for (const add of item.addQuestions) {
      const element = add.element.trim().replace(/[?.]+$/, '');
      if (!element || r.questions.length >= MAX_QUESTIONS) continue;
      n++;
      r.questions.push({
        id: `${r.id}.f${n}`,
        kind: 'coverage',
        element,
        trueWhen: add.trueWhen.trim() || undefined,
        falseWhen: add.falseWhen.trim() || undefined,
        lint: lintElement(element),
      });
      what.push(`new question: "${element}"`);
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
