'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Project, Quote, Requirement, RequirementResult, Tone } from '@/lib/types';
import type { CheckState } from './Workspace';
import { ScoreBar, SummaryBar } from './ScoreBar';
import RequirementDetail from './RequirementDetail';
import { IconAlert } from './Icons';

function ago(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString();
}

export default function CompliancePanel({
  project,
  check,
  hasDraft,
  onOpenQuote,
}: {
  project: Project;
  check: CheckState;
  hasDraft: boolean;
  onOpenQuote: (q: Quote) => void;
}) {
  const [needsWork, setNeedsWork] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  const resultOf = (r: Requirement): RequirementResult | undefined => (hasDraft ? project.results[r.id] : undefined);
  const toneOf = (r: Requirement): Tone => resultOf(r)?.tone ?? 'grey';

  const active = project.requirements.filter((r) => !r.muted);
  const muted = project.requirements.filter((r) => r.muted);
  const [showMuted, setShowMuted] = useState(false);

  const tally = useMemo(() => {
    const t = { green: 0, amber: 0, red: 0, grey: 0 };
    for (const r of project.requirements) if (!r.muted) t[toneOf(r)]++;
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.requirements, project.results, hasDraft]);

  const req = selected ? project.requirements.find((r) => r.id === selected) : null;
  if (req) {
    return (
      <RequirementDetail
        project={project}
        req={req}
        result={resultOf(req)}
        onBack={() => setSelected(null)}
        onOpenQuote={onOpenQuote}
      />
    );
  }

  const stale = !check.running && hasDraft && project.lastCheckAt && project.checkedDraft !== project.draft;

  return (
    <section className="scroll-thin flex h-full min-h-0 flex-col overflow-y-auto border-l border-line bg-panel px-6 pb-8 pt-6 sm:px-7" aria-label="Compliance">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[21px] font-medium text-ink">Compliance</h2>
        <StatusLine check={check} hasDraft={hasDraft} lastCheckAt={project.lastCheckAt} now={now} />
      </div>

      {check.error && (
        <div className="mt-4 flex gap-2.5 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2.5 text-[13px] leading-relaxed text-ink-2" role="alert">
          <IconAlert size={16} className="mt-0.5 shrink-0 text-warn-text" />
          <span>{check.error.message}</span>
        </div>
      )}

      <div className="mt-4">
        <SummaryBar {...tally} />
      </div>
      <div className="mt-2.5 flex items-center justify-between text-[15px]">
        <span className="text-ink-2">
          {tally.green} of {active.length} green
          {stale && <span className="ml-2 text-[12px] text-faint">draft changed since</span>}
        </span>
        <button type="button" onClick={() => setNeedsWork((v) => !v)} aria-pressed={needsWork} className="text-link hover:underline">
          {needsWork ? 'Show all' : 'Needs work only'}
        </button>
      </div>

      {!hasDraft && (
        <p className="mt-5 rounded-lg bg-panel-2 px-3 py-2.5 text-[13px] leading-relaxed text-muted">
          Start writing in the middle. Each row below is a requirement found in your rule documents; Jev scores how well the draft meets it.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-6">
        {project.categories.map((cat) => {
          const all = active.filter((r) => r.category === cat);
          const rows = needsWork ? all.filter((r) => toneOf(r) !== 'green') : all;
          if (!rows.length) return null;
          const green = all.filter((r) => toneOf(r) === 'green').length;
          return (
            <div key={cat}>
              <div className="mb-1.5 flex items-baseline justify-between text-[14px] text-muted">
                <h3>{cat}</h3>
                <span>
                  {green}/{all.length} green
                </span>
              </div>
              <ul className="flex flex-col">
                {rows.map((r) => {
                  const res = resultOf(r);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(r.id)}
                        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-[5px] text-left hover:bg-panel-2"
                        title={r.need}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[15.5px] text-ink">
                          {r.focusNote && <span className="size-1.5 shrink-0 rounded-full bg-link" title={`Your focus: ${r.focusNote}`} />}
                          <span className="truncate">{r.title}</span>
                          {res?.contradiction && <IconAlert size={14} className="shrink-0 text-bad-text" aria-label="Conflicts with your evidence" />}
                          {res?.error && <IconAlert size={14} className="shrink-0 text-warn-text" aria-label="Not checked: the call failed" />}
                        </span>
                        <span className="w-9 shrink-0 text-right text-[14px] tabular-nums text-muted">{res && !res.error ? `${res.passed}/${res.total}` : `0/${r.questions.length}`}</span>
                        <ScoreBar score={res && !res.error ? res.score : null} tone={res?.tone ?? 'grey'} width={150} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {muted.length > 0 && (
        <div className="mt-8">
          <button type="button" onClick={() => setShowMuted((v) => !v)} className="text-[13px] text-muted hover:text-ink">
            {showMuted ? 'Hide' : 'Show'} {muted.length} muted by your focus
          </button>
          {showMuted && (
            <ul className="mt-2 flex flex-col">
              {muted.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setSelected(r.id)} className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1 text-left text-[14px] text-faint hover:bg-panel-2" title={r.focusNote}>
                    <span className="truncate">{r.title}</span>
                    <span className="ml-auto shrink-0 text-[12px]">{r.category}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-10 text-[12px] leading-relaxed text-faint">
        Scores are Jev support signals (0 to 100) from your own files only: the weakest question for each requirement counts. Green means every
        question is at 80 or above. This is writing feedback, not a compliance decision.
      </p>
    </section>
  );
}

function StatusLine({ check, hasDraft, lastCheckAt, now }: { check: CheckState; hasDraft: boolean; lastCheckAt?: number; now: number }) {
  let dot = 'bg-faint';
  let text = 'Waiting for text';
  let pulse = false;
  if (check.running) {
    dot = 'bg-warn-text';
    pulse = true;
    text = `Checking ${check.done} of ${check.total}`;
  } else if (check.error) {
    dot = 'bg-bad-text';
    text = 'Check failed';
  } else if (hasDraft && lastCheckAt) {
    dot = 'bg-ok-text';
    text = `Updated ${ago(lastCheckAt, now)}`;
  } else if (hasDraft) {
    text = 'Not checked yet';
  }
  return (
    <span className="flex items-center gap-2 text-[14px] text-muted" aria-live="polite">
      <span className={`size-2.5 rounded-full ${dot} ${pulse ? 'pulse-dot' : ''}`} />
      {text}
    </span>
  );
}
