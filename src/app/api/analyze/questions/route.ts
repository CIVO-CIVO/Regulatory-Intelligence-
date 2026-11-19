import { llmObject } from '@/lib/server/ai';
import { QUESTIONS_SYSTEM, questionsSchema } from '@/lib/server/prompts';
import { errorResponse, HttpError, readJson } from '@/lib/server/http';
import { locateQuote, pageAt } from '@/lib/text';
import { lintElement } from '@/lib/lint';
import type { JevQuestionSpec, Quote, Requirement } from '@/lib/types';

export const maxDuration = 300;

interface Body {
  description: string;
  category: string;
  requirements: Pick<Requirement, 'id' | 'title' | 'need' | 'criticality' | 'quote'>[];
  evidence: { id: string; name: string; text: string }[];
}

const MAX_EVIDENCE_CHARS = 1_200_000;

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const body = await readJson<Body>(req);
    if (!body.requirements?.length) throw new HttpError(400, 'No requirements given.');
    const evidence = body.evidence ?? [];
    let budget = MAX_EVIDENCE_CHARS;
    const evidenceText = evidence
      .map((e) => {
        const text = e.text.slice(0, Math.max(0, budget));
        budget -= text.length;
        return `<evidence id="${e.id}" name="${e.name.replace(/"/g, "'")}">\n${text}\n</evidence>`;
      })
      .join('\n\n');
    const reqText = body.requirements
      .map((r) => `<requirement id="${r.id}" title="${r.title}" criticality="${r.criticality}">\nWhat the draft must contain: ${r.need}\nVerbatim rule: "${r.quote.text}"\n</requirement>`)
      .join('\n');
    const prompt = `What the user is writing: ${body.description || '(not stated)'}
Category: ${body.category}

Requirements in this category:
${reqText}

The applicant's EVIDENCE files:
${evidenceText || '(none uploaded)'}

Return one entry per requirement id.`;

    const out = await llmObject({ tier: 'strong', system: QUESTIONS_SYSTEM, prompt, schema: questionsSchema, maxOutputTokens: 16000 });

    const result = body.requirements.map((r) => {
      const o = out.requirements.find((x) => x.id === r.id);
      const questions: JevQuestionSpec[] = [];
      const verified: Quote[] = [];
      if (o) {
        for (const e of o.evidence.slice(0, 4)) {
          const docs = [evidence.find((d) => d.id === e.docId), ...evidence.filter((d) => d.id !== e.docId)].filter(Boolean) as Body['evidence'];
          for (const d of docs) {
            const hit = locateQuote(d.text, e.quote);
            if (hit) {
              if (!verified.some((v) => v.docId === d.id && v.start === hit.start)) {
                verified.push({ docId: d.id, text: hit.text, start: hit.start, end: hit.end, page: pageAt(d.text, hit.start), match: hit.match });
              }
              break;
            }
          }
        }
        o.coverage.slice(0, 3).forEach((c, i) => {
          const element = c.element.trim().replace(/[?.]+$/, '');
          if (!element) return;
          questions.push({ id: `${r.id}.${i + 1}`, kind: 'coverage', element, trueWhen: c.trueWhen.trim() || undefined, falseWhen: c.falseWhen.trim() || undefined, lint: lintElement(element) });
        });
        const claim = o.claim.trim().replace(/[?.]+$/, '');
        if (claim && verified.length) {
          questions.push({ id: `${r.id}.${questions.length + 1}`, kind: 'claim', element: claim, lint: lintElement(claim) });
        }
      }
      if (!questions.length) {
        // Fallback so every requirement is testable: ask for the need itself.
        const element = `what this requirement asks for: ${r.need.replace(/\.$/, '')}`;
        questions.push({ id: `${r.id}.1`, kind: 'coverage', element, lint: lintElement(element) });
      }
      return { id: r.id, questions, evidence: verified, hint: o?.hint?.trim() || undefined };
    });
    console.log(`[questions] ${body.category}: ${result.length} reqs, ${Date.now() - t0} ms`);
    return Response.json({ requirements: result });
  } catch (err) {
    return errorResponse(err);
  }
}
