'use client';
export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
  }
}

/** POST JSON; large bodies are gzipped in the browser to stay under the function body limit. */
export async function postJson<T>(url: string, body: unknown, opts: { gzip?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  const json = JSON.stringify(body);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let payload: BodyInit = json;
  if (opts.gzip && typeof CompressionStream !== 'undefined' && json.length > 50_000) {
    payload = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
    headers['x-body-encoding'] = 'gzip';
  }
  const res = await fetch(url, { method: 'POST', headers, body: payload, signal: opts.signal });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(res.status === 504 ? 'The analysis took too long. Try fewer or smaller files.' : `Server error (${res.status}).`, 'http', res.status);
  }
  if (!res.ok) {
    const d = data as { error?: string; code?: string };
    throw new ApiError(d.error ?? `Server error (${res.status}).`, d.code ?? 'http', res.status);
  }
  return data as T;
}
