'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DraftPage, Project, Quote, Requirement, RuleCheck, Tone } from '@/lib/types';
import type { CheckState } from './Workspace';
import { pageIsStale } from '@/lib/pages';
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

const SEVERITY: Record<Tone, number> = { red: 0, amber: 1, green: 2, grey: 3 };

export interface AcrossPages {
  check: RuleCheck; // the worst rating across the pages where the rule is relevant
  pages: { page: DraftPage; check: RuleCheck }[];
}

/** For the "All pages" view: per rule, the pages it is relevant on and its worst rating. */
export function acrossPages(project: Project): Map<string, AcrossPages> {
  const out = new Map<string, AcrossPages>();
  for (const pg of project.pages) {
    const pc = project.pageChecks?.[pg.id];
    if (!pc) continue;
    for (const c of Object.values(pc.rules)) {
      if (!c.relevant) continue;
      const cur = out.get(c.reqId) ?? { check: c, pages: [] };
      cur.pages.push({ page: pg, check: c });
      const worse = SEVERITY[c.tone] < SEVERITY[cur.check.tone] || (c.tone === cur.check.tone && (c.score ?? 100) < (cur.check.score ?? 100));
      if (worse) cur.check = c;
      out.set(c.reqId, cur);
    }
  }
  return out;
}

export default function CompliancePanel({
  project,
  page,
  check,
  onOpenQuote,
  onRebuild,
  onCheckAll,
}: {
  project: Project;
  page: DraftPage;
  check: CheckState;
  onOpenQuote: (q: Quote) => void;
  onRebuild: () => void;
  onCheckAll: () => void;
}) {
  const [mode, setMode] = useState<'page' | 'all'>('page');
  const [needsWork, setNeedsWork] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [showNeutral, setShowNeutral] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  const pc = project.pageChecks?.[page.id];
  const across = useMemo(() => acrossPages(project), [project]);
  const rules = project.requirements.filter((r) => !r.muted);

  const ratingOf = (r: Requirement): RuleCheck | undefined => (mode === 'page' ? pc?.rules[r.id] : across.get(r.id)?.check);
  const isRelevant = (r: Requirement) => !!ratingOf(r)?.relevant;
  const relevant = rules.filter(isRelevant);
  const neutral = rules.filter((r) => !isRelevant(r));

  const tally = { green: 0, amber: 0, red: 0, grey: 0 };
  for (const r of relevant) tally[ratingOf(r)!.tone]++;

  const req = selected ? project.requirements.find((r) => r.id === selected) : null;
  if (req) {
    return (
      <RequirementDetail
        project={project}
        page={page}
        mode={mode}
        req={req}
        check={pc?.rules[req.id]}
        across={across.get(req.id)}
        onBack={() => setSelected(null)}
        onOpenQuote={onOpenQuote}
      />
    );
  }

  const checkingHere = check.running && check.pageId === page.id;
  const stale = mode === 'page' && !!pc && pageIsStale(project, page.id);
  const stalePages = project.pages.filter((p) => p.text.trim() && pageIsStale(project, p.id)).length;

  return (
    <section className="scroll-thin flex h-full min-h-0 flex-col overflow-y-auto border-l border-line bg-panel px-6 pb-8 pt-6 sm:px-7" aria-label="Compliance">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[21px] font-medium text-ink">Compliance</h2>
        <StatusLine checkingHere={checkingHere} error={check.pageId === page.id ? check.error : null} at={mode === 'page' ? pc?.at : undefined} now={now} />
      </div>

      <div className="mt-3 flex items-center gap-1 rounded-lg bg-panel-2 p-0.5 text-[13px]" role="tablist" aria-label="Which ratings">
        {(['page', 'all'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`min-w-0 flex-1 truncate rounded-md px-3 py-1.5 ${mode === m ? 'bg-raise text-ink' : 'text-muted hover:text-ink'}`}
          >
            {m === 'page' ? `This page: ${page.title || 'Untitled page'}` : 'All pages'}
          </button>
        ))}
      </div>

      {project.engine !== 2 && (
        <div className="mt-3 flex gap-2.5 rounded-lg border border-link/30 bg-link/5 px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">
          <IconAlert size={16} className="mt-0.5 shrink-0 text-link" />
          <span>
            This project was built with the first checklist, which can miss rules. Rebuild it to find the rules in every rule document and check each page
            on its own.{' '}
            <button type="button" onClick={onRebuild} className="text-link hover:underline">
              Rebuild now
            </button>
          </span>
        </div>
      )}

      {check.error && check.pageId === page.id && !check.running && (
        <div className="mt-3 flex gap-2.5 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2.5 text-[13px] leading-relaxed text-ink-2" role="alert">
          <IconAlert size={16} className="mt-0.5 shrink-0 text-warn-text" />
          <span>{check.error.message}</span>
        </div>
      )}

      <div className="mt-4">
        <SummaryBar green={tally.green} amber={tally.amber} red={tally.red} grey={tally.grey} />
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3 text-[14px]">
        <span className="text-ink-2">
          {relevant.length ? `${tally.green} of ${relevant.length} relevant rules green` : 'No rated rules yet'}
          {stale && <span className="ml-2 text-[12px] text-faint">page changed since</span>}
        </span>
        <button type="button" onClick={() => setNeedsWork((v) => !v)} aria-pressed={needsWork} className="shrink-0 text-link hover:underline">
          {needsWork ? 'Show all' : 'Needs work only'}
        </button>
      </div>

      {mode === 'all' && stalePages > 0 && (
        <p className="mt-2 text-[12px] text-faint">
          {stalePages} page{stalePages > 1 ? 's' : ''} changed or not checked yet.{' '}
          <button type="button" onClick={onCheckAll} className="text-link hover:underline">
            Check all pages
          </button>
        </p>
      )}

      {!relevant.length && (
        <p className="mt-5 rounded-lg bg-panel-2 px-3 py-2.5 text-[13px] leading-relaxed text-muted">
          {mode === 'page'
            ? pc
              ? 'Nothing on this page touches your rules yet. Rules only get a rating when the page is about them; the rest stay neutral.'
              : checkingHere
                ? 'Jev is reading this page…'
                : 'Write or paste on this page. Jev rates only the rules the page is about.'
            : 'No page has been rated yet.'}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-3.5">
        {project.categories.map((cat) => {
          const inCat = relevant.filter((r) => r.category === cat);
          const rows = (needsWork ? inCat.filter((r) => ratingOf(r)!.tone !== 'green') : inCat).sort(
            (a, b) => SEVERITY[ratingOf(a)!.tone] - SEVERITY[ratingOf(b)!.tone] || (ratingOf(a)!.score ?? 0) - (ratingOf(b)!.score ?? 0),
          );
          if (!rows.length) return null;
          const green = inCat.filter((r) => ratingOf(r)!.tone === 'green').length;
          return (
            <div key={cat}>
              <div className="mb-0.5 flex items-baseline justify-between text-[12.5px] text-muted">
                <h3>{cat}</h3>
                <span>
                  {green}/{inCat.length} green
                </span>
              </div>
              <ul className="flex flex-col">
                {rows.map((r) => {
                  const c = ratingOf(r)!;
                  const n = mode === 'all' ? (across.get(r.id)?.pages.length ?? 0) : 0;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(r.id)}
                        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-md px-2 py-[3px] text-left hover:bg-panel-2"
                        title={`${r.section ? `${r.section}: ` : ''}${r.need}`}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px] leading-[18px] text-ink">
                          {r.focusNote && <span className="size-1.5 shrink-0 rounded-full bg-link" title={`Your focus: ${r.focusNote}`} />}
                          <span className="truncate">{r.title}</span>
                          {c.conflict && <IconAlert size={13} className="shrink-0 text-bad-text" aria-label="Breaks this rule" />}
                          {c.error && <IconAlert size={13} className="shrink-0 text-warn-text" aria-label="Not checked" />}
                        </span>
                        <span className="w-16 shrink-0 truncate text-right text-[11.5px] tabular-nums text-faint">
                          {mode === 'all' ? `${n} page${n === 1 ? '' : 's'}` : (r.section ?? '')}
                        </span>
                        <ScoreBar score={c.score ?? null} tone={c.tone} width={112} height={16} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {neutral.length > 0 && (
        <div className="mt-6">
          <button type="button" onClick={() => setShowNeutral((v) => !v)} className="text-[13px] text-muted hover:text-ink">
            {showNeutral ? 'Hide' : 'Show'} {neutral.length} rule{neutral.length === 1 ? '' : 's'} {mode === 'page' ? 'this page is not about' : 'no page is about yet'}
          </button>
          {showNeutral && (
            <div className="mt-2 flex flex-col gap-2.5">
              {project.categories.map((cat) => {
                const rows = neutral.filter((r) => r.category === cat);
                if (!rows.length) return null;
                return (
                  <div key={cat}>
                    <div className="text-[12px] text-faint">{cat}</div>
                    <ul>
                      {rows.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => setSelected(r.id)}
                            className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-[2px] text-left text-[13px] text-faint hover:bg-panel-2 hover:text-ink-2"
                          >
                            <span className="truncate">{r.title}</span>
                            <span className="ml-auto shrink-0 text-[11px]">{r.section}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {project.requirements.some((r) => r.muted) && (
        <p className="mt-3 text-[12px] text-faint">{project.requirements.filter((r) => r.muted).length} rule(s) muted by your focus settings.</p>
      )}

      <p className="mt-10 text-[12px] leading-relaxed text-faint">
        Jev first decides which rules a page is about; only those get a rating, the rest stay neutral. Following a rule scores high, leaving a step
        out a little lower, and breaking it near zero with a warning. Claims about your project are compared with the project facts in your knowledge
        base. Writing feedback, not a compliance decision.
      </p>
    </section>
  );
}

function StatusLine({ checkingHere, error, at, now }: { checkingHere: boolean; error: CheckState['error']; at?: number; now: number }) {
  let dot = 'bg-faint';
  let text = 'Not checked yet';
  let pulse = false;
  if (checkingHere) {
    dot = 'bg-warn-text';
    pulse = true;
    text = 'Checking';
  } else if (error) {
    dot = 'bg-bad-text';
    text = 'Check failed';
  } else if (at) {
    dot = 'bg-ok-text';
    text = `Updated ${ago(at, now)}`;
  }
  return (
    <span className="flex items-center gap-2 text-[14px] text-muted" aria-live="polite">
      <span className={`size-2.5 rounded-full ${dot} ${pulse ? 'pulse-dot' : ''}`} />
      {text}
    </span>
  );
}
