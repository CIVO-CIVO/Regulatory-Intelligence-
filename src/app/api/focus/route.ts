import { engines, llmObject } from '@/lib/server/ai';
import { FOCUS_SYSTEM, focusSchema } from '@/lib/server/prompts';
import { errorResponse, HttpError, readJson } from '@/lib/server/http';
import type { Requirement } from '@/lib/types';

export const maxDuration = 300;

interface Body {
  description: string;
  focus: string;
  categories: string[];
  requirements: Requirement[];
}

/** Turn the user's plain-language focus into a checklist plan (applied in code on the client). */
export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const body = await readJson<Body>(req, 6_000_000);
    const focus = (body.focus ?? '').trim();
    if (!focus) throw new HttpError(400, 'Write what Jev should focus on first.');
    if (focus.length > 6000) throw new HttpError(413, 'Keep the focus text under 6,000 characters.');
    if (!body.requirements?.length) throw new HttpError(400, 'The checklist is empty.');
    const checklist = body.categories
      .map((c) => {
        const rows = body.requirements
          .filter((r) => r.category === c)
          .map((r) => {
            const qs = r.questions
              .map((q) => `    - ${q.id} [${q.kind}] ${q.element}${q.trueWhen ? ` | true when: ${q.trueWhen}` : ''}${q.falseWhen ? ` | false when: ${q.falseWhen}` : ''}`)
              .join('\n');
            return `  <requirement id="${r.id}" title="${r.title}" priority="${r.criticality}">\n    Need: ${r.need}\n    Rule quote: "${r.quote.text.replace(/\s+/g, ' ').slice(0, 500)}"\n    Questions:\n${qs}\n  </requirement>`;
          })
          .join('\n');
        return `<category name="${c}">\n${rows}\n</category>`;
      })
      .join('\n');
    const prompt = `What the user is writing: ${body.description || '(not stated)'}

The user's focus, in their own words:
"""
${focus}
"""

The current checklist (built only from the user's uploaded documents):
${checklist}

Return the changes now.`;
    const plan = await llmObject({ tier: 'strong', system: FOCUS_SYSTEM, prompt, schema: focusSchema, maxOutputTokens: 12000 });
    const ids = new Set(body.requirements.map((r) => r.id));
    plan.requirements = plan.requirements.filter((x) => ids.has(x.id));
    console.log(`[focus] ${plan.requirements.length} changed, ${Date.now() - t0} ms`);
    return Response.json({ plan, model: engines().llm });
  } catch (err) {
    return errorResponse(err);
  }
}
