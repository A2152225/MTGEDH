import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stampPermanentEntryTimestamp, readPermanentTimestamp } from '../../rules-engine/src/permanentTimestamps.js';

/**
 * Every code path that pushes a new permanent onto the battlefield must stamp its entry timestamp
 * (CR 613.7) right away instead of relying on the lazy stamping done when derived effects sync.
 * This guard scans the server sources so a newly added entry path cannot silently skip it.
 */
const SRC = join(__dirname, '..', 'src');
/** Paths that legitimately create synthetic/test-only permanents. */
const EXEMPT = [/oracleIrLiveSoak\.ts$/, /spellCastBoardContext\.ts$/];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('permanent entry timestamps', () => {
  it('stampPermanentEntryTimestamp gives each entering permanent a fresh increasing timestamp and is idempotent', () => {
    const state: any = { battlefield: [] };
    const a: any = { id: 'a' };
    const b: any = { id: 'b' };
    state.battlefield.push(a);
    stampPermanentEntryTimestamp(state, a);
    state.battlefield.push(b);
    stampPermanentEntryTimestamp(state, b);
    expect(readPermanentTimestamp(a)).toBeDefined();
    expect(readPermanentTimestamp(b)!).toBeGreaterThan(readPermanentTimestamp(a)!);
    const before = a.timestamp;
    stampPermanentEntryTimestamp(state, a);
    expect(a.timestamp).toBe(before);
  });

  it('every battlefield.push(...) in server sources is followed by an entry-timestamp stamp', () => {
    const missing: string[] = [];
    for (const file of walk(SRC)) {
      if (EXEMPT.some((re) => re.test(file))) continue;
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!/\bbattlefield(?:\s+as any\))?\s*\.push\(/.test(line)) return;
        // Walk to the end of the push statement, then look a few lines beyond it.
        let depth = 0;
        let end = index;
        for (let i = index; i < lines.length; i++) {
          for (const ch of lines[i]) {
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
          }
          if (depth <= 0) { end = i; break; }
        }
        const window = lines.slice(end, end + 4).join('\n');
        // A temporary probe permanent that is popped right away never actually enters the battlefield.
        if (!/stampPermanentEntryTimestamp\(/.test(window) && !/battlefield\.pop\(\)/.test(window)) {
          missing.push(`${relative(SRC, file)}:${index + 1}`);
        }
      });
    }
    expect(missing).toEqual([]);
  });
});