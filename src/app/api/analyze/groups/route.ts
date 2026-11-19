import { groupCategories } from '@/lib/server/pipeline';
import { errorResponse, HttpError, readJson } from '@/lib/server/http';

export const maxDuration = 120;

/** Engine 2, step 2: fold many fine categories into a few readable groups. */
export async function POST(req: Request) {
  try {
    const body = await readJson<{ counts: Record<string, number> }>(req, 200_000);
    const names = Object.keys(body.counts ?? {});
    if (!names.length || names.length > 400) throw new HttpError(400, 'Bad category list.');
    return Response.json(await groupCategories(names, body.counts));
  } catch (err) {
    return errorResponse(err);
  }
}
