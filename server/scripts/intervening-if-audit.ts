import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// stream-json is CJS; use createRequire for compatibility in our ESM server workspace.
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamObject } = require('stream-json/streamers/StreamObject');

import { extractInterveningIfClause, evaluateInterveningIfClauseDetailed } from '../src/state/modules/triggers/intervening-if.js';

type ClauseStats = {
  clause: string;
  clauseLower: string;
  count: number;
  exampleCards: string[];
  evaluation: 'recognized' | 'unknown';
  sampleResult?: boolean;
};

function normalizeClauseKey(clause: string): string {
  return String(clause || '')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function splitOracleTextIntoTriggerLikeChunks(text: string): string[] {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const lines = normalized
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  const triggerStart = /^(when|whenever|at)\b/i;
  const abilityWordWithDash = /^[^\u2014]{2,40}\u2014\s*(when|whenever|at)\b/i;

  for (const line of lines) {
    // Only consider text that appears to be a triggered ability line.
    // This avoids false positives like "If you do, ..." follow-up instructions.
    if (triggerStart.test(line)) {
      chunks.push(line);
      continue;
    }

    // Ability word templates: "Landfall — Whenever ..."
    if (abilityWordWithDash.test(line)) {
      chunks.push(line);
      const idx = line.indexOf('—');
      if (idx >= 0) {
        const afterDash = line.slice(idx + 1).trim();
        if (afterDash) chunks.push(afterDash);
      }
      continue;
    }
  }

  return Array.from(new Set(chunks));
}

function buildProbeContext(): any {
  // The goal here is NOT to simulate a real game, but to provide enough state
  // that most supported patterns can return true/false instead of null.
  const controllerId = 'P1';
  const opp1 = 'P2';
  const opp2 = 'P3';

  return {
    state: {
      players: [{ id: controllerId }, { id: opp1 }, { id: opp2 }],

      // Common numeric trackers
      life: { [controllerId]: 40, [opp1]: 40, [opp2]: 39 },
      poisonCounters: { [controllerId]: 0, [opp1]: 0, [opp2]: 1 },
      cardsDrawnThisTurn: { [controllerId]: 2, [opp1]: 1, [opp2]: 0 },
      lifeGainedThisTurn: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },
      lifeLostThisTurn: { [controllerId]: 0, [opp1]: 1, [opp2]: 0 },
      landsEnteredBattlefieldThisTurn: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },

      // Turn / phase-ish knobs (best effort)
      dayNight: 'day',
      isDay: true,
      isNight: false,

      // Spell casting trackers
      spellsCastThisTurn: [{ id: 'spell1' }],
      spellsCastLastTurn: { [controllerId]: 2, [opp1]: 0, [opp2]: 0 },

      // Damage trackers
      creaturesThatDealtDamageToPlayer: {
        [opp1]: { SRC: true },
        [opp2]: { SRC: false },
      },

      // Battlefield
      battlefield: [
        {
          id: 'SRC',
          controller: controllerId,
          attackedThisTurn: true,
          card: { type_line: 'Creature — Human Knight', manaValue: 3 },
          counters: { '+1/+1': 1 },
          auras: ['aura1'],
          equipment: ['eq1'],
        },
        {
          id: 'C2',
          controller: controllerId,
          card: { type_line: 'Creature — Wizard', manaValue: 2 },
        },
        {
          id: 'L1',
          controller: controllerId,
          card: { type_line: 'Basic Land — Plains' },
        },
        {
          id: 'L2',
          controller: controllerId,
          card: { type_line: 'Basic Land — Plains' },
        },
        {
          id: 'L3',
          controller: controllerId,
          card: { type_line: 'Basic Land — Island' },
        },
        {
          id: 'O1',
          controller: opp1,
          card: { type_line: 'Creature — Human' },
        },
      ],

      // Zones
      hands: {
        [controllerId]: [{ name: 'Card A' }, { name: 'Card B' }],
        [opp1]: [{ name: 'Card C' }],
        [opp2]: [{ name: 'Card D' }, { name: 'Card E' }, { name: 'Card F' }],
      },
      graveyards: {
        [controllerId]: [{ type_line: 'Creature — Zombie' }],
        [opp1]: [],
        [opp2]: [{ type_line: 'Instant' }, { type_line: 'Creature — Elf' }],
      },
      libraries: {
        [controllerId]: [{}, {}, {}],
        [opp1]: [{}, {}],
        [opp2]: [{}, {}, {}, {}, {}],
      },

      // Commander-ish
      commanderZone: {},

      // Misc
      monarch: controllerId,
    },
  };
}

function buildProbeSource(controllerId: string): any {
  return {
    id: 'SRC',
    controller: controllerId,
    card: {
      chosenColor: 'red',
      manaColorsSpent: ['red', 'red'],
      castFromForetell: true,
      castDuringOwnMainPhase: true,
      manaValue: 3,
      type_line: 'Creature — Human Knight',
    },
  };
}

async function main(): Promise<void> {
  const atomicCardsPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(process.cwd(), '..', 'AtomicCards.json');

  if (!fs.existsSync(atomicCardsPath)) {
    console.error(`AtomicCards.json not found at: ${atomicCardsPath}`);
    process.exit(1);
  }

  const outDir = path.resolve(process.cwd(), 'scripts', 'out');
  fs.mkdirSync(outDir, { recursive: true });

  const probeCtx = buildProbeContext();
  const controllerId = 'P1';
  const probeSource = buildProbeSource(controllerId);

  const byClause = new Map<
    string,
    {
      clause: string;
      count: number;
      exampleCards: Set<string>;
    }
  >();

  let cardNameCount = 0;
  let printingsCount = 0;

  const pipeline = chain([
    fs.createReadStream(atomicCardsPath, { encoding: 'utf8' }),
    parser(),
    // AtomicCards.json is shaped like { meta: {...}, data: { <cardName>: [printings] } }
    pick({ filter: 'data' }),
    streamObject(),
  ]);

  for await (const chunk of pipeline as any) {
    const key = String(chunk?.key || '');
    const value = chunk?.value;
    if (!key || !Array.isArray(value)) continue;

    cardNameCount++;

    for (const printing of value) {
      if (!printing || typeof printing !== 'object') continue;
      printingsCount++;

      const text = (printing as any).text;
      if (typeof text !== 'string' || !text.trim()) continue;

      const chunks = splitOracleTextIntoTriggerLikeChunks(text);
      for (const abilityText of chunks) {
        const clause = extractInterveningIfClause(abilityText);
        if (!clause) continue;

        const clauseLower = normalizeClauseKey(clause);
        if (!clauseLower.startsWith('if ')) continue;

        const existing = byClause.get(clauseLower);
        if (existing) {
          existing.count++;
          if (existing.exampleCards.size < 10) existing.exampleCards.add(key);
        } else {
          byClause.set(clauseLower, { clause, count: 1, exampleCards: new Set([key]) });
        }
      }
    }
  }

  const clauses: ClauseStats[] = [];
  for (const [clauseLower, data] of byClause.entries()) {
    const detailed = evaluateInterveningIfClauseDetailed(probeCtx, controllerId, data.clause, probeSource);

    clauses.push({
      clause: data.clause,
      clauseLower,
      count: data.count,
      exampleCards: Array.from(data.exampleCards),
      evaluation: detailed.matched ? 'recognized' : 'unknown',
      sampleResult: detailed.matched && detailed.value !== null ? detailed.value : undefined,
    });
  }

  clauses.sort((a, b) => b.count - a.count || a.clauseLower.localeCompare(b.clauseLower));

  const unknown = clauses.filter((c) => c.evaluation === 'unknown');
  const recognized = clauses.filter((c) => c.evaluation === 'recognized');

  const report = {
    meta: {
      atomicCardsPath,
      generatedAt: new Date().toISOString(),
      cardNameCount,
      printingsCount,
      totalInterveningIfClausesFound: clauses.length,
      recognizedCount: recognized.length,
      unknownCount: unknown.length,
    },
    recognized,
    unknown,
    topRecognized: recognized.slice(0, 200),
    topUnknown: unknown.slice(0, 400),
  };

  const outJson = path.resolve(outDir, 'intervening-if-audit.json');
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Scanned card names: ${cardNameCount}`);
  console.log(`Scanned printings: ${printingsCount}`);
  console.log(`Unique intervening-if clauses: ${clauses.length}`);
  console.log(`Recognized by evaluator (probe): ${recognized.length}`);
  console.log(`Unknown (probe): ${unknown.length}`);
  console.log(`Wrote report: ${outJson}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
