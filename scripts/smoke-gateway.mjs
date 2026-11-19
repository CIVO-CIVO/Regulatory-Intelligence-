// Live smoke test: Jev (decision) + Claude (text) through Vercel AI Gateway with the project's OIDC token.
import { experimental_decide as decide, generateText } from 'ai';

const t0 = Date.now();
const jev = await decide({
  model: 'typesafe-ai/jev-1.14.0',
  state: { DRAFT: [{ section: 'Clinical evidence', text: 'A prospective study with 148 subjects reported 2 device-related adverse events through 12 months.' }],
           EVIDENCE: [{ source: 'CSR v3, p. 17', text: 'Two device-related adverse events occurred among 148 subjects; follow-up was 12 months.' }] },
  questions: {
    cov: { type: 'boolean', instructions: 'Does the DRAFT explicitly state the number of device-related adverse events?', criteria: { true: 'The DRAFT gives a number of device-related adverse events.', false: 'No number is given.' } },
    claim: { type: 'choice', instructions: 'How does the DRAFT statement about adverse events relate to the EVIDENCE?', criteria: {
      supported: 'Every fact in the DRAFT about this matches the EVIDENCE.', partially_supported: 'Some facts match, one is missing.', not_addressed: 'The DRAFT does not mention it.', contradicted: 'The DRAFT conflicts with the EVIDENCE.', insufficient_information: 'The state does not allow a decision.' } },
  },
  providerOptions: { gateway: { zeroDataRetention: true } },
});
console.log('JEV', Date.now() - t0, 'ms', JSON.stringify(jev.answers ?? jev, null, 0).slice(0, 600));
console.log('JEV keys', Object.keys(jev));
const t1 = Date.now();
const r = await generateText({ model: 'anthropic/claude-haiku-5.5', prompt: 'Reply with the single word: ok', providerOptions: { gateway: { zeroDataRetention: true } } });
console.log('CLAUDE', Date.now() - t1, 'ms', JSON.stringify(r.text));
