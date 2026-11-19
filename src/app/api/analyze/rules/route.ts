import { extractRules } from '@/lib/server/pipeline';
import { errorResponse, HttpError, readJson } from '@/lib/server/http';

export const maxDuration = 300;

interface Body {
  name: string;
  description: string;
  doc: { id: string; name: string; text: string };
  otherDocs: string[];
  part?: { n: number; of: number; offset: number };
}

/** Engine 2, step 1: the rules of ONE regulatory document (documents run in parallel). */
export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const body = await readJson<Body>(req);
    if (!body.doc?.text) throw new HttpError(400, 'No document text.');
    if (body.doc.text.length > 400_000) throw new HttpError(413, `${body.doc.name}: one part is too long.`);
    const out = await extractRules(body.doc, { name: body.name, description: body.description, otherDocs: body.otherDocs ?? [], part: body.part });
    console.log(`[rules] ${body.doc.name}${body.part ? ` part ${body.part.n}/${body.part.of}` : ''}: ${out.rules.length} kept, ${out.dropped.length} dropped, ${Date.now() - t0} ms`);
    return Response.json(out);
  } catch (err) {
    return errorResponse(err);
  }
}
