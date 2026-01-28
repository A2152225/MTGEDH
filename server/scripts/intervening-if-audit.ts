import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
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
      turnNumber: 2,

      // Starting player (for "if you weren't the starting player")
      startingPlayerId: opp1,

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
      landsPlayedThisTurn: { [controllerId]: 2, [opp1]: 0, [opp2]: 0 },
      landsEnteredBattlefieldThisTurn: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },
      nonlandPermanentsEnteredBattlefieldThisTurn: { [controllerId]: 2, [opp1]: 0, [opp2]: 0 },
      artifactsEnteredBattlefieldThisTurnByController: { [controllerId]: 0, [opp1]: 0, [opp2]: 0 },
      planeswalkersEnteredBattlefieldThisTurnByController: { [controllerId]: 0, [opp1]: 0, [opp2]: 0 },
      creaturesEnteredBattlefieldThisTurnByController: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },
      creaturesEnteredBattlefieldThisTurnByControllerSubtype: { [controllerId]: { wizard: 1 }, [opp1]: {}, [opp2]: {} },
      creaturesEnteredBattlefieldThisTurnIdsByController: { [controllerId]: ['SRC'], [opp1]: [], [opp2]: [] },
      faceDownCreaturesEnteredBattlefieldThisTurnByController: { [controllerId]: 0, [opp1]: 0, [opp2]: 0 },

      // Death trackers
      creaturesDiedThisTurnByController: { [controllerId]: 0, [opp1]: 1, [opp2]: 0 },
      creaturesDiedThisTurnByControllerSubtype: { [controllerId]: { human: 1, phyrexian: 1 }, [opp1]: {}, [opp2]: {} },

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
        { id: 'spell1', casterId: controllerId, card: { type_line: 'Instant', manaValue: 3 } },
        { id: 'spell2', casterId: controllerId, card: { type_line: 'Creature — Elf', manaValue: 2 } },
        { id: 'spell3', casterId: controllerId, card: { type_line: 'Sorcery', manaValue: 4 } },
      ],
      spellsCastFromHandThisTurn: { [controllerId]: 0, [opp1]: 0, [opp2]: 0 },
      playedCardFromExileThisTurn: { [controllerId]: false, [opp1]: false, [opp2]: false },
      castFromExileThisTurn: { [controllerId]: false, [opp1]: false, [opp2]: false },

      // Cycling / crime
      cardsCycledThisTurn: { [controllerId]: 2, [opp1]: 0, [opp2]: 0 },
      committedCrimeThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },

      // Token/sacrifice
      tokensCreatedThisTurn: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },
      permanentsSacrificedThisTurn: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },
      foodsSacrificedThisTurn: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },

      // Die rolls (for "if you roll/rolled a 6")
      dieRollsThisTurn: {
        [controllerId]: [{ sides: 20, result: 6 }],
        [opp1]: [],
        [opp2]: [],
      },

      // Dungeon completion (AFR)
      completedDungeonThisTurn: { [controllerId]: false, [opp1]: false, [opp2]: false },
      completedDungeon: { [controllerId]: true, [opp1]: false, [opp2]: false },
      completedDungeons: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },
      completedDungeonNames: { [controllerId]: ['Lost Mine of Phandelver'], [opp1]: [], [opp2]: [] },

      // Last-turn trackers
      lifeLostLastTurnByPlayerCounts: { [controllerId]: 0, [opp1]: 1, [opp2]: 0 },
      cardsDrawnLastTurnByPlayerCounts: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },
      landsEnteredBattlefieldLastTurnByPlayerCounts: { [controllerId]: 0, [opp1]: 1, [opp2]: 0 },
      creaturesEnteredBattlefieldLastTurnByController: { [controllerId]: 2, [opp1]: 0, [opp2]: 0 },
      attackedYouLastTurnByPlayer: { [opp1]: true, [opp2]: false },
      tappedNonlandPermanentLastTurnByPlayer: { [opp1]: false, [opp2]: true },
      opponentCastSpellSinceYourLastTurnEnded: { [opp1]: false, [opp2]: false },

      // Counter placement trackers
      putCounterOnCreatureThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },
      putPlusOneCounterOnPermanentThisTurn: { [controllerId]: true, [opp1]: false, [opp2]: false },

      // Per-permanent counter placement tracking (for "first time ... this turn" templates)
      countersPutThisTurnByPermanentId: { C2: 1 },
      plusOneCountersPutThisTurnByPermanentId: { C2: 1 },

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
          owner: controllerId,
          attackedThisTurn: true,
          attacking: true,
          defendingPlayerId: opp1,
          damageThisTurn: 0,
          basePower: '3',
          power: '4',
          baseToughness: '3',
          toughness: '3',
          card: { id: 'CMD1', name: 'Probe Source', type_line: 'Creature — Human Knight', manaValue: 3, power: '3', toughness: '3', mana_cost: '{W}{B}{W/B}' },
          counters: { '+1/+1': 1, '-1/-1': 1, quest: 2, soul: 2 },
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
          card: { type_line: 'Artifact — Equipment', manaValue: 1 },
        },
        {
          id: 'C2',
          controller: controllerId,
          owner: controllerId,
          wasDealtExcessDamageThisTurn: true,
          enteredFromZone: 'graveyard',
          tapped: false,
          dealtCombatDamageToCreatureThisTurn: false,
          card: {
            name: 'Other Creature',
            type_line: 'Creature — Wizard',
            manaValue: 2,
            power: '4',
            toughness: '4',
            colors: ['R'],
            oracle_text: 'Flying\nToxic 1',
          },
          counters: {},
        },
        {
          id: 'C3',
          controller: controllerId,
          card: { name: 'Green Creature', type_line: 'Creature — Elf', manaValue: 2, power: '1', toughness: '1', colors: ['G'] },
          counters: {},
        },
        {
          id: 'ART_MAX',
          controller: controllerId,
          owner: controllerId,
          counters: {},
          card: { name: 'Big Artifact', type_line: 'Artifact', manaValue: 7, colors: [] },
        },
        {
          id: 'ART_SMALL',
          controller: opp1,
          owner: opp1,
          counters: {},
          card: { name: 'Small Artifact', type_line: 'Artifact', manaValue: 3, colors: [] },
        },
        {
          id: 'P2_NONBLACK',
          controller: opp1,
          owner: opp1,
          counters: {},
          card: { name: 'Nonblack Permanent', type_line: 'Creature — Soldier', manaValue: 2, power: '1', toughness: '1', colors: ['W'] },
        },
        {
          id: 'ASSASSIN_ATK',
          controller: controllerId,
          owner: controllerId,
          attackingTargetId: opp1,
          counters: {},
          card: { name: 'Assassin Attacker', type_line: 'Creature — Assassin', manaValue: 3, power: '2', toughness: '2', colors: ['B'] },
        },
        {
          id: 'WARR1',
          controller: controllerId,
          owner: controllerId,
          counters: {},
          card: { name: 'Warrior Source', type_line: 'Creature — Warrior', manaValue: 2, power: '2', toughness: '2', colors: ['R'] },
        },
        {
          id: 'WALL1',
          controller: controllerId,
          owner: controllerId,
          counters: {},
          card: { name: 'Wall One', type_line: 'Creature — Wall', manaValue: 1, power: '0', toughness: '4', colors: [] },
        },
        {
          id: 'WALL2',
          controller: controllerId,
          owner: controllerId,
          counters: {},
          card: { name: 'Wall Two', type_line: 'Creature — Wall', manaValue: 1, power: '0', toughness: '4', colors: [] },
        },
        {
          id: 'C4',
          controller: controllerId,
          card: { name: 'White Creature', type_line: 'Creature — Human', manaValue: 2, power: '1', toughness: '1', colors: ['W'] },
          counters: {},
        },
        {
          id: 'C5',
          controller: controllerId,
          card: { name: 'Blue Creature', type_line: 'Creature — Merfolk', manaValue: 2, power: '1', toughness: '1', colors: ['U'] },
          counters: {},
        },
        {
          id: 'C6',
          controller: controllerId,
          card: { name: 'Black Creature', type_line: 'Creature — Zombie', manaValue: 2, power: '1', toughness: '1', colors: ['B'] },
          counters: {},
        },
        {
          id: 'RASP1',
          controller: controllerId,
          startedTurnUntapped: true,
          tapped: false,
          counters: {},
          card: { name: 'Rasputin Dreamweaver', type_line: 'Legendary Creature — Human Wizard', manaValue: 6, power: '4', toughness: '1', colors: ['W', 'U'] },
        },
        {
          id: 'GE1',
          controller: controllerId,
          counters: { oil: 1 },
          card: { name: 'Glistening Extractor', type_line: 'Artifact Creature — Phyrexian', manaValue: 2, power: '1', toughness: '2', colors: [] },
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
          wasDealtExcessDamageThisTurn: false,
          counters: {},
          card: { type_line: 'Creature — Human', colors: ['B'], set: 'wot', power: '1', toughness: '1' },
        },
        {
          id: 'ATK1',
          controller: opp1,
          attacking: controllerId,
          enteredFromZone: 'exile',
          counters: {},
          card: { type_line: 'Creature — Goblin', power: '2', toughness: '2' },
        },
        {
          id: 'ATK2',
          controller: opp2,
          attacking: controllerId,
          enteredFromZone: 'graveyard',
          counters: {},
          card: { type_line: 'Creature — Zombie', power: '2', toughness: '2' },
        },

        // ED-E with quest counters
        {
          id: 'EDE',
          controller: controllerId,
          owner: controllerId,
          card: { name: 'ED-E', type_line: 'Artifact Creature — Robot', manaValue: 2, power: '1', toughness: '3' },
          counters: { quest: 2 },
        },

        // Pangram permanent name to satisfy the alphabet clause
        {
          id: 'ALPHA',
          controller: controllerId,
          owner: controllerId,
          card: { name: 'Sphinx of black quartz, judge my vow', type_line: 'Artifact', manaValue: 5 },
          counters: {},
        },

        // Devotion helpers
        {
          id: 'DEV1',
          controller: controllerId,
          owner: controllerId,
          card: { name: 'Devotion Helper W', type_line: 'Enchantment', mana_cost: '{W}{W}{W}' },
          counters: {},
        },
        {
          id: 'DEV2',
          controller: controllerId,
          owner: controllerId,
          card: { name: 'Devotion Helper B', type_line: 'Enchantment', mana_cost: '{B}{B}{B}' },
          counters: {},
        },

        // Sarulf + counters
        {
          id: 'SARULF',
          controller: controllerId,
          owner: controllerId,
          card: { name: 'Sarulf, Realm Eater', type_line: 'Legendary Creature — Wolf', power: '3', toughness: '3' },
          counters: { '+1/+1': 1 },
        },

        // Titania for the graveyard+own/control clause
        {
          id: 'TITANIA',
          controller: controllerId,
          owner: controllerId,
          card: { name: 'Titania, Protector of Argoth', type_line: 'Legendary Creature — Elemental', power: '5', toughness: '3' },
          counters: {},
        },

        // Drizzt and an "it" creature for power comparison
        {
          id: 'DRIZZT',
          controller: controllerId,
          owner: controllerId,
          card: { name: "Drizzt Do'Urden", type_line: 'Legendary Creature — Elf Ranger', power: '3', toughness: '3' },
          counters: {},
        },
        {
          id: 'ITCRE',
          controller: controllerId,
          owner: controllerId,
          basePower: '4',
          power: '5',
          toughness: '0',
          card: { name: 'It Creature', type_line: 'Creature — Beast', power: '4', toughness: '1' },
          counters: {},
        },

        // Own/control pair checks
        {
          id: 'GISELA',
          controller: controllerId,
          owner: controllerId,
          card: { name: 'Gisela, the Broken Blade', type_line: 'Legendary Creature — Angel', power: '4', toughness: '3' },
          counters: {},
        },
        {
          id: 'BRUNA',
          controller: controllerId,
          owner: controllerId,
          card: { name: 'Bruna, the Fading Light', type_line: 'Legendary Creature — Angel', power: '5', toughness: '7' },
          counters: {},
        },
        {
          id: 'MIDNIGHT',
          controller: controllerId,
          owner: controllerId,
          card: { name: 'Midnight Scavengers', type_line: 'Creature — Human Rogue', power: '3', toughness: '3' },
          counters: {},
        },
        {
          id: 'VANILLE',
          controller: controllerId,
          owner: controllerId,
          card: { name: 'Vanille', type_line: 'Creature — Human', power: '2', toughness: '2' },
          counters: {},
        },
        {
          id: 'FANG',
          controller: controllerId,
          owner: controllerId,
          card: { name: 'Fang', type_line: 'Creature — Wolf', power: '2', toughness: '2' },
          counters: {},
        },

        // Opponent permanents with aim counters (P2/P3)
        {
          id: 'AIM1',
          controller: opp1,
          owner: opp1,
          card: { name: 'Aim Counter Perm 1', type_line: 'Artifact', manaValue: 4 },
          counters: { aim: 1 },
        },
        {
          id: 'AIM2',
          controller: opp2,
          owner: opp2,
          card: { name: 'Aim Counter Perm 2', type_line: 'Enchantment' },
          counters: { aim: 1 },
        },

        // P2 basic lands + contested counter land
        {
          id: 'P2_PLAINS',
          controller: opp1,
          owner: opp1,
          card: { name: 'Plains', type_line: 'Basic Land — Plains' },
          counters: {},
        },
        {
          id: 'P2_ISLAND',
          controller: opp1,
          owner: opp1,
          card: { name: 'Island', type_line: 'Basic Land — Island' },
          counters: {},
        },
        {
          id: 'P2_SWAMP',
          controller: opp1,
          owner: opp1,
          card: { name: 'Swamp', type_line: 'Basic Land — Swamp' },
          counters: {},
        },
        {
          id: 'P2_MOUNTAIN',
          controller: opp1,
          owner: opp1,
          card: { name: 'Mountain', type_line: 'Basic Land — Mountain' },
          counters: {},
        },
        {
          id: 'P2_CONTESTED',
          controller: opp1,
          owner: opp1,
          card: { name: 'Contested Land', type_line: 'Land' },
          counters: { contested: 1 },
        },
      ],

      // Stack (for single-target + mana-spent templates)
      stack: [
        {
          id: 'spell1',
          controller: controllerId,
          isManaAbility: false,
          targets: ['C2'],
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
            mana_cost: '{X}{G}',
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
          graveyard: [
            { name: 'Land 1', type_line: 'Land', manaValue: 0 },
            { name: 'Land 2', type_line: 'Basic Land — Forest', manaValue: 0 },
            { name: 'Land 3', type_line: 'Basic Land — Island', manaValue: 0 },
            { name: 'Land 4', type_line: 'Basic Land — Plains', manaValue: 0 },
            { name: 'Gy1', type_line: 'Instant', manaValue: 1 },
            { name: 'Gy2', type_line: 'Sorcery', manaValue: 2 },
            { name: 'Gy3', type_line: 'Creature — Elf', manaValue: 3 },
            { name: 'Gy4', type_line: 'Artifact', manaValue: 4 },
            { name: 'Gy5', type_line: 'Enchantment', manaValue: 5 },
          ],
          graveyardCount: 9,
          library: [{ name: 'Ring Out', type_line: 'Instant' }, { name: 'Plains', type_line: 'Basic Land — Plains' }, { name: 'Forest', type_line: 'Basic Land — Forest' }],
          libraryCount: 3,
          exile: [
            { id: 'THAT_CARD', name: 'That Card', type_line: 'Creature — Elf', exiledWithSourceId: 'SRC' },
            { name: 'Hex', type_line: 'Legendary Creature — Beast', counters: { fetch: 1 } },
            { name: 'Probe Spell', type_line: 'Instant', exiledWithSourceId: 'SRC' },
          ],
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

      // Starting-library metadata (best-effort)
      minimumLibrarySize: 60,
      startingLibraryCountByPlayer: { [controllerId]: 80, [opp1]: 60, [opp2]: 60 },

      // Monarch at turn begin
      monarchAtTurnBeginByPlayer: { [controllerId]: true, [opp1]: false, [opp2]: false },

      // Energy
      energyCounters: { [controllerId]: 1, [opp1]: 0, [opp2]: 0 },

      // Token counters
      tokenCounters: { [controllerId]: 4, [opp1]: 0, [opp2]: 0 },

      // Combat damage since last turn
      combatDamageDealtToPlayerSinceLastTurn: { [controllerId]: false, [opp1]: false, [opp2]: false },

      // Planeswalk history
      planeswalkedToThisTurn: { [controllerId]: ['Unyaro'], [opp1]: [], [opp2]: [] },

      // Players lost
      playersLostCount: 2,
    },
  };
}

function buildProbeSource(controllerId: string): any {
  return {
    id: 'SRC',
    controller: controllerId,
    owner: controllerId,
    zone: 'battlefield',
    thatCardId: 'THAT_CARD',
    // Exiled-cards bookkeeping (used by several "cards exiled with this artifact" templates)
    exiledCards: [{ id: 'EX1' }, { id: 'EX2' }, { id: 'EX3' }, { id: 'EX4' }],
    thatPlayerId: 'P2',
    referencedPlayerId: 'P2',
    theirPlayerId: 'P2',
    defendingPlayerId: 'P2',
    thoseCreatureIds: ['C2', 'ATK1', 'ATK2'],
    thatCreatureId: 'C2',
    chosenNumber: 4,
    chosenName: 'Other Creature',
    ringBearerName: 'Other Creature',
    activatedAbilityIsManaAbility: false,
    triggeringStackItemId: 'spell1',
    attachedTo: 'C2',
    // Attachment id lists used by attachment-based evaluators.
    attachments: ['aura1', 'aura2'],
    attachedEquipment: ['eq1'],
    counters: { test: 1, quest: 2, soul: 2, '-1/-1': 1 },
    xValue: 1,
    damageThisTurn: 0,
    wasUnearthed: false,
    giftPromised: false,
    monstrous: false,
    suspected: false,
    regeneratedThisTurn: false,
    enteredThisTurn: false,
    enteredBattlefieldThisTurn: false,
    cameUnderYourControlThisTurn: false,
    gainedControlThisTurn: false,
    attackedThisTurn: true,
    attackedThisCombat: true,
    attacking: true,
    blockedThisTurn: false,
    itDied: false,
    died: false,
    wasSacrificed: false,
    lifePaidToActivateIt: true,
    wasCastThem: true,
    permanentsSacrificedToActivateItCount: 1,
    abilityResolvedCountBeforeThis: 0,
    playerHasPlayedTheCard: false,
    resultStoredOnThisCreature: false,
    castUsingWebSlinging: true,
    scatteredDragonstormGlobes: false,
    revealedDragonCardAsCast: true,
    controlledDragonAsCast: false,
    guessedCorrectlyForCardName: { 'spire phantasm': true },
    thatPlayersProgramCardCount: 4,
    itCreatureId: 'ITCRE',
    // Remaining recognized-null templates (best-effort flags)
    wouldDrawCard: true,
    wouldDealDamage: true,
    wouldDealDamageToThatPlayerOrTheirPermanent: true,
    planarDieWouldPlaneswalk: true,
    spellCouldTargetNonlandPermanentControlledByAnotherOpponent: true,
    damageIncludedWarriorSource: true,
    damageSourceCreatureIds: ['WARR1'],
    creatureDamagedByThisCreatureDiedThisTurn: true,
    uncrossedDigits: [4, 7],
    itsManaValue: 4,
    representedByFood: true,
    noOpponentCastSpellSinceYourLastTurnEnded: true,
    noneOfThemWereCast: true,
    manaWasSpentToCastThem: false,
    thatCreatureHadToAttackThisCombat: true,
    thatCreatureDestroyedThisWay: true,
    thatPlayerAttackedYouLastTurn: true,
    thatPlayerTappedNonlandPermanentLastTurn: false,
    thatPlayerHasAnotherOpponentNotBeingAttacked: true,
    theyArentAttackingYou: true,
    theyAttackedYouOrYourPlaneswalker: true,
    theyWereAttackedThisTurnByAssassinYouControlled: true,
    necessary: true,
    youHaveOne: true,
    haveDrinkStache: true,
    onePlayerHasWonMoreMagicGamesThatDay: true,
    lifeTotalIsOnLazyCaterersSequence: true,
    sheWasANonlandCreature: true,
    itSharesKeywordOrAbilityWordWithYourPermanentOrGraveyardCard: false,
    aGiant: true,
    blockingCreatureIds: ['WALL1', 'WALL2'],
    hasActiveTournament: false,
    hasTimerRunning: false,
    hasBoon: true,
    isEating: true,
    hadSubgamesThisMatch: false,
    addedManaWithThisAbilityThisTurn: false,
    damageDealtToThatPlayerThisTurn: 10,
    wasPutOntoBattlefieldWithThisAbility: false,
    enlistedCreatureThisCombat: true,
    crewedByCreatureCountThisTurn: 2,
    crewedByCreatureTypesThisTurn: ['Assassin'],
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
      name: 'Probe Source',
      chosenColor: 'red',
      colors: ['red'],
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
      toughness: '2',
      manaFromCreaturesSpent: 3,
      convokeTappedCreatures: ['C2', 'ATK1', 'ATK2'],
    },
  };
}

function buildProbeSourceEnchantmentNonCreature(controllerId: string): any {
  const src = buildProbeSource(controllerId);
  return {
    ...src,
    id: 'SRC_ENCH',
    card: {
      ...src.card,
      name: 'Probe Enchantment',
      type_line: 'Enchantment',
      power: undefined,
      toughness: undefined,
    },
  };
}

function pickProbeSourceForClause(clause: string, creatureSrc: any, enchantmentSrc: any): any {
  const c = String(clause || '').toLowerCase();
  if (c.includes('this enchantment')) return enchantmentSrc;
  return creatureSrc;
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
  const probeSourceCreature = buildProbeSource(controllerId);
  const probeSourceEnchantment = buildProbeSourceEnchantmentNonCreature(controllerId);

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
    const src = pickProbeSourceForClause(data.clause, probeSourceCreature, probeSourceEnchantment);
    const detailed = evaluateInterveningIfClauseDetailed(probeCtx, controllerId, data.clause, src, src);

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
