'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusState, KbDocument, PageCheck, Project, ProjectSummary, Quote, Requirement, RuleCheck } from '@/lib/types';
import { SOURCE_ROLES } from '@/lib/types';
import { applyFocus, type FocusPlan } from '@/lib/focus';
import { postJson } from '@/lib/client/api';
import { countWords } from '@/lib/text';
import { activePage, nextPageId, pageIsStale, signature, totalWords } from '@/lib/pages';
import { selectFacts } from '@/lib/rules';
import { extractFile } from '@/lib/client/extract';
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
  pageId?: string;
  error: { code: string; message: string } | null;
}

/** Only what the check needs travels to the server (no stored answers, no evidence lists). */
const slimRule = (r: Requirement): Requirement => ({
  id: r.id,
  category: r.category,
  title: r.title,
  need: r.need,
  criticality: r.criticality,
  section: r.section,
  topic: r.topic,
  complies: r.complies,
  conflicts: r.conflicts,
  quote: { ...r.quote, text: r.quote.text },
  questions: [],
  evidence: [],
});

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
  const [check, setCheck] = useState<CheckState>({ running: false, error: null });
  const [wordsSince, setWordsSince] = useState(0);
  const [doc, setDoc] = useState<{ doc: KbDocument; quote?: Quote } | null>(null);
  const [mobileTab, setMobileTab] = useState<'draft' | 'compliance'>('draft');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rebuild, setRebuild] = useState<{ steps: Step[]; error: string | null } | null>(null);
  const [rolesChanged, setRolesChanged] = useState(false);
  const [view, setView] = useState<'draft' | 'focus'>('draft');
  const [focusBusy, setFocusBusy] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [confirmDeletePage, setConfirmDeletePage] = useState(false);
  const [confirmMovePage, setConfirmMovePage] = useState(false);

  const projectRef = useRef(project);
  projectRef.current = project;
  const page = activePage(project);
  const running = useRef(false);
  const pending = useRef<Set<string>>(new Set());
  const abort = useRef<AbortController | null>(null);
  const lastWords = useRef(countWords(page.text));
  const disposed = useRef(false);
  const gen = useRef(0); // bumped when results of an older check must be ignored (rebuild, focus)
  const rebuilding = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const words = useMemo(() => countWords(page.text), [page.text]);
  const allWords = useMemo(() => totalWords(project.pages), [project.pages]);
  const pageCheck = project.pageChecks?.[page.id];
  const stale = pageIsStale(project, page.id);

  // The ref is advanced at once (fn is pure), so a check started right after a change, before React
  // re-renders, already sees it (e.g. a page imported from a file).
  const updateSelf = useCallback(
    (fn: (p: Project) => Project, immediate?: boolean) => {
      projectRef.current = fn(projectRef.current);
      update(fn, immediate, project.id);
    },
    [update, project.id],
  );

  // ------------------------------------------------------------ the check, one page at a time

  const runCheck = useCallback(
    async (pageId?: string) => {
      if (disposed.current) return;
      const p = projectRef.current;
      const id = pageId ?? activePage(p).id;
      if (running.current || rebuilding.current) {
        pending.current.add(id);
        return;
      }
      if (idle.current) clearTimeout(idle.current);
      const pg = p.pages.find((x) => x.id === id);
      const rules = p.requirements.filter((r) => !r.muted);
      if (!pg || p.status !== 'ready' || !rules.length) return;
      if (id === activePage(p).id) setWordsSince(0);
      const sig = signature([pg]);
      const facts = selectFacts(
        p.documents.filter((d) => d.role === 'evidence').map((d) => ({ id: d.id, name: d.name, text: d.text })),
        pg.text,
      );
      if (countWords(pg.text) < 3) {
        const empty: PageCheck = { signature: sig, title: pg.title, text: pg.text, at: Date.now(), rules: {}, facts: [] };
        updateSelf((x) => ({ ...x, pageChecks: { ...(x.pageChecks ?? {}), [id]: empty } }), true);
        return;
      }
      const myGen = gen.current;
      const current = () => !disposed.current && gen.current === myGen;
      running.current = true;
      const ac = new AbortController();
      abort.current = ac;
      setCheck({ running: true, pageId: id, error: null });
      let error: CheckState['error'] = null;
      try {
        const res = await postJson<{ rules: Record<string, RuleCheck>; model?: string; partial: boolean }>(
          '/api/check-page',
          {
            page: { title: pg.title, text: pg.text },
            rules: rules.map(slimRule),
            facts,
            docs: p.documents.map((d) => ({ id: d.id, name: d.name })),
          },
          { gzip: true, signal: ac.signal },
        );
        if (current()) {
          const result: PageCheck = { signature: sig, title: pg.title, text: pg.text, at: Date.now(), rules: res.rules, facts, model: res.model, partial: res.partial };
          updateSelf((x) => ({ ...x, pageChecks: { ...(x.pageChecks ?? {}), [id]: result } }), true);
          if (res.partial) error = { code: 'partial', message: 'Some Jev answers were missing, so those rules show as not checked. Use "Check now" to try again.' };
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          const e = err as { message: string; code?: string };
          error = { code: e.code ?? 'error', message: e.message };
        }
      } finally {
        running.current = false;
        abort.current = null;
        if (!disposed.current) setCheck({ running: false, pageId: id, error: current() ? error : null });
        // Next queued page, the one being edited first.
        if (!disposed.current && pending.current.size) {
          const active = activePage(projectRef.current).id;
          const next = pending.current.has(active) ? active : [...pending.current][0];
          pending.current.delete(next);
          void runCheck(next);
        }
      }
    },
    [updateSelf],
  );

  const checkAllPages = () => {
    const p = projectRef.current;
    const stalePages = p.pages.filter((x) => countWords(x.text) > 2 && pageIsStale(p, x.id)).map((x) => x.id);
    stalePages.forEach((id) => pending.current.add(id));
    if (!running.current && stalePages.length) {
      const first = stalePages[0];
      pending.current.delete(first);
      void runCheck(first);
    }
  };

  // First open: check the page in view if it changed since its last check.
  useEffect(() => {
    disposed.current = false;
    const p = projectRef.current;
    const pg = activePage(p);
    if (p.status === 'ready' && countWords(pg.text) > 2 && pageIsStale(p, pg.id)) void runCheck(pg.id);
    return () => {
      disposed.current = true;
      pending.current.clear();
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
      setWordsSince(0);
      setTimeout(() => void runCheck(pageId), 0);
    } else {
      setWordsSince(since);
      // Small edits that keep the word count (e.g. fixing "12" to "24") are checked after a pause.
      idle.current = setTimeout(() => {
        if (pageIsStale(projectRef.current, pageId)) void runCheck(pageId);
      }, IDLE_CHECK_MS);
    }
  };

  /** Replace the checklist (rebuild, focus) and check the page in view again. */
  const swapChecklist = (patch: Partial<Project>) => {
    gen.current++;
    pending.current.clear();
    abort.current?.abort();
    updateSelf((x) => ({ ...x, ...patch, pageChecks: {}, results: {}, checkedPages: undefined }), true);
    setTimeout(() => void runCheck(), 50);
  };

  /** Project facts changed: page claims must be compared again. */
  const factsChanged = () => {
    gen.current++;
    pending.current.clear();
    abort.current?.abort();
    updateSelf((x) => ({ ...x, pageChecks: {} }), true);
    setTimeout(() => void runCheck(), 50);
  };

  // ------------------------------------------------------------ rebuild the checklist

  const doRebuild = async (newFiles?: File[]) => {
    setRebuild({ steps: initialSteps(), error: null });
    rebuilding.current = true;
    gen.current++;
    pending.current.clear();
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
      let addedRules = true;
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
        // New project facts only: no need to rebuild the rules.
        addedRules = docs.some((d) => d.role && SOURCE_ROLES.includes(d.role)) || projectRef.current.engine !== 2;
      } else {
        set('read', { state: 'done', detail: `${documents.length} files` });
        set('sort', { state: 'done', detail: 'Using the roles you set' });
      }
      if (!addedRules) {
        set('rules', { state: 'done', detail: 'The new files are project facts; the rules stay as they are' });
        set('questions', { state: 'done' });
        updateSelf((x) => ({ ...x, documents, dropped: [...x.dropped, ...unread] }), true);
        setRebuild(null);
        rebuilding.current = false;
        factsChanged();
        return;
      }
      const map = await buildRequirements({ ...projectRef.current, documents }, set);
      const earlierUnread = projectRef.current.dropped.filter((d) => d.reason === 'File could not be read.');
      const focusText = projectRef.current.focus?.text;
      const focused = focusText ? await planFocus(map.requirements, map.categories, focusText).catch(() => null) : null;
      rebuilding.current = false;
      swapChecklist({
        documents,
        engine: 2,
        baseRequirements: map.requirements,
        baseCategories: map.categories,
        requirements: focused?.requirements ?? map.requirements,
        categories: focused?.categories ?? map.categories,
        focus: focused?.focus,
        dropped: [...earlierUnread, ...unread, ...map.dropped],
        status: 'ready',
      });
      setRolesChanged(false);
      setRebuild(null);
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
    setWordsSince(0);
    setConfirmDeletePage(false);
    setConfirmMovePage(false);
    updateSelf((x) => ({ ...x, activePageId: id }));
    setView('draft');
    setMobileTab('draft');
    setSidebarOpen(false);
    // Each page has its own ratings: check it if it changed since its last check.
    if (countWords(pg.text) > 2 && pageIsStale(projectRef.current, id)) setTimeout(() => void runCheck(id), 0);
  };

  const addPage = () => {
    const id = nextPageId(projectRef.current.pages);
    lastWords.current = 0;
    setWordsSince(0);
    updateSelf((x) => ({ ...x, pages: [...x.pages, { id, title: 'Untitled page', text: '' }], activePageId: id }), true);
    setView('draft');
    setSidebarOpen(false);
  };

  /** Each imported file becomes its own page; imported text is checked straight away, like a paste. */
  const addPageFiles = async (files: File[]) => {
    setImporting(`Reading ${files.length} file${files.length > 1 ? 's' : ''}…`);
    const failed: string[] = [];
    const added: { id: string; title: string; text: string }[] = [];
    for (const f of files) {
      try {
        const d = await extractFile(f, 'tmp');
        const text = d.text.replace(/\n*\[Page \d+\]\n?/g, '\n\n').trim();
        const id = nextPageId([...projectRef.current.pages, ...added]);
        added.push({ id, title: f.name.replace(/\.[a-z0-9]+$/i, ''), text });
      } catch (err) {
        failed.push(`${f.name}: ${(err as Error).message}`);
      }
    }
    if (added.length) {
      lastWords.current = countWords(added[0].text);
      updateSelf((x) => ({ ...x, pages: [...x.pages, ...added], activePageId: added[0].id }), true);
      setView('draft');
      added.slice(1).forEach((a) => pending.current.add(a.id));
      setTimeout(() => void runCheck(added[0].id), 0);
    }
    setImporting(failed.length ? `Could not read: ${failed.join('; ')}` : null);
    if (failed.length) setTimeout(() => setImporting(null), 8000);
  };

  const renamePage = (title: string) => {
    const id = activePage(projectRef.current).id;
    updateSelf((x) => ({ ...x, pages: x.pages.map((pg) => (pg.id === id ? { ...pg, title } : pg)) }));
  };

  const removePage = (id: string) => {
    const p = projectRef.current;
    const idx = p.pages.findIndex((x) => x.id === id);
    const rest = p.pages.filter((x) => x.id !== id);
    const pages = rest.length ? rest : [{ id: nextPageId(p.pages), title: 'Submission draft', text: '' }];
    const next = pages[Math.max(0, Math.min(idx, pages.length) - 1)] ?? pages[0];
    lastWords.current = countWords(next.text);
    const checks = { ...(p.pageChecks ?? {}) };
    delete checks[id];
    updateSelf((x) => ({ ...x, pages, activePageId: next.id, pageChecks: checks }), true);
    return next;
  };

  const deletePage = () => {
    if (projectRef.current.pages.length < 2) return;
    setConfirmDeletePage(false);
    const next = removePage(activePage(projectRef.current).id);
    if (pageIsStale(projectRef.current, next.id) && countWords(next.text) > 2) setTimeout(() => void runCheck(next.id), 0);
  };

  /** A page that holds facts about the project (a dossier, a study summary) belongs in the knowledge base. */
  const movePageToKnowledgeBase = () => {
    const p = projectRef.current;
    const pg = activePage(p);
    const maxId = Math.max(0, ...p.documents.map((d) => Number(d.id.slice(1)) || 0));
    const d: KbDocument = {
      id: `D${maxId + 1}`,
      name: `${pg.title || 'Untitled page'}.txt`,
      size: pg.text.length,
      kind: 'text',
      text: pg.text,
      quality: { chars: pg.text.length, lowTextPages: [] },
      role: 'evidence',
      title: pg.title,
      summary: 'Moved from Our draft. Used as project facts: claims on your pages are compared with it.',
    };
    setConfirmMovePage(false);
    updateSelf((x) => ({ ...x, documents: [...x.documents, d] }), true);
    removePage(pg.id);
    factsChanged();
  };

  // ------------------------------------------------------------ focus settings

  const planFocus = async (base: Requirement[], baseCategories: string[], text: string) => {
    const p = projectRef.current;
    const res = await postJson<{ plan: FocusPlan; model: string }>(
      '/api/focus',
      { description: p.description, focus: text, categories: baseCategories, requirements: base.map(slimRule) },
      { gzip: true },
    );
    const applied = applyFocus(base, baseCategories, res.plan);
    const focus: FocusState = { text, appliedAt: Date.now(), summary: res.plan.summary, notes: res.plan.notes, changes: applied.changes, model: res.model };
    return { requirements: applied.requirements, categories: applied.categories, focus };
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
          checkingPageId={check.running ? check.pageId : undefined}
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
              <div className="-mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-6 pb-2 text-[12px] text-faint sm:px-9">
                {project.pages.length > 1 && (
                  <span>
                    Page {project.pages.findIndex((x) => x.id === page.id) + 1} of {project.pages.length}. Each page has its own ratings.
                  </span>
                )}
                {!confirmMovePage ? (
                  <button type="button" onClick={() => setConfirmMovePage(true)} className="hover:text-ink" title="For pages that hold facts about your project, such as a dossier or study summary">
                    Use as project facts
                  </button>
                ) : (
                  <span className="flex items-center gap-2">
                    Move this page to the knowledge base as project facts?
                    <button type="button" onClick={movePageToKnowledgeBase} className="text-link hover:underline">
                      Move
                    </button>
                    <button type="button" onClick={() => setConfirmMovePage(false)} className="hover:text-ink">
                      Cancel
                    </button>
                  </span>
                )}
                {project.pages.length > 1 &&
                  (!confirmDeletePage ? (
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
                  ))}
              </div>
              <textarea
                key={page.id}
                className="draft-area scroll-thin min-h-0 flex-1 resize-none bg-transparent px-6 pb-8 text-[17px] leading-[1.75] text-ink outline-none sm:px-9"
                value={page.text}
                spellCheck
                placeholder={
                  project.status === 'ready'
                    ? 'Start writing here, or paste your draft in.\n\nJev checks this page against your rules every 100 words, and straight away when you paste. Only the rules this page is about get a rating; everything else stays neutral.'
                    : 'Your checklist is not ready yet.'
                }
                onChange={(e) => onDraftInput(e.target.value, (e.nativeEvent as InputEvent).inputType)}
                aria-label="Submission draft text"
              />
              <CheckFooter
                check={check}
                pageId={page.id}
                wordsSince={wordsSince}
                hasText={words > 2}
                onCheck={() => void runCheck(page.id)}
                checkedAt={pageCheck?.at}
                changed={stale}
              />
            </>
          )}
        </section>

        <div className={`min-h-0 lg:block ${mobileTab === 'compliance' ? 'block' : 'hidden'}`}>
          <CompliancePanel
            project={project}
            page={page}
            check={check}
            onOpenQuote={openQuote}
            onRebuild={() => void doRebuild()}
            onCheckAll={checkAllPages}
          />
        </div>
      </div>

      {doc && (
        <DocViewer
          doc={doc.doc}
          quote={doc.quote}
          onClose={() => setDoc(null)}
          onRoleChange={(role) => {
            const before = doc.doc.role;
            updateSelf((x) => ({ ...x, documents: x.documents.map((d) => (d.id === doc.doc.id ? { ...d, role } : d)) }), true);
            setDoc((cur) => (cur ? { ...cur, doc: { ...cur.doc, role } } : cur));
            const isRule = (r?: string) => !!r && SOURCE_ROLES.includes(r as never);
            if (isRule(before) || isRule(role)) setRolesChanged(true); // the rules change: rebuild
            else if (before === 'evidence' || role === 'evidence') factsChanged(); // only the facts change
          }}
        />
      )}

      {rebuild && <RebuildOverlay steps={rebuild.steps} error={rebuild.error} onClose={() => setRebuild(null)} />}
    </div>
  );
}

function CheckFooter({
  check,
  pageId,
  wordsSince,
  hasText,
  onCheck,
  checkedAt,
  changed,
}: {
  check: CheckState;
  pageId: string;
  wordsSince: number;
  hasText: boolean;
  onCheck: () => void;
  checkedAt?: number;
  changed: boolean;
}) {
  const left = Math.max(0, WORDS_PER_CHECK - wordsSince);
  const busyHere = check.running && check.pageId === pageId;
  const failedHere = !check.running && check.error && check.pageId === pageId;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-3 text-[13px] text-muted sm:px-9">
      <span className="flex items-center gap-2" aria-live="polite">
        {busyHere ? (
          <>
            <Spinner size={13} /> Jev is checking this page
          </>
        ) : failedHere ? (
          <>
            <IconAlert size={14} className="text-warn-text" /> Last check failed
          </>
        ) : checkedAt ? (
          <>
            <IconCheck size={14} className="text-ok-text" /> {changed ? `Next check in ${left} words, on paste or after a pause` : 'Checked'}
          </>
        ) : (
          <>Checks every {WORDS_PER_CHECK} words and on paste</>
        )}
      </span>
      <button type="button" onClick={onCheck} disabled={busyHere || !hasText} className="rounded-md px-2 py-1 text-link hover:bg-raise disabled:opacity-40">
        Check now
      </button>
    </div>
  );
}

function RebuildOverlay({ steps, error, onClose }: { steps: Step[]; error: string | null; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal aria-label="Rebuilding the checklist">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-6">
        <h3 className="text-[17px]">Rebuilding the checklist</h3>
        <ol className="mt-5 flex flex-col gap-3">
          {steps.map((s) => (
            <li key={s.key} className="flex items-start gap-3 text-[14px]">
              <span className="mt-0.5 grid size-5 place-items-center">
                {s.state === 'done' ? (
                  <IconCheck size={16} className="text-ok-text" />
                ) : s.state === 'running' && !error ? (
                  <Spinner size={14} />
                ) : s.state === 'running' ? (
                  <IconAlert size={15} className="text-bad-text" />
                ) : (
                  <span className="size-1.5 rounded-full bg-line-strong" />
                )}
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
