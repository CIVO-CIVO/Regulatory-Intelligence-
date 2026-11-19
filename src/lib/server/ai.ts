import 'server-only';
// Model access. Production: Vercel AI Gateway with the project's OIDC token (no stored keys),
// zero data retention required. Direct provider keys are optional overrides. Dev-only backends
// (Jev mock, Claude Code CLI) are refused on Vercel so production can never silently fake results.

import {
  experimental_decide as decide,
  generateText,
  Output,
  type Experimental_DecisionQuestion,
  type Experimental_DecisionState,
} from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import type { DecisionAnswer, DecisionQuestion } from '../jev';
import { mockDecide } from './jev-mock';

export const JEV_MODEL = 'typesafe-ai/jev-1.14.0'; // pinned, never the moving alias
const TYPESAFE_MODEL = 'jev-1.14.0';
// Owner's rule (2026-11-19): no high-end models. NanoGPT (billed from the balance) is the main path.
const NANO = {
  main: process.env.NANOGPT_MODEL?.trim() || 'deepseek/deepseek-v4.1-flash',
  fallback: process.env.NANOGPT_FALLBACK_MODEL?.trim() || 'z-ai/glm-5.3',
};
const LLM = {
  strong: { gateway: 'anthropic/claude-haiku-5.5', direct: 'claude-haiku-5-5' },
  fast: { gateway: 'anthropic/claude-haiku-5.5', direct: 'claude-haiku-5-5' },
} as const;
export type LlmTier = keyof typeof LLM;

// Dev-only backends need an explicit opt-in and are refused on Vercel and in production builds.
const devBackendsAllowed =
  !process.env.VERCEL && (process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_BACKENDS === '1');
const GATEWAY_OPTS = { gateway: { zeroDataRetention: true } };

export function jevBackend(): 'mock' | 'typesafe' | 'gateway' {
  if (process.env.JEV_BACKEND === 'mock' && devBackendsAllowed) return 'mock';
  if (process.env.TYPESAFE_API_KEY?.trim()) return 'typesafe';
  return 'gateway';
}

export function llmBackend(): 'claude-cli' | 'nanogpt' | 'anthropic' | 'gateway' {
  if (process.env.LLM_BACKEND === 'claude-cli' && devBackendsAllowed) return 'claude-cli';
  if (process.env.NANOGPT_API_KEY?.trim()) return 'nanogpt';
  if (process.env.ANTHROPIC_API_KEY?.trim()) return 'anthropic';
  return 'gateway';
}

export function engines() {
  const jev = jevBackend();
  const llm = llmBackend();
  return {
    jev: jev === 'mock' ? 'Jev MOCK (dev only)' : `Jev 1.14.0 via ${jev === 'typesafe' ? 'TypeSafe' : 'AI Gateway'}`,
    llm:
      llm === 'claude-cli'
        ? 'Claude via Claude Code CLI (dev only)'
        : llm === 'nanogpt'
          ? `${modelLabel(NANO.main)} via NanoGPT (balance)`
          : `Claude Haiku 5.5 via ${llm === 'anthropic' ? 'Anthropic' : 'AI Gateway'}`,
    mock: jev === 'mock',
  };
}

// ---------------------------------------------------------------- LLM

export async function llmObject<T>(opts: {
  tier: LlmTier;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
}): Promise<T> {
  const backend = llmBackend();
  if (backend === 'nanogpt') return nanoObject(opts);
  if (backend === 'claude-cli') {
    const { cliObject } = await import('./claude-cli');
    return cliObject({ ...opts, model: LLM[opts.tier].direct });
  }
  const model =
    backend === 'anthropic'
      ? createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(LLM[opts.tier].direct)
      : LLM[opts.tier].gateway;
  const res = await generateText({
    model,
    system: opts.system,
    prompt: opts.prompt,
    output: Output.object({ schema: opts.schema }),
    maxOutputTokens: opts.maxOutputTokens ?? 16000,
    reasoning: opts.tier === 'strong' ? 'low' : 'none',
    providerOptions: backend === 'gateway' ? GATEWAY_OPTS : undefined,
    abortSignal: opts.abortSignal,
    maxRetries: 2,
  });
  return res.output as T;
}

function modelLabel(id: string): string {
  const known: Record<string, string> = {
    'deepseek/deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
    'z-ai/glm-5.3': 'GLM-5.3',
  };
  return known[id] ?? id;
}

/**
 * NanoGPT (OpenAI-compatible). Always billed from the account BALANCE: the account also has a
 * subscription whose weekly allowance runs out and then refuses requests, so every call forces
 * pay-as-you-go (header X-Billing-Mode + body billing_mode). Main model first, fallback model once.
 */
async function nanoObject<T>(opts: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
}): Promise<T> {
  const schema = z.toJSONSchema(opts.schema);
  const system = `${opts.system}\n\nReply with one JSON object only (no prose, no code fences) matching this JSON Schema:\n${JSON.stringify(schema)}`;
  let lastErr: unknown;
  for (const model of [NANO.main, NANO.fallback]) {
    const t0 = Date.now();
    try {
      const res = await fetch('https://nano-gpt.com/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.NANOGPT_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Billing-Mode': 'paygo',
        },
        body: JSON.stringify({
          model,
          billing_mode: 'paygo',
          temperature: 0.2,
          max_tokens: opts.maxOutputTokens ?? 16000,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: opts.prompt },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } },
        }),
        signal: opts.abortSignal ?? AbortSignal.timeout(240_000),
      });
      const text = await res.text();
      if (!res.ok) throw Object.assign(new Error(`NanoGPT HTTP ${res.status}: ${text.slice(0, 300)}`), { statusCode: res.status, responseBody: text.slice(0, 2000) });
      const json = JSON.parse(text) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const content = json.choices?.[0]?.message?.content ?? '';
      if (json.choices?.[0]?.finish_reason === 'length') throw new Error(`${model} ran out of output tokens`);
      const parsed = opts.schema.parse(JSON.parse(firstJsonObject(content)));
      console.log(`[llm] ${model} ok ${Date.now() - t0} ms, tokens ${json.usage?.prompt_tokens ?? '?'} in / ${json.usage?.completion_tokens ?? '?'} out`);
      return parsed;
    } catch (err) {
      lastErr = err;
      console.warn(`[llm] ${model} failed after ${Date.now() - t0} ms: ${String((err as Error).message ?? err).slice(0, 200)}`);
      if ((err as { statusCode?: number }).statusCode === 401) break; // bad key: the fallback will not help
    }
  }
  throw lastErr;
}

/** The first balanced {...} object in a model reply (ignores fences, think tags and trailing prose). */
export function firstJsonObject(s: string): string {
  const cleaned = s.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = cleaned.indexOf('{');
  if (start < 0) throw new Error('No JSON object in the reply.');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return cleaned.slice(start, i + 1);
  }
  throw new Error('Unterminated JSON object in the reply.');
}

// ---------------------------------------------------------------- Jev

export interface DecideResult {
  answers: Record<string, DecisionAnswer>;
  model: string;
  ms: number;
  inputTokens?: number;
}

export async function jevDecide(
  state: Record<string, unknown>,
  questions: Record<string, DecisionQuestion>,
  abortSignal?: AbortSignal,
): Promise<DecideResult> {
  const t0 = Date.now();
  const backend = jevBackend();
  if (backend === 'mock') {
    return { answers: mockDecide(state, questions), model: 'jev-mock (dev only)', ms: Date.now() - t0 };
  }
  if (backend === 'typesafe') return typesafeDecide(state, questions, t0, abortSignal);
  const res = await decide({
    model: JEV_MODEL,
    state: state as unknown as Experimental_DecisionState,
    questions: questions as unknown as Record<string, Experimental_DecisionQuestion>,
    maxRetries: 3,
    abortSignal,
    providerOptions: GATEWAY_OPTS,
  });
  const r = res as unknown as {
    answers: Record<string, DecisionAnswer>;
    usage?: { inputTokens?: number };
    response?: { modelId?: string };
  };
  return {
    answers: r.answers,
    model: r.response?.modelId ?? JEV_MODEL,
    ms: Date.now() - t0,
    inputTokens: r.usage?.inputTokens,
  };
}

/** Direct TypeSafe System One API (used only when TYPESAFE_API_KEY is set). */
async function typesafeDecide(
  state: Record<string, unknown>,
  questions: Record<string, DecisionQuestion>,
  t0: number,
  abortSignal?: AbortSignal,
): Promise<DecideResult> {
  const wireQuestions = Object.fromEntries(
    Object.entries(questions).map(([id, q]) => [id, { ...q, type: q.type === 'boolean' ? 'noul' : q.type }]),
  );
  const body = JSON.stringify({ model: TYPESAFE_MODEL, state, questions: wireQuestions });
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res: Response;
    try {
      res = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
        body,
        signal: abortSignal,
        redirect: 'error',
      });
    } catch (err) {
      // Dropped connections ("fetch failed": a reused keep-alive socket the server already closed,
      // a reset, a DNS blip) are retried; an abort from the caller is not.
      if (abortSignal?.aborted || attempt === 4) throw err;
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      console.warn(`[jev] network error, retry ${attempt}: ${(err as Error).message} ${cause?.code ?? ''} ${cause?.message ?? ''}`);
      await new Promise((r) => setTimeout(r, 150 * 2 ** attempt));
      continue;
    }
    if ([429, 500, 502, 503, 504, 529].includes(res.status) && attempt < 4) {
      await res.body?.cancel();
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`TypeSafe HTTP ${res.status}`);
    const json = (await res.json()) as {
      model: string;
      answers: Record<string, { type: string; noul?: number; choice?: string; probabilities?: Record<string, number> }>;
      usage?: { input_tokens?: number };
    };
    const answers: Record<string, DecisionAnswer> = {};
    for (const [id, a] of Object.entries(json.answers)) {
      if (a.type === 'noul') answers[id] = { type: 'boolean', probability: a.noul ?? 0 };
      else if (a.type === 'choice') answers[id] = { type: 'choice', choice: a.choice ?? '', probabilities: a.probabilities };
      else answers[id] = { type: 'refusal' };
    }
    return { answers, model: json.model, ms: Date.now() - t0, inputTokens: json.usage?.input_tokens };
  }
  throw new Error('TypeSafe retries exhausted');
}

/** Turn provider errors into a short message the UI can show and act on. */
export function describeAiError(err: unknown): { message: string; code: string } {
  type E = { message?: string; statusCode?: number; responseBody?: string; type?: string; lastError?: E; cause?: E; errors?: E[] };
  const chain: E[] = [];
  const walk = (e: E | undefined, depth = 0) => {
    if (!e || depth > 4 || typeof e !== 'object') return;
    chain.push(e);
    walk(e.lastError, depth + 1);
    walk(e.cause, depth + 1);
    e.errors?.forEach((x) => walk(x, depth + 1));
  };
  walk(err as E);
  // Only status codes, error types and response bodies count; never stack traces.
  const bodies = chain.map((e) => `${e.type ?? ''} ${e.responseBody ?? ''}`).join(' ');
  const statuses = chain.map((e) => e.statusCode).filter((x): x is number => typeof x === 'number');
  const text = String((err as E)?.message ?? err);
  if (/customer_verification_required|credit card on file/i.test(`${bodies} ${text}`)) {
    return {
      code: 'gateway_card_required',
      message:
        'The AI connection is not active yet: the Vercel team needs a payment card on file for AI Gateway. Add it in Vercel (team settings, AI Gateway) and try again.',
    };
  }
  if (statuses.includes(401) || statuses.includes(403) || /authentication_error|invalid_api_key|oidc token/i.test(bodies)) {
    return { code: 'auth', message: 'The AI connection could not authenticate. Check the deployment settings.' };
  }
  if (statuses.includes(429)) return { code: 'rate_limit', message: 'The AI service is busy. Try again in a moment.' };
  if (/fetch failed|ECONNRESET|socket|ETIMEDOUT|EAI_AGAIN/i.test(text)) {
    return { code: 'network', message: 'Could not reach the AI service (network error). Use "Check now" to try again.' };
  }
  return { code: 'error', message: text.slice(0, 300) };
}
