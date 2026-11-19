// Shared data model for Regulatory Intelligence.
// Everything a project needs lives in the user's browser (IndexedDB); the server is stateless.

export type DocRole = 'regulation' | 'guidance' | 'standard' | 'evidence' | 'draft' | 'other';

/** Roles whose text can create requirements. Everything else can only be evidence. */
export const SOURCE_ROLES: DocRole[] = ['regulation', 'guidance', 'standard'];

export const ROLE_LABEL: Record<DocRole, string> = {
  regulation: 'Regulation',
  guidance: 'Guidance',
  standard: 'Standard',
  evidence: 'Evidence',
  draft: 'Submission draft',
  other: 'Other',
};

export type DocKind = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'text';

export interface KbDocument {
  id: string; // D1, D2 ...
  name: string; // file name as uploaded
  size: number;
  kind: DocKind;
  /** Extracted text. PDFs carry "[Page N]" markers so quotes can be located. */
  text: string;
  quality: {
    chars: number;
    pages?: number;
    /** Pages with (almost) no text layer: scanned, image or figure only. */
    lowTextPages: number[];
    note?: string;
  };
  role?: DocRole;
  title?: string;
  summary?: string;
}

/** A quotation that has been string-matched against the uploaded text. */
export interface Quote {
  docId: string;
  text: string; // the text exactly as it appears in the document
  start: number;
  end: number;
  page?: number;
  match: 'exact' | 'fuzzy';
}

export type QuestionKind = 'coverage' | 'claim';

export interface JevQuestionSpec {
  id: string; // R4.1
  kind: QuestionKind;
  /** The specific content the draft must state, written out in full. */
  element: string;
  trueWhen?: string;
  falseWhen?: string;
  lint?: string[];
}

export type Criticality = 'critical' | 'major' | 'minor';

export interface Requirement {
  id: string; // R1 ...
  category: string;
  title: string; // 1-4 words, shown in the panel
  need: string; // plain-language: what the draft must contain
  criticality: Criticality;
  quote: Quote; // verified quotation from a regulation / guidance / standard
  questions: JevQuestionSpec[];
  evidence: Quote[]; // verified passages from the user's evidence files
  hint?: string;
  /** Set by the user's focus settings: left out of checks and counts. */
  muted?: boolean;
  /** Focus ranking inside the category (1 = most important). */
  rank?: number;
  /** Why the focus settings changed this requirement. */
  focusNote?: string;
}

export interface FocusChange {
  reqId: string;
  title: string;
  what: string;
}

export interface FocusState {
  text: string;
  appliedAt: number;
  summary: string;
  notes: string[];
  changes: FocusChange[];
  model?: string;
}

export interface QuestionResult {
  id: string;
  kind: QuestionKind;
  /** Support signal in [0, 1]: P(yes) for coverage, P(supported) for claim checks. */
  support: number;
  /** Full distribution for claim checks. */
  probabilities?: Record<string, number>;
  contradiction?: number;
  refused?: boolean;
}

export type Tone = 'green' | 'amber' | 'red' | 'grey';

export interface RequirementResult {
  reqId: string;
  at: number;
  questions: QuestionResult[];
  score: number; // 0-100, the weakest question (conservative)
  passed: number;
  total: number;
  tone: Tone;
  contradiction: boolean;
  /** Exact Jev requests sent (state + questions), for transparency. */
  requests?: unknown[];
  model?: string;
  error?: string;
  /** Draft sections that were in the state. */
  sections?: string[];
  /** Jev saw only part of a long draft. */
  partial?: boolean;
}

export interface DroppedRequirement {
  title: string;
  reason: string;
}

export type ProjectStatus = 'building' | 'ready' | 'error';

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  status: ProjectStatus;
  buildError?: string;
  documents: KbDocument[];
  categories: string[];
  requirements: Requirement[];
  /** The checklist as built from the documents, before focus settings (focus is always applied to this). */
  baseRequirements?: Requirement[];
  baseCategories?: string[];
  focus?: FocusState;
  dropped: DroppedRequirement[];
  /** The submission is written across one or more pages ("Our draft"). */
  pages: DraftPage[];
  activePageId?: string;
  /** Legacy single-draft field (projects before pages); migrated into pages on load. */
  draft?: string;
  results: Record<string, RequirementResult>;
  lastCheckAt?: number;
  /** The pages as they were at the last completed check (to rebuild the exact Jev requests). */
  checkedPages?: PageText[];
  /** Legacy, see checkedPages. */
  checkedDraft?: string;
  /** Which engines produced the analysis (shown in the UI, never hidden). */
  engines?: { llm: string; jev: string };
}

export interface PageText {
  title: string;
  text: string;
}

export interface DraftPage extends PageText {
  id: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  status: ProjectStatus;
}

/** Thresholds for the support signal. Not compliance percentages. */
export const PASS_AT = 0.8;
export const AMBER_AT = 0.5;
export const CONTRADICTION_AT = 0.3;
