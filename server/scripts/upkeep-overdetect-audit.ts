/**
 * Over-detect / duplicate audit for beginning-of-upkeep detection.
 * Coverage audits measure under-detect; this flags:
 * - false upkeep_effect with no upkeep/keyword timing in oracle
 * - paraphrase+oracle doubles (same permanent, near-duplicate effect keys)
 *
 * Write: server/scripts/out/upkeep-overdetect.json
 *
 * Env:
 *   UPKEEP_OVERDETECT_LIMIT=N  (default 400)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectUpkeepTriggers } from '../src/state/modules/upkeep-triggers.js';
import {
  ensureLocalCardLookupIndexSync,
  lookupLocalCardByNameSync,
} from '../src/services/localCardLookup.js';
import { readOracleCardsSync } from '../src/services/oracleCardsIndex.js';

const LIMIT = Math.max(1, Number(process.env.UPKEEP_OVERDETECT_LIMIT || 400) || 400);
const EFFECT_TYPES = new Set([
  'upkeep_effect',
  'each_upkeep',
  'each_player_upkeep',
  'opponent_upkeep',
  'sacrifice_creature_or_self',
]);

function normalizeEffectKey(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[~—–-]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasUpkeepTiming(oracle: string): boolean {
  return /\bat the beginning of (?:your|each(?: player's)?|each opponent's|the)[^\n.]{0,40}\bupkeep\b/i.test(
    oracle,
  );
}

function hasKeywordUpkeep(oracle: string): boolean {
  return /\b(?:fading|vanishing|cumulative upkeep|echo|pact)\b/i.test(oracle);
}

ensureLocalCardLookupIndexSync();

const falsePositives: Array<{ name: string; triggerTypes: string[]; effects: string[] }> = [];
const duplicates: Array<{ name: string; effects: string[] }> = [];
let scanned = 0;

const cards = readOracleCardsSync() as Array<Record<string, unknown>>;
for (const card of cards) {
  const name = String(card?.name || '').trim();
  if (!name || name.includes('//')) continue;
  const local = lookupLocalCardByNameSync(name) || card;
  const oracle = String((local as any)?.oracle_text || card?.oracle_text || '');
  if (!oracle) continue;
  if (!/\bupkeep\b/i.test(oracle) && !hasKeywordUpkeep(oracle)) {
    // Still probe a slice of non-upkeep cards for false positives.
    if (scanned % 17 !== 0) {
      scanned += 1;
      if (scanned >= LIMIT) break;
      continue;
    }
  }

  const triggers = detectUpkeepTriggers(
    local,
    { id: `p-${scanned}`, controller: 'p1', counters: { fade: 2, time: 2, soot: 1, age: 1 } },
  );
  const effectTriggers = triggers.filter((t) => EFFECT_TYPES.has(String(t.triggerType)));
  scanned += 1;

  if (effectTriggers.length > 0 && !hasUpkeepTiming(oracle) && !hasKeywordUpkeep(oracle)) {
    falsePositives.push({
      name,
      triggerTypes: effectTriggers.map((t) => String(t.triggerType)),
      effects: effectTriggers.map((t) => String(t.effect || t.description || '').slice(0, 160)),
    });
  }

  const keys = effectTriggers.map((t) => normalizeEffectKey(String(t.effect || t.description || '')));
  const seen = new Set<string>();
  const dupKeys: string[] = [];
  for (const key of keys) {
    if (!key) continue;
    if (seen.has(key)) dupKeys.push(key);
    seen.add(key);
  }
  // Near-duplicate: one key is a prefix of another (paraphrase vs full clause).
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = keys[i];
      const b = keys[j];
      if (!a || !b || a === b) continue;
      if (a.includes(b) || b.includes(a)) dupKeys.push(`${a} ~~ ${b}`);
    }
  }
  if (dupKeys.length > 0) {
    duplicates.push({
      name,
      effects: effectTriggers.map((t) => String(t.effect || t.description || '').slice(0, 160)),
    });
  }

  if (scanned >= LIMIT) break;
}

const report = {
  scanned,
  falsePositiveCount: falsePositives.length,
  duplicateCount: duplicates.length,
  falsePositives: falsePositives.slice(0, 100),
  duplicates: duplicates.slice(0, 100),
};

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'upkeep-overdetect.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`Wrote report: ${outPath}`);
console.log(JSON.stringify({
  scanned: report.scanned,
  falsePositiveCount: report.falsePositiveCount,
  duplicateCount: report.duplicateCount,
}, null, 2));
process.exit(0);
