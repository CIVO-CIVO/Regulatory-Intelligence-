'use client';

import { useMemo, useState } from 'react';
import type { DraftPage, Project, Quote, Requirement, RuleCheck } from '@/lib/types';
import { complianceQuestion, OPTIONS, relevanceQuestion, RELEVANT_AT, ruleView } from '@/lib/rules';
import type { AcrossPages } from './CompliancePanel';
import { ScoreBar } from './ScoreBar';
import { IconAlert, IconChevronLeft } from './Icons';

const OPTION_LABEL: Record<string, string> = {
  complies: 'follows the rule',
  mostly: 'mostly follows',
  unclear: 'only mentioned',
  conflicts: 'breaks the rule',
};

export default function RequirementDetail({
  project,
  page,
  mode,
  req,
  check,
  across,
  onBack,
  onOpenQuote,
}: {
  project: Project;
  page: DraftPage;
  mode: 'page' | 'all';
  req: Requirement;
  check?: RuleCheck;
  across?: AcrossPages;
  onBack: () => void;
  onOpenQuote: (q: Quote) => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const docName = (id: string) => project.documents.find((d) => d.id === id)?.name ?? id;
  const view = ruleView(req);
  const pc = project.pageChecks?.[page.id];
  const shown = mode === 'all' ? across?.check : check;

  const raw = useMemo(() => {
    if (!showRaw) return null;
    const PAGE = `(the text of "${pc?.title ?? page.title}", split into its sections)`;
    return {
      model: pc?.model ?? 'jev-1.14.0',
      step1_relevance: { state: { PAGE }, question: relevanceQuestion(req) },
      step2_compliance_if_relevant: {
        state: { PAGE, PROJECT_FACTS: (pc?.facts ?? []).map((f) => ({ source: f.source, text: f.text })) },
        question: complianceQuestion(req, docName),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRaw, req, pc]);

  const verdict = !shown
    ? mode === 'page'
      ? 'This page has not been checked yet.'
      : 'No page has been checked against this rule yet.'
    : shown.error
      ? 'Not checked: a Jev answer was missing. Use "Check now" to try again.'
      : !shown.relevant
        ? mode === 'page'
          ? `This page is not about this rule (relevance ${shown.relevance.toFixed(2)}), so it stays neutral.`
          : 'No page is about this rule yet.'
        : shown.conflict
          ? 'Jev reads this page as breaking the rule.'
          : shown.tone === 'green'
            ? 'Jev reads this page as following the rule.'
            : shown.tone === 'amber'
              ? 'Jev reads this page as partly following the rule.'
              : 'Jev reads this page as falling short of the rule.';

  return (
    <section className="scroll-thin flex h-full min-h-0 flex-col overflow-y-auto border-l border-line bg-panel px-6 pb-10 pt-5 sm:px-7" aria-label={`Rule ${req.title}`}>
      <button type="button" onClick={onBack} className="-ml-1.5 flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-[14px] text-link hover:bg-panel-2">
        <IconChevronLeft size={16} /> All rules
      </button>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
        <span>{req.category}</span>
        <span aria-hidden>·</span>
        <span className={req.criticality === 'critical' ? 'text-bad-text' : req.criticality === 'major' ? 'text-warn-text' : ''}>
          {req.criticality === 'critical' ? 'Critical' : req.criticality === 'major' ? 'Major' : 'Minor'}
        </span>
        {req.section && (
          <>
            <span aria-hidden>·</span>
            <span>{req.section}</span>
          </>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-4">
        <h2 className="text-[21px] font-medium leading-snug text-ink">{req.title}</h2>
        <ScoreBar score={shown?.relevant && !shown.error ? (shown.score ?? null) : null} tone={shown?.tone ?? 'grey'} width={130} />
      </div>
      <p className={`mt-2 text-[14px] ${shown?.conflict ? 'text-bad-text' : 'text-muted'}`}>
        {mode === 'page' ? `On "${page.title}": ` : 'Across your pages: '}
        {verdict}
      </p>

      {shown?.relevant && shown.probs && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-muted">
          {OPTIONS.map((o) => (
            <span key={o}>
              {OPTION_LABEL[o]}{' '}
              <span className={`tabular-nums ${o === 'conflicts' && (shown.probs![o] ?? 0) >= 0.5 ? 'text-bad-text' : o === 'complies' ? 'text-ok-text' : 'text-ink-2'}`}>
                {(shown.probs![o] ?? 0).toFixed(2)}
              </span>
            </span>
          ))}
          <span>
            relevance <span className="tabular-nums text-ink-2">{shown.relevance.toFixed(2)}</span>
          </span>
        </div>
      )}

      {mode === 'all' && across && across.pages.length > 0 && (
        <Block title="Pages this rule is about">
          <ul className="flex flex-col gap-1">
            {across.pages.map(({ page: p, check: c }) => (
              <li key={p.id} className="flex items-center justify-between gap-3 text-[14px]">
                <span className="truncate text-ink-2">{p.title}</span>
                <ScoreBar score={c.score ?? null} tone={c.tone} width={100} height={16} />
              </li>
            ))}
          </ul>
        </Block>
      )}

      {(req.focusNote || req.muted) && (
        <div className="mt-5 rounded-xl border border-link/30 bg-link/5 px-4 py-3 text-[13px] leading-relaxed text-ink-2">
          <span className="text-link">Your focus: </span>
          {req.muted ? 'muted, so it is not checked or counted. ' : ''}
          {req.focusNote}
        </div>
      )}

      <Block title="What the rule requires">
        <p className="text-[15px] leading-relaxed text-ink">{req.need}</p>
        {req.hint && <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{req.hint}</p>}
      </Block>

      <Block title="What your rule document says">
        <QuoteCard quote={req.quote} source={`${docName(req.quote.docId)}${req.section ? `, ${req.section}` : ''}`} onOpen={() => onOpenQuote(req.quote)} />
      </Block>

      <Block title="How Jev judges a page">
        <dl className="flex flex-col gap-2.5 text-[13.5px] leading-relaxed">
          <div>
            <dt className="text-muted">Applies when the page is about</dt>
            <dd className="text-ink-2">{view.topic}</dd>
          </div>
          <div>
            <dt className="text-ok-text">Follows the rule when</dt>
            <dd className="text-ink-2">{view.complies}</dd>
          </div>
          <div>
            <dt className="text-bad-text">Breaks the rule when</dt>
            <dd className="text-ink-2">{view.conflicts}</dd>
          </div>
        </dl>
        <p className="mt-2 text-[12px] text-faint">A rule counts as relevant from a relevance of {RELEVANT_AT.toFixed(1)}. Change the emphasis in Focus settings.</p>
      </Block>

      {mode === 'page' && pc && pc.facts.length > 0 && shown?.relevant && (
        <Block title="Project facts Jev compared with">
          <details>
            <summary className="cursor-pointer text-[13px] text-link">
              {pc.facts.length} passage{pc.facts.length > 1 ? 's' : ''} from {[...new Set(pc.facts.map((f) => f.source))].join(', ')}
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              {pc.facts.map((f, i) => (
                <p key={i} className="whitespace-pre-line rounded-lg bg-panel-2 px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
                  {f.text}
                </p>
              ))}
            </div>
          </details>
        </Block>
      )}

      {mode === 'page' && shown?.sections && shown.sections.length > 0 && (
        <Block title="Sections Jev read">
          <p className="text-[13px] leading-relaxed text-muted">{shown.sections.join(', ')}</p>
        </Block>
      )}

      <div className="mt-7">
        <button type="button" onClick={() => setShowRaw((v) => !v)} className="text-[13px] text-link hover:underline">
          {showRaw ? 'Hide' : 'Show'} the exact Jev questions
        </button>
        {raw && (
          <pre className="scroll-thin mt-3 max-h-[420px] overflow-auto rounded-xl bg-[#151515] p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">
            {JSON.stringify(raw, null, 2)}
          </pre>
        )}
      </div>

      {shown?.error && (
        <p className="mt-4 flex items-center gap-2 text-[12px] text-warn-text">
          <IconAlert size={13} /> {shown.error}
        </p>
      )}

      <p className="mt-8 text-[12px] leading-relaxed text-faint">
        Jev returns probabilities, not explanations. It sees only the page, the quoted rule and the project facts listed here.
        {pc?.model ? ` Model: ${pc.model}.` : ''} The weights and thresholds were tuned on a 12-case A/B test set, not on expert reviews.
      </p>
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-7">
      <h3 className="mb-2.5 text-[13px] text-muted">{title}</h3>
      {children}
    </div>
  );
}

function QuoteCard({ quote, source, onOpen }: { quote: Quote; source: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="w-full rounded-xl border border-line bg-panel-2 px-4 py-3 text-left hover:border-line-strong">
      <span className="block text-[14px] leading-relaxed text-ink-2">&ldquo;{quote.text.replace(/\[Page \d+\]/g, ' ').replace(/\s+/g, ' ').trim()}&rdquo;</span>
      <span className="mt-2 block text-[12px] text-muted">
        {source}
        {quote.page ? `, page ${quote.page}` : ''}
        {quote.match === 'fuzzy' ? ' · matched with small differences' : ''}
        <span className="text-link"> · open</span>
      </span>
    </button>
  );
}
