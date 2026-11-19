import 'server-only';
import { describeAiError } from './ai';

/** Read a JSON body that the browser may have gzipped (header x-body-encoding: gzip). */
export async function readJson<T>(req: Request, maxBytes = 40_000_000): Promise<T> {
  assertSameOrigin(req);
  let stream = req.body;
  if (!stream) throw new HttpError(400, 'Empty body');
  if (req.headers.get('x-body-encoding') === 'gzip') {
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) throw new HttpError(413, 'The files are too large to analyse in one go.');
    chunks.push(value);
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message, code: 'bad_request' }, { status: err.status });
  }
  const d = describeAiError(err);
  console.error('[api]', d.code, err);
  return Response.json({ error: d.message, code: d.code }, { status: d.code === 'gateway_card_required' ? 402 : 502 });
}

/** Browsers send Origin on POST; refuse other sites calling these endpoints on our AI credits. */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  // Browsers always send Origin (or Sec-Fetch-Site) on POST; a request with neither is not from this app.
  if (!origin) {
    if (req.headers.get('sec-fetch-site') === 'same-origin') return;
    throw new HttpError(403, 'Requests must come from the app.');
  }
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    if (new URL(origin).host !== host) throw new HttpError(403, 'Cross-site requests are not allowed.');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(403, 'Bad origin.');
  }
}
