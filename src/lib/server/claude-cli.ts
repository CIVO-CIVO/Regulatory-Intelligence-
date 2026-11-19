import 'server-only';
// DEV ONLY: run the LLM steps through the Claude Code CLI logged in on this machine, so prompts can
// be tested against a real model without a gateway. Refused on Vercel (see ai.ts).
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

function findCli(): string {
  const env = process.env.CLAUDE_CLI;
  if (env && existsSync(/*turbopackIgnore: true*/ env)) return env;
  for (const p of [path.join(homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (existsSync(/*turbopackIgnore: true*/ p)) return p;
  }
  const ext = path.join(homedir(), '.vscode/extensions');
  if (existsSync(/*turbopackIgnore: true*/ ext)) {
    const hits = readdirSync(/*turbopackIgnore: true*/ ext)
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .sort()
      .reverse();
    for (const d of hits) {
      const p = path.join(ext, d, 'resources/native-binary/claude');
      if (existsSync(/*turbopackIgnore: true*/ p)) return p;
    }
  }
  throw new Error('Claude Code CLI not found (set CLAUDE_CLI).');
}

export async function cliObject<T>(opts: {
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}): Promise<T> {
  const cli = findCli();
  const jsonSchema = JSON.stringify(z.toJSONSchema(opts.schema));
  const system = `${opts.system}\n\nRespond with ONE JSON object only, no prose and no code fences, matching this JSON Schema:\n${jsonSchema}`;
  const cwd = mkdtempSync(/*turbopackIgnore: true*/ path.join(tmpdir(), 'ri-cli-'));
  const args = ['-p', '--output-format', 'json', '--model', opts.model, '--effort', 'low', '--tools', '',
    '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands',
    '--system-prompt', system];
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ cli, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`claude cli exit ${code}: ${stderr.slice(0, 400)}`))));
    child.stdin.end(opts.prompt);
  });
  const envelope = JSON.parse(out) as { result?: string; is_error?: boolean };
  if (envelope.is_error || typeof envelope.result !== 'string') throw new Error(`claude cli error: ${out.slice(0, 300)}`);
  const text = firstJsonObject(envelope.result);
  return opts.schema.parse(JSON.parse(text));
}

/** The first balanced {...} object in a model reply (ignores fences and trailing prose). */
function firstJsonObject(s: string): string {
  const start = s.indexOf('{');
  if (start < 0) throw new Error('No JSON object in the reply.');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return s.slice(start, i + 1);
  }
  throw new Error('Unterminated JSON object in the reply.');
}
