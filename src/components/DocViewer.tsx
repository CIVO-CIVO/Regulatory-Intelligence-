'use client';

import { useEffect, useRef } from 'react';
import { ROLE_LABEL, type DocRole, type KbDocument, type Quote } from '@/lib/types';
import { IconAlert, IconX } from './Icons';

const ROLES = Object.keys(ROLE_LABEL) as DocRole[];

export default function DocViewer({
  doc,
  quote,
  onClose,
  onRoleChange,
}: {
  doc: KbDocument;
  quote?: Quote;
  onClose: () => void;
  onRoleChange: (role: DocRole) => void;
}) {
  const hit = useRef<HTMLElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeBtn.current?.focus();
    const t = setTimeout(() => hit.current?.scrollIntoView({ block: 'center' }), 30);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, quote]);

  const text = doc.text;
  const q = quote && quote.docId === doc.id && quote.end <= text.length ? quote : undefined;

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end bg-black/55" role="dialog" aria-modal aria-label={doc.name}>
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[760px] flex-col border-l border-line bg-panel shadow-2xl">
        <header className="flex items-start gap-3 border-b border-line px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-medium text-ink" title={doc.name}>
              {doc.name}
            </h2>
            {doc.title && doc.title !== doc.name && <p className="mt-0.5 truncate text-[13px] text-muted">{doc.title}</p>}
            {doc.summary && <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{doc.summary}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
              <label className="flex items-center gap-2">
                Role
                <select
                  value={doc.role ?? 'other'}
                  onChange={(e) => onRoleChange(e.target.value as DocRole)}
                  className="rounded-md border border-line bg-panel-2 px-2 py-1 text-ink"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
              <span>{doc.kind.toUpperCase()}</span>
              {doc.quality.pages ? <span>{doc.quality.pages} pages</span> : null}
              <span>{Math.round(doc.quality.chars / 1000)}k characters</span>
            </div>
            {doc.quality.note && (
              <p className="mt-3 flex items-start gap-2 text-[13px] text-warn-text">
                <IconAlert size={15} className="mt-0.5 shrink-0" /> {doc.quality.note}
                {doc.quality.lowTextPages.length > 0 && doc.quality.lowTextPages.length < 30 && ` Pages: ${doc.quality.lowTextPages.join(', ')}.`}
              </p>
            )}
          </div>
          <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-raise hover:text-ink">
            <IconX />
          </button>
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">
          <p className="mb-4 text-[12px] text-faint">Extracted text, as the AI models read it.</p>
          <div className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.7] text-ink-2">
            {q ? (
              <>
                {text.slice(0, q.start)}
                <mark ref={hit} className="quote-hit">
                  {text.slice(q.start, q.end)}
                </mark>
                {text.slice(q.end)}
              </>
            ) : (
              text
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
