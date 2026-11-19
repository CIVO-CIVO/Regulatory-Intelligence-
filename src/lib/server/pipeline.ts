import 'server-only';
// Engine 2 pipeline, shared by the API routes and the validation harness (scripts/validate-pages.mts).

import { jevDecide, llmObject } from './ai';
import { CRITERIA_SYSTEM, GROUPS_SYSTEM, RULES_SYSTEM, criteriaSchema, groupsSchema, rulesSchema } from './prompts';
import { locateQuote, pageAt, splitSections } from '../text';
import {
  chunkSections,
  combineChunks,
  complianceQuestion,
  relevanceQuestion,
  RELEVANT_AT,
  type BoolQ,
  type ChoiceQ,
} from '../rules';
import type { DroppedRequirement, FactPassage, PageText, Requirement, RuleCheck } from '../types';
import type { DecisionAnswer, DecisionQuestion } from '../jev';

export interface SourceDoc {
  id: string;
  name: string;
  text: string;
}

// ------------------------------------------------------------ 1. rules from one document

export async function extractRules(
  doc: SourceDoc,
  ctx: { name: string; description: string; otherDocs: string[]; part?: { n: number; of: number; offset: number } },
): Promise<{ rules: Requirement[]; dropped: DroppedRequirement[] }> {
  const offset = ctx.part?.offset ?? 0;
  const prompt = `Project: ${ctx.name}
What the user is writing: ${ctx.description || '(not stated; infer from the documents)'}
Other files in the project: ${ctx.otherDocs.join('; ') || 'none'}

The regulatory document${ctx.part && ctx.part.of > 1 ? ` (part ${ctx.part.n} of ${ctx.part.of}; extract the rules in this part only)` : ''}:
<document id="${doc.id}" name="${doc.name.replace(/"/g, "'")}">
${doc.text}
</document>

Extract the rules now.`;
  const out = await llmObject({ tier: 'strong', system: RULES_SYSTEM, prompt, schema: rulesSchema, maxOutputTokens: 24000 });
  const rules: Requirement[] = [];
  const dropped: DroppedRequirement[] = [];
  const seen = new Set<number>();
  for (const r of out.rules) {
    const hit = locateQuote(doc.text, r.quote);
    if (!hit) {
      dropped.push({ title: `${r.section} ${r.title}`.trim(), reason: 'Its quotation could not be found in your files, so it was left out.' });
      continue;
    }
    if (seen.has(hit.start)) continue;
    seen.add(hit.start);
    rules.push({
      id: '',
      category: r.category.trim(),
      section: r.section.trim(),
      title: r.title.trim(),
      need: r.need.trim(),
      criticality: r.criticality,
      quote: { docId: doc.id, text: hit.text, start: offset + hit.start, end: offset + hit.end, page: pageAt(doc.text, hit.start), match: hit.match },
      questions: [],
      evidence: [],
    });
  }
  return { rules, dropped };
}

// ------------------------------------------------------------ 1b. fewer, readable categories

/** Map many fine categories to 6-12 groups. Returns the ordered group names and a category -> group map. */
export async function groupCategories(categories: string[], counts: Record<string, number>): Promise<{ order: string[]; map: Record<string, string> }> {
  if (categories.length <= 10) return { order: categories, map: Object.fromEntries(categories.map((c) => [c, c])) };
  const out = await llmObject({
    tier: 'fast',
    system: GROUPS_SYSTEM,
    prompt: `Categories (with number of rules):\n${categories.map((c) => `- ${c} (${counts[c] ?? 0})`).join('\n')}`,
    schema: groupsSchema,
    maxOutputTokens: 4000,
  });
  const map: Record<string, string> = {};
  const order: string[] = [];
  for (const g of out.groups) {
    const name = g.name.trim();
    for (const m of g.members) if (categories.includes(m) && !map[m]) map[m] = name;
    if (!order.includes(name)) order.push(name);
  }
  for (const c of categories) if (!map[c]) { map[c] = c; order.push(c); } // anything the model missed keeps its own name
  return { order: order.filter((g) => Object.values(map).includes(g)), map };
}

// ------------------------------------------------------------ 2. Jev criteria for a batch of rules

export async function writeCriteria(rules: Requirement[], ctx: { description: string }): Promise<Requirement[]> {
  const list = rules
    .map((r) => `<rule id="${r.id}" section="${r.section ?? ''}" title="${r.title}">\nRequires: ${r.need}\nQuote: "${r.quote.text.replace(/\s+/g, ' ')}"\n</rule>`)
    .join('\n');
  const out = await llmObject({
    tier: 'strong',
    system: CRITERIA_SYSTEM,
    prompt: `What the user is writing: ${ctx.description || '(not stated)'}\n\nRules:\n${list}\n\nReturn one entry per rule id.`,
    schema: criteriaSchema,
    maxOutputTokens: 12000,
  });
  return rules.map((r) => {
    const c = out.rules.find((x) => x.id === r.id);
    return c ? { ...r, topic: c.topic.trim(), complies: c.complies.trim(), conflicts: c.conflicts.trim(), hint: c.hint.trim() || r.hint } : r;
  });
}

// ------------------------------------------------------------ 3. check one page

const REL_PER_REQUEST = 45;
const CMP_PER_REQUEST = 10;

async function ask(state: Record<string, unknown>, questions: Record<string, BoolQ | ChoiceQ>) {
  return jevDecide(state, questions as unknown as Record<string, DecisionQuestion>);
}

function batches<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export async function checkPage(
  page: PageText,
  rules: Requirement[],
  facts: FactPassage[],
  docName: (id: string) => string,
  opts: { askFrom?: number } = {},
): Promise<{ rules: Record<string, RuleCheck>; model?: string; jevCalls: number; partial: boolean; errors: string[] }> {
  const askFrom = opts.askFrom ?? RELEVANT_AT; // the harness asks lower to collect tuning data
  const sections = splitSections(page.text);
  const chunks = chunkSections(sections);
  const errors: string[] = [];
  let model: string | undefined;
  let jevCalls = 0;
  const parts = new Map<string, { relevance: number; probs?: Record<string, number>; sections: string[] }[]>();

  await Promise.all(
    chunks.map(async (chunk) => {
      const PAGE = chunk.map((s) => ({ section: s.heading || 'Untitled section', text: s.text }));
      const names = chunk.map((s) => s.heading || 'Untitled section');
      // Stage 1: relevance for every rule (PAGE only, so persuasive facts cannot make a page "relevant").
      const rel = new Map<string, number>();
      await Promise.all(
        batches(rules, REL_PER_REQUEST).map(async (b) => {
          try {
            const res = await ask({ PAGE }, Object.fromEntries(b.map((r) => [r.id, relevanceQuestion(r)])));
            jevCalls++;
            model ??= res.model;
            for (const r of b) {
              const a = res.answers[r.id] as DecisionAnswer | undefined;
              rel.set(r.id, a && a.type === 'boolean' ? a.probability : 0);
            }
          } catch (err) {
            errors.push(String((err as Error).message ?? err));
          }
        }),
      );
      // Stage 2: graded compliance, only where the page is about the rule.
      const relevant = rules.filter((r) => (rel.get(r.id) ?? 0) >= askFrom);
      const probs = new Map<string, Record<string, number>>();
      await Promise.all(
        batches(relevant, CMP_PER_REQUEST).map(async (b) => {
          try {
            const state: Record<string, unknown> = { PAGE };
            if (facts.length) state.PROJECT_FACTS = facts.map((f) => ({ source: f.source, text: f.text }));
            const res = await ask(state, Object.fromEntries(b.map((r) => [r.id, complianceQuestion(r, docName)])));
            jevCalls++;
            for (const r of b) {
              const a = res.answers[r.id] as DecisionAnswer | undefined;
              if (a && a.type === 'choice') probs.set(r.id, a.probabilities ?? { [a.choice]: 1 });
            }
          } catch (err) {
            errors.push(String((err as Error).message ?? err));
          }
        }),
      );
      for (const r of rules) {
        if (!rel.has(r.id)) continue;
        const list = parts.get(r.id) ?? [];
        list.push({ relevance: rel.get(r.id)!, probs: probs.get(r.id), sections: names });
        parts.set(r.id, list);
      }
    }),
  );

  const out: Record<string, RuleCheck> = {};
  for (const r of rules) {
    const p = parts.get(r.id);
    out[r.id] = p ? combineChunks(r.id, p) : { reqId: r.id, relevance: 0, relevant: false, tone: 'grey', error: 'Not checked' };
  }
  return { rules: out, model, jevCalls, partial: errors.length > 0, errors };
}
