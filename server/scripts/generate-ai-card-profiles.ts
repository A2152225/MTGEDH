/**
 * Generate server/data/ai-card-profiles.json and docs/ai-card-profiles.md (P1-4).
 *
 * Usage: npm run ai:profiles --workspace=server
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { cardAnalyzer } from '../../rules-engine/src/CardAnalyzer.js';
import { readOracleCardsSync } from '../src/services/oracleCardsIndex.js';
import type { CardAIProfile, CardRole } from '../../rules-engine/src/ai/cardProfileTypes.js';
import {
  emptyProfile,
  legacyRoles,
  mapCardToProfile,
  type OracleCardLike,
} from './lib/cardProfileMapper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverRoot, '..');
const OUT_PROFILES = path.join(serverRoot, 'data', 'ai-card-profiles.json');
const OUT_REPORT = path.join(repoRoot, 'docs', 'ai-card-profiles.md');
const OVERRIDES_PATH = path.join(serverRoot, 'data', 'ai-card-overrides.json');

type OverrideMap = Record<string, Partial<CardAIProfile>>;

function loadOverrides(): OverrideMap {
  if (!fs.existsSync(OVERRIDES_PATH)) return {};
  const raw = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8')) as Record<string, unknown>;
  const out: OverrideMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) continue;
    if (v && typeof v === 'object') out[k] = v as Partial<CardAIProfile>;
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleDisagreements(
  cards: OracleCardLike[],
  profilesByName: Map<string, CardAIProfile>,
  seed: number,
  n: number,
): Array<{ name: string; legacy: CardRole[]; profile: CardRole[] }> {
  const compareRoles = new Set<CardRole>(['ramp', 'draw', 'removal']);
  const diffs: Array<{ name: string; legacy: CardRole[]; profile: CardRole[] }> = [];
  for (const c of cards) {
    const leg = legacyRoles(c).filter((r) => compareRoles.has(r)).sort();
    const prof = (profilesByName.get(c.name)?.roles || []).filter((r) => compareRoles.has(r)).sort();
    if (leg.join(',') !== prof.join(',')) {
      diffs.push({ name: c.name, legacy: leg, profile: prof });
    }
  }
  const rng = mulberry32(seed);
  for (let i = diffs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [diffs[i], diffs[j]] = [diffs[j], diffs[i]];
  }
  return diffs.slice(0, n);
}

function main(): void {
  const started = Date.now();
  const cards = readOracleCardsSync() as OracleCardLike[];
  const overrides = loadOverrides();
  const legal = cards.filter((c) => c.legalities?.commander === 'legal' && c.name);
  const legalNames = new Set(legal.map((c) => c.name));
  const profiles: CardAIProfile[] = [];
  const failures: Array<{ name: string; error: string }> = [];

  for (const card of legal) {
    let p: CardAIProfile;
    try {
      p = mapCardToProfile(card, {
        parse: parseOracleTextToIR,
        analyze: (c) => cardAnalyzer.analyzeCard(c),
      });
    } catch (e) {
      failures.push({ name: card.name, error: String(e) });
      p = emptyProfile(card);
    }
    const o = overrides[card.name];
    if (o) {
      profiles.push({ ...p, ...o, name: card.name, oracleId: p.oracleId, source: 'override' });
    } else {
      profiles.push(p);
    }
  }

  profiles.sort((a, b) => a.name.localeCompare(b.name));
  const byName = new Map(profiles.map((p) => [p.name, p]));

  fs.mkdirSync(path.dirname(OUT_PROFILES), { recursive: true });
  fs.writeFileSync(
    OUT_PROFILES,
    `${JSON.stringify({ version: 1, count: profiles.length, profiles }, null, 0)}\n`,
  );

  const bySource: Record<string, number> = {};
  const byRole: Record<string, number> = {};
  let noRole = 0;
  for (const p of profiles) {
    bySource[p.source] = (bySource[p.source] || 0) + 1;
    if (p.roles.length === 0) noRole += 1;
    for (const r of p.roles) byRole[r] = (byRole[r] || 0) + 1;
  }
  const unusedOverrideKeys = Object.keys(overrides).filter((k) => !legalNames.has(k));
  const disagreements = sampleDisagreements(legal, byName, 1, 20);

  const report = `# AI card profiles (P1-4)

Generated ${new Date().toISOString()} in ${((Date.now() - started) / 1000).toFixed(1)}s.

## Counts

| Metric | Value |
| --- | --- |
| Commander-legal cards | ${profiles.length} |
| Failures | ${failures.length} |
| No role | ${noRole} |

### By source

| Source | Count |
| --- | --- |
${Object.entries(bySource).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

### By role

| Role | Cards |
| --- | --- |
${Object.entries(byRole).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

## Unused override keys

${unusedOverrideKeys.length ? unusedOverrideKeys.map((k) => `- ${k}`).join('\n') : '_None_'}

## Sample disagreements (legacy substring vs profile, ramp/draw/removal)

${disagreements.map((d) => `- **${d.name}**: legacy [${d.legacy.join(', ')}] → profile [${d.profile.join(', ')}]`).join('\n') || '_None_'}

## Failures

${failures.length ? failures.map((f) => `- ${f.name}: ${f.error}`).join('\n') : '_None_'}
`;

  fs.mkdirSync(path.dirname(OUT_REPORT), { recursive: true });
  fs.writeFileSync(OUT_REPORT, report);

  console.log(`Wrote ${profiles.length} profiles → ${OUT_PROFILES}`);
  console.log(`Wrote report → ${OUT_REPORT}`);
  console.log(`sources=${JSON.stringify(bySource)} noRole=${noRole} failures=${failures.length}`);
  if (failures.length) process.exitCode = 1;
}

main();
