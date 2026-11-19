import { describeAiError, jevDecide } from '@/lib/server/ai';
import { errorResponse, HttpError, readJson } from '@/lib/server/http';
import { buildJobs, scoreRequirement, toQuestionResult, type JevJob } from '@/lib/jev';
import { splitSections } from '@/lib/text';
import type { QuestionResult, Requirement } from '@/lib/types';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

interface Body {
  draft: string;
  docs: { id: string; name: string }[];
  requirements: Requirement[];
}

const CONCURRENCY = 12;
const TIME_BUDGET_MS = 95_000; // maxDuration is 120 s

/**
 * Re-check the draft: every requirement's Jev questions are asked against the current text.
 * Streams one NDJSON line per requirement as soon as its answers are in.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = await readJson<Body>(req, 8_000_000);
    if (typeof body.draft !== 'string' || body.draft.length > 600_000) throw new HttpError(413, 'The draft is too long to check in one go.');
    if (!Array.isArray(body.requirements) || body.requirements.length > 200) throw new HttpError(400, 'Too many requirements.');
  } catch (err) {
    return errorResponse(err);
  }
  const names = new Map(body.docs.map((d) => [d.id, d.name]));
  const docName = (id: string) => names.get(id) ?? id;
  const sections = splitSections(body.draft);
  const jobs: JevJob[] = body.requirements.flatMap((r) => buildJobs(r, sections, docName));
  const pending = new Map<string, number>();
  for (const j of jobs) pending.set(j.reqId, (pending.get(j.reqId) ?? 0) + 1);
  const answers = new Map<string, QuestionResult[]>();
  const errors = new Map<string, string>();
  const models = new Set<string>();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      const t0 = Date.now();
      let firstError: { code: string; message: string } | null = null;
      let next = 0;
      const finish = (r: Requirement, job: JevJob) => {
        const left = (pending.get(r.id) ?? 1) - 1;
        pending.set(r.id, left);
        if (left > 0) return;
        const qs = answers.get(r.id) ?? [];
        const result = scoreRequirement(r, qs, {
          model: [...models][0],
          error: errors.get(r.id),
          sections: job.sections,
          partial: job.partial,
        });
        // A requirement with a failed call is shown as not checked, never with a partial score.
        if (result.error) result.tone = 'grey';
        send({ type: 'result', result });
      };
      const worker = async () => {
        while (next < jobs.length) {
          const job = jobs[next++];
          const r = body.requirements.find((x) => x.id === job.reqId)!;
          if (Date.now() - t0 > TIME_BUDGET_MS) {
            // Never run into the function limit mid-stream: unanswered items come back as "not checked".
            errors.set(r.id, 'Time limit reached before this requirement was checked.');
            finish(r, job);
            continue;
          }
          try {
            const out = await jevDecide(job.state, job.questions, req.signal);
            models.add(out.model);
            const list = answers.get(r.id) ?? [];
            for (const spec of r.questions) {
              if (job.questions[spec.id]) list.push(toQuestionResult(spec, out.answers[spec.id]));
            }
            answers.set(r.id, list);
          } catch (err) {
            const cause = (err as { cause?: { code?: string } }).cause;
            console.warn(`[evaluate] ${job.key} failed: ${String((err as Error).message).slice(0, 160)} ${cause?.code ?? ''}`);
            const d = describeAiError(err);
            firstError ??= d;
            errors.set(r.id, d.message);
          }
          finish(r, job);
        }
      };
      try {
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
        console.log(`[evaluate] ${body.requirements.length} reqs, ${jobs.length} Jev calls, ${Date.now() - t0} ms${firstError ? `, error ${(firstError as { code: string }).code}` : ''}`);
        send({ type: 'done', ms: Date.now() - t0, jobs: jobs.length, model: [...models][0], error: firstError });
      } catch (err) {
        send({ type: 'done', ms: Date.now() - t0, jobs: jobs.length, error: describeAiError(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
