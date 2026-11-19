import 'server-only';
// DEV ONLY stand-in for Jev: crude keyword and number matching so the interface can be exercised
// offline. It is never used on Vercel and every result it produces is labelled "jev-mock".
import type { DecisionAnswer, DecisionQuestion } from '../jev';
import { keywords } from '../text';

const nums = (s: string) => new Set((s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.')));

export function mockDecide(
  state: Record<string, unknown>,
  questions: Record<string, DecisionQuestion>,
): Record<string, DecisionAnswer> {
  const draft = JSON.stringify(state.DRAFT ?? '');
  const evidence = JSON.stringify(state.EVIDENCE ?? '');
  const draftWords = new Set(keywords(draft));
  const out: Record<string, DecisionAnswer> = {};
  for (const [id, q] of Object.entries(questions)) {
    const question = String((q.instructions as { question?: string }).question ?? '');
    const element = question.replace(/^.*?(state|about)\s+/i, '').replace(/ with the EVIDENCE.*$/i, '');
    const kw = keywords(element);
    const hit = kw.length ? kw.filter((w) => draftWords.has(w)).length / kw.length : 0;
    if (q.type === 'boolean') {
      out[id] = { type: 'boolean', probability: Math.min(0.97, Math.max(0.03, hit * hit * 1.15)) };
      continue;
    }
    const dn = nums(draft);
    const en = nums(evidence);
    let probs: Record<string, number>;
    if (hit < 0.35) probs = { supported: 0.04, partially_supported: 0.08, not_addressed: 0.82, contradicted: 0.02, insufficient_information: 0.04 };
    else {
      const shared = [...dn].filter((n) => en.has(n)).length;
      const foreign = [...dn].filter((n) => !en.has(n)).length;
      if (shared > 0 && foreign === 0) probs = { supported: 0.9, partially_supported: 0.06, not_addressed: 0.01, contradicted: 0.01, insufficient_information: 0.02 };
      else if (foreign > shared) probs = { supported: 0.1, partially_supported: 0.25, not_addressed: 0.05, contradicted: 0.55, insufficient_information: 0.05 };
      else probs = { supported: 0.55, partially_supported: 0.3, not_addressed: 0.08, contradicted: 0.03, insufficient_information: 0.04 };
    }
    const choice = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
    out[id] = { type: 'choice', choice, probabilities: probs };
  }
  return out;
}
