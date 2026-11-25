'use client';

import { useEffect, useRef, useState } from 'react';
import type { Project, ProjectSummary } from '@/lib/types';
import { ACCEPT, kindOf } from '@/lib/client/extract';
import { sourceLabel, type SourceInput } from '@/lib/client/sources';
import AddSourceDialog, { type AddMode } from './AddSourceDialog';
import { createProject, initialSteps, type Step } from '@/lib/client/build';
import { IconAlert, IconArrowRight, IconCheck, IconDots, IconFile, IconFolder, IconFolderUp, IconLink, IconText, IconX, Spinner } from './Icons';

/** Example projects bundled in public/examples/<id>/case.json, listed in public/examples/index.json. */
interface ExampleSummary {
  id: string;
  menu: string;
  menuSub: string;
}
interface ExampleCase {
  id: string;
  name: string;
  description: string;
  notice: string;
  files: { path: string; label: string }[];
  pages: { title: string; path: string }[];
}

interface Status {
  ok: boolean | null;
  code?: string;
  error?: string;
  jev?: string;
  llm?: string;
  mock?: boolean;
}

export default function Home({
  projects,
  onOpen,
  onCreated,
}: {
  projects: ProjectSummary[];
  onOpen: (id: string) => void;
  onCreated: (p: Project) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sources, setSources] = useState<SourceInput[]>([]);
  const [adding, setAdding] = useState<AddMode | null>(null);
  const [drag, setDrag] = useState(false);
  const [menu, setMenu] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [examples, setExamples] = useState<ExampleSummary[]>([]);
  const [example, setExample] = useState<{ name: string; pages: { title: string; text: string }[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/examples/index.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((x: ExampleSummary[]) => setExamples(Array.isArray(x) ? x : []))
      .catch(() => setExamples([]));
  }, []);

  useEffect(() => {
    fetch('/api/status?probe=1')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ ok: false, error: 'Could not reach the server.' }));
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    const bad = incoming.filter((f) => !kindOf(f.name));
    const good = incoming.filter((f) => kindOf(f.name));
    setSources((prev) => [
      ...prev,
      ...good.filter((f) => !prev.some((p) => p.type === 'file' && p.file.name === f.name && p.file.size === f.size)).map((file) => ({ type: 'file' as const, file })),
    ]);
    setNotice(bad.length ? `Skipped ${bad.map((f) => f.name).join(', ')}: use PDF, DOCX, XLSX, CSV or text files.` : null);
  };

  const loadExample = async (id: string) => {
    setMenu(false);
    setNotice(null);
    try {
      const base = `/examples/${encodeURIComponent(id)}/`;
      const get = async (path: string) => {
        const r = await fetch(base + encodeURIComponent(path));
        if (!r.ok) throw new Error(path);
        return r;
      };
      const c = (await (await get('case.json')).json()) as ExampleCase;
      const files = await Promise.all(
        c.files.map(async (f) => {
          const blob = await (await get(f.path)).blob();
          return new File([blob], f.label, { type: blob.type });
        }),
      );
      const pages = await Promise.all(c.pages.map(async (pg) => ({ title: pg.title, text: (await (await get(pg.path)).text()).trim() })));
      setName(c.name);
      setDescription(c.description);
      setSources(files.map((file) => ({ type: 'file' as const, file })));
      setExample({ name: c.name, pages });
      setNotice(c.notice);
    } catch {
      setNotice('The example files could not be loaded.');
    }
  };

  const create = async () => {
    if (!sources.length) return;
    setError(null);
    setSteps(initialSteps());
    try {
      const project = await createProject({ name: name || 'Untitled project', description, sources }, setSteps);
      // An example keeps its draft pages unless the user renamed the project.
      if (example && name === example.name && example.pages.length) {
        project.pages = example.pages.map((pg, i) => ({ id: `P${i + 1}`, title: pg.title, text: pg.text }));
        project.activePageId = 'P1';
      }
      onCreated(project);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const canCreate = sources.length > 0 && name.trim().length > 0;
  const building = steps !== null;

  return (
    <main className="flex min-h-dvh flex-col items-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-[880px]">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-[15px] text-muted">Regulatory Intelligence</h1>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="More"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
              className="grid size-9 place-items-center rounded-lg bg-panel text-ink-2 hover:bg-raise"
            >
              <IconDots />
            </button>
            {menu && (
              <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-panel-2 py-1.5 shadow-2xl">
                {examples.length > 0 && <div className="px-4 pb-1 pt-1.5 text-[11.5px] uppercase tracking-wide text-faint">Try an example project</div>}
                {examples.map((x) => (
                  <button key={x.id} type="button" onClick={() => void loadExample(x.id)} disabled={building} className="block w-full px-4 py-2 text-left text-[14px] hover:bg-raise disabled:opacity-50">
                    {x.menu}
                    <span className="mt-0.5 block text-[12px] text-muted">{x.menuSub}</span>
                  </button>
                ))}
                {projects.length > 0 && <div className="mx-4 my-1.5 border-t border-line" />}
                {projects.slice(0, 8).map((p) => (
                  <button key={p.id} type="button" onClick={() => onOpen(p.id)} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[14px] hover:bg-raise">
                    <IconFolder size={16} className="text-muted" />
                    <span className="truncate">{p.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <section className="rounded-[22px] bg-panel p-6 sm:p-9" aria-label="New project">
          {!building ? (
            <div className="grid gap-8 md:grid-cols-2">
              <div className="flex flex-col gap-6">
                <label className="flex flex-col gap-2.5">
                  <span className="text-[15px] text-muted">Project name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="project 1"
                    className="h-[54px] rounded-xl border border-line bg-panel-2 px-4 text-[19px] text-ink outline-none placeholder:text-faint focus:border-line-strong"
                  />
                </label>
                <label className="flex flex-col gap-2.5">
                  <span className="text-[15px] text-muted">What are you writing?</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    placeholder="For example: a 510(k) premarket notification for a silicone foam wound dressing"
                    className="min-h-[128px] resize-y rounded-xl border border-line bg-panel-2 px-4 py-3 text-[15px] leading-relaxed text-ink outline-none placeholder:text-faint focus:border-line-strong"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-2.5">
                <span className="text-[15px] text-muted">Import files</span>
                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDrag(false);
                    addFiles(e.dataTransfer.files);
                  }}
                  className={`flex h-[128px] flex-col items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-dashed px-4 text-center transition-colors ${
                    drag ? 'border-ink-2 bg-raise' : 'border-line-strong hover:bg-panel-2'
                  }`}
                >
                  <IconFolderUp size={26} className="text-ink-2" />
                  <span className="text-[15px] text-ink-2">Drop regulations, guidance and evidence</span>
                  <span className="text-[12px] text-faint">PDF, Word, Excel, CSV or text</span>
                </button>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setAdding('link')} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13.5px] text-ink-2 hover:bg-panel-2 hover:text-ink">
                    <IconLink size={15} /> Add a link
                  </button>
                  <button type="button" onClick={() => setAdding('text')} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13.5px] text-ink-2 hover:bg-panel-2 hover:text-ink">
                    <IconText size={15} /> Paste text
                  </button>
                </div>
                <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
                <ul className="mt-1 flex flex-col items-start gap-2">
                  {sources.map((src, i) => {
                    const fromLink = src.type === 'link' || (src.type === 'doc' && !!src.doc.sourceUrl);
                    const fromText = src.type === 'text' || (src.type === 'doc' && !src.doc.sourceUrl && src.doc.kind === 'text');
                    const Icon = fromLink ? IconLink : fromText ? IconText : IconFile;
                    const label = sourceLabel(src);
                    return (
                      <li key={`${label}-${i}`} className="flex max-w-full items-center gap-2 rounded-full bg-panel-2 py-2 pl-3.5 pr-2.5 text-[14px] text-ink-2" title={src.type === 'doc' && src.doc.sourceUrl ? src.doc.sourceUrl : label}>
                        <Icon size={16} className="shrink-0 text-muted" />
                        <span className="max-w-[260px] truncate">{label}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${label}`}
                          onClick={() => setSources((prev) => prev.filter((_, j) => j !== i))}
                          className="grid size-6 place-items-center rounded-full text-muted hover:bg-raise hover:text-ink"
                        >
                          <IconX size={14} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ) : (
            <BuildProgress steps={steps} error={error} name={name} />
          )}

          {notice && !building && <p className="mt-6 text-[13px] text-muted">{notice}</p>}

          <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
            {building && error && (
              <button type="button" onClick={() => setSteps(null)} className="h-12 rounded-xl px-5 text-[15px] text-ink-2 hover:bg-raise">
                Back
              </button>
            )}
            {!building && (
              <button
                type="button"
                onClick={create}
                disabled={!canCreate}
                className="flex h-[52px] items-center gap-2 rounded-xl border border-line-strong px-6 text-[17px] text-ink transition-colors hover:bg-raise disabled:cursor-not-allowed disabled:opacity-40"
              >
                Create project <IconArrowRight size={18} />
              </button>
            )}
          </div>
        </section>

        <ConnectionNote status={status} />

        {adding && (
          <AddSourceDialog
            mode={adding}
            target="knowledge base"
            onClose={() => setAdding(null)}
            onAdd={(doc) => setSources((prev) => [...prev, { type: 'doc', doc }])}
          />
        )}

        {projects.length > 0 && !building && (
          <section className="mt-8">
            <h2 className="mb-2 text-[13px] text-muted">Your projects</h2>
            <ul className="flex flex-wrap gap-2">
              {projects.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onOpen(p.id)} className="flex items-center gap-2 rounded-lg bg-panel px-3 py-2 text-[14px] text-ink-2 hover:bg-raise">
                    <IconFolder size={16} className="text-muted" />
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-10 max-w-[640px] text-[12px] leading-relaxed text-faint">
          Your files and drafts are stored only in this browser. Their text is sent to the AI models (a language model to build the checklist, Jev
          to check your draft) while they are being analysed
          {status && /Gateway/.test(`${status.jev} ${status.llm}`) && !/TypeSafe|Anthropic/.test(`${status.jev} ${status.llm}`)
            ? ', with zero data retention,'
            : ", under the AI providers' own data terms,"}{' '}
          and is not kept on our server. The scores are writing feedback from your own documents, not a regulatory decision.
        </p>
      </div>
    </main>
  );
}

function BuildProgress({ steps, error, name }: { steps: Step[]; error: string | null; name: string }) {
  return (
    <div aria-live="polite">
      <h2 className="text-[19px] text-ink">{name || 'New project'}</h2>
      <p className="mt-1 text-[14px] text-muted">Building your checklist. This usually takes one to three minutes.</p>
      <ol className="mt-7 flex flex-col gap-4">
        {steps.map((s) => {
          const failed = error && s.state === 'running';
          return (
            <li key={s.key} className="flex items-start gap-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center">
                {s.state === 'done' ? (
                  <IconCheck size={18} className="text-ok-text" />
                ) : failed ? (
                  <IconAlert size={18} className="text-bad-text" />
                ) : s.state === 'running' ? (
                  <Spinner size={17} className="text-ink-2" />
                ) : (
                  <span className="size-2 rounded-full bg-line-strong" />
                )}
              </span>
              <div>
                <div className={`text-[15px] ${s.state === 'waiting' ? 'text-faint' : 'text-ink'}`}>{s.label}</div>
                {s.detail && <div className="text-[13px] text-muted">{s.detail}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      {error && (
        <div className="mt-7 whitespace-pre-line rounded-xl border border-bad/60 bg-bad/15 px-4 py-3 text-[14px] leading-relaxed text-ink-2" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function ConnectionNote({ status }: { status: Status | null }) {
  if (!status) return null;
  if (status.ok === false) {
    return (
      <div className="mt-5 flex gap-3 rounded-xl border border-warn/50 bg-warn/10 px-4 py-3 text-[13px] leading-relaxed text-ink-2" role="status">
        <IconAlert size={18} className="mt-0.5 shrink-0 text-warn-text" />
        <span>{status.error ?? 'The AI connection is not working right now.'}</span>
      </div>
    );
  }
  if (status.mock) {
    return <p className="mt-5 text-[13px] text-warn-text">Development mode: Jev answers are simulated ({status.jev}).</p>;
  }
  return null;
}
