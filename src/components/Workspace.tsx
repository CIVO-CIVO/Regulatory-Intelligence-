'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusState, KbDocument, Project, ProjectSummary, Quote, Requirement } from '@/lib/types';
import { applyFocus, type FocusPlan } from '@/lib/focus';
import { postJson } from '@/lib/client/api';
import { countWords } from '@/lib/text';
import { activePage, nextPageId, pageTexts, signature, totalWords } from '@/lib/pages';
import { extractFile } from '@/lib/client/extract';
import { streamEvaluate } from '@/lib/client/api';
import { buildRequirements, classify, initialSteps, readFiles, type Step } from '@/lib/client/build';
import Sidebar from './Sidebar';
import CompliancePanel from './CompliancePanel';
import DocViewer from './DocViewer';
import FocusSettings from './FocusSettings';
import { IconAlert, IconCheck, IconMenu, Spinner } from './Icons';

/** Re-check after this many words written or removed since the last check (pastes check at once). */
export const WORDS_PER_CHECK = 100;
/** After a pause in typing, unchecked edits are checked too. */
const IDLE_CHECK_MS = 15_000;

export interface CheckState {
  running: boolean;
  done: number;
  total: number;
  error: { code: string; message: string } | null;
}

export default function Workspace({
  project,
  projects,
  update,
  onOpen,
  onNew,
  onDelete,
}: {
  project: Project;
  projects: ProjectSummary[];
  update: (fn: (p: Project) => Project, immediate?: boolean, projectId?: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const [check, setCheck] = useState<CheckState>({ running: false, done: 0, total: 0, error: null });
  const [wordsSince, setWordsSince] = useState(0);
  const [doc, setDoc] = useState<{ doc: KbDocument; quote?: Quote } | null>(null);
  const [mobileTab, setMobileTab] = useState<'draft' | 'compliance'>('draft');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rebuild, setRebuild] = useState<{ steps: Step[]; error: string | null } | null>(null);
  const [rolesChanged, setRolesChanged] = useState(false);
  const [view, setView] = useState<'draft' | 'focus'>('draft');
  const [focusBusy, setFocusBusy] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);

  const projectRef = useRef(project);
  projectRef.current = project;
  const running = useRef(false);
  const again = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const page = activePage(project);
  const lastWords = useRef(countWords(page.text));
  const [importing, setImporting] = useState<string | null>(null);
  const [confirmDeletePage, setConfirmDeletePage] = useState(false);

  const words = useMemo(() => countWords(page.text), [page.text]);
  const allWords = useMemo(() => totalWords(project.pages), [project.pages]);
  const changedSinceCheck = signature(project.pages) !== signature(project.checkedPages);

  const disposed = useRef(false);
  const gen = useRef(0); // bumped when results of an older check must be ignored (rebuild)
  const rebuilding = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Every update is tagged with this project's id, so a late result can never land in another project.
  // The ref is advanced at once (fn is pure), so a check started right after a change, before React
  // re-renders, already sees it (e.g. a page imported from a file).
  const updateSelf = useCallback(
    (fn: (p: Project) => Project, immediate?: boolean) => {
      projectRef.current = fn(projectRef.current);
      update(fn, immediate, project.id);
    },
    [update, project.id],
  );

  const runCheck = useCallback(async () => {
    if (disposed.current) return;
    if (running.current || rebuilding.current) {
      again.current = true;
      return;
    }
    if (idle.current) clearTimeout(idle.current);
    const p = projectRef.current;
    const active = p.requirements.filter((r) => !r.muted);
    if (p.status !== 'ready' || !active.length) return;
    const pages = pageTexts(p.pages);
    setWordsSince(0);
    if (totalWords(pages) < 3) {
      updateSelf((x) => ({ ...x, results: {}, checkedPages: pages, lastCheckAt: undefined }));
      return;
    }
    const myGen = gen.current;
    const current = () => !disposed.current && gen.current === myGen;
    running.current = true;
    again.current = false;
    const ac = new AbortController();
    abort.current = ac;
    setCheck({ running: true, done: 0, total: active.length, error: null });
    let received = 0;
    let sawDone = false;
    let error: CheckState['error'] = null;
    try {
      await streamEvaluate(
        { pages, docs: p.documents.map((d) => ({ id: d.id, name: d.name })), requirements: active },
        (e) => {
          if (!current()) return;
          if (e.type === 'result') {
            received++;
            updateSelf((x) => ({ ...x, results: { ...x.results, [e.result.reqId]: e.result } }));
            setCheck((c) => ({ ...c, done: c.done + 1 }));
          } else if (e.type === 'done') {
            sawDone = true;
            error = e.error ?? null;
          }
        },
        ac.signal,
      );
      if (!sawDone || received < active.length) {
        error ??= { code: 'incomplete', message: 'The check was cut off before every requirement was answered. Use "Check now" to try again.' };
      }
      // Only a complete check counts as current; otherwise the panel keeps saying the draft changed.
      if (current() && sawDone && received === active.length) {
        updateSelf((x) => ({ ...x, checkedPages: pages, lastCheckAt: Date.now() }), true);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const e = err as { message: string; code?: string };
        error = { code: e.code ?? 'error', message: e.message };
      }
    } finally {
      running.current = false;
      abort.current = null;
      if (!disposed.current) setCheck((c) => ({ ...c, running: false, error: current() ? error : null }));
      if (!disposed.current && again.current) {
        again.current = false;
        void runCheck();
      }
    }
  }, [updateSelf]);

  // First open: check once if the draft changed since the last completed check.
  useEffect(() => {
    disposed.current = false;
    const p = projectRef.current;
    if (p.status === 'ready' && totalWords(p.pages) > 0 && signature(p.pages) !== signature(p.checkedPages)) void runCheck();
    return () => {
      disposed.current = true;
      again.current = false;
      if (idle.current) clearTimeout(idle.current);
      abort.current?.abort();
    };
  }, [runCheck]);

  const onDraftInput = (value: string, inputType?: string) => {
    const n = countWords(value);
    const delta = Math.abs(n - lastWords.current);
    lastWords.current = n;
    const pageId = activePage(projectRef.current).id;
    updateSelf((x) => ({ ...x, pages: x.pages.map((pg) => (pg.id === pageId ? { ...pg, text: value } : pg)) }));
    const pasted = inputType === 'insertFromPaste' || inputType === 'insertFromDrop';
    const since = wordsSince + delta;
    if (idle.current) clearTimeout(idle.current);
    if (pasted || since >= WORDS_PER_CHECK) {
      // Let React commit the new draft first so the check sends the current text.
      setWordsSince(0);
      setTimeout(() => void runCheck(), 0);
    } else {
      setWordsSince(since);
      // Small edits that keep the word count (e.g. fixing "12" to "24") are checked after a pause.
      idle.current = setTimeout(() => {
        const p = projectRef.current;
        if (signature(p.pages) !== signature(p.checkedPages)) void runCheck();
      }, IDLE_CHECK_MS);
    }
  };

  const doRebuild = async (newFiles?: File[]) => {
    setRebuild({ steps: initialSteps(), error: null });
    rebuilding.current = true;
    gen.current++;
    again.current = false;
    abort.current?.abort();
    const steps = initialSteps();
    const set = (key: Step['key'], patch: Partial<Step>) => {
      const i = steps.findIndex((s) => s.key === key);
      steps[i] = { ...steps[i], ...patch };
      setRebuild({ steps: steps.map((s) => ({ ...s })), error: null });
    };
    try {
      let documents = projectRef.current.documents;
      let unread: Project['dropped'] = [];
      if (newFiles?.length) {
        set('read', { state: 'running', detail: `0 of ${newFiles.length}` });
        const maxId = Math.max(0, ...documents.map((d) => Number(d.id.slice(1)) || 0));
        const { docs, failed } = await readFiles(newFiles, (n) => set('read', { detail: `${n} of ${newFiles.length}` }), maxId + 1);
        unread = failed.map((f) => ({ title: f, reason: 'File could not be read.' }));
        set('read', { state: 'done', detail: `${docs.length} new file${docs.length === 1 ? '' : 's'}${failed.length ? `, ${failed.length} skipped` : ''}` });
        set('sort', { state: 'running' });
        await classify(projectRef.current.description, docs);
        set('sort', { state: 'done' });
        documents = [...documents, ...docs];
      } else {
        set('read', { state: 'done', detail: `${documents.length} files` });
        set('sort', { state: 'done', detail: 'Using the roles you set' });
      }
      const map = await buildRequirements({ ...projectRef.current, documents }, set);
      const earlierUnread = projectRef.current.dropped.filter((d) => d.reason === 'File could not be read.');
      // The new checklist is the new base; an existing focus is re-applied to it (ids have changed).
      const focusText = projectRef.current.focus?.text;
      const focused = focusText ? await planFocus(map.requirements, map.categories, focusText).catch(() => null) : null;
      updateSelf(
        (x) => ({
          ...x,
          documents,
          baseRequirements: map.requirements,
          baseCategories: map.categories,
          requirements: focused?.requirements ?? map.requirements,
          categories: focused?.categories ?? map.categories,
          focus: focused?.focus,
          dropped: [...earlierUnread, ...unread, ...map.dropped],
          results: {},
          checkedPages: undefined,
          lastCheckAt: undefined,
          status: 'ready',
        }),
        true,
      );
      setRolesChanged(false);
      setRebuild(null);
      rebuilding.current = false;
      setTimeout(() => void runCheck(), 50);
    } catch (err) {
      rebuilding.current = false;
      setRebuild({ steps: steps.map((s) => ({ ...s })), error: (err as Error).message });
    }
  };

  // ------------------------------------------------------------ pages ("Our draft")

  const selectPage = (id: string) => {
    const pg = projectRef.current.pages.find((x) => x.id === id);
    if (!pg) return;
    lastWords.current = countWords(pg.text);
    setConfirmDeletePage(false);
    updateSelf((x) => ({ ...x, activePageId: id }));
    setView('draft');
    setMobileTab('draft');
    setSidebarOpen(false);
  };

  const addPage = () => {
    const id = nextPageId(projectRef.current.pages);
    lastWords.current = 0;
    updateSelf((x) => ({ ...x, pages: [...x.pages, { id, title: 'Untitled page', text: '' }], activePageId: id }), true);
    setView('draft');
    setSidebarOpen(false);
  };

  /** Each imported file becomes its own page; imported text is checked straight away, like a paste. */
  const addPageFiles = async (files: File[]) => {
    setImporting(`Reading ${files.length} file${files.length > 1 ? 's' : ''}…`);
    const failed: string[] = [];
    const added: { id: string; title: string; text: string }[] = [];
    let ids = projectRef.current.pages;
    for (const f of files) {
      try {
        const doc = await extractFile(f, 'tmp');
        const text = doc.text.replace(/\n*\[Page \d+\]\n?/g, '\n\n').trim();
        const id = nextPageId([...ids, ...added.map((a) => ({ ...a }))]);
        added.push({ id, title: f.name.replace(/\.[a-z0-9]+$/i, ''), text });
      } catch (err) {
        failed.push(`${f.name}: ${(err as Error).message}`);
      }
    }
    ids = [...ids, ...added];
    if (added.length) {
      lastWords.current = countWords(added[0].text);
      updateSelf((x) => ({ ...x, pages: [...x.pages, ...added], activePageId: added[0].id }), true);
      setView('draft');
      setTimeout(() => void runCheck(), 0);
    }
    setImporting(failed.length ? `Could not read: ${failed.join('; ')}` : null);
    if (failed.length) setTimeout(() => setImporting(null), 8000);
  };

  const renamePage = (title: string) => {
    const id = activePage(projectRef.current).id;
    updateSelf((x) => ({ ...x, pages: x.pages.map((pg) => (pg.id === id ? { ...pg, title } : pg)) }));
  };

  const deletePage = () => {
    const p = projectRef.current;
    if (p.pages.length < 2) return;
    const id = activePage(p).id;
    const idx = p.pages.findIndex((x) => x.id === id);
    const rest = p.pages.filter((x) => x.id !== id);
    const next = rest[Math.max(0, idx - 1)];
    lastWords.current = countWords(next.text);
    setConfirmDeletePage(false);
    updateSelf((x) => ({ ...x, pages: rest, activePageId: next.id }), true);
    setTimeout(() => void runCheck(), 0);
  };

  const planFocus = async (base: Requirement[], baseCategories: string[], text: string) => {
    const p = projectRef.current;
    const res = await postJson<{ plan: FocusPlan; model: string }>(
      '/api/focus',
      { description: p.description, focus: text, categories: baseCategories, requirements: base },
      { gzip: true },
    );
    const applied = applyFocus(base, baseCategories, res.plan);
    const focus: FocusState = {
      text,
      appliedAt: Date.now(),
      summary: res.plan.summary,
      notes: res.plan.notes,
      changes: applied.changes,
      model: res.model,
    };
    return { requirements: applied.requirements, categories: applied.categories, focus };
  };

  /** Replace the checklist and start a fresh check (old results belong to the old checklist). */
  const swapChecklist = (patch: Partial<Project>) => {
    gen.current++;
    again.current = false;
    abort.current?.abort();
    updateSelf((x) => ({ ...x, ...patch, results: {}, checkedPages: undefined, lastCheckAt: undefined }), true);
    setTimeout(() => void runCheck(), 50);
  };

  const applyFocusText = async (text: string) => {
    const p = projectRef.current;
    const base = p.baseRequirements ?? p.requirements;
    const baseCategories = p.baseCategories ?? p.categories;
    setFocusBusy(true);
    setFocusError(null);
    try {
      const f = await planFocus(base, baseCategories, text.trim());
      swapChecklist({ baseRequirements: base, baseCategories, ...f });
    } catch (err) {
      setFocusError((err as Error).message);
    } finally {
      setFocusBusy(false);
    }
  };

  const resetFocus = () => {
    const p = projectRef.current;
    if (!p.baseRequirements) return;
    swapChecklist({ requirements: p.baseRequirements, categories: p.baseCategories ?? p.categories, focus: undefined });
  };

  const openQuote = (q: Quote) => {
    const d = project.documents.find((x) => x.id === q.docId);
    if (d) setDoc({ doc: d, quote: q });
  };

  return (
    <div className="flex h-dvh flex-col bg-bg p-0 lg:p-3">
      {/* Mobile header */}
      <header className="flex items-center gap-2 border-b border-line px-3 py-2 lg:hidden">
        <button type="button" aria-label="Projects and files" onClick={() => setSidebarOpen(true)} className="grid size-10 place-items-center rounded-lg text-ink-2 hover:bg-raise">
          <IconMenu />
        </button>
        <span className="min-w-0 flex-1 truncate text-[15px]">{project.name}</span>
        <div className="flex rounded-lg bg-panel p-0.5 text-[13px]" role="tablist">
          {(['draft', 'compliance'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={mobileTab === t}
              onClick={() => setMobileTab(t)}
              className={`rounded-md px-3 py-1.5 ${mobileTab === t ? 'bg-raise text-ink' : 'text-muted'}`}
            >
              {t === 'draft' ? 'Draft' : 'Compliance'}
            </button>
          ))}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)_minmax(400px,500px)] lg:rounded-[22px] lg:border lg:border-line">
        <Sidebar
          project={project}
          projects={projects}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onOpenDoc={(d) => setDoc({ doc: d })}
          onOpenProject={onOpen}
          onNew={onNew}
          onDelete={onDelete}
          onAddFiles={(files) => void doRebuild(files)}
          rolesChanged={rolesChanged}
          onRebuild={() => void doRebuild()}
          pages={project.pages}
          activePageId={page.id}
          onSelectPage={selectPage}
          onAddPage={addPage}
          onAddPageFiles={(f) => void addPageFiles(f)}
          importing={importing}
          view={view}
          onView={(v) => {
            setView(v);
            setMobileTab('draft');
            setSidebarOpen(false);
          }}
        />

        <section className={`min-h-0 flex-col bg-panel lg:flex ${mobileTab === 'draft' ? 'flex' : 'hidden'}`} aria-label={view === 'focus' ? 'Focus settings' : 'Submission draft'}>
          {view === 'focus' ? (
            <FocusSettings
              project={project}
              busy={focusBusy}
              error={focusError}
              onApply={(t) => void applyFocusText(t)}
              onReset={resetFocus}
              onBack={() => setView('draft')}
            />
          ) : (
          <>
          <div className="flex items-center justify-between gap-4 px-6 pb-3 pt-6 sm:px-9">
            <input
              value={page.title}
              onChange={(e) => renamePage(e.target.value)}
              onBlur={(e) => !e.target.value.trim() && renamePage('Untitled page')}
              aria-label="Page title"
              className="min-w-0 flex-1 rounded-md bg-transparent text-[19px] font-medium text-ink outline-none hover:bg-panel-2 focus:bg-panel-2"
            />
            <span className="flex shrink-0 items-center gap-3 text-[15px] tabular-nums text-muted">
              {words} words
              {project.pages.length > 1 && <span className="text-[13px] text-faint">{allWords} in all pages</span>}
            </span>
          </div>
          {project.pages.length > 1 && (
            <div className="-mt-2 flex items-center gap-3 px-6 pb-2 text-[12px] text-faint sm:px-9">
              <span>
                Page {project.pages.findIndex((x) => x.id === page.id) + 1} of {project.pages.length}. Jev checks all pages together.
              </span>
              {!confirmDeletePage ? (
                <button type="button" onClick={() => setConfirmDeletePage(true)} className="hover:text-bad-text">
                  Delete page
                </button>
              ) : (
                <span className="flex items-center gap-2">
                  Delete this page?
                  <button type="button" onClick={deletePage} className="text-bad-text hover:underline">
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirmDeletePage(false)} className="hover:text-ink">
                    Cancel
                  </button>
                </span>
              )}
            </div>
          )}
          <textarea
            key={page.id}
            className="draft-area scroll-thin min-h-0 flex-1 resize-none bg-transparent px-6 pb-8 text-[17px] leading-[1.75] text-ink outline-none sm:px-9"
            value={page.text}
            spellCheck
            placeholder={
              project.status === 'ready'
                ? 'Start writing here, or paste your draft in.\n\nPut each section under a short heading line (for example "Device description") with a blank line between sections. Jev checks the draft against your requirements every 100 words, and straight away when you paste.'
                : 'Your checklist is not ready yet.'
            }
            onChange={(e) => onDraftInput(e.target.value, (e.nativeEvent as InputEvent).inputType)}
            aria-label="Submission draft text"
          />
          <CheckFooter check={check} wordsSince={wordsSince} hasDraft={allWords > 2} onCheck={() => void runCheck()} lastCheckAt={project.lastCheckAt} changed={changedSinceCheck} />
          </>
          )}
        </section>

        <div className={`min-h-0 lg:block ${mobileTab === 'compliance' ? 'block' : 'hidden'}`}>
          <CompliancePanel project={project} check={check} hasDraft={allWords > 2} onOpenQuote={openQuote} />
        </div>
      </div>

      {doc && (
        <DocViewer
          doc={doc.doc}
          quote={doc.quote}
          onClose={() => setDoc(null)}
          onRoleChange={(role) => {
            updateSelf((x) => ({ ...x, documents: x.documents.map((d) => (d.id === doc.doc.id ? { ...d, role } : d)) }), true);
            setDoc((cur) => (cur ? { ...cur, doc: { ...cur.doc, role } } : cur));
            setRolesChanged(true);
          }}
        />
      )}

      {rebuild && <RebuildOverlay steps={rebuild.steps} error={rebuild.error} onClose={() => setRebuild(null)} />}
    </div>
  );
}

function CheckFooter({
  check,
  wordsSince,
  hasDraft,
  onCheck,
  lastCheckAt,
  changed,
}: {
  check: CheckState;
  wordsSince: number;
  hasDraft: boolean;
  onCheck: () => void;
  lastCheckAt?: number;
  changed: boolean;
}) {
  const left = Math.max(0, WORDS_PER_CHECK - wordsSince);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-3 text-[13px] text-muted sm:px-9">
      <span className="flex items-center gap-2" aria-live="polite">
        {check.running ? (
          <>
            <Spinner size={13} /> Jev is checking ({check.done} of {check.total})
          </>
        ) : check.error ? (
          <>
            <IconAlert size={14} className="text-warn-text" /> Last check failed
          </>
        ) : lastCheckAt ? (
          <>
            <IconCheck size={14} className="text-ok-text" /> {changed ? `Next check in ${left} words, on paste or after a pause` : 'Checked'}
          </>
        ) : (
          <>Checks every {WORDS_PER_CHECK} words and on paste</>
        )}
      </span>
      <button type="button" onClick={onCheck} disabled={check.running || !hasDraft} className="rounded-md px-2 py-1 text-link hover:bg-raise disabled:opacity-40">
        Check now
      </button>
    </div>
  );
}

function RebuildOverlay({ steps, error, onClose }: { steps: Step[]; error: string | null; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal aria-label="Rebuilding requirements">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-6">
        <h3 className="text-[17px]">Rebuilding the checklist</h3>
        <ol className="mt-5 flex flex-col gap-3">
          {steps.map((s) => (
            <li key={s.key} className="flex items-start gap-3 text-[14px]">
              <span className="mt-0.5 grid size-5 place-items-center">
                {s.state === 'done' ? <IconCheck size={16} className="text-ok-text" /> : s.state === 'running' && !error ? <Spinner size={14} /> : s.state === 'running' ? <IconAlert size={15} className="text-bad-text" /> : <span className="size-1.5 rounded-full bg-line-strong" />}
              </span>
              <span>
                <span className={s.state === 'waiting' ? 'text-faint' : 'text-ink'}>{s.label}</span>
                {s.detail && <span className="block text-[12px] text-muted">{s.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
        {error && (
          <>
            <p className="mt-5 rounded-lg bg-bad/15 px-3 py-2 text-[13px] text-ink-2" role="alert">
              {error}
            </p>
            <div className="mt-4 text-right">
              <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-[14px] hover:bg-raise">
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
