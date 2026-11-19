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
import type { z } from 'zod';
import type { DecisionAnswer, DecisionQuestion } from '../jev';
import { mockDecide } from './jev-mock';

export const JEV_MODEL = 'typesafe-ai/jev-1.14.0'; // pinned, never the moving alias
const TYPESAFE_MODEL = 'jev-1.14.0';
const LLM = {
  strong: { gateway: 'anthropic/claude-sonnet-5.5', direct: 'claude-sonnet-5-5' },
  fast: { gateway: 'anthropic/claude-haiku-5.5', direct: 'claude-haiku-5-5' },
} as const;
export type LlmTier = keyof typeof LLM;

const onVercel = Boolean(process.env.VERCEL);
const GATEWAY_OPTS = { gateway: { zeroDataRetention: true } };

export function jevBackend(): 'mock' | 'typesafe' | 'gateway' {
  if (process.env.JEV_BACKEND === 'mock' && !onVercel) return 'mock';
  if (process.env.TYPESAFE_API_KEY?.trim()) return 'typesafe';
  return 'gateway';
}

export function llmBackend(): 'claude-cli' | 'anthropic' | 'gateway' {
  if (process.env.LLM_BACKEND === 'claude-cli' && !onVercel) return 'claude-cli';
  if (process.env.ANTHROPIC_API_KEY?.trim()) return 'anthropic';
  return 'gateway';
}

export function engines() {
  const jev = jevBackend();
  const llm = llmBackend();
  return {
    jev: jev === 'mock' ? 'Jev MOCK (dev only)' : `Jev 1.14.0 via ${jev === 'typesafe' ? 'TypeSafe' : 'AI Gateway'}`,
    llm: llm === 'claude-cli' ? 'Claude via Claude Code CLI (dev only)' : `Claude 5.5 via ${llm === 'anthropic' ? 'Anthropic' : 'AI Gateway'}`,
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
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
      body,
      signal: abortSignal,
      redirect: 'error',
    });
    if ([429, 502, 503, 529].includes(res.status) && attempt < 3) {
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
  const text = String((err as { message?: string })?.message ?? err);
  const body = JSON.stringify(err, Object.getOwnPropertyNames(err ?? {})).slice(0, 4000);
  if (/customer_verification_required|credit card/i.test(text + body)) {
    return {
      code: 'gateway_card_required',
      message:
        'The AI connection is not active yet: the Vercel team needs a payment card on file for AI Gateway. Add it in Vercel (team settings, AI Gateway) and try again.',
    };
  }
  if (/oidc|unauthori[sz]ed|401|authentication/i.test(text + body)) {
    return { code: 'auth', message: 'The AI connection could not authenticate. Check the deployment settings.' };
  }
  if (/429|rate limit/i.test(text)) return { code: 'rate_limit', message: 'The AI service is busy. Try again in a moment.' };
  return { code: 'error', message: text.slice(0, 300) };
}
