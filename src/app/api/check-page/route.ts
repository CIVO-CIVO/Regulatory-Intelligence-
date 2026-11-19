import { checkPage } from '@/lib/server/pipeline';
import { describeAiError } from '@/lib/server/ai';
import { errorResponse, HttpError, readJson } from '@/lib/server/http';
import type { FactPassage, PageText, Requirement } from '@/lib/types';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

interface Body {
  page: PageText;
  rules: Requirement[];
  facts: FactPassage[];
  docs: { id: string; name: string }[];
}

/** Engine 2: check one draft page. Relevance first, then graded compliance for the relevant rules. */
export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const body = await readJson<Body>(req, 12_000_000);
    if (typeof body.page?.text !== 'string' || body.page.text.length > 400_000) throw new HttpError(413, 'This page is too long to check in one go. Split it into pages.');
    if (!Array.isArray(body.rules) || body.rules.length > 600) throw new HttpError(400, 'Too many rules.');
    const names = new Map((body.docs ?? []).map((d) => [d.id, d.name]));
    const out = await checkPage(body.page, body.rules, (body.facts ?? []).slice(0, 20), (id) => names.get(id) ?? id);
    const relevant = Object.values(out.rules).filter((r) => r.relevant).length;
    console.log(`[check-page] ${body.rules.length} rules, ${relevant} relevant, ${out.jevCalls} Jev calls, ${Date.now() - t0} ms${out.errors.length ? `, ${out.errors.length} errors` : ''}`);
    if (out.jevCalls === 0 && out.errors.length) {
      const d = describeAiError(new Error(out.errors[0]));
      return Response.json({ error: d.message, code: d.code }, { status: 502 });
    }
    return Response.json({ ...out, errors: out.errors.slice(0, 3) });
  } catch (err) {
    return errorResponse(err);
  }
}
