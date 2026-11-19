// Bake-off: cheap NanoGPT models on the real requirement-extraction task, scored by our own quote verification.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { REQUIREMENTS_SYSTEM, requirementsSchema } from '../src/lib/server/prompts.ts';
import { locateQuote } from '../src/lib/text.ts';

const ex = new URL('../public/examples/', import.meta.url).pathname;
const sources = [
  { id: 'D1', name: '21 CFR 807 subpart E.pdf', text: readFileSync(ex + '21-CFR-807-subpart-E.txt', 'utf8') },
  { id: 'D2', name: 'FDA guidance - 510(k) format.txt', text: readFileSync(ex + 'FDA-guidance-510k-format-excerpt.txt', 'utf8') },
  { id: 'D3', name: 'ISO 10993-1 summary.txt', text: readFileSync(ex + 'ISO-10993-1-summary-internal.txt', 'utf8') },
];
const prompt = `Project: FlexiGuard 510(k)
What the user is writing: A traditional 510(k) premarket notification to the US FDA for the FlexiGuard FG-200 wound dressing.

Rule documents:

${sources.map((s) => `<document id="${s.id}" name="${s.name}">\n${s.text}\n</document>`).join('\n\n')}

Build the requirement map now.`;
const schema = z.toJSONSchema(requirementsSchema);
const system = `${REQUIREMENTS_SYSTEM}\n\nReply with one JSON object only, matching this JSON Schema:\n${JSON.stringify(schema)}`;

async function run(model: string, mode: 'json_schema' | 'json_object') {
  const t0 = Date.now();
  const res = await fetch('https://nano-gpt.com/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.NANOGPT_API_KEY}`, 'Content-Type': 'application/json', 'X-Billing-Mode': 'paygo' },
    body: JSON.stringify({
      model, temperature: 0.2, max_tokens: 16000, billing_mode: 'paygo',
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      response_format: mode === 'json_schema' ? { type: 'json_schema', json_schema: { name: 'requirement_map', strict: true, schema } } : { type: 'json_object' },
    }),
  });
  const ms = Date.now() - t0;
  const j: any = await res.json().catch(() => null);
  if (!res.ok) return { model, mode, ok: false, status: res.status, err: JSON.stringify(j).slice(0, 200), ms };
  const content: string = j.choices?.[0]?.message?.content ?? '';
  let parsed: any, valid = false, zerr = '';
  try {
    const start = content.indexOf('{');
    parsed = JSON.parse(content.slice(start, content.lastIndexOf('}') + 1));
    requirementsSchema.parse(parsed); valid = true;
  } catch (e) { zerr = String(e).slice(0, 160); }
  let verified = 0, total = 0;
  for (const r of parsed?.requirements ?? []) {
    total++;
    const d = sources.find((s) => s.id === r.docId);
    if ((d && locateQuote(d.text, r.quote)) || sources.some((s) => locateQuote(s.text, r.quote))) verified++;
  }
  return { model, mode, ok: true, valid, zerr, reqs: total, verified, cats: parsed?.categories?.length, ms,
    inTok: j.usage?.prompt_tokens, outTok: j.usage?.completion_tokens, cost: j.usage?.cost ?? j.cost ?? j.x_nanogpt_pricing, sample: (parsed?.requirements ?? []).slice(0, 3).map((r: any) => `${r.category} / ${r.title}: ${r.need}`) };
}

const models = (process.argv[2] ?? 'deepseek/deepseek-v4.1-flash,z-ai/glm-5.3-flash,qwen/qwen3.8-flash').split(',');
const mode = (process.argv[3] ?? 'json_schema') as 'json_schema' | 'json_object';
const results = await Promise.all(models.map((m) => run(m, mode).catch((e) => ({ model: m, ok: false, err: String(e) }))));
for (const r of results) console.log(JSON.stringify(r, null, 1));
