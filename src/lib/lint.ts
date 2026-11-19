// Question linter (PRD section 10.4 / Appendix C, the checks that matter for live drafting).

const UNRESOLVED = /\b(the specified|the relevant|the applicable|the above|as required|said|aforementioned|as appropriate|where applicable)\b/i;
const LEADING = /^\s*(confirm|verify|ensure|check)\b/i;
const QUALIFIER = /\b(adequate(ly)?|sufficient(ly)?|appropriate(ly)?|properly|robust|acceptable|significant(ly)?|timely|reasonabl[ey]|clear(ly)?)\b/i;

export function lintElement(element: string): string[] {
  const out: string[] = [];
  const m1 = element.match(UNRESOLVED);
  if (m1) out.push(`Refers to "${m1[0]}" without saying what it is.`);
  if (LEADING.test(element)) out.push('Leading wording ("confirm", "verify").');
  const m2 = element.match(QUALIFIER);
  if (m2) out.push(`Uses "${m2[0]}" without defining it.`);
  if (element.trim().split(/\s+/).length < 3) out.push('Very short; may be ambiguous.');
  return out;
}
