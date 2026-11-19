'use client';
// Projects live only in this browser (IndexedDB). Nothing is stored on the server.
import { createStore, del, get, set } from 'idb-keyval';
import type { Project, ProjectSummary } from '../types';
import { migrateProject } from '../pages';

const store = typeof indexedDB !== 'undefined' ? createStore('regulatory-intelligence', 'projects') : undefined;
const INDEX = 'index';

export async function listProjects(): Promise<ProjectSummary[]> {
  if (!store) return [];
  return ((await get<ProjectSummary[]>(INDEX, store)) ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | undefined> {
  if (!store) return undefined;
  const p = await get<Project>(`p:${id}`, store);
  return p ? migrateProject(p) : undefined;
}

export async function saveProject(p: Project): Promise<void> {
  if (!store) return;
  await set(`p:${p.id}`, p, store);
  const idx = (await get<ProjectSummary[]>(INDEX, store)) ?? [];
  const summary: ProjectSummary = { id: p.id, name: p.name, updatedAt: p.updatedAt, status: p.status };
  const next = [summary, ...idx.filter((x) => x.id !== p.id)];
  await set(INDEX, next, store);
}

export async function deleteProject(id: string): Promise<void> {
  if (!store) return;
  await del(`p:${id}`, store);
  const idx = (await get<ProjectSummary[]>(INDEX, store)) ?? [];
  await set(INDEX, idx.filter((x) => x.id !== id), store);
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
