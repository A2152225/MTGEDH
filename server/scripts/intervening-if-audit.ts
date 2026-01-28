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
  evaluation: 'recognized' | 'fallback' | 'unknown';
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

      // Turn/phase
      activePlayer: controllerId,
      phase: 'main1',
      turnDirection: 1,

      // Common booleans
      // Some best-effort templates return `null` when this is true because attribution isn't tracked.
      // Use `false` to keep those cases decidable under probe.
      creatureDiedThisTurn: false,
      permanentLeftBattlefieldThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },

      // Common numeric trackers
      life: { [controllerId]: 40, [opp1]: 40, [opp2]: 39 },
      poisonCounters: { [controllerId]: 0, [opp1]: 0, [opp2]: 1 },
      cardsDrawnThisTurn: { [controllerId]: 2, [opp1]: 1, [opp2]: 0 },
      lifeGainedThisTurn: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },
      lifeLostThisTurn: { [controllerId]: 0, [opp1]: 1, [opp2]: 0 },
      landsEnteredBattlefieldThisTurn: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },
      nonlandPermanentsEnteredBattlefieldThisTurn: { [controllerId]: 2, [opp1]: 0, [opp2]: 0 },
      artifactsEnteredBattlefieldThisTurnByController: { [controllerId]: 0, [opp1]: 0, [opp2]: 0 },
      planeswalkersEnteredBattlefieldThisTurnByController: { [controllerId]: 0, [opp1]: 0, [opp2]: 0 },
      creaturesEnteredBattlefieldThisTurnByController: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },
      creaturesEnteredBattlefieldThisTurnByControllerSubtype: { [controllerId]: { wizard: 1 }, [opp1]: {}, [opp2]: {} },
      creaturesEnteredBattlefieldThisTurnIdsByController: { [controllerId]: ['SRC'], [opp1]: [], [opp2]: [] },
      faceDownCreaturesEnteredBattlefieldThisTurnByController: { [controllerId]: 0, [opp1]: 0, [opp2]: 0 },

      // Turn / phase-ish knobs (best effort)
      dayNight: 'day',
      isDay: true,
      isNight: false,

      // Dungeons / initiative / blessing
      initiative: controllerId,
      cityBlessing: { [controllerId]: true, [opp1]: false, [opp2]: false },

      // "Descended" (LCI) per-turn flag
      descendedThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },

      // Spell casting trackers
      spellsCastThisTurn: [
        { id: 'spell1', casterId: controllerId, card: { type_line: 'Instant' } },
        { id: 'spell2', casterId: controllerId, card: { type_line: 'Creature — Elf' } },
      ],
      playedCardFromExileThisTurn: { [controllerId]: false, [opp1]: false, [opp2]: false },
      castFromExileThisTurn: { [controllerId]: false, [opp1]: false, [opp2]: false },

      // Dungeon completion (AFR)
      completedDungeonThisTurn: { [controllerId]: false, [opp1]: false, [opp2]: false },
      completedDungeon: { [controllerId]: true, [opp1]: false, [opp2]: false },
      completedDungeons: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },
      completedDungeonNames: { [controllerId]: ['Lost Mine of Phandelver'], [opp1]: [], [opp2]: [] },

      // Last-turn trackers
      lifeLostLastTurnByPlayerCounts: { [controllerId]: 0, [opp1]: 1, [opp2]: 0 },
      cardsDrawnLastTurnByPlayerCounts: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },

      // Counter placement trackers
      putCounterOnCreatureThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },
      putPlusOneCounterOnPermanentThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },

      // Graveyard movement trackers
      cardLeftGraveyardThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },
      creatureCardLeftGraveyardThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },
      cardLeftYourGraveyardThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },
      creatureCardLeftYourGraveyardThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },
      creatureCardPutIntoYourGraveyardThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },
      cardsPutIntoYourGraveyardThisTurn: { [controllerId]: 2, [opp1]: 0, [opp2]: 0 },
      cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },

      // Battlefield-to-zone typed trackers
      landYouControlledPutIntoGraveyardFromBattlefieldThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },
      permanentPutIntoHandFromBattlefieldThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },
      enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },
      artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn: true,

      // Discard trackers
      anyPlayerDiscardedCardThisTurn: true,
      discardedCardThisTurn: { [controllerId]: false, [opp1]: true, [opp2]: false },

      // Clue sacrifice trackers
      cluesSacrificedThisTurn: { [controllerId]: 3, [opp1]: 0, [opp2]: 0 },

      // Evidence (MKM) trackers
      evidenceCollectedThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },

      // Team assignment (Alchemy)
      team: { [controllerId]: 'mirran', [opp1]: 'phyrexian', [opp2]: 'mirran' },
      // Keep legacy map for convenience, but prefer the newer keys used by the evaluator helpers.
      spellsCastLastTurn: { [controllerId]: 2, [opp1]: 0, [opp2]: 0 },
      spellsCastLastTurnCount: 2,
      spellsCastLastTurnByPlayerCounts: { [controllerId]: 2, [opp1]: 0, [opp2]: 0 },

      // Damage trackers
      creaturesThatDealtDamageToPlayer: {
        [opp1]: { SRC: true },
        [opp2]: { SRC: false },
      },
      damageTakenThisTurnByPlayer: { [controllerId]: 0, [opp1]: 3, [opp2]: 0 },

      // Battlefield
      battlefield: [
        {
          id: 'SRC',
          controller: controllerId,
          attackedThisTurn: true,
          damageThisTurn: 0,
          card: { id: 'CMD1', type_line: 'Creature — Human Knight', manaValue: 3, power: '3', toughness: '3' },
          counters: { '+1/+1': 1 },
          auras: ['aura1'],
          equipment: ['eq1'],
        },
        {
          id: 'aura1',
          controller: controllerId,
          attachedTo: 'SRC',
          card: { type_line: 'Enchantment — Aura' },
        },
        {
          id: 'aura2',
          controller: controllerId,
          attachedTo: 'SRC',
          card: { type_line: 'Enchantment — Aura' },
        },
        {
          id: 'eq1',
          controller: controllerId,
          attachedTo: 'SRC',
          card: { type_line: 'Artifact — Equipment' },
        },
        {
          id: 'C2',
          controller: controllerId,
          enteredFromZone: 'graveyard',
          tapped: false,
          card: {
            type_line: 'Creature — Wizard',
            manaValue: 2,
            power: '4',
            toughness: '4',
            colors: ['R'],
            oracle_text: 'Flying\nToxic 1',
          },
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
          card: { type_line: 'Creature — Human', colors: ['B'], set: 'wot', power: '1', toughness: '1' },
        },
        {
          id: 'ATK1',
          controller: opp1,
          attacking: controllerId,
          card: { type_line: 'Creature — Goblin', power: '2', toughness: '2' },
        },
        {
          id: 'ATK2',
          controller: opp2,
          attacking: controllerId,
          card: { type_line: 'Creature — Zombie', power: '2', toughness: '2' },
        },
      ],

      // Stack (for single-target + mana-spent templates)
      stack: [
        {
          id: 'spell1',
          controller: controllerId,
          isManaAbility: false,
          targets: ['O1'],
          manaSpentTotal: 1,
          // Alternate cost id (newer templates like spectacle/prowl/surge/madness)
          alternateCostId: 'spectacle',
          // Alternate/additional-cost flags (best-effort probe values)
          prowlCostWasPaid: false,
          surgeCostWasPaid: false,
          madnessCostWasPaid: false,
          spectacleCostWasPaid: true,
          additionalCostWasPaid: false,
          card: {
            id: 'SPELL1',
            name: 'Probe Spell',
            type_line: 'Instant',
            manaValue: 3,
            colors: ['G'],
            oracle_text: 'Madness {1}{R}',
            alternateCostId: 'spectacle',
          },

          // Snow-mana spent (so "if {S} of any of that spell's colors was spent" is decidable)
          snowManaSpentByColor: { green: 1 },

          // Mana spent breakdown (so "at least three mana of the same color" can be decidable)
          manaSpentBreakdown: { green: 3 },
        },
      ],

      // Zones (use the structure the evaluator reads)
      zones: {
        [controllerId]: {
          hand: [{ name: 'Card A' }, { name: 'Card B' }],
          handCount: 2,
          graveyard: [{ type_line: 'Creature — Zombie' }],
          graveyardCount: 1,
          library: [{}, {}, {}],
          libraryCount: 3,
          exile: [{ name: 'Exiled Card', type_line: 'Creature — Elf', exiledWithSourceId: 'SRC' }],
        },
        [opp1]: {
          hand: [{ name: 'Card C' }],
          handCount: 1,
          graveyard: [],
          graveyardCount: 0,
          library: [{}, {}],
          libraryCount: 2,
          exile: [],
        },
        [opp2]: {
          hand: [{ name: 'Card D' }, { name: 'Card E' }, { name: 'Card F' }],
          handCount: 3,
          graveyard: [{ type_line: 'Instant' }, { type_line: 'Creature — Elf' }],
          graveyardCount: 2,
          library: [{}, {}, {}, {}, {}],
          libraryCount: 5,
          exile: [],
        },
      },

      // Commander-ish
      commandZone: {
        [controllerId]: {
          commanderIds: ['CMD1', 'CMD_ARAHBO', 'CMD_EDGAR', 'CMD_INALLA', 'CMD_SIDAR'],
          commanderNames: [
            'Oloro, Ageless Ascetic',
            'Arahbo, Roar of the World',
            'Edgar Markov',
            'Inalla, Archmage Ritualist',
            'Sidar Jabari of Zhalfir',
          ],
          commanderCards: [
            { id: 'CMD1', name: 'Oloro, Ageless Ascetic' },
            { id: 'CMD_ARAHBO', name: 'Arahbo, Roar of the World' },
            { id: 'CMD_EDGAR', name: 'Edgar Markov' },
            { id: 'CMD_INALLA', name: 'Inalla, Archmage Ritualist' },
            { id: 'CMD_SIDAR', name: 'Sidar Jabari of Zhalfir' },
          ],
          inCommandZone: ['CMD1'],
          tax: 0,
          taxById: { CMD1: 0 },
        },
        [opp1]: { commanderIds: ['CMD2'], commanderNames: ['Opponent Commander'], commanderCards: [{ id: 'CMD2', name: 'Opponent Commander' }], inCommandZone: ['CMD2'], tax: 0, taxById: { CMD2: 0 } },
        [opp2]: { commanderIds: ['CMD3'], commanderNames: ['Opponent Commander 2'], commanderCards: [{ id: 'CMD3', name: 'Opponent Commander 2' }], inCommandZone: ['CMD3'], tax: 0, taxById: { CMD3: 0 } },
      },

      // Misc
      monarch: controllerId,
    },
  };
}

function buildProbeSource(controllerId: string): any {
  return {
    id: 'SRC',
    controller: controllerId,
    zone: 'battlefield',
    thatPlayerId: 'P2',
    referencedPlayerId: 'P2',
    theirPlayerId: 'P2',
    defendingPlayerId: 'P2',
    thoseCreatureIds: ['C2', 'ATK1', 'ATK2'],
    activatedAbilityIsManaAbility: false,
    triggeringStackItemId: 'spell1',
    attachedTo: 'C2',
    // Attachment id lists used by attachment-based evaluators.
    attachments: ['aura1', 'aura2'],
    attachedEquipment: ['eq1'],
    counters: {},
    damageThisTurn: 0,
    wasUnearthed: false,
    giftPromised: false,
    attackedThisTurn: true,
    enteredFromCast: true,
    wasCast: true,
    castFromHand: true,
    castSourceZone: 'hand',
    tributePaid: false,
    manaFromTreasureSpent: true,
    // Convoke-style templates: "mana from creatures was spent to cast it"
    manaFromCreaturesSpent: 3,
    convokeTappedCreatures: ['C2', 'ATK1', 'ATK2'],
    card: {
      id: 'CMD1',
      chosenColor: 'red',
      manaColorsSpent: ['red', 'red'],
      manaSpentBreakdown: { red: 4, blue: 0, black: 0, green: 0, white: 0, colorless: 0 },
      castFromForetell: true,
      castDuringOwnMainPhase: true,
      wasKicked: true,
      kickerPaidCount: 2,
      wasBargained: true,
      isSuspended: true,
      manaValue: 3,
      type_line: 'Creature — Human Knight',
      power: '2',
      manaFromCreaturesSpent: 3,
      convokeTappedCreatures: ['C2', 'ATK1', 'ATK2'],
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
    const detailed = evaluateInterveningIfClauseDetailed(probeCtx, controllerId, data.clause, probeSource, probeSource);

    const evaluation: ClauseStats['evaluation'] = detailed.matched
      ? detailed.fallback
        ? 'fallback'
        : 'recognized'
      : 'unknown';

    clauses.push({
      clause: data.clause,
      clauseLower,
      count: data.count,
      exampleCards: Array.from(data.exampleCards),
      evaluation,
      sampleResult: detailed.matched && detailed.value !== null ? detailed.value : undefined,
    });
  }

  clauses.sort((a, b) => b.count - a.count || a.clauseLower.localeCompare(b.clauseLower));

  const unknown = clauses.filter((c) => c.evaluation === 'unknown');
  const fallback = clauses.filter((c) => c.evaluation === 'fallback');
  const recognized = clauses.filter((c) => c.evaluation === 'recognized');

  const recognizedDecidable = recognized.filter((c) => typeof c.sampleResult === 'boolean');
  const recognizedNull = recognized.filter((c) => typeof c.sampleResult !== 'boolean');

  const report = {
    meta: {
      atomicCardsPath,
      generatedAt: new Date().toISOString(),
      cardNameCount,
      printingsCount,
      totalInterveningIfClausesFound: clauses.length,
      recognizedCount: recognized.length,
      recognizedDecidableCount: recognizedDecidable.length,
      recognizedNullCount: recognizedNull.length,
      fallbackCount: fallback.length,
      unknownCount: unknown.length,
    },
    recognized,
    fallback,
    unknown,
    topRecognized: recognized.slice(0, 200),
    topRecognizedDecidable: recognizedDecidable.slice(0, 200),
    topRecognizedNull: recognizedNull.slice(0, 200),
    topFallback: fallback.slice(0, 200),
    topUnknown: unknown.slice(0, 400),
  };

  const outJson = path.resolve(outDir, 'intervening-if-audit.json');
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Scanned card names: ${cardNameCount}`);
  console.log(`Scanned printings: ${printingsCount}`);
  console.log(`Unique intervening-if clauses: ${clauses.length}`);
  console.log(`Recognized by evaluator (probe): ${recognized.length}`);
  console.log(`Matched by fallback (probe): ${fallback.length}`);
  console.log(`Unknown (probe): ${unknown.length}`);
  console.log(`Wrote report: ${outJson}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
