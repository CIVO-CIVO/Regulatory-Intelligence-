// Jev decision wire types (AI SDK decision format; 'boolean' is Jev's noul).
// The question templates, state profiles and scoring live in rules.ts (engine 2).

export type DecisionQuestion =
  | { type: 'boolean'; instructions: Record<string, unknown>; criteria: { true: string; false: string } }
  | { type: 'choice'; instructions: Record<string, unknown>; criteria: Record<string, string> };

export type DecisionAnswer =
  | { type: 'boolean'; probability: number }
  | { type: 'choice'; choice: string; probabilities?: Record<string, number> }
  | { type: 'score'; score: number }
  | { type: 'refusal' };
