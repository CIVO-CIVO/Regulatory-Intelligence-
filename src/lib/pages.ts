// Draft pages: a submission can be written across several pages. Jev checks all pages together.

import type { DraftPage, PageText, Project } from './types';
import { countWords, splitSections, type DraftSection } from './text';

export const FIRST_PAGE_TITLE = 'Submission draft';

/** Projects saved before pages existed carry one `draft` string: turn it into the first page. */
export function migrateProject(p: Project): Project {
  if (Array.isArray(p.pages) && p.pages.length) {
    return p.activePageId && p.pages.some((x) => x.id === p.activePageId) ? p : { ...p, activePageId: p.pages[0].id };
  }
  const pages: DraftPage[] = [{ id: 'P1', title: FIRST_PAGE_TITLE, text: p.draft ?? '' }];
  return {
    ...p,
    pages,
    activePageId: 'P1',
    draft: undefined,
    checkedPages: p.checkedPages ?? (p.checkedDraft !== undefined ? [{ title: FIRST_PAGE_TITLE, text: p.checkedDraft }] : undefined),
    checkedDraft: undefined,
  };
}

export function activePage(p: Project): DraftPage {
  return p.pages.find((x) => x.id === p.activePageId) ?? p.pages[0];
}

export function pageTexts(pages: PageText[]): PageText[] {
  return pages.map((x) => ({ title: x.title, text: x.text }));
}

/** Changes whenever any page's title or text changes. */
export function signature(pages: PageText[] | undefined): string {
  return (pages ?? []).map((x) => `${x.title}\u0000${x.text}`).join('\u0001');
}

export function totalWords(pages: PageText[]): number {
  return pages.reduce((n, x) => n + countWords(x.text), 0);
}

export function nextPageId(pages: DraftPage[]): string {
  return `P${Math.max(0, ...pages.map((x) => Number(x.id.slice(1)) || 0)) + 1}`;
}

/**
 * Draft sections across all pages. With one page the headings are the page's own; with several,
 * each heading carries its page ("Labeling › Warnings") so Jev and the user can see where it is.
 */
export function pageSections(pages: PageText[]): DraftSection[] {
  const withText = pages.filter((x) => x.text.trim());
  if (withText.length <= 1) return splitSections(withText[0]?.text ?? '');
  return withText.flatMap((page) =>
    splitSections(page.text).map((s) => ({ ...s, heading: `${page.title || 'Untitled page'} › ${s.heading || 'Untitled section'}` })),
  );
}
