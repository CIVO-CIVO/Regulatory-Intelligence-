// Quick check of category grouping on a cached rule set: tsx --conditions=react-server scripts/try-groups.mts <rules-cache.json>
import { readFileSync } from 'node:fs';
import { groupCategories } from '../src/lib/server/pipeline.ts';
const rules = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { category: string }[];
const counts: Record<string, number> = {};
for (const r of rules) counts[r.category] = (counts[r.category] ?? 0) + 1;
const g = await groupCategories(Object.keys(counts), counts);
for (const name of g.order) console.log(`${name}: ${Object.entries(g.map).filter(([, v]) => v === name).map(([k]) => k).join(', ')}`);
