'use client';
import type { RequirementResult } from '../types';

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

export type EvalEvent =
  | { type: 'result'; result: RequirementResult }
  | { type: 'done'; ms: number; jobs: number; model?: string; error?: { code: string; message: string } | null };

/** Stream the live check: one event per requirement as Jev answers arrive. */
export async function streamEvaluate(body: unknown, onEvent: (e: EvalEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch('/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `Check failed (${res.status}).`;
    let code = 'http';
    try {
      const d = await res.json();
      msg = d.error ?? msg;
      code = d.code ?? code;
    } catch {}
    throw new ApiError(msg, code, res.status);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as EvalEvent);
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf) as EvalEvent);
}
