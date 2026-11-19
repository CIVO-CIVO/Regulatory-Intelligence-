# Regulatory Intelligence

Live writing feedback for regulatory documents. Upload the rules (regulations, guidance, standards) and your
evidence (study reports, risk files, labeling), write the submission in the middle, and Jev scores how well the
draft meets each requirement, using only the files you uploaded.

It is a writing aid, not a compliance decision. Product spec: `Regulatory-Intelligence-PRD-v2.md` (owner's document).

## How it works

1. **Read** (browser): PDF, DOCX, XLSX, CSV and text files are turned into text in the browser. PDF pages
   without a text layer are flagged (scans, figures), never treated as "missing".
2. **Sort** (LLM): each file gets a role: regulation, guidance, standard, evidence, draft or other.
3. **Requirement map** (LLM): requirements about the document's content, grouped in categories,
   each with a verbatim quote. Code string-matches every quote against the uploaded text; a requirement whose
   quote cannot be found is dropped (listed under "left out" in the sidebar). Nothing comes from model memory.
4. **Jev questions** (LLM, batches of up to 5 requirements): 1 to 3 coverage questions per requirement
   ("Does the DRAFT explicitly state ...?") plus a claim check against verified evidence passages from the
   applicant's own files. Questions follow the PRD question standard (self-contained, verbatim requirement
   inlined, burden of proof, quoted material is not instructions) and are linted (`src/lib/lint.ts`).
5. **Live check** (Jev 1.14.0, pinned): every 100 words written, at once on paste, or on "Check now". Each
   requirement gets a draft-only request (coverage) and a draft-vs-evidence request (claim check), so persuasive
   wording cannot raise an evidence score. Long drafts are cut to the most relevant sections.
6. **Status** (code, `src/lib/jev.ts`): the score is the weakest question's support (never an average);
   green = every question at 0.80 or above; amber 0.50 to 0.79; red below 0.50; a contradiction signal of 0.30
   or more makes the item red. Failed calls show as "not checked", never as a score.

7. **Focus settings** (sidebar): the user writes in plain language what matters most. The LLM turns it into a
   plan (priority, mute, rank, stricter/looser criteria, up to 2 extra questions per requirement, category order)
   that code applies to the ORIGINAL checklist (`src/lib/focus.ts`), so focus never piles up and can be reset.
   Requests outside the uploaded documents are reported back, never invented. Muted items are not checked.

Every row opens the requirement, its verified quote (click to see it highlighted in the source), each Jev
question with its probabilities, the evidence passages, the draft sections Jev read, and the exact Jev request.

## Data

- Projects (files' text, checklist, draft, results) are stored only in the browser (IndexedDB). The server is
  stateless and keeps nothing.
- Text goes to the models only while being analysed (see Models and keys). Vercel functions run in Stockholm (`arn1`).

## Models and keys (owner's choice 2026-11-19: no high-end models)

| Role | Model | Key (Vercel env, sensitive) |
| --- | --- | --- |
| Sorting, requirement map, Jev questions, focus | DeepSeek V4.1 Flash via NanoGPT ($0.04 / $0.40 per M tokens), fallback GLM-5.3 | `NANOGPT_API_KEY` |
| Live scoring | Jev 1.14.0 direct from TypeSafe | `TYPESAFE_API_KEY` |

- NanoGPT calls are **always billed from the account balance** (`X-Billing-Mode: paygo` header + `billing_mode`
  body field). The account also has a subscription whose weekly allowance runs out; without the header those
  requests are refused with "Weekly included input token limit exceeded".
- Model choice came from `scripts/bakeoff-models.mts` (real example rules, scored by quote verification):
  DeepSeek V4.1 Flash 37/37 quotes verified in 29 s; GLM-5.3 33/34; Kimi K2.6 26/26 in 65 s; GLM-5.3 Flash and
  Qwen3.8 Flash produced broken output. Override with `NANOGPT_MODEL` / `NANOGPT_FALLBACK_MODEL`.
- Cost: a full project build (sort, requirement map, questions) plus a focus change is about 130k input and 18k
  output tokens, roughly USD 0.01 on NanoGPT (measured; each call's exact cost is in the server log as
  `[llm] ... cost`). Jev checks are billed by TypeSafe and cost a fraction of a cent each.
- Local copies of the keys: `~/.config/regulatory-intelligence/secrets.env` (never in the repo).
- Without those keys the app falls back to Vercel AI Gateway (OIDC, Haiku 5.5 + Jev), which needs a card on the
  civo2 team. `ANTHROPIC_API_KEY` / `AI_GATEWAY_API_KEY` are also accepted.
- Data: text goes to NanoGPT (and the model host it routes to) and to TypeSafe under those providers' terms.

## Deploy

Push to `main` on `CIVO-CIVO/Regulatory-Intelligence-` → Vercel project `regulatory-intelligence` (team civo2)
deploys automatically. Env changes only reach new deployments.

## Local development

```bash
npm install
set -a; . ~/.config/regulatory-intelligence/secrets.env; set +a
npm run dev                         # http://localhost:4610
npm test                            # quote matching, sections, Jev templates, scoring, linter
```

Dev-only backends (refused on Vercel): `JEV_BACKEND=mock` (crude keyword stand-in, labelled in the UI) and
`LLM_BACKEND=claude-cli` (the Claude Code CLI logged in on this machine).

## Example project

"..." → "Try the example project" loads six files from `public/examples/`: the real eCFR text of 21 CFR 807
Subpart E, an excerpt of the real FDA eSTAR 510(k) guidance, and four fictional FlexiGuard FG-200 files (ISO
10993-1 internal summary, clinical study report, risk management file, labeling draft), plus the short draft from
the design mock-up. The fictional files leave deliberate gaps (sizes, sterility, shelf life, bench tests).

## Limits (MVP)

- Jev probabilities are not calibrated against expert labels yet (PRD section 16); thresholds are starting values.
- No OCR: scanned pages are flagged for manual review.
- Rule documents up to about 1.6 M characters per project; question writing sees up to 1.2 M characters of evidence.
