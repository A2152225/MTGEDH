/*
  Oracle IR Executor Coverage Audit

  Dry-runs Oracle IR execution against parsed triggered-ability effect text (and
  optionally full-card oracle IR) using a rich synthetic game fixture with
  pre-bound targets. Surfaces the gap between "parses cleanly" and "executes
  without skips" that the trigger-coverage audit does not measure.

  Run:
    npm run executor:coverage --workspace=server

  Optional env:
    EXECUTOR_COVERAGE_SCOPE=trigger_effects|full_card|both   (default: trigger_effects)
    EXECUTOR_COVERAGE_COMMANDER_ONLY=1|0                     (default: 1)
    EXECUTOR_COVERAGE_TOP=100
    EXECUTOR_COVERAGE_MAX_EXAMPLES=8
    EXECUTOR_COVERAGE_ONLY_GAPS=1
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GameState, PlayerID } from '../../shared/src/index.js';
import type { OracleEffectStep } from '../../rules-engine/src/oracleIR.js';
import type { OracleIRExecutionResult } from '../../rules-engine/src/oracleIRExecutionTypes.js';
import {
  applyOracleIRStepsToGameState,
  buildOracleIRExecutionContext,
} from '../../rules-engine/src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import type { TriggeredAbility } from '../../rules-engine/src/triggeredAbilitiesTypes.js';
import {
  getCombinedOracleText,
  hasUnknownIRSteps,
  isCommanderLegalCard,
  isEligible,
  isIgnorableCardForIrGap,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outDir = path.join(__dirname, 'out');
const outPath = path.join(outDir, 'executor-coverage-audit.json');

type OracleCard = {
  oracle_id?: string;
  id?: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
  games?: string[];
  digital?: boolean;
  oversized?: boolean;
  set_type?: string;
  border_color?: string;
  set?: string;
  legalities?: Record<string, string>;
};

export type ExecutorCoverageStatus =
  | 'fully_applied'
  | 'choice_required'
  | 'unsupported'
  | 'partial'
  | 'ir_gap'
  | 'no_steps'
  | 'impossible';

type Scope = 'trigger_effects' | 'full_card' | 'both';

type AuditArgs = {
  scope: Scope;
  commanderOnly: boolean;
  top: number;
  maxExamples: number;
  onlyGaps: boolean;
};

type StepCount = {
  total: number;
  unknown: number;
  recognized: number;
};

type ExecutionRecord = {
  status: ExecutorCoverageStatus;
  applied: number;
  skipped: number;
  choiceRequired: number;
  unsupported: number;
  impossible: number;
  reasonCodes: Record<string, number>;
  stepKinds: Record<string, number>;
};

type PatternRecord = {
  templateKey: string;
  event: string;
  count: number;
  statuses: ExecutorCoverageStatus[];
  exampleCards: string[];
  sampleEffect: string;
  topReasonCodes: string[];
  topSkippedKinds: string[];
};

type AuditStats = {
  cardsScanned: number;
  itemsScanned: number;
  byStatus: Record<ExecutorCoverageStatus, number>;
  byScope: Record<'trigger_effects' | 'full_card', number>;
  parseToExecuteGap: number;
};

function parseArgs(): AuditArgs {
  const scopeRaw = String(process.env.EXECUTOR_COVERAGE_SCOPE || 'trigger_effects').trim().toLowerCase();
  const scope: Scope =
    scopeRaw === 'full_card' || scopeRaw === 'both' ? scopeRaw : 'trigger_effects';

  return {
    scope,
    commanderOnly: String(process.env.EXECUTOR_COVERAGE_COMMANDER_ONLY ?? '1') !== '0',
    top: Math.max(1, Number(process.env.EXECUTOR_COVERAGE_TOP || 100) || 100),
    maxExamples: Math.max(1, Number(process.env.EXECUTOR_COVERAGE_MAX_EXAMPLES || 8) || 8),
    onlyGaps: String(process.env.EXECUTOR_COVERAGE_ONLY_GAPS || '') === '1',
  };
}

function effectTextForIrAudit(effectText: string): string {
  const raw = String(effectText || '').trim();
  const stripped = raw
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\s+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 4 ? stripped : raw;
}

function normalizeText(text: string): string {
  return String(text || '')
    .replace(/[’]/g, "'")
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function walkOracleSteps(
  steps: readonly OracleEffectStep[] | undefined,
  visit: (step: OracleEffectStep) => void
): void {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    visit(step);
    const record = step as Record<string, unknown>;
    if (Array.isArray(record.steps)) walkOracleSteps(record.steps as OracleEffectStep[], visit);
    if (Array.isArray(record.modes)) {
      for (const mode of record.modes as Array<{ steps?: readonly OracleEffectStep[] }>) {
        walkOracleSteps(mode?.steps, visit);
      }
    }
  }
}

export function countOracleSteps(steps: readonly OracleEffectStep[] | undefined): StepCount {
  let total = 0;
  let unknown = 0;
  walkOracleSteps(steps, (step) => {
    total += 1;
    if (String(step.kind || '') === 'unknown') unknown += 1;
  });
  return { total, unknown, recognized: Math.max(0, total - unknown) };
}

export function collectStepsFromIrText(text: string, cardName: string): readonly OracleEffectStep[] {
  const parsed = parseOracleTextToIR(effectTextForIrAudit(text), cardName);
  const out: OracleEffectStep[] = [];
  for (const ability of parsed.abilities || []) {
    for (const step of ability.steps || []) out.push(step);
  }
  return out;
}

export function collectAutoSelectedModeIds(steps: readonly OracleEffectStep[]): string[] {
  const ids: string[] = [];
  walkOracleSteps(steps, (step) => {
    if (step.kind !== 'choose_mode') return;
    const modes = Array.isArray((step as any).modes) ? (step as any).modes : [];
    const minModes = Math.max(0, Number((step as any).minModes) || 0);
    const pickCount = minModes > 0 ? minModes : 1;
    for (let i = 0; i < pickCount && i < modes.length; i += 1) {
      const label = String(modes[i]?.label || '').trim();
      if (label) ids.push(label);
    }
  });
  return ids;
}

export function buildAuditFixtureState(cardName?: string, typeLine?: string): GameState {
  const resolvedTypeLine = String(typeLine || 'Creature').trim() || 'Creature';
  const isCreatureCard = /\bCreature\b/i.test(resolvedTypeLine);
  const sourceFaceUpCard =
    isCreatureCard && cardName
      ? {
          id: 'bf-source-face-up',
          name: cardName,
          type_line: resolvedTypeLine,
          power: '3',
          toughness: '3',
        }
      : null;
  const sourceGraveyardCard = cardName
    ? {
        id: 'gy-source-self',
        name: cardName,
        type_line: resolvedTypeLine,
        colors: [],
        ...(sourceFaceUpCard
          ? {
              faceDown: true,
              faceUpCard: sourceFaceUpCard,
            }
          : {}),
      }
    : null;
  const gyAntecedent = {
    id: 'gy-antecedent-1',
    name: 'Antecedent Creature',
    type_line: 'Creature — Bear',
    colors: ['G'],
  };
  const gySplitCards = [
    { id: 'gy-split-1', name: 'Split Card A', type_line: 'Creature', colors: ['U'], cmc: 2 },
    { id: 'gy-split-2', name: 'Split Card B', type_line: 'Creature', colors: ['B'] },
    { id: 'gy-split-3', name: 'Split Card C', type_line: 'Instant', colors: ['R'] },
  ];
  const gyCreature = {
    id: 'gy-creature-1',
    name: 'Gravecrawler',
    type_line: 'Creature — Zombie',
    mana_cost: '{B}',
    power: '2',
    toughness: '2',
    colors: ['B'],
  };
  const gyInstant = {
    id: 'gy-instant-1',
    name: 'Lightning Bolt',
    type_line: 'Instant',
    mana_cost: '{R}',
    colors: ['R'],
  };

  return {
    id: 'executor-audit-game',
    format: 'commander',
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 40,
        library: [
          { id: 'lib-plains-1', name: 'Plains', type_line: 'Basic Land — Plains' },
          { id: 'lib-land-1', name: 'Forest', type_line: 'Basic Land — Forest' },
          { id: 'lib-1', name: 'Audit Spell', type_line: 'Instant' },
          { id: 'lib-2', name: 'Audit Creature', type_line: 'Creature' },
          { id: 'lib-3', name: 'Audit Artifact', type_line: 'Artifact' },
        ],
        hand: [
          { id: 'hand-1', name: 'Opt', type_line: 'Instant' },
          { id: 'hand-land-1', name: 'Forest', type_line: 'Basic Land — Forest' },
          { id: 'hand-creature-1', name: 'Audit Hand Creature', type_line: 'Creature — Human', mana_cost: '{1}', cmc: 1 },
          { id: 'hand-artifact-1', name: 'Mind Stone', type_line: 'Artifact', mana_cost: '{2}', cmc: 2 },
          { id: 'hand-equipment-1', name: 'Sword of Feast and Famine', type_line: 'Artifact — Equipment', mana_cost: '{3}', cmc: 3 },
          { id: 'hand-aura-1', name: 'Pacifism', type_line: 'Enchantment — Aura', mana_cost: '{1}{W}', cmc: 2 },
          { id: 'hand-vampire-1', name: 'Vampire Lacerator', type_line: 'Creature — Vampire Warrior', mana_cost: '{B}', cmc: 1 },
          { id: 'hand-x-spell-1', name: 'Bonfire of the Damned', type_line: 'Sorcery', mana_cost: '{X}{X}{R}', cmc: 0 },
          { id: 'hand-source-card', name: cardName, type_line: 'Creature', mana_cost: '{3}', cmc: 3 },
        ],
        graveyard: [
          gyCreature,
          gyInstant,
          {
            id: 'gy-doctor-1',
            name: 'Audit Doctor Graveyard',
            type_line: 'Creature — Doctor',
            mana_cost: '{2}',
            cmc: 2,
          },
          {
            id: 'gy-rat-1',
            name: 'Audit Rat',
            type_line: 'Creature — Rat',
            mana_cost: '{1}',
            cmc: 1,
          },
          {
            id: 'gy-milled-1',
            name: 'Milled This Turn',
            type_line: 'Creature — Zombie',
            mana_cost: '{2}',
            cmc: 2,
            milledTurn: 3,
          },
          {
            id: 'gy-aura-1',
            name: 'Unstable Mutation',
            type_line: 'Enchantment — Aura',
            mana_cost: '{U}',
            cmc: 1,
          },
          {
            id: 'gy-elf-1',
            name: 'Llanowar Elves',
            type_line: 'Creature — Elf Druid',
            mana_cost: '{G}',
            cmc: 1,
          },
          gyAntecedent,
          ...gySplitCards,
          ...(sourceGraveyardCard ? [sourceGraveyardCard] : []),
        ],
        exile: sourceGraveyardCard
          ? [
              {
                id: 'exile-source-self',
                name: cardName || 'Audit Source',
                type_line: resolvedTypeLine,
              },
              {
                id: 'exile-linked-1',
                name: 'Linked Exile Card',
                type_line: 'Creature',
                faceDown: true,
                faceUpCard: {
                  id: 'exile-linked-1-face-up',
                  name: 'Linked Exile Creature',
                  type_line: 'Creature',
                  power: '2',
                  toughness: '2',
                },
                exiledWith: 'bf-source',
                exiledWithSourceId: 'bf-source',
              },
              {
                id: 'exile-opponent-owned-1',
                name: 'Opponent Owned Exile',
                type_line: 'Creature',
                owner: 'p2',
              },
              {
                id: 'exile-goblin-1',
                name: 'Goblin Guide',
                type_line: 'Creature — Goblin Scout',
                mana_cost: '{R}',
                cmc: 1,
              },
              {
                id: 'exile-goblin-2',
                name: 'Siege-Gang Commander',
                type_line: 'Creature — Goblin',
                mana_cost: '{3}{R}{R}',
                cmc: 5,
              },
              {
                id: 'exile-among-them-1',
                name: 'Among Them Human',
                type_line: 'Creature — Human',
                mana_cost: '{2}',
                cmc: 2,
              },
              {
                id: 'exile-land-1',
                name: 'Revealed Forest',
                type_line: 'Basic Land — Forest',
              },
              {
                id: 'exile-dwarf-1',
                name: 'Dwarven Trader',
                type_line: 'Creature — Dwarf',
                mana_cost: '{R}',
                cmc: 1,
              },
              {
                id: 'exile-doctor-1',
                name: 'Audit Doctor',
                type_line: 'Creature — Doctor',
                mana_cost: '{2}',
                cmc: 2,
              },
              {
                id: 'exile-zombie-1',
                name: 'Audit Zombie',
                type_line: 'Creature — Zombie',
                mana_cost: '{B}',
                cmc: 1,
              },
              {
                id: 'exile-island-1',
                name: 'Revealed Island',
                type_line: 'Basic Land — Island',
              },
              {
                id: 'exile-vote-1',
                name: 'Vote Winner A',
                type_line: 'Creature',
              },
              {
                id: 'exile-linked-2',
                name: 'Linked Exile Permanent',
                type_line: 'Artifact',
                exiledWith: 'bf-source',
                exiledWithSourceId: 'bf-source',
              },
            ]
          : [
              {
                id: 'exile-opponent-owned-1',
                name: 'Opponent Owned Exile',
                type_line: 'Creature',
                owner: 'p2',
              },
              {
                id: 'exile-goblin-1',
                name: 'Goblin Guide',
                type_line: 'Creature — Goblin Scout',
                mana_cost: '{R}',
                cmc: 1,
              },
              {
                id: 'exile-goblin-2',
                name: 'Siege-Gang Commander',
                type_line: 'Creature — Goblin',
                mana_cost: '{3}{R}{R}',
                cmc: 5,
              },
              {
                id: 'exile-among-them-1',
                name: 'Among Them Human',
                type_line: 'Creature — Human',
                mana_cost: '{2}',
                cmc: 2,
              },
              {
                id: 'exile-land-1',
                name: 'Revealed Forest',
                type_line: 'Basic Land — Forest',
              },
              {
                id: 'exile-dwarf-1',
                name: 'Dwarven Trader',
                type_line: 'Creature — Dwarf',
                mana_cost: '{R}',
                cmc: 1,
              },
              {
                id: 'exile-doctor-1',
                name: 'Audit Doctor',
                type_line: 'Creature — Doctor',
                mana_cost: '{2}',
                cmc: 2,
              },
              {
                id: 'exile-zombie-1',
                name: 'Audit Zombie',
                type_line: 'Creature — Zombie',
                mana_cost: '{B}',
                cmc: 1,
              },
              {
                id: 'exile-island-1',
                name: 'Revealed Island',
                type_line: 'Basic Land — Island',
              },
              {
                id: 'exile-vote-1',
                name: 'Vote Winner A',
                type_line: 'Creature',
              },
              {
                id: 'exile-linked-2',
                name: 'Linked Exile Permanent',
                type_line: 'Artifact',
                exiledWith: 'bf-source',
                exiledWithSourceId: 'bf-source',
              },
            ],
        manaPool: { white: 5, blue: 5, black: 5, red: 5, green: 5, colorless: 5 },
      },
      {
        id: 'p2',
        name: 'P2',
        seat: 1,
        life: 40,
        library: [{ id: 'lib-p2-1' }, { id: 'lib-p2-2' }],
        hand: [
          { id: 'hand-p2-1', name: 'Shock', type_line: 'Instant' },
          { id: 'hand-p2-2', name: 'Counterspell', type_line: 'Instant' },
          { id: 'hand-p2-3', name: 'Island', type_line: 'Basic Land — Island' },
          { id: 'hand-p2-4', name: 'Audit Elf', type_line: 'Creature — Elf' },
          { id: 'hand-p2-5', name: 'Divination', type_line: 'Sorcery' },
          { id: 'hand-p2-6', name: 'Opt', type_line: 'Instant' },
          { id: 'hand-p2-7', name: 'Swords to Plowshares', type_line: 'Instant' },
          { id: 'hand-p2-8', name: 'Path to Exile', type_line: 'Instant' },
          { id: 'hand-p2-9', name: 'Brainstorm', type_line: 'Instant' },
        ],
        graveyard: [
          { id: 'gy-p2-1', name: 'Counterspell', type_line: 'Instant' },
          { id: 'gy-p2-land-1', name: 'Island', type_line: 'Basic Land — Island' },
          {
            id: 'gy-p2-creature-1',
            name: 'Defending Bear',
            type_line: 'Creature — Bear',
            cmc: 2,
            putIntoGraveyardTurn: 3,
          },
        ],
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      {
        id: 'p3',
        name: 'P3',
        seat: 2,
        life: 40,
        library: [{ id: 'lib-p3-1' }],
        hand: [],
        graveyard: [],
      },
      {
        id: 'p4',
        name: 'P4',
        seat: 3,
        life: 40,
        library: [{ id: 'lib-p4-1' }],
        hand: [],
        graveyard: [],
      },
    ],
    startingLife: 40,
    life: { p1: 40, p2: 40, p3: 40, p4: 40 },
    turnPlayer: 'p1',
    turnNumber: 3,
    priority: 'p1',
    phase: 'main1',
    active: true,
    stack: [
      {
        id: 'stack-spell-1',
        type: 'spell',
        controller: 'p2',
        owner: 'p2',
        card: { id: 'stack-card-1', name: 'Cultivate', type_line: 'Sorcery', colors: ['G'], cmc: 5, manaValue: 5 },
      } as any,
    ],
    battlefield: [
      {
        id: 'bf-source',
        name: cardName || 'Audit Source',
        controller: 'p1',
        owner: 'p1',
        type_line: resolvedTypeLine,
        power: /\bCreature\b/i.test(resolvedTypeLine) ? 3 : undefined,
        toughness: /\bCreature\b/i.test(resolvedTypeLine) ? 3 : undefined,
        tapped: false,
        wasKicked: true,
        counters: { quest: 4, verse: 3, age: 2 },
        colors: ['U'],
        card: {
          id: 'bf-source-card',
          name: cardName || 'Audit Source',
          type_line: resolvedTypeLine,
          colors: ['U'],
          manaSpentTotal: 5,
          wasKicked: true,
          manaSpent: { blue: 1, white: 0, black: 0, red: 0, green: 0, colorless: 0 },
          ...(sourceFaceUpCard ? { faceDown: true } : {}),
        },
        manaSpentTotal: 5,
        manaSpent: { blue: 1, white: 0, black: 0, red: 0, green: 0, colorless: 0 },
        ...(/\b(?:Aura|Equipment)\b/i.test(resolvedTypeLine) ? { attachedTo: 'bf-creature-1' } : {}),
        ...(/\bVehicle\b/i.test(resolvedTypeLine) ? { lastCrewedCreatureId: 'bf-creature-1' } : {}),
        ...(sourceFaceUpCard ? { faceUpCard: sourceFaceUpCard } : {}),
      },
      {
        id: 'bf-vehicle-1',
        name: 'Audit Vehicle',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact — Vehicle',
        tapped: false,
        lastCrewedCreatureId: 'bf-creature-1',
        card: { id: 'bf-vehicle-1-card', name: 'Audit Vehicle', type_line: 'Artifact — Vehicle' },
      },
      {
        id: 'bf-treasure-1',
        name: 'Audit Treasure',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact — Treasure',
        tapped: false,
        card: { id: 'bf-treasure-1-card', name: 'Audit Treasure', type_line: 'Artifact — Treasure' },
      },
      {
        id: 'bf-wolf-1',
        name: 'Audit Wolf',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Wolf',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-wolf-1-card', name: 'Audit Wolf', type_line: 'Creature — Wolf' },
      },
      {
        id: 'bf-creature-1',
        name: 'Grizzly Bears',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Bear',
        power: 2,
        toughness: 2,
        tapped: false,
        attackedThisTurn: true,
        colors: ['G'],
        mana_cost: '{1}{G}',
        cmc: 2,
        card: { id: 'bf-creature-1-card', name: 'Grizzly Bears', type_line: 'Creature — Bear', colors: ['G'], mana_cost: '{1}{G}', cmc: 2 },
      },
      {
        id: 'bf-legendary-creature',
        name: 'Rafiq of the Many',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Legendary Creature — Human Knight',
        power: 3,
        toughness: 3,
        tapped: false,
        colors: ['W', 'U', 'G'],
        card: {
          id: 'bf-legendary-creature-card',
          name: 'Rafiq of the Many',
          type_line: 'Legendary Creature — Human Knight',
          colors: ['W', 'U', 'G'],
        },
      },
      {
        id: 'bf-creature-2',
        name: 'Merfolk Looter',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Merfolk Rogue',
        power: 1,
        toughness: 1,
        tapped: true,
        colors: ['U'],
        card: { id: 'bf-creature-2-card', name: 'Merfolk Looter', type_line: 'Creature — Merfolk Rogue', colors: ['U'] },
      },
      {
        id: 'bf-spider-1',
        name: 'Audit Spider',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Spider',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-spider-1-card', name: 'Audit Spider', type_line: 'Creature — Spider' },
      },
      {
        id: 'bf-villain-1',
        name: 'Audit Villain',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Human Villain',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-villain-1-card', name: 'Audit Villain', type_line: 'Creature — Human Villain' },
      },
      {
        id: 'bf-token-1',
        name: 'Audit Spirit Token',
        controller: 'p1',
        owner: 'p1',
        isToken: true,
        type_line: 'Token Creature — Spirit',
        power: 1,
        toughness: 1,
        tapped: false,
        card: { id: 'bf-token-1-card', name: 'Audit Spirit Token', type_line: 'Token Creature — Spirit' },
      },
      {
        id: 'bf-blue-black-creature',
        name: 'Nightveil Specter',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Specter',
        power: 2,
        toughness: 3,
        tapped: false,
        colors: ['U', 'B'],
        card: {
          id: 'bf-blue-black-creature-card',
          name: 'Nightveil Specter',
          type_line: 'Creature — Specter',
          colors: ['U', 'B'],
        },
      },
      {
        id: 'bf-opponent-creature',
        name: 'Runeclaw Bear',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Creature — Bear',
        power: 2,
        toughness: 2,
        tapped: false,
        colors: ['G'],
        card: { id: 'bf-opponent-creature-card', name: 'Runeclaw Bear', type_line: 'Creature — Bear', colors: ['G'] },
      },
      {
        id: 'bf-opponent-land',
        name: 'Mountain',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Basic Land — Mountain',
        tapped: false,
        card: { id: 'bf-opponent-land-card', name: 'Mountain', type_line: 'Basic Land — Mountain' },
      },
      {
        id: 'bf-opponent-artifact',
        name: 'Mind Stone',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Artifact',
        tapped: false,
        card: { id: 'bf-opponent-artifact-card', name: 'Mind Stone', type_line: 'Artifact', mana_cost: '{2}', cmc: 2 },
      },
      {
        id: 'bf-opponent-enchantment',
        name: 'Pacifism',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Enchantment — Aura',
        tapped: false,
        attachedTo: 'bf-opponent-creature',
        card: { id: 'bf-opponent-enchantment-card', name: 'Pacifism', type_line: 'Enchantment — Aura', mana_cost: '{1}{W}', cmc: 2 },
      },
      {
        id: 'bf-land-1',
        name: 'Island',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Basic Land — Island',
        tapped: false,
        card: { id: 'bf-land-1-card', name: 'Island', type_line: 'Basic Land — Island' },
      },
      {
        id: 'bf-land-2',
        name: 'Forest',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Basic Land — Forest',
        tapped: false,
        card: { id: 'bf-land-2-card', name: 'Forest', type_line: 'Basic Land — Forest' },
      },
      {
        id: 'bf-red-creature',
        name: 'Goblin Piker',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Goblin',
        power: 4,
        toughness: 1,
        tapped: false,
        attacking: true,
        attackedThisTurn: true,
        colors: ['R'],
        card: {
          id: 'bf-red-creature-card',
          name: 'Goblin Piker',
          type_line: 'Creature — Goblin',
          colors: ['R'],
        },
      },
      {
        id: 'bf-artifact-1',
        name: 'Sol Ring',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact',
        tapped: false,
        card: { id: 'bf-artifact-1-card', name: 'Sol Ring', type_line: 'Artifact' },
      },
      {
        id: 'bf-equipment-1',
        name: 'Sword of Feast and Famine',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact — Equipment',
        tapped: false,
        card: {
          id: 'bf-equipment-1-card',
          name: 'Sword of Feast and Famine',
          type_line: 'Artifact — Equipment',
          mana_cost: '{3}',
          cmc: 3,
        },
      },
      {
        id: 'bf-enchantment-1',
        name: 'Curiosity',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Enchantment — Aura',
        tapped: false,
        attachedTo: 'bf-creature-1',
        card: { id: 'bf-enchantment-1-card', name: 'Curiosity', type_line: 'Enchantment — Aura' },
      },
      {
        id: 'bf-planeswalker-1',
        name: 'Jace, the Mind Sculptor',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Legendary Planeswalker — Jace',
        loyalty: 4,
        counters: { flood: 3 },
        card: { id: 'bf-planeswalker-1-card', name: 'Jace, the Mind Sculptor', type_line: 'Legendary Planeswalker — Jace' },
      },
      {
        id: 'bf-party-cleric',
        name: 'Audit Cleric',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Human Cleric',
        power: 1,
        toughness: 1,
        card: { name: 'Audit Cleric', type_line: 'Creature — Human Cleric' },
      },
      {
        id: 'bf-party-rogue',
        name: 'Audit Rogue',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Human Rogue',
        power: 1,
        toughness: 1,
        card: { name: 'Audit Rogue', type_line: 'Creature — Human Rogue' },
      },
      {
        id: 'bf-party-warrior',
        name: 'Audit Warrior',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Human Warrior',
        power: 1,
        toughness: 1,
        attacking: true,
        attackedThisTurn: true,
        card: { name: 'Audit Warrior', type_line: 'Creature — Human Warrior' },
      },
      {
        id: 'bf-clue-1',
        name: 'Audit Clue',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact — Clue',
        tapped: false,
        card: { id: 'bf-clue-1-card', name: 'Audit Clue', type_line: 'Artifact — Clue' },
      },
      {
        id: 'bf-clue-2',
        name: 'Audit Clue Two',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact — Clue',
        tapped: false,
        card: { id: 'bf-clue-2-card', name: 'Audit Clue Two', type_line: 'Artifact — Clue' },
      },
      {
        id: 'bf-wall-opponent',
        name: 'Audit Wall',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Creature — Wall',
        power: 0,
        toughness: 4,
        tapped: false,
        card: { id: 'bf-wall-opponent-card', name: 'Audit Wall', type_line: 'Creature — Wall' },
      },
      {
        id: 'bf-zombie-1',
        name: 'Audit Zombie',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Zombie',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-zombie-1-card', name: 'Audit Zombie', type_line: 'Creature — Zombie' },
      },
      {
        id: 'bf-dinosaur-1',
        name: 'Audit Dinosaur',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Dinosaur',
        power: 4,
        toughness: 4,
        tapped: false,
        card: { id: 'bf-dinosaur-1-card', name: 'Audit Dinosaur', type_line: 'Creature — Dinosaur' },
      },
      {
        id: 'bf-spirit-1',
        name: 'Audit Spirit',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Spirit',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-spirit-1-card', name: 'Audit Spirit', type_line: 'Creature — Spirit' },
      },
      {
        id: 'bf-snake-1',
        name: 'Audit Snake',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Snake',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-snake-1-card', name: 'Audit Snake', type_line: 'Creature — Snake' },
      },
      {
        id: 'bf-flying-1',
        name: 'Audit Griffin',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Griffin',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-flying-1-card', name: 'Audit Griffin', type_line: 'Creature — Griffin', keywords: ['Flying'] },
      },
      {
        id: 'bf-elemental-1',
        name: 'Audit Elemental',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Elemental',
        power: 3,
        toughness: 3,
        tapped: false,
        card: { id: 'bf-elemental-1-card', name: 'Audit Elemental', type_line: 'Creature — Elemental' },
      },
      {
        id: 'bf-cat-1',
        name: 'Audit Cat',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Cat',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-cat-1-card', name: 'Audit Cat', type_line: 'Creature — Cat' },
      },
      {
        id: 'bf-defender-1',
        name: 'Audit Wall Defender',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Wall',
        power: 0,
        toughness: 5,
        tapped: false,
        card: { id: 'bf-defender-1-card', name: 'Audit Wall Defender', type_line: 'Creature — Wall', keywords: ['Defender'] },
      },
      {
        id: 'bf-rebel-1',
        name: 'Audit Rebel',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Human Rebel',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-rebel-1-card', name: 'Audit Rebel', type_line: 'Creature — Human Rebel' },
      },
      {
        id: 'bf-party-wizard',
        name: 'Audit Wizard',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Human Wizard',
        power: 1,
        toughness: 1,
        card: { name: 'Audit Wizard', type_line: 'Creature — Human Wizard' },
      },
    ],
    commandZone: {} as any,
    attackersDeclaredThisCombatByPlayer: { p1: ['bf-creature-1', 'bf-red-creature'], p2: [] },
    attackedDefendingPlayersThisCombatByPlayer: { p1: ['p2'] },
    permanentLeftBattlefieldThisTurn: { p1: true, p2: false },
    spellWarpedThisTurn: { p1: true, p2: false },
    poisonCounters: { p1: 0, p2: 3, p3: 0, p4: 0 },
    spellsCastThisTurn: { p1: 2, p2: 1 },
    noncreatureSpellsCastThisTurn: { p1: 1, p2: 1 },
    manaPool: { p1: { white: 2, blue: 2, black: 2, red: 2, green: 2, colorless: 2 } },
  } as GameState;
}

export function buildAuditExecutionContext(cardName: string): ReturnType<typeof buildOracleIRExecutionContext> {
  const controllerId = 'p1' as PlayerID;
  const selectorContext = {
    targetCreatureId: 'bf-legendary-creature',
    targetPermanentId: 'bf-legendary-creature',
    targetSpellId: 'stack-spell-1',
    combatOpponentCreatureId: 'bf-opponent-creature',
    targetOpponentId: 'p2' as PlayerID,
    targetPlayerId: 'p2' as PlayerID,
    chosenCreatureType: 'Zombie',
    chosenCardName: 'Lightning Bolt',
    chosenBasicLandType: 'Island',
    chosenMana: '{R}',
    unlessPaysLifeChoice: 'decline' as const,
    unlessPaysManaChoice: 'decline' as const,
    tapOrUntapChoice: 'tap' as const,
    eachOfThoseOpponents: ['p2', 'p3', 'p4'] as PlayerID[],
    chosenObjectIds: [
      'gy-antecedent-1',
      'gy-split-1',
      'gy-split-2',
      'gy-split-3',
      'hand-land-1',
      'hand-creature-1',
      'hand-artifact-1',
      'hand-equipment-1',
      'hand-aura-1',
      'gy-aura-1',
      'bf-enchantment-1',
      'gy-split-1',
      'gy-split-2',
      'bf-creature-1',
      'bf-creature-2',
      'bf-spider-1',
      'bf-villain-1',
      'bf-token-1',
      'bf-treasure-1',
      'bf-wolf-1',
      'gy-p2-1',
      'gy-creature-1',
      'gy-instant-1',
      'gy-source-self',
      'exile-linked-1',
      'exile-opponent-owned-1',
      'hand-p2-1',
      'bf-blue-black-creature',
      'bf-opponent-creature',
      'bf-opponent-land',
      'bf-opponent-artifact',
      'bf-opponent-enchantment',
      'bf-vehicle-1',
      'bf-planeswalker-1',
      'bf-equipment-1',
      'bf-legendary-creature',
      'exile-source-self',
      'exile-goblin-1',
      'exile-goblin-2',
      'exile-among-them-1',
      'exile-land-1',
      'exile-dwarf-1',
      'exile-doctor-1',
      'gy-p2-land-1',
      'gy-aura-1',
      'exile-zombie-1',
      'hand-vampire-1',
      'gy-doctor-1',
      'gy-milled-1',
      'exile-island-1',
      'exile-vote-1',
      'exile-linked-2',
      'hand-x-spell-1',
      'hand-source-card',
      'bf-land-1',
      'bf-land-2',
      'bf-red-creature',
      'bf-rebel-1',
      'gy-rat-1',
      'gy-p2-creature-1',
      'bf-clue-1',
      'bf-clue-2',
      'bf-wall-opponent',
      'bf-party-warrior',
      'bf-dinosaur-1',
      'bf-spirit-1',
      'bf-snake-1',
      'bf-flying-1',
      'bf-elemental-1',
      'bf-artifact-1',
      'bf-cat-1',
      'bf-defender-1',
      'bf-rebel-1',
      'hand-source-card',
      'gy-rat-1',
    ],
  };

  return buildOracleIRExecutionContext(
    {
      controllerId,
      sourceId: 'bf-source',
      sourceName: cardName,
      sourceObjectType: 'ability',
      xValue: 3,
      referenceAmount: 2,
      giftPromised: true,
      abilityResolveCountThisTurn: 2,
      referenceSpellManaValue: 5,
      lastClashWon: true,
      wonCoinFlip: false,
      targetCreatureId: 'bf-legendary-creature',
      targetPermanentId: 'bf-legendary-creature',
      targetSpellId: 'stack-spell-1',
      unlessPaysLifeChoice: 'decline',
      unlessPaysManaChoice: 'decline',
      tapOrUntapChoice: 'tap',
      selectorContext,
    },
    {
      targetPlayerId: 'p2',
      targetOpponentId: 'p2',
      targetSpellId: 'stack-spell-1',
      targetPermanentId: 'bf-creature-1',
      chosenObjectIds: [
      'gy-antecedent-1',
      'gy-split-1',
      'gy-split-2',
      'gy-split-3',
      'hand-land-1',
      'hand-creature-1',
      'hand-artifact-1',
      'hand-equipment-1',
      'hand-aura-1',
      'gy-aura-1',
      'bf-enchantment-1',
      'gy-split-1',
      'gy-split-2',
      'bf-creature-1',
      'bf-creature-2',
      'bf-spider-1',
      'bf-villain-1',
      'bf-token-1',
      'bf-treasure-1',
      'bf-wolf-1',
      'gy-p2-1',
      'gy-creature-1',
      'gy-instant-1',
      'gy-source-self',
      'exile-linked-1',
      'exile-opponent-owned-1',
      'hand-p2-1',
      'bf-blue-black-creature',
      'bf-opponent-creature',
      'bf-opponent-land',
      'bf-opponent-artifact',
      'bf-opponent-enchantment',
      'bf-vehicle-1',
      'bf-planeswalker-1',
      'bf-equipment-1',
      'bf-legendary-creature',
      'exile-source-self',
      'exile-goblin-1',
      'exile-goblin-2',
      'exile-among-them-1',
      'exile-land-1',
      'exile-dwarf-1',
      'exile-doctor-1',
      'gy-p2-land-1',
      'gy-aura-1',
      'exile-zombie-1',
      'hand-vampire-1',
      'gy-doctor-1',
      'gy-milled-1',
      'exile-island-1',
      'exile-vote-1',
      'exile-linked-2',
      'hand-x-spell-1',
      'hand-source-card',
      'bf-land-1',
      'bf-land-2',
      'bf-red-creature',
      'bf-rebel-1',
      'gy-rat-1',
      'gy-p2-creature-1',
      'bf-clue-1',
      'bf-clue-2',
      'bf-wall-opponent',
      'bf-party-warrior',
      'bf-dinosaur-1',
      'bf-spirit-1',
      'bf-snake-1',
      'bf-flying-1',
      'bf-elemental-1',
      'bf-artifact-1',
      'bf-cat-1',
      'bf-defender-1',
      'bf-rebel-1',
      'hand-source-card',
      'gy-rat-1',
    ],
      chosenCreatureType: 'Zombie',
      chosenCardName: 'Lightning Bolt',
      chosenMana: '{R}',
      unlessPaysLifeChoice: 'decline',
      unlessPaysManaChoice: 'decline',
      tapOrUntapChoice: 'tap',
      affectedOpponentIds: ['p2', 'p3', 'p4'],
      opponentsDealtDamageIds: ['p2'],
      referenceAmount: 2,
      spellCastCountThisTurn: 2,
      noncreatureSpellCastCountThisTurn: 1,
      spellManaValue: 5,
      giftPromised: true,
    }
  );
}

export function classifyExecutionResult(
  result: OracleIRExecutionResult,
  stepCount: StepCount,
  irGaps: readonly string[]
): ExecutionRecord {
  const reasonCodes: Record<string, number> = {};
  const stepKinds: Record<string, number> = {};

  for (const gap of result.automationGaps || []) {
    const code = String(gap.reasonCode || 'unknown_reason');
    reasonCodes[code] = (reasonCodes[code] || 0) + 1;
    const kind = String(gap.stepKind || 'unknown');
    stepKinds[kind] = (stepKinds[kind] || 0) + 1;
  }

  let choiceRequired = 0;
  let unsupported = 0;
  let impossible = 0;
  for (const [code, count] of Object.entries(reasonCodes)) {
    if (code === 'player_choice_required') choiceRequired += count;
    else if (code === 'impossible_action' || code === 'invalid_input') impossible += count;
    else unsupported += count;
  }

  const applied = result.appliedSteps?.length || 0;
  const skipped = result.skippedSteps?.length || 0;

  let status: ExecutorCoverageStatus;
  if (irGaps.length > 0) {
    status = 'ir_gap';
  } else if (stepCount.recognized === 0) {
    status = 'no_steps';
  } else if (skipped === 0 && applied > 0) {
    status = 'fully_applied';
  } else if (skipped > 0 && applied === 0 && choiceRequired > 0 && unsupported === 0 && impossible === 0) {
    status = 'choice_required';
  } else if (skipped > 0 && applied === 0 && impossible > 0 && choiceRequired === 0) {
    status = 'impossible';
  } else if (skipped > 0 && applied === 0 && unsupported > 0) {
    status = 'unsupported';
  } else if (applied > 0 && skipped > 0) {
    status = choiceRequired > 0 && unsupported === 0 ? 'choice_required' : 'partial';
  } else if (unsupported > 0) {
    status = 'unsupported';
  } else if (choiceRequired > 0) {
    status = 'choice_required';
  } else {
    status = 'partial';
  }

  return {
    status,
    applied,
    skipped,
    choiceRequired,
    unsupported,
    impossible,
    reasonCodes,
    stepKinds,
  };
}

export function dryRunOracleSteps(
  steps: readonly OracleEffectStep[],
  cardName: string,
  irGaps: readonly string[],
  options?: { readonly typeLine?: string }
): ExecutionRecord {
  const stepCount = countOracleSteps(steps);
  const typeLine = options?.typeLine;
  if (irGaps.length > 0 || stepCount.recognized === 0) {
    return classifyExecutionResult(
      { state: buildAuditFixtureState(cardName, typeLine), log: [], appliedSteps: [], skippedSteps: [], automationGaps: [], pendingOptionalSteps: [] },
      stepCount,
      irGaps
    );
  }

  const state = buildAuditFixtureState(cardName, typeLine);
  const ctx = buildAuditExecutionContext(cardName);
  const selectedModeIds = collectAutoSelectedModeIds(steps);
  const result = applyOracleIRStepsToGameState(state, steps, ctx, {
    allowOptional: true,
    ...(selectedModeIds.length > 0 ? { selectedModeIds } : {}),
  });

  return classifyExecutionResult(result, stepCount, irGaps);
}

function buildTemplateKey(trigger: TriggeredAbility): string {
  const event = String(trigger.event || 'unknown');
  const condition = normalizeText(trigger.condition || trigger.triggerFilter || '')
    .toLowerCase()
    .replace(/\b\d+\b/g, '<N>')
    .replace(/\bthis (?:creature|permanent|enchantment|artifact|planeswalker|land|vehicle)\b/g, 'this permanent')
    .slice(0, 120);
  const ifSuffix = trigger.interveningIfClause ? ', if <if>' : '';
  return `${event}|${condition || '<unknown-condition>'}${ifSuffix}`;
}

function pushExample(target: string[], value: string, limit: number): void {
  if (!value || target.includes(value)) return;
  if (target.length < limit) target.push(value);
}

function topKeys(record: Record<string, number>, n = 3): string[] {
  return Object.entries(record)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([key]) => key);
}

async function main(): Promise<void> {
  const args = parseArgs();
  await loadEffectIrParser();

  const oraclePath = path.join(repoRoot, 'oracle-cards.json');
  if (!fs.existsSync(oraclePath)) {
    console.error(`oracle-cards.json not found at ${oraclePath}`);
    process.exit(1);
  }

  const cards = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as OracleCard[];
  const patterns = new Map<string, PatternRecord>();
  const gapCards = new Set<string>();

  const stats: AuditStats = {
    cardsScanned: 0,
    itemsScanned: 0,
    byStatus: {
      fully_applied: 0,
      choice_required: 0,
      unsupported: 0,
      partial: 0,
      ir_gap: 0,
      no_steps: 0,
      impossible: 0,
    },
    byScope: { trigger_effects: 0, full_card: 0 },
    parseToExecuteGap: 0,
  };

  const reasonTotals: Record<string, number> = {};
  const skippedKindTotals: Record<string, number> = {};

  const assessItem = (
    card: OracleCard,
    scope: 'trigger_effects' | 'full_card',
    text: string,
    trigger?: TriggeredAbility
  ): void => {
    const irGaps = hasUnknownIRSteps(text, card.name);
    const steps = collectStepsFromIrText(text, card.name);
    const record = dryRunOracleSteps(steps, card.name, irGaps, { typeLine: card.type_line });

    stats.itemsScanned += 1;
    stats.byScope[scope] += 1;
    stats.byStatus[record.status] += 1;

    if (irGaps.length === 0 && record.status !== 'fully_applied' && record.status !== 'choice_required') {
      stats.parseToExecuteGap += 1;
      gapCards.add(card.name);
    }

    for (const [code, count] of Object.entries(record.reasonCodes)) {
      reasonTotals[code] = (reasonTotals[code] || 0) + count;
    }
    for (const [kind, count] of Object.entries(record.stepKinds)) {
      skippedKindTotals[kind] = (skippedKindTotals[kind] || 0) + count;
    }

    const templateKey =
      scope === 'trigger_effects' && trigger
        ? buildTemplateKey(trigger)
        : `${scope}|${normalizeText(text).toLowerCase().slice(0, 80)}`;

    const existing = patterns.get(templateKey);
    if (!existing) {
      patterns.set(templateKey, {
        templateKey,
        event: trigger ? String(trigger.event || 'unknown') : scope,
        count: 1,
        statuses: [record.status],
        exampleCards: [card.name],
        sampleEffect: normalizeText(text).slice(0, 160),
        topReasonCodes: topKeys(record.reasonCodes),
        topSkippedKinds: topKeys(record.stepKinds),
      });
      return;
    }

    existing.count += 1;
    if (!existing.statuses.includes(record.status)) existing.statuses.push(record.status);
    pushExample(existing.exampleCards, card.name, args.maxExamples);
    existing.topReasonCodes = topKeys({
      ...Object.fromEntries(existing.topReasonCodes.map((k) => [k, 1])),
      ...record.reasonCodes,
    });
    existing.topSkippedKinds = topKeys({
      ...Object.fromEntries(existing.topSkippedKinds.map((k) => [k, 1])),
      ...record.stepKinds,
    });
  };

  const seenOracleIds = new Set<string>();

  for (const card of cards) {
    if (!isEligible(card)) continue;
    if (args.commanderOnly && !isCommanderLegalCard(card)) continue;

    const oracleId = String(card.oracle_id || card.id || `${card.name}:${getCombinedOracleText(card)}`);
    if (seenOracleIds.has(oracleId)) continue;
    seenOracleIds.add(oracleId);
    stats.cardsScanned += 1;

    const oracle = getCombinedOracleText(card);
    if (!oracle) continue;

    if (args.scope === 'trigger_effects' || args.scope === 'both') {
      const triggers = parseTriggeredAbilitiesFromText(oracle, card.name);
      for (const trigger of triggers) {
        const effect = String(trigger.effect || '').trim();
        if (!effect) continue;
        if (isIgnorableCardForIrGap(card) && hasUnknownIRSteps(effect, card.name).length > 0) continue;
        assessItem(card, 'trigger_effects', effect, trigger);
      }
    }

    if (args.scope === 'full_card' || args.scope === 'both') {
      if (isIgnorableCardForIrGap(card)) continue;
      const parsed = parseOracleTextToIR(oracle, card.name);
      for (const ability of parsed.abilities || []) {
        const text = String(ability.effectText || ability.text || '').trim();
        if (!text) continue;
        assessItem(card, 'full_card', text);
      }
    }
  }

  const gapPatterns = [...patterns.values()]
    .filter((pattern) => !pattern.statuses.every((s) => s === 'fully_applied' || s === 'choice_required'))
    .sort((a, b) => b.count - a.count);

  const topPatterns = (args.onlyGaps ? gapPatterns : [...patterns.values()].sort((a, b) => b.count - a.count)).slice(
    0,
    args.top
  );

  const topReasonCodes = topKeys(reasonTotals, 25);
  const topSkippedKinds = topKeys(skippedKindTotals, 25);

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      scope: args.scope,
      commanderOnly: args.commanderOnly,
      fixture: 'assisted (pre-bound targets, allowOptional=true, auto first-mode for choose_mode)',
      top: args.top,
      maxExamples: args.maxExamples,
      onlyGaps: args.onlyGaps,
    },
    stats,
    topReasonCodes: topReasonCodes.map((code) => ({ code, count: reasonTotals[code] || 0 })),
    topSkippedStepKinds: topSkippedKinds.map((kind) => ({ kind, count: skippedKindTotals[kind] || 0 })),
    topGapPatterns: topPatterns,
    gapCardCount: gapCards.size,
    gapCardSamples: [...gapCards].slice(0, args.maxExamples),
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  const applied = stats.byStatus.fully_applied;
  const choice = stats.byStatus.choice_required;
  const executable = applied + choice;
  const rate = stats.itemsScanned > 0 ? Math.round((executable / stats.itemsScanned) * 1000) / 10 : 0;

  console.log('Oracle IR Executor Coverage Audit');
  console.log('================================');
  console.log(`Scope: ${args.scope}`);
  console.log(`Commander-legal only: ${args.commanderOnly ? 'yes' : 'no'}`);
  console.log(`Cards scanned: ${stats.cardsScanned}`);
  console.log(`Items dry-run: ${stats.itemsScanned}`);
  console.log(`Fully applied: ${applied}`);
  console.log(`Choice required (expected UI): ${choice}`);
  console.log(`Parse→execute gaps: ${stats.parseToExecuteGap} items on ${gapCards.size} cards`);
  console.log(`Assisted execution rate: ${rate}% (${executable}/${stats.itemsScanned})`);
  console.log('');
  console.log('By status:');
  for (const [status, count] of Object.entries(stats.byStatus)) {
    if (count > 0) console.log(`  ${status}: ${count}`);
  }
  console.log('');
  console.log('Top skip reason codes:');
  for (const entry of report.topReasonCodes.slice(0, 12)) {
    console.log(`  ${entry.code}: ${entry.count}`);
  }
  console.log('');
  console.log('Top gap patterns:');
  for (const pattern of topPatterns.slice(0, 15)) {
    console.log(
      `  [${pattern.count}] ${pattern.event} — ${pattern.statuses.join(', ')} — ${pattern.sampleEffect.slice(0, 90)}`
    );
    if (pattern.exampleCards.length > 0) {
      console.log(`       e.g. ${pattern.exampleCards.slice(0, 3).join(', ')}`);
    }
  }
  console.log('');
  console.log(`Wrote report: ${outPath}`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
