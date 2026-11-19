import { engines, jevDecide, describeAiError } from '@/lib/server/ai';

export const dynamic = 'force-dynamic';

/** Which engines are configured; with ?probe=1 also a tiny live Jev call to prove the connection. */
export async function GET(req: Request) {
  const info = engines();
  if (new URL(req.url).searchParams.get('probe') !== '1') return Response.json({ ...info, ok: null });
  try {
    const r = await jevDecide(
      { DRAFT: [{ section: 'Test', text: 'The device is a sterile wound dressing.' }] },
      { probe: { type: 'boolean', instructions: { question: 'Does the DRAFT say the device is sterile?' }, criteria: { true: 'It says so.', false: 'It does not.' } } },
    );
    return Response.json({ ...info, ok: true, model: r.model, ms: r.ms });
  } catch (err) {
    const d = describeAiError(err);
    return Response.json({ ...info, ok: false, code: d.code, error: d.message });
  }
}
