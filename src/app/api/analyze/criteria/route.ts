import { writeCriteria } from '@/lib/server/pipeline';
import { errorResponse, HttpError, readJson } from '@/lib/server/http';
import type { Requirement } from '@/lib/types';

export const maxDuration = 300;

/** Engine 2, step 3: Jev's judging criteria (topic, complies, conflicts, hint) for a batch of rules. */
export async function POST(req: Request) {
  try {
    const body = await readJson<{ description: string; rules: Requirement[] }>(req, 2_000_000);
    if (!body.rules?.length || body.rules.length > 12) throw new HttpError(400, 'Send 1 to 12 rules.');
    const rules = await writeCriteria(body.rules, { description: body.description ?? '' });
    return Response.json({ rules: rules.map((r) => ({ id: r.id, topic: r.topic, complies: r.complies, conflicts: r.conflicts, hint: r.hint })) });
  } catch (err) {
    return errorResponse(err);
  }
}
