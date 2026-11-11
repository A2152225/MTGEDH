/**
 * Shared self-play JSONL row helpers (P1-3 / P1-6).
 *
 * Public entry symbols: ResultRow, podOf, expandGlobs, readJsonlRows, mulberry32.
 */

import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'node:fs';

export interface ResultRow {
  gameId: string;
  seed?: number;
  decks?: Record<string, string>;
  seatBrains?: Record<string, string>;
  seatOrder?: string[];
  winner?: string | null;
  endReason?: string;
  turns?: number;
  ms?: number;
  error?: string;
}

/** selfplay-<seed>-<pod>-<rotation> → selfplay-<seed>-<pod> */
export function podOf(gameId: string): string {
  const m = /^(selfplay-\d+-\d+)-\d+$/.exec(gameId);
  return m ? m[1] : gameId.replace(/-\d+$/, '');
}

export function expandGlobs(specs: string[], cwd = process.cwd()): string[] {
  const files: string[] = [];
  for (const spec of specs) {
    if (!spec) continue;
    if (spec.includes('*') || spec.includes('?')) {
      const abs = path.isAbsolute(spec) ? spec : path.join(cwd, spec);
      files.push(...globSync(abs, { windowsPathsNoEscape: true }));
    } else {
      const p = path.isAbsolute(spec) ? spec : path.resolve(cwd, spec);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        files.push(...globSync(path.join(p, '*.jsonl'), { windowsPathsNoEscape: true }));
      } else if (fs.existsSync(p)) {
        files.push(p);
      }
    }
  }
  return [...new Set(files)].sort();
}

export function readJsonlRows<T = ResultRow>(files: string[]): T[] {
  const rows: T[] = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.warn(`missing: ${file}`);
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line) as T);
      } catch {
        console.warn(`bad line in ${file}: ${line.slice(0, 80)}`);
      }
    }
  }
  return rows;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
