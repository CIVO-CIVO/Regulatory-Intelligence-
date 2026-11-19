import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { errorResponse, HttpError, readJson } from '@/lib/server/http';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_BYTES = 30_000_000;
const TIMEOUT_MS = 25_000;
const UA = 'Mozilla/5.0 (compatible; RegulatoryIntelligence/1.0; document import)';

/** Private, loopback, link-local and other internal ranges are never fetched (no SSRF). */
function isPrivate(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}

async function assertPublic(url: URL) {
  if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, 'Only http and https links can be added.');
  if (url.username || url.password) throw new HttpError(400, 'Links with a user name or password are not supported.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new HttpError(400, 'That address is not on the public internet.');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new HttpError(400, `Could not find the site ${host}.`);
  if (addrs.some((a) => isPrivate(a.address))) throw new HttpError(400, 'That address is not on the public internet.');
}

/**
 * eCFR pages wrap the regulation in site menus; its renderer gives the clean text of the same part,
 * subpart or section. https://www.ecfr.gov/current/title-21/chapter-I/subchapter-H/part-812
 */
function rewrite(url: URL): { url: URL; note?: string } {
  if (/(^|\.)ecfr\.gov$/i.test(url.hostname)) {
    const m = url.pathname.match(/^\/current\/title-(\d+)(\/.*)?$/);
    if (m) {
      const api = new URL(`https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-${m[1]}`);
      for (const seg of (m[2] ?? '').split('/').filter(Boolean)) {
        const k = seg.match(/^(chapter|subchapter|part|subpart|section|appendix)-(.+)$/);
        if (k) api.searchParams.set(k[1], decodeURIComponent(k[2]));
      }
      if ([...api.searchParams.keys()].length) return { url: api, note: 'ecfr' };
    }
  }
  return { url };
}

function fileName(cd: string | null): string | null {
  if (!cd) return null;
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star) return decodeURIComponent(star[1].replace(/"/g, '').trim());
  const plain = cd.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : null;
}

/** Download a public web page or file for the knowledge base. The browser turns it into text. */
export async function POST(req: Request) {
  try {
    const body = await readJson<{ url: string }>(req, 10_000);
    let url: URL;
    try {
      url = new URL(String(body.url ?? '').trim());
    } catch {
      throw new HttpError(400, 'That does not look like a web address. It should start with https://');
    }
    const original = url.toString();
    const r = rewrite(url);
    url = r.url;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      let res: Response | null = null;
      for (let hop = 0; hop < 6; hop++) {
        await assertPublic(url);
        res = await fetch(url, {
          redirect: 'manual',
          signal: ac.signal,
          headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain,*/*;q=0.8', 'Accept-Language': 'en' },
        });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          await res.body?.cancel();
          url = new URL(res.headers.get('location')!, url); // each hop is checked again
          continue;
        }
        break;
      }
      if (!res) throw new HttpError(502, 'No answer from the site.');
      if (res.status >= 300 && res.status < 400) throw new HttpError(502, 'The site redirected too many times.');
      if (!res.ok) throw new HttpError(502, `The site answered ${res.status}${res.status === 403 ? ' (access refused; it may block automatic downloads)' : res.status === 404 ? ' (page not found)' : ''}.`);
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > MAX_BYTES) throw new HttpError(413, 'The file is larger than 30 MB. Download it and upload a smaller part.');
      // Stream through with a hard size cap.
      let seen = 0;
      const capped = res.body!.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, ctrl) {
            seen += chunk.byteLength;
            if (seen > MAX_BYTES) ctrl.error(new Error('Too large'));
            else ctrl.enqueue(chunk);
          },
        }),
      );
      const buf = new Uint8Array(await new Response(capped).arrayBuffer());
      if (buf.byteLength === 0) {
        throw new HttpError(502, 'The site sent an empty page. It probably blocks automatic downloads (some sites use a bot check). Download the document and upload it, or paste its text.');
      }
      console.log(`[fetch-url] ${url.hostname} ${res.status} ${res.headers.get('content-type')} ${buf.byteLength} bytes`);
      return new Response(buf, {
        headers: {
          'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
          'X-Final-Url': url.toString(),
          'X-Original-Url': original,
          ...(r.note ? { 'X-Source-Note': r.note } : {}),
          ...(fileName(res.headers.get('content-disposition')) ? { 'X-Filename': encodeURIComponent(fileName(res.headers.get('content-disposition'))!) } : {}),
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new HttpError(504, 'The site took too long to answer.');
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Could not download the page: ${String((err as Error).message ?? err).slice(0, 160)}`);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return errorResponse(err);
  }
}
