/**
 * Outcome sweep CLI arguments and card selection (Commander-legal oracle cards by default,
 * filtered by set / name, optionally a hash-mixed sample, then offset / limit).
 */
import path from 'node:path';
import { iterateOracleCards, resolveOracleCardsPath } from '../../src/services/oracleCardsIndex.js';
import { includeCardInCensus } from '../census-card-filter.js';
import { shapeSweepCard, type SweepCard } from './sweepBoard.js';
import { SWEEP_REPO_ROOT, SWEEP_SERVER_ROOT } from './sweepEnv.js';

export type SweepArgs = {
  out: string;
  limit?: number;
  offset: number;
  sets: string[];
  names: string[];
  exactNames: boolean;
  sample?: number;
  chunk: number;
  workers: number;
  timeoutMs: number;
  resume: boolean;
  reportOnly: boolean;
  verbose: boolean;
  /** Previous run directory: write compare.txt / compare.json (per-card class changes) into --out. */
  compare?: string;
};

function value(argv: string[], flag: string): string | undefined {
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

function num(argv: string[], flag: string): number | undefined {
  const raw = value(argv, flag);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Comma-separated list; when the value contains `|`, it is the separator instead (card names with commas). */
function list(argv: string[], flag: string): string[] {
  const raw = String(value(argv, flag) || '');
  return raw.split(raw.includes('|') ? '|' : ',').map((entry) => entry.trim()).filter(Boolean);
}

export function parseSweepArgs(argv: string[]): SweepArgs {
  return {
    out: path.resolve(value(argv, '--out') || process.env.OUTCOME_SWEEP_DIR || path.join(SWEEP_SERVER_ROOT, 'scripts', 'out', 'outcome-sweep')),
    limit: num(argv, '--limit'),
    offset: num(argv, '--offset') ?? 0,
    sets: list(argv, '--set').map((set) => set.toLowerCase()),
    names: list(argv, '--name').map((name) => name.toLowerCase()),
    exactNames: argv.includes('--exact'),
    sample: num(argv, '--sample'),
    chunk: Math.max(1, num(argv, '--chunk') ?? 200),
    workers: Math.max(1, Math.min(8, num(argv, '--workers') ?? 1)),
    timeoutMs: num(argv, '--timeout') ?? 20000,
    resume: argv.includes('--resume'),
    reportOnly: argv.includes('--report-only'),
    verbose: argv.includes('--verbose'),
    compare: value(argv, '--compare') ? path.resolve(String(value(argv, '--compare'))) : undefined,
  };
}

function fnv(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function selectSweepCards(args: SweepArgs): Promise<SweepCard[]> {
  const out: SweepCard[] = [];
  const seen = new Set<string>();
  for await (const raw of iterateOracleCards(resolveOracleCardsPath(SWEEP_REPO_ROOT))) {
    const name = String(raw.name || '');
    if (!name || seen.has(name)) continue;
    if (!includeCardInCensus(raw as any)) continue;
    if (args.sets.length && !args.sets.includes(String(raw.set || '').toLowerCase())) continue;
    if (args.names.length) {
      const lower = name.toLowerCase();
      if (!args.names.some((needle) => (args.exactNames ? lower === needle : lower.includes(needle)))) continue;
    }
    seen.add(name);
    out.push(shapeSweepCard(raw));
  }
  let cards = out;
  if (args.sample) cards = [...cards].sort((a, b) => fnv(String(a.name)) - fnv(String(b.name))).slice(0, args.sample);
  cards = cards.slice(args.offset);
  if (args.limit !== undefined) cards = cards.slice(0, args.limit);
  return cards;
}
