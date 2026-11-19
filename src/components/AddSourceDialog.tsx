'use client';

import { useEffect, useRef, useState } from 'react';
import type { DocRole, KbDocument } from '@/lib/types';
import { sourceToDoc } from '@/lib/client/sources';
import { IconX, Spinner } from './Icons';

export type AddMode = 'link' | 'text';

/**
 * Add a web link or pasted text. The link is downloaded and read here, so a blocked or empty page is
 * reported before anything is added.
 */
export default function AddSourceDialog({
  mode,
  target,
  onAdd,
  onClose,
}: {
  mode: AddMode;
  target: 'knowledge base' | 'draft';
  onAdd: (doc: KbDocument) => void | Promise<void>;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<'auto' | DocRole>('auto');
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const doc =
        mode === 'link'
          ? await sourceToDoc({ type: 'link', url: url.trim().match(/^https?:\/\//i) ? url.trim() : `https://${url.trim()}` }, 'tmp')
          : await sourceToDoc({ type: 'text', title: title.trim(), text }, 'tmp');
      await onAdd(role === 'auto' ? doc : { ...doc, role });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const can = mode === 'link' ? url.trim().length > 4 : text.trim().length >= 20;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal aria-label={mode === 'link' ? 'Add a link' : 'Paste text'}>
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={() => !busy && onClose()} />
      <form onSubmit={submit} className="relative w-full max-w-lg rounded-2xl border border-line bg-panel p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-[17px] text-ink">{mode === 'link' ? `Add a link to the ${target}` : `Paste text into the ${target}`}</h3>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-raise hover:text-ink">
            <IconX size={16} />
          </button>
        </div>
        {mode === 'link' ? (
          <>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              A web page with a regulation or guidance (for example on ecfr.gov, fda.gov or federalregister.gov), or a direct link to a PDF or Word
              file. The page is downloaded once and saved as text.
            </p>
            <input
              ref={first}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.ecfr.gov/current/title-21/chapter-I/subchapter-H/part-812"
              inputMode="url"
              disabled={busy}
              className="mt-4 h-11 w-full rounded-xl border border-line bg-panel-2 px-3.5 text-[14px] text-ink outline-none placeholder:text-faint focus:border-line-strong"
            />
          </>
        ) : (
          <>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              disabled={busy}
              className="mt-4 h-11 w-full rounded-xl border border-line bg-panel-2 px-3.5 text-[14px] text-ink outline-none placeholder:text-faint focus:border-line-strong"
            />
            <textarea
              ref={first}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={9}
              placeholder="Paste the text of a regulation, a guidance, or facts about your project."
              disabled={busy}
              className="mt-3 w-full resize-y rounded-xl border border-line bg-panel-2 px-3.5 py-3 text-[14px] leading-relaxed text-ink outline-none placeholder:text-faint focus:border-line-strong"
            />
          </>
        )}
        {target === 'knowledge base' && (
          <label className="mt-3 flex items-center gap-2 text-[13px] text-muted">
            Use as
            <select value={role} onChange={(e) => setRole(e.target.value as 'auto' | DocRole)} disabled={busy} className="rounded-md border border-line bg-panel-2 px-2 py-1 text-ink">
              <option value="auto">Decide for me</option>
              <option value="regulation">Rules: regulation</option>
              <option value="guidance">Rules: guidance</option>
              <option value="standard">Rules: standard</option>
              <option value="evidence">Project facts</option>
            </select>
          </label>
        )}
        {error && (
          <p className="mt-3 rounded-lg bg-bad/15 px-3 py-2 text-[13px] leading-relaxed text-ink-2" role="alert">
            {error}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-3">
          {busy && (
            <span className="mr-auto flex items-center gap-2 text-[13px] text-muted">
              <Spinner size={13} /> {mode === 'link' ? 'Downloading and reading…' : 'Adding…'}
            </span>
          )}
          <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-xl px-4 text-[14px] text-ink-2 hover:bg-raise">
            Cancel
          </button>
          <button type="submit" disabled={!can || busy} className="h-10 rounded-xl border border-line-strong px-5 text-[14px] text-ink hover:bg-raise disabled:opacity-40">
            {mode === 'link' ? 'Add link' : 'Add text'}
          </button>
        </div>
      </form>
    </div>
  );
}
