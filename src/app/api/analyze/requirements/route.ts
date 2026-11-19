import { llmObject } from '@/lib/server/ai';
import { REQUIREMENTS_SYSTEM, requirementsSchema } from '@/lib/server/prompts';
import { errorResponse, HttpError, readJson } from '@/lib/server/http';
import { locateQuote, pageAt } from '@/lib/text';
import type { DroppedRequirement, Requirement } from '@/lib/types';

export const maxDuration = 300;

interface Body {
  name: string;
  description: string;
  docs: { id: string; name: string; role: string; title?: string }[];
  sources: { id: string; name: string; text: string }[];
}

const MAX_SOURCE_CHARS = 1_600_000;

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const body = await readJson<Body>(req);
    if (!body.sources?.length) throw new HttpError(400, 'No regulation, guidance or standard among the files.');
    const total = body.sources.reduce((n, s) => n + s.text.length, 0);
    if (total > MAX_SOURCE_CHARS) {
      throw new HttpError(413, `The rule documents hold ${Math.round(total / 1000)}k characters; the limit is ${MAX_SOURCE_CHARS / 1000}k. Remove some files.`);
    }
    const others = body.docs
      .filter((d) => !body.sources.some((s) => s.id === d.id))
      .map((d) => `- ${d.name} (${d.role})`)
      .join('\n');
    const sourceText = body.sources
      .map((s) => `<document id="${s.id}" name="${s.name.replace(/"/g, "'")}">\n${s.text}\n</document>`)
      .join('\n\n');
    const prompt = `Project: ${body.name}
What the user is writing: ${body.description || '(not stated; infer from the documents)'}

Other files the user uploaded as evidence (not rules, for context only):
${others || '- none'}

Rule documents:

${sourceText}

Build the requirement map now.`;

    const out = await llmObject({ tier: 'strong', system: REQUIREMENTS_SYSTEM, prompt, schema: requirementsSchema, maxOutputTokens: 24000 });

    // Every requirement must quote the uploaded text. Unverifiable ones are dropped, never shown.
    const byId = new Map(body.sources.map((s) => [s.id, s]));
    const categories = [...new Set(out.categories.map((c) => c.trim()).filter(Boolean))];
    const requirements: Requirement[] = [];
    const dropped: DroppedRequirement[] = [];
    const seen = new Set<string>();
    for (const r of out.requirements) {
      const tryDocs = [byId.get(r.docId), ...body.sources.filter((s) => s.id !== r.docId)].filter(Boolean) as Body['sources'];
      let quote: Requirement['quote'] | null = null;
      for (const d of tryDocs) {
        const hit = locateQuote(d.text, r.quote);
        if (hit) {
          quote = { docId: d.id, text: hit.text, start: hit.start, end: hit.end, page: pageAt(d.text, hit.start), match: hit.match };
          break;
        }
      }
      if (!quote) {
        dropped.push({ title: r.title, reason: 'Its quotation could not be found in your files, so it was left out.' });
        continue;
      }
      const key = `${quote.docId}:${quote.start}:${r.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      r.category = r.category.trim();
      if (!categories.includes(r.category)) categories.push(r.category);
      requirements.push({
        id: '',
        category: r.category,
        title: r.title.trim(),
        need: r.need.trim(),
        criticality: r.criticality,
        quote,
        questions: [],
        evidence: [],
      });
    }
    // Stable ids in display order.
    const ordered = categories.flatMap((c) => requirements.filter((r) => r.category === c));
    ordered.forEach((r, i) => (r.id = `R${i + 1}`));
    console.log(`[requirements] ${ordered.length} kept, ${dropped.length} dropped, ${Date.now() - t0} ms`);
    return Response.json({ categories: categories.filter((c) => ordered.some((r) => r.category === c)), requirements: ordered, dropped });
  } catch (err) {
    return errorResponse(err);
  }
}
