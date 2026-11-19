// Direct provider keys (TYPESAFE_API_KEY, ANTHROPIC_API_KEY): check the wire format with a stubbed fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

const calls: { url: string; body: any; headers: any }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any) => {
  const body = JSON.parse(init.body);
  calls.push({ url: String(url), body, headers: init.headers });
  if (String(url).includes('typesafe')) {
    return new Response(JSON.stringify({
      model: 'jev-1.14.0',
      answers: {
        q1: { type: 'noul', noul: 0.91 },
        q2: { type: 'choice', choice: 'supported', probabilities: { supported: 0.8, contradicted: 0.2 }, confidence: 0.7 },
      },
      usage: { input_tokens: 120, output_tokens: 0 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  // Anthropic Messages API reply carrying the structured JSON
  return new Response(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: body.model,
    content: [{ type: 'text', text: JSON.stringify({ documents: [{ id: 'D1', role: 'regulation', title: 'CFR', summary: 'Rules.' }] }) }],
    stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

process.env.TYPESAFE_API_KEY = 'ts-test';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

test('TYPESAFE_API_KEY: Jev goes straight to TypeSafe with noul questions, answers mapped back', async () => {
  const { jevDecide, engines } = await import('../src/lib/server/ai.ts');
  assert.match(engines().jev, /TypeSafe/);
  const out = await jevDecide({ DRAFT: [{ section: 'A', text: 'B' }] }, {
    q1: { type: 'boolean', instructions: { question: 'x?' }, criteria: { true: 'y', false: 'n' } },
    q2: { type: 'choice', instructions: { question: 'z?' }, criteria: { supported: 's', contradicted: 'c' } },
  });
  const c = calls.find((x) => x.url.includes('typesafe'))!;
  assert.equal(c.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(c.headers.Authorization, 'Bearer ts-test');
  assert.equal(c.body.model, 'jev-1.14.0');
  assert.equal(c.body.questions.q1.type, 'noul');
  assert.deepEqual(out.answers.q1, { type: 'boolean', probability: 0.91 });
  assert.equal((out.answers.q2 as any).probabilities.supported, 0.8);
});

test('ANTHROPIC_API_KEY: Claude goes straight to Anthropic with the right model id', async () => {
  const { llmObject, engines } = await import('../src/lib/server/ai.ts');
  assert.match(engines().llm, /Anthropic/);
  const out = await llmObject({
    tier: 'fast', system: 'sys', prompt: 'p',
    schema: z.object({ documents: z.array(z.object({ id: z.string(), role: z.string(), title: z.string(), summary: z.string() })) }),
  });
  const c = calls.find((x) => x.url.includes('anthropic'))!;
  assert.match(c.url, /api\.anthropic\.com\/v1\/messages/);
  assert.equal(c.headers['x-api-key'] ?? c.headers['X-Api-Key'], 'sk-ant-test');
  assert.equal(c.body.model, 'claude-haiku-5-5');
  assert.equal(out.documents[0].role, 'regulation');
  globalThis.fetch = realFetch;
});
