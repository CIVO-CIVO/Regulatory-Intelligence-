'use client';

import { useRef, useState } from 'react';
import { ROLE_LABEL, SOURCE_ROLES, type DraftPage, type KbDocument, type Project, type ProjectSummary } from '@/lib/types';
import { ACCEPT } from '@/lib/client/extract';
import { IconAlert, IconBooks, IconDoc, IconFile, IconFolder, IconPen, IconPlus, IconRefresh, IconSliders, IconX, Spinner } from './Icons';
import { pageIsStale } from '@/lib/pages';

export default function Sidebar({
  project,
  projects,
  open,
  onClose,
  onOpenDoc,
  onOpenProject,
  onNew,
  onDelete,
  onAddFiles,
  rolesChanged,
  onRebuild,
  pages,
  activePageId,
  onSelectPage,
  onAddPage,
  onAddPageFiles,
  importing,
  checkingPageId,
  view,
  onView,
}: {
  project: Project;
  projects: ProjectSummary[];
  open: boolean;
  onClose: () => void;
  onOpenDoc: (d: KbDocument) => void;
  onOpenProject: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onAddFiles: (files: File[]) => void;
  rolesChanged: boolean;
  onRebuild: () => void;
  pages: DraftPage[];
  activePageId: string;
  onSelectPage: (id: string) => void;
  onAddPage: () => void;
  onAddPageFiles: (files: File[]) => void;
  importing: string | null;
  checkingPageId?: string;
  view: 'draft' | 'focus';
  onView: (v: 'draft' | 'focus') => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const pageFileInput = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const others = projects.filter((p) => p.id !== project.id);

  const body = (
    <nav className="scroll-thin flex h-full flex-col overflow-y-auto px-5 py-6 text-[15px]" aria-label="Projects">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-muted">Your projects</span>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-raise lg:hidden">
          <IconX size={16} />
        </button>
      </div>

      <div className="flex items-center gap-2.5 py-1.5 font-medium text-ink">
        <IconFolder size={18} className="shrink-0" />
        <span className="truncate" title={project.name}>
          {project.name}
        </span>
      </div>

      <div className="ml-4 mt-2 flex flex-col">
        <div className="flex items-center gap-2.5 py-1.5 text-ink-2">
          <IconBooks size={17} className="shrink-0" />
          <span>Knowledge base</span>
        </div>
        <ul className="ml-5 flex flex-col">
          {(
            [
              ['Rules', project.documents.filter((d) => d.role && SOURCE_ROLES.includes(d.role))],
              ['Project facts', project.documents.filter((d) => d.role === 'evidence')],
              ['Other', project.documents.filter((d) => !d.role || (!SOURCE_ROLES.includes(d.role) && d.role !== 'evidence'))],
            ] as const
          ).map(([label, docs]) =>
            docs.length ? (
              <li key={label} className="mt-1.5 first:mt-0">
                <div className="pb-0.5 text-[11.5px] uppercase tracking-wide text-faint">{label}</div>
                <ul>
                  {docs.map((d) => {
                    const unreadable = d.quality.lowTextPages.length > 0;
                    return (
                      <li key={d.id}>
                        <button
                          type="button"
                          onClick={() => onOpenDoc(d)}
                          title={`${d.name} (${d.role ? ROLE_LABEL[d.role] : 'unsorted'})`}
                          className="group flex w-full items-center gap-2 rounded-md py-1 pr-1 text-left text-ink-2 hover:text-ink"
                        >
                          <IconFile size={15} className="shrink-0 text-muted" />
                          <span className="min-w-0 flex-1 truncate">{d.name}</span>
                          {unreadable && <IconAlert size={13} className="shrink-0 text-warn-text" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ) : null,
          )}
          <li>
            <button type="button" onClick={() => fileInput.current?.click()} className="flex items-center gap-2 py-1.5 text-[13px] text-muted hover:text-ink">
              <IconPlus size={14} /> Add files
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onAddFiles(Array.from(e.target.files));
                e.target.value = '';
              }}
            />
          </li>
        </ul>
        {rolesChanged && (
          <button type="button" onClick={onRebuild} className="ml-5 mt-1 flex items-center gap-2 rounded-md bg-raise px-2.5 py-1.5 text-[13px] text-ink hover:bg-line-strong">
            <IconRefresh size={14} /> Rebuild checklist
          </button>
        )}

        <div className="mt-5 flex items-center gap-2.5 py-1.5 text-ink-2">
          <IconPen size={16} className="shrink-0" />
          <span>Our draft</span>
        </div>
        <ul className="ml-5 flex flex-col">
          {pages.map((pg) => {
            const current = view === 'draft' && pg.id === activePageId;
            return (
              <li key={pg.id}>
                <button
                  type="button"
                  onClick={() => onSelectPage(pg.id)}
                  aria-current={current ? 'page' : undefined}
                  title={pg.title}
                  className={`flex w-full items-center gap-2 rounded-md py-1.5 text-left ${current ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}
                >
                  <IconDoc size={16} className="shrink-0" />
                  <span className={`min-w-0 flex-1 truncate ${current ? 'font-medium' : ''}`}>{pg.title || 'Untitled page'}</span>
                  <PageStatus project={project} pageId={pg.id} checking={checkingPageId === pg.id} />
                </button>
              </li>
            );
          })}
          <li className="flex flex-wrap gap-x-4">
            <button type="button" onClick={onAddPage} className="flex items-center gap-2 py-1.5 text-[13px] text-muted hover:text-ink">
              <IconPlus size={14} /> Add page
            </button>
            <button type="button" onClick={() => pageFileInput.current?.click()} className="flex items-center gap-2 py-1.5 text-[13px] text-muted hover:text-ink">
              <IconPlus size={14} /> Add files
            </button>
            <input
              ref={pageFileInput}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onAddPageFiles(Array.from(e.target.files));
                e.target.value = '';
              }}
            />
          </li>
          {importing && <li className="py-1 text-[12px] text-muted">{importing}</li>}
        </ul>

        <button
          type="button"
          onClick={() => onView('focus')}
          aria-current={view === 'focus' ? 'page' : undefined}
          className={`mt-5 flex items-center gap-2.5 py-1.5 text-left ${view === 'focus' ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}
        >
          <IconSliders size={16} className="shrink-0" />
          <span>Focus settings</span>
          {project.focus && <span className="size-1.5 rounded-full bg-link" aria-label="Focus applied" />}
        </button>
      </div>

      {others.length > 0 && (
        <ul className="mt-6 flex flex-col">
          {others.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onOpenProject(p.id)} className="flex w-full items-center gap-2.5 py-1.5 text-left text-ink-2 hover:text-ink">
                <IconFolder size={17} className="shrink-0 text-muted" />
                <span className="truncate">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={onNew} className="mt-6 flex items-center gap-2.5 py-1.5 text-muted hover:text-ink">
        <IconPlus size={16} /> New project
      </button>

      <div className="mt-auto pt-10 text-[12px] text-faint">
        {project.engines && (
          <p className="mb-2 leading-relaxed">
            {project.engines.llm}
            <br />
            {project.engines.jev}
          </p>
        )}
        {project.dropped.length > 0 && (
          <details className="mb-2">
            <summary className="cursor-pointer text-muted">{project.dropped.length} item(s) left out</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {project.dropped.map((d, i) => (
                <li key={i}>
                  <span className="text-ink-2">{d.title}</span>: {d.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        {!confirmDelete ? (
          <button type="button" onClick={() => setConfirmDelete(true)} className="text-faint hover:text-bad-text">
            Delete project
          </button>
        ) : (
          <span className="flex items-center gap-3">
            Delete for good?
            <button type="button" onClick={() => onDelete(project.id)} className="text-bad-text hover:underline">
              Delete
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="hover:text-ink">
              Cancel
            </button>
          </span>
        )}
      </div>
    </nav>
  );

  return (
    <>
      <aside className="hidden min-h-0 border-r border-line bg-[#1e1e1e] lg:block">{body}</aside>
      {open && (
        <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-modal aria-label="Projects and files">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60" onClick={onClose} />
          <aside className="absolute inset-y-0 left-0 w-[300px] max-w-[85vw] border-r border-line bg-[#1e1e1e]">{body}</aside>
        </div>
      )}
    </>
  );
}

/** Worst rating on a page: red if any rule breaks, amber if any is partial, green if all relevant rules pass. */
function PageStatus({ project, pageId, checking }: { project: Project; pageId: string; checking: boolean }) {
  if (checking) return <Spinner size={11} className="shrink-0 text-muted" />;
  const pc = project.pageChecks?.[pageId];
  if (!pc) return null;
  const rel = Object.values(pc.rules).filter((c) => c.relevant && !project.requirements.find((r) => r.id === c.reqId)?.muted);
  if (!rel.length) return <span className="size-1.5 shrink-0 rounded-full bg-line-strong" title="No rules rated on this page" />;
  const red = rel.filter((c) => c.tone === 'red').length;
  const amber = rel.filter((c) => c.tone === 'amber').length;
  const color = red ? 'bg-bad-text' : amber ? 'bg-warn-text' : 'bg-ok-text';
  const stale = pageIsStale(project, pageId);
  return (
    <span
      className={`size-2 shrink-0 rounded-full ${color} ${stale ? 'opacity-40' : ''}`}
      title={`${rel.length} rules rated: ${red} red, ${amber} amber, ${rel.length - red - amber} green${stale ? ' (changed since)' : ''}`}
    />
  );
}
