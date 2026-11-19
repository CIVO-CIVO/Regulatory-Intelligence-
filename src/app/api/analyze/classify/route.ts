import { llmObject } from '@/lib/server/ai';
import { CLASSIFY_SYSTEM, classifySchema } from '@/lib/server/prompts';
import { errorResponse, HttpError, readJson } from '@/lib/server/http';

export const maxDuration = 120;

interface Body {
  description: string;
  docs: { id: string; name: string; kind: string; chars: number; head: string; tail: string }[];
}

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const body = await readJson<Body>(req, 2_000_000);
    if (!Array.isArray(body.docs) || body.docs.length === 0 || body.docs.length > 60) {
      throw new HttpError(400, 'Upload between 1 and 60 files.');
    }
    const files = body.docs
      .map(
        (d) =>
          `<file id="${d.id}" name="${esc(d.name)}" type="${d.kind}" characters="${d.chars}">\n${d.head.slice(0, 5000)}${
            d.tail ? `\n[...]\n${d.tail.slice(0, 1200)}` : ''
          }\n</file>`,
      )
      .join('\n\n');
    const out = await llmObject({
      tier: 'fast',
      system: CLASSIFY_SYSTEM,
      prompt: `The user is writing: ${body.description || '(not stated)'}\n\nFiles (start and end of each):\n\n${files}\n\nReturn every file id exactly once.`,
      schema: classifySchema,
      maxOutputTokens: 6000,
    });
    console.log(`[classify] ${body.docs.length} files, ${Date.now() - t0} ms`);
    return Response.json(out);
  } catch (err) {
    return errorResponse(err);
  }
}

const esc = (s: string) => s.replace(/"/g, "'").slice(0, 200);
