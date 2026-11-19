import type { Tone } from '@/lib/types';

const FILL: Record<Tone, string> = { green: 'bg-ok', amber: 'bg-warn', red: 'bg-bad', grey: 'bg-transparent' };

/** Jev support signal 0-100 as a pill bar; the number sits at the right end like the design. */
export function ScoreBar({ score, tone, width = 168, label }: { score: number | null; tone: Tone; width?: number; label?: string }) {
  const pct = score === null ? 0 : Math.max(score, 3);
  return (
    <div
      className="relative h-[26px] shrink-0 overflow-hidden rounded-full bg-track"
      style={{ width }}
      role="img"
      aria-label={label ?? (score === null ? 'Not checked yet' : `Jev support ${score} of 100`)}
    >
      {score !== null && <div className={`absolute inset-y-0 left-0 rounded-full ${FILL[tone]} transition-[width] duration-500`} style={{ width: `${pct}%` }} />}
      <span className="absolute inset-y-0 right-2.5 flex items-center text-[14px] tabular-nums text-ink">{score ?? ''}</span>
    </div>
  );
}

export function SummaryBar({ green, amber, red, grey }: { green: number; amber: number; red: number; grey: number }) {
  const total = green + amber + red + grey || 1;
  const seg = (n: number, cls: string, key: string) => (n ? <div key={key} className={cls} style={{ width: `${(n / total) * 100}%` }} /> : null);
  return (
    <div className="flex h-[9px] w-full overflow-hidden rounded-full bg-track" role="img" aria-label={`${green} green, ${amber} amber, ${red} red, ${grey} not checked`}>
      {seg(green, 'bg-ok', 'g')}
      {seg(amber, 'bg-warn', 'a')}
      {seg(red, 'bg-bad', 'r')}
      {seg(grey, 'bg-track', 'n')}
    </div>
  );
}
