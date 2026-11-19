'use client';

import { useEffect, useRef, useState } from 'react';
import type { Project, ProjectSummary } from '@/lib/types';
import { ACCEPT, kindOf } from '@/lib/client/extract';
import { createProject, initialSteps, type Step } from '@/lib/client/build';
import { IconAlert, IconArrowRight, IconCheck, IconDots, IconFile, IconFolder, IconFolderUp, IconX, Spinner } from './Icons';

const EXAMPLE = {
  name: 'FlexiGuard 510(k)',
  description:
    'A traditional 510(k) premarket notification to the US FDA for the FlexiGuard FG-200 wound dressing (silicone contact layer and polyurethane foam).',
};

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
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [menu, setMenu] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [exampleDraft, setExampleDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
    setFiles((prev) => [...prev, ...good.filter((f) => !prev.some((p) => p.name === f.name && p.size === f.size))]);
    setNotice(bad.length ? `Skipped ${bad.map((f) => f.name).join(', ')}: use PDF, DOCX, XLSX, CSV or text files.` : null);
  };

  const loadExample = async () => {
    setMenu(false);
    setNotice(null);
    try {
      const manifest = (await fetch('/examples/manifest.json').then((r) => r.json())) as { file: string; label: string }[];
      const loaded = await Promise.all(
        manifest.map(async (m) => {
          const blob = await fetch(`/examples/${encodeURIComponent(m.file)}`).then((r) => {
            if (!r.ok) throw new Error(m.file);
            return r.blob();
          });
          return new File([blob], m.label, { type: blob.type });
        }),
      );
      const draft = await fetch('/examples/draft.txt').then((r) => (r.ok ? r.text() : ''));
      setName(EXAMPLE.name);
      setDescription(EXAMPLE.description);
      setFiles(loaded);
      setExampleDraft(draft);
      setNotice('Example files loaded. The clinical, risk and labeling files are fictional; the CFR and FDA texts are real public documents.');
    } catch {
      setNotice('The example files could not be loaded.');
    }
  };

  const create = async () => {
    if (!files.length) return;
    setError(null);
    setSteps(initialSteps());
    try {
      const project = await createProject({ name: name || 'Untitled project', description, files }, setSteps);
      if (exampleDraft && name === EXAMPLE.name) project.pages = [{ ...project.pages[0], text: exampleDraft }];
      onCreated(project);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const canCreate = files.length > 0 && name.trim().length > 0;
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
              <div className="absolute right-0 z-20 mt-2 w-72 overflow-hidden rounded-xl border border-line bg-panel-2 py-1.5 shadow-2xl">
                <button type="button" onClick={loadExample} disabled={building} className="block w-full px-4 py-2.5 text-left text-[14px] hover:bg-raise disabled:opacity-50">
                  Try the example project
                  <span className="mt-0.5 block text-[12px] text-muted">FDA 510(k) for a wound dressing, six files</span>
                </button>
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
                <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
                <ul className="mt-2 flex flex-col items-start gap-2">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex max-w-full items-center gap-2 rounded-full bg-panel-2 py-2 pl-3.5 pr-2.5 text-[14px] text-ink-2">
                      <IconFile size={16} className="shrink-0 text-muted" />
                      <span className="max-w-[260px] truncate">{f.name}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="grid size-6 place-items-center rounded-full text-muted hover:bg-raise hover:text-ink"
                      >
                        <IconX size={14} />
                      </button>
                    </li>
                  ))}
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
