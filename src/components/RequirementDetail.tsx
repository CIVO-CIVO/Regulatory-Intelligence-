'use client';

import { useMemo, useState } from 'react';
import { PASS_AT, type Project, type QuestionResult, type Quote, type Requirement, type RequirementResult } from '@/lib/types';
import { buildJobs, CLAIM_OPTIONS } from '@/lib/jev';
import { splitSections } from '@/lib/text';
import { ScoreBar } from './ScoreBar';
import { IconAlert, IconChevronLeft } from './Icons';

const CLAIM_LABEL: Record<string, string> = {
  supported: 'supported',
  partially_supported: 'partly supported',
  not_addressed: 'not addressed',
  contradicted: 'contradicted',
  insufficient_information: 'cannot tell',
};

export default function RequirementDetail({
  project,
  req,
  result,
  onBack,
  onOpenQuote,
}: {
  project: Project;
  req: Requirement;
  result?: RequirementResult;
  onBack: () => void;
  onOpenQuote: (q: Quote) => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const docName = (id: string) => project.documents.find((d) => d.id === id)?.name ?? id;
  const live = result && !result.error ? result : undefined;

  const requests = useMemo(() => {
    if (!showRaw) return null;
    const draft = project.checkedDraft ?? project.draft;
    return buildJobs(req, splitSections(draft), docName).map((j) => ({
      model: live?.model ?? 'typesafe-ai/jev-1.14.0',
      profile: j.profile,
      state: j.state,
      questions: j.questions,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRaw, req, project.checkedDraft]);

  const summary = !live
    ? result?.error
      ? `Not checked: ${result.error}`
      : 'Not checked yet. Write in the draft and Jev will check it.'
    : live.contradiction
      ? 'Jev found a conflict between the draft and your evidence files.'
      : live.tone === 'green'
        ? `All ${live.total} question${live.total > 1 ? 's' : ''} at 80 or above.`
        : `${live.passed} of ${live.total} question${live.total > 1 ? 's' : ''} at 80 or above. The weakest one sets the score.`;

  return (
    <section className="scroll-thin flex h-full min-h-0 flex-col overflow-y-auto border-l border-line bg-panel px-6 pb-10 pt-5 sm:px-7" aria-label={`Requirement ${req.title}`}>
      <button type="button" onClick={onBack} className="-ml-1.5 flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-[14px] text-link hover:bg-panel-2">
        <IconChevronLeft size={16} /> All requirements
      </button>

      <div className="mt-4 flex items-center gap-2 text-[13px] text-muted">
        <span>{req.category}</span>
        <span aria-hidden>·</span>
        <span className={req.criticality === 'critical' ? 'text-bad-text' : req.criticality === 'major' ? 'text-warn-text' : ''}>
          {req.criticality === 'critical' ? 'Critical' : req.criticality === 'major' ? 'Major' : 'Minor'}
        </span>
        <span aria-hidden>·</span>
        <span>{req.id}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-4">
        <h2 className="text-[21px] font-medium leading-snug text-ink">{req.title}</h2>
        <ScoreBar score={live ? live.score : null} tone={live?.tone ?? 'grey'} width={130} />
      </div>
      <p className={`mt-2 text-[14px] ${live?.contradiction ? 'text-bad-text' : 'text-muted'}`}>{summary}</p>

      <Block title="What the draft must contain">
        <p className="text-[15px] leading-relaxed text-ink">{req.need}</p>
        {req.hint && <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{req.hint}</p>}
      </Block>

      <Block title="What your rule document says">
        <QuoteCard quote={req.quote} source={docName(req.quote.docId)} onOpen={() => onOpenQuote(req.quote)} />
      </Block>

      <Block title="Jev questions">
        <ul className="flex flex-col gap-3">
          {req.questions.map((q) => {
            const r = live?.questions.find((x) => x.id === q.id);
            return (
              <li key={q.id} className="rounded-xl bg-panel-2 px-4 py-3">
                <p className="text-[14px] leading-relaxed text-ink">
                  {q.kind === 'coverage' ? `Does the draft explicitly state ${q.element}?` : `Does what the draft says about ${q.element} match your evidence?`}
                </p>
                {r && <Answer r={r} />}
                {!!q.lint?.length && (
                  <p className="mt-2 flex items-start gap-1.5 text-[12px] text-warn-text">
                    <IconAlert size={13} className="mt-0.5 shrink-0" /> Question check: {q.lint.join(' ')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </Block>

      {req.evidence.length > 0 && (
        <Block title="Evidence from your files">
          <div className="flex flex-col gap-3">
            {req.evidence.map((e, i) => (
              <QuoteCard key={i} quote={e} source={docName(e.docId)} onOpen={() => onOpenQuote(e)} />
            ))}
          </div>
        </Block>
      )}

      {live?.sections && (
        <Block title="Draft sections Jev read">
          <p className="text-[13px] leading-relaxed text-muted">{live.sections.join(', ') || 'None'}</p>
        </Block>
      )}

      <div className="mt-7">
        <button type="button" onClick={() => setShowRaw((v) => !v)} className="text-[13px] text-link hover:underline">
          {showRaw ? 'Hide' : 'Show'} the exact Jev request
        </button>
        {requests && (
          <pre className="scroll-thin mt-3 max-h-[420px] overflow-auto rounded-xl bg-[#151515] p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">
            {JSON.stringify(requests, null, 2)}
          </pre>
        )}
      </div>

      <p className="mt-8 text-[12px] leading-relaxed text-faint">
        Jev returns probabilities, not explanations. It sees only the draft text, the quoted rule and the evidence passages shown here.
        {live?.model ? ` Model: ${live.model}.` : ''} Values are not yet calibrated against expert reviews.
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
      <span className="block whitespace-pre-line text-[14px] leading-relaxed text-ink-2">&ldquo;{quote.text.trim()}&rdquo;</span>
      <span className="mt-2 block text-[12px] text-muted">
        {source}
        {quote.page ? `, page ${quote.page}` : ''}
        {quote.match === 'fuzzy' ? ' · matched with small differences' : ''}
        <span className="text-link"> · open</span>
      </span>
    </button>
  );
}

function Answer({ r }: { r: QuestionResult }) {
  if (r.refused) return <p className="mt-2 text-[12px] text-warn-text">Jev declined to answer this question.</p>;
  const pass = r.support >= PASS_AT;
  if (r.kind === 'coverage') {
    return (
      <p className="mt-2 text-[12.5px] text-muted">
        Jev P(yes) <span className={`tabular-nums ${pass ? 'text-ok-text' : r.support >= 0.5 ? 'text-warn-text' : 'text-bad-text'}`}>{r.support.toFixed(2)}</span>
      </p>
    );
  }
  const probs = r.probabilities ?? {};
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-muted">
      {CLAIM_OPTIONS.map((k) => (
        <span key={k}>
          {CLAIM_LABEL[k]}{' '}
          <span
            className={`tabular-nums ${
              k === 'supported' ? (pass ? 'text-ok-text' : 'text-ink-2') : k === 'contradicted' && (probs[k] ?? 0) >= 0.3 ? 'text-bad-text' : 'text-ink-2'
            }`}
          >
            {(probs[k] ?? 0).toFixed(2)}
          </span>
        </span>
      ))}
    </div>
  );
}
