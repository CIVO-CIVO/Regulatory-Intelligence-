# Regulatory Intelligence

Live writing feedback for regulatory documents. Upload the rules (regulations, guidance, standards) and your
evidence (study reports, risk files, labeling), write the submission in the middle, and Jev scores how well the
draft meets each requirement, using only the files you uploaded.

It is a writing aid, not a compliance decision. Product spec: `Regulatory-Intelligence-PRD-v2.md` (owner's document).

## How it works (engine 2, 2026-11-19)

The owner's goal: when you write a paragraph, show how it stands against the rules it is about, and keep
everything else neutral. Each page under "Our draft" has its own ratings.

1. **Read** (browser): files (PDF, DOCX, XLSX, CSV, text), **web links** and **pasted text**, on the front page,
   in the knowledge base (Files / Link / Paste text) and as draft pages (Page / Files / Link). Scanned pages are
   flagged.
   - Links go through `/api/fetch-url`, a safe download proxy: http(s) only, public addresses only (DNS checked,
     every redirect re-checked), 30 MB and 25 s caps. The browser then reads the result like an upload.
   - Web pages keep their main content only (menus, headers and footers removed), headings as `#` lines,
     lists as `-`, table rows as `a | b`, saved as a `.md` document with its source link.
   - eCFR links (`ecfr.gov/current/title-21/.../part-812`, also subpart and section links) are fetched from the
     eCFR renderer, which gives the regulation without the site around it.
   - A short landing page that links its main document (FDA guidance pages: "Download the guidance") brings in
     that PDF instead.
   - Sites with a bot check or JavaScript-only pages (EUR-Lex, for example) give almost no text; the user is
     told to upload the file or paste the text.
2. **Sort** (LLM): each file is a rule document (regulation, guidance, standard), **project facts** (what is
   true about the project: dossier, study reports, approvals) or other.
3. **Rules** (LLM, one call per rule document; long documents are split into ~60k-character parts, in parallel):
   obligations, prohibitions and required content, with section numbers, from EVERY part of every rule
   document. Each quote is string-matched to the uploaded text (offsets into the full document); a rule whose
   quote is not found is dropped. Fine categories are then folded into 6 to 12 readable groups.
4. **Judging criteria** (LLM, batches of 6): per rule a `topic` (what a page must be about for it to apply),
   what text that `complies` says, and what text that `conflicts` says (red flags), plus a hint.
5. **Page check** (Jev 1.14.0), per page, every 100 words, on paste, after a pause, or on switching to a
   changed page:
   - Stage 1, relevance: one fan-out request asks, for every rule, "Is the PAGE about <topic>?" (page only).
   - Stage 2, compliance: only for rules with relevance >= 0.7, a choice: complies / mostly / unclear /
     conflicts, with the verbatim rule, and PROJECT_FACTS passages (picked by word overlap with the page) so
     claims like "FDA approved" are compared with the facts.
   - Score = 100 x (complies + 0.85 mostly + 0.6 unclear); green >= 70, amber >= 45; P(conflicts) >= 0.5 is red
     with a warning. A rule whose best answer is "unclear" stays neutral unless relevance >= 0.9.
   - About 5 to 10 Jev requests per page check (questions fan out on one state), about 2 seconds.
6. **Panel**: "This page" shows only the rules the page is about; the rest are neutral (listed on demand).
   "All pages" shows each rule's worst rating across pages. The sidebar shows a dot per page (worst rating).
7. **Focus settings**: plain-language priorities become changes to priority, muting, ranking, topic and the
   complies/conflicts criteria, applied in code to the original rules (resettable; never invents rules).

Projects built with engine 1 (one "contents" checklist) still open; their rules get criteria derived from
title and summary, and a banner offers "Rebuild now".

### Validation (scripts/validate-pages.mts)

The owner's CardioX test set (12 tests; paragraph A breaks rules, B fixes them; an answer key names the
sections) with 21 CFR 812, 21 CFR 814 and 45 CFR 164 as rules and the CardioX dossier as project facts:

| Measure | Result |
| --- | --- |
| Answer-key sections found relevant (A and B) | 12/12 |
| A flagged red/conflict | 12/12 (92% of rated rules red) |
| B ok on its sections (no conflict, mean >= 60) | 12/12 (88% green, 0 red) |
| Score goes up from A to B | 12/12 |
| Rated rules per page | about 15 of 357 |

Thresholds and option weights in `src/lib/rules.ts` were chosen on this set (simulated offline from raw Jev
answers, `raw.json`). It is one test set: treat the numbers as a sanity check, not a calibration.

## Data

- Projects (files' text, checklist, draft, results) are stored only in the browser (IndexedDB). The server is
  stateless and keeps nothing.
- Text goes to the models only while being analysed (see Models and keys). Vercel functions run in Stockholm (`arn1`).

## Models and keys (owner's choice 2026-11-19: no high-end models)

| Role | Model | Key (Vercel env, sensitive) |
| --- | --- | --- |
| Sorting, rules, judging criteria, groups, focus | DeepSeek V4.1 Flash via NanoGPT ($0.04 / $0.40 per M tokens), fallback GLM-5.3 | `NANOGPT_API_KEY` |
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
