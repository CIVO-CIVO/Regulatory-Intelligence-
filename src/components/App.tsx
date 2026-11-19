'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, ProjectSummary } from '@/lib/types';
import { deleteProject, listProjects, loadProject, saveProject } from '@/lib/client/store';
import Home from './Home';
import Workspace from './Workspace';

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [current, setCurrent] = useState<Project | null>(null);
  const [booted, setBooted] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Project | null>(null);

  const refreshList = useCallback(async () => setProjects(await listProjects()), []);

  const setUrl = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('p', id);
    else url.searchParams.delete('p');
    window.history.replaceState(null, '', url);
  };

  const open = useCallback(
    async (id: string) => {
      const p = await loadProject(id);
      if (!p) return;
      latest.current = p;
      setCurrent(p);
      setUrl(p.id);
    },
    [],
  );

  useEffect(() => {
    (async () => {
      await refreshList();
      const id = new URL(window.location.href).searchParams.get('p');
      if (id) await open(id);
      setBooted(true);
    })();
  }, [open, refreshList]);

  const flush = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (latest.current) {
      await saveProject(latest.current);
      await refreshList();
    }
  }, [refreshList]);

  /** Update the open project; persisted to IndexedDB shortly after. */
  const update = useCallback(
    (fn: (p: Project) => Project, immediate = false, projectId?: string) => {
      if (projectId && latest.current?.id !== projectId) return; // late update for a project no longer open
      setCurrent((prev) => {
        if (!prev || (projectId && prev.id !== projectId)) return prev;
        const next = { ...fn(prev), updatedAt: Date.now() };
        latest.current = next;
        return next;
      });
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, immediate ? 0 : 700);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => {
      if (latest.current) void saveProject(latest.current);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  if (!booted) return <div className="min-h-dvh bg-bg" />;

  if (!current) {
    return (
      <Home
        projects={projects}
        onOpen={open}
        onCreated={async (p) => {
          await saveProject(p);
          await refreshList();
          latest.current = p;
          setCurrent(p);
          setUrl(p.id);
        }}
      />
    );
  }

  return (
    <Workspace
      key={current.id}
      project={current}
      projects={projects}
      update={update}
      onOpen={async (id) => {
        await flush();
        await open(id);
      }}
      onNew={async () => {
        await flush();
        latest.current = null;
        setCurrent(null);
        setUrl(null);
      }}
      onDelete={async (id) => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = null;
        if (latest.current?.id === id) latest.current = null;
        await deleteProject(id);
        await refreshList();
        if (current.id === id) {
          latest.current = null;
          setCurrent(null);
          setUrl(null);
        }
      }}
    />
  );
}
