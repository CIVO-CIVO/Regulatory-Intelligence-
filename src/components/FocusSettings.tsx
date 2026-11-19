'use client';

import { useState } from 'react';
import type { Project } from '@/lib/types';
import { IconAlert, IconCheck, IconChevronLeft, Spinner } from './Icons';

const EXAMPLES = [
  'Clinical safety is what the reviewers will look at hardest. Treat adverse events, follow-up and the study population as critical, and be strict that numbers match the study report.',
  'Ignore the cover letter and administrative items for now; I will do them last.',
  'Biocompatibility must name every endpoint from the ISO summary, not just cytotoxicity and sensitization.',
];

export default function FocusSettings({
  project,
  busy,
  error,
  onApply,
  onReset,
  onBack,
}: {
  project: Project;
  busy: boolean;
  error: string | null;
  onApply: (text: string) => void;
  onReset: () => void;
  onBack: () => void;
}) {
  const [text, setText] = useState(project.focus?.text ?? '');
  const f = project.focus;
  const muted = project.requirements.filter((r) => r.muted).length;

  return (
    <section className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-10 pt-6 sm:px-9" aria-label="Focus settings">
      <button type="button" onClick={onBack} className="-ml-1.5 flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-[14px] text-link hover:bg-panel-2">
        <IconChevronLeft size={16} /> Back to the draft
      </button>
      <h2 className="mt-4 text-[21px] font-medium text-ink">Jev focus</h2>
      <p className="mt-2 max-w-[620px] text-[14px] leading-relaxed text-muted">
        Tell Jev in your own words what matters most in these rules and documents. Your focus changes priorities, the order of the checklist,
        how strict the questions are, and which items are left out. It only works with what is in your files: nothing new is invented.
      </p>

      <label className="mt-6 flex flex-col gap-2.5">
        <span className="text-[14px] text-muted">Your focus</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          disabled={busy}
          placeholder={`For example:\n${EXAMPLES[0]}`}
          className="min-h-[170px] resize-y rounded-xl border border-line bg-panel-2 px-4 py-3 text-[15px] leading-relaxed text-ink outline-none placeholder:text-faint focus:border-line-strong disabled:opacity-60"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((e) => (
          <button
            key={e}
            type="button"
            disabled={busy}
            onClick={() => setText((t) => (t.trim() ? `${t.trim()}\n${e}` : e))}
            className="max-w-full truncate rounded-full bg-panel-2 px-3 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-raise disabled:opacity-50"
            title={e}
          >
            + {e.length > 70 ? `${e.slice(0, 68)}…` : e}
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onApply(text)}
          disabled={busy || !text.trim() || project.status !== 'ready'}
          className="flex h-11 items-center gap-2 rounded-xl border border-line-strong px-5 text-[15px] text-ink hover:bg-raise disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Spinner size={15} /> : null}
          {busy ? 'Adjusting the checklist…' : 'Apply focus'}
        </button>
        {f && !busy && (
          <button type="button" onClick={onReset} className="h-11 rounded-xl px-4 text-[14px] text-muted hover:bg-raise hover:text-ink">
            Reset to the original checklist
          </button>
        )}
      </div>

      {error && (
        <div className="mt-5 flex gap-2.5 rounded-lg border border-bad/50 bg-bad/15 px-3 py-2.5 text-[13px] text-ink-2" role="alert">
          <IconAlert size={16} className="mt-0.5 shrink-0 text-bad-text" /> {error}
        </div>
      )}

      {f && (
        <div className="mt-8 rounded-xl border border-line bg-panel-2 px-5 py-4">
          <div className="flex items-center gap-2 text-[14px] text-ink">
            <IconCheck size={16} className="text-ok-text" /> Focus applied {new Date(f.appliedAt).toLocaleString()}
          </div>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{f.summary}</p>
          {muted > 0 && <p className="mt-2 text-[13px] text-muted">{muted} requirement(s) muted: not checked and not counted.</p>}
          {f.changes.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2 text-[13px]">
              {f.changes.map((c, i) => (
                <li key={i} className="leading-relaxed">
                  <span className="text-ink">{c.title}</span>
                  <span className="text-muted">: {c.what}</span>
                </li>
              ))}
            </ul>
          )}
          {f.notes.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1.5 text-[13px] text-warn-text">
              {f.notes.map((n, i) => (
                <li key={i} className="flex gap-2">
                  <IconAlert size={14} className="mt-0.5 shrink-0" /> {n}
                </li>
              ))}
            </ul>
          )}
          {f.model && <p className="mt-4 text-[12px] text-faint">Adjusted by {f.model}</p>}
        </div>
      )}
    </section>
  );
}
