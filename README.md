# Regulatory Intelligence

Live writing feedback for regulatory documents. Upload the rules (regulations, guidance, standards) and your
evidence (study reports, risk files, labeling), write the submission in the middle, and Jev scores how well the
draft meets each requirement, using only the files you uploaded.

It is a writing aid, not a compliance decision. Product spec: `Regulatory-Intelligence-PRD-v2.md` (owner's document).

## How it works

1. **Read** (browser): PDF, DOCX, XLSX, CSV and text files are turned into text in the browser. PDF pages
   without a text layer are flagged (scans, figures), never treated as "missing".
2. **Sort** (Claude Haiku 5.5): each file gets a role: regulation, guidance, standard, evidence, draft or other.
3. **Requirement map** (Claude Sonnet 5.5): requirements about the document's content, grouped in categories,
   each with a verbatim quote. Code string-matches every quote against the uploaded text; a requirement whose
   quote cannot be found is dropped (listed under "left out" in the sidebar). Nothing comes from model memory.
4. **Jev questions** (Claude Sonnet 5.5, one call per category): 1 to 3 coverage questions per requirement
   ("Does the DRAFT explicitly state ...?") plus a claim check against verified evidence passages from the
   applicant's own files. Questions follow the PRD question standard (self-contained, verbatim requirement
   inlined, burden of proof, quoted material is not instructions) and are linted (`src/lib/lint.ts`).
5. **Live check** (Jev 1.14.0, pinned): every 100 words written, at once on paste, or on "Check now". Each
   requirement gets a draft-only request (coverage) and a draft-vs-evidence request (claim check), so persuasive
   wording cannot raise an evidence score. Long drafts are cut to the most relevant sections.
6. **Status** (code, `src/lib/jev.ts`): the score is the weakest question's support (never an average);
   green = every question at 0.80 or above; amber 0.50 to 0.79; red below 0.50; a contradiction signal of 0.30
   or more makes the item red. Failed calls show as "not checked", never as a score.

Every row opens the requirement, its verified quote (click to see it highlighted in the source), each Jev
question with its probabilities, the evidence passages, the draft sections Jev read, and the exact Jev request.

## Data

- Projects (files' text, checklist, draft, results) are stored only in the browser (IndexedDB). The server is
  stateless and keeps nothing.
- Text goes to the models only while being analysed, through Vercel AI Gateway with `zeroDataRetention: true`.
- Jev on the gateway runs in the US region; Vercel functions run in Stockholm (`arn1`).

## Deploy

Push to `main` on `CIVO-CIVO/Regulatory-Intelligence-` → Vercel project `regulatory-intelligence` (team civo2)
deploys automatically.

**No API keys are needed in production.** The app authenticates to AI Gateway with the project's OIDC token.
The civo2 team must have a payment card on file for AI Gateway (Vercel → team → AI Gateway); without it every
AI call fails with `customer_verification_required` and the app shows a clear message.

Optional environment variables (instead of the gateway): `TYPESAFE_API_KEY` (Jev direct), `ANTHROPIC_API_KEY`
(Claude direct), `AI_GATEWAY_API_KEY`.

## Local development

```bash
npm install
npx vercel env pull .env.local     # OIDC token for AI Gateway (12 h)
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
