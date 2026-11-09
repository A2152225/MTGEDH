/**
 * AI puzzle suite harness (P0-5).
 *
 * Each puzzle returns an observed action key. The suite passes when that key is
 * on the acceptable list. Forbidden keys are reported as blunders. Puzzles that
 * v0 is expected to miss are marked knownFailing so the suite stays green while
 * the pass table still shows the baseline.
 */

import { expect } from 'vitest';
import {
  AIEngine,
  AIDecisionType,
  AIStrategy,
  type AIDecisionContext,
} from '../../../rules-engine/src/AIEngine.js';
import type { BattlefieldPermanent, GameState } from '../../../shared/src/types.js';
import { GameStep } from '../../../shared/src/types.js';
import { seedAIRandom } from '../../../rules-engine/src/aiRandom.js';

export type PuzzleKind = 'attack' | 'block' | 'mulligan' | 'priority' | 'response' | 'target';

export interface PuzzleResult {
  observed: string;
  detail?: unknown;
}

export interface Puzzle {
  id: string;
  description: string;
  category: string;
  kind: PuzzleKind;
  /** v0 is known to miss this; suite stays green but counts as a baseline fail. */
  knownFailing?: boolean;
  acceptable: string[];
  forbidden: string[];
  run: () => Promise<PuzzleResult>;
}

export interface PuzzleOutcome {
  id: string;
  category: string;
  description: string;
  observed: string;
  passed: boolean;
  knownFailing: boolean;
  blunder: boolean;
  detail?: unknown;
}

export function creature(
  id: string,
  controller: string,
  extras: Partial<BattlefieldPermanent> & {
    power?: string;
    toughness?: string;
    attacking?: unknown;
    isCommander?: boolean;
    oracle_text?: string;
    type_line?: string;
  } = {},
): BattlefieldPermanent {
  const {
    power = '2',
    toughness = '2',
    attacking,
    isCommander,
    oracle_text = '',
    type_line = 'Creature',
    card: cardOverride,
    ...rest
  } = extras as any;
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    counters: {},
    card: {
      id: `card_${id}`,
      name: id,
      type_line,
      power,
      toughness,
      oracle_text,
      ...(cardOverride || {}),
    },
    ...(attacking !== undefined ? { attacking } : {}),
    ...(isCommander ? { isCommander: true } : {}),
    ...rest,
  } as BattlefieldPermanent;
}

export function makeAIEngine(playerId = 'ai-player', difficulty = 1): AIEngine {
  const engine = new AIEngine();
  engine.registerAI({
    playerId,
    strategy: AIStrategy.BASIC,
    difficulty,
  });
  return engine;
}

export function basePlayers(lifeById: Record<string, number>) {
  return Object.entries(lifeById).map(([id, life]) => ({
    id,
    name: id,
    life,
    spectator: false,
    isAI: id === 'ai-player',
  }));
}

export async function decideAttackers(args: {
  life: Record<string, number>;
  battlefield: BattlefieldPermanent[];
  playerId?: string;
  commanderDamage?: Record<string, Record<string, number>>;
}): Promise<PuzzleResult> {
  seedAIRandom(42);
  const playerId = args.playerId || 'ai-player';
  const engine = makeAIEngine(playerId);
  const gameState = {
    turn: 8,
    turnNumber: 8,
    step: GameStep.DECLARE_ATTACKERS,
    phase: 'combat',
    activePlayerIndex: 0,
    battlefield: args.battlefield,
    life: args.life,
    players: basePlayers(args.life),
    commanderDamage: args.commanderDamage || {},
  } as unknown as GameState;

  const context: AIDecisionContext = {
    gameState,
    playerId,
    decisionType: AIDecisionType.DECLARE_ATTACKERS,
    options: [],
    constraints: {},
  };

  const decision = await engine.makeDecision(context);
  const attackers = Array.isArray(decision.action?.attackers) ? decision.action.attackers : [];
  const keys = attackers
    .map((a: any) => `${a.creatureId}->${a.defendingPlayerId}`)
    .sort();
  const observed = keys.length === 0 ? 'attack:none' : `attack:${keys.join(',')}`;
  return { observed, detail: attackers };
}

export async function decideBlockers(args: {
  life: number;
  attackers: BattlefieldPermanent[];
  blockers: BattlefieldPermanent[];
  otherPermanents?: BattlefieldPermanent[];
  commanderDamage?: Record<string, Record<string, number>>;
  playerId?: string;
}): Promise<PuzzleResult> {
  seedAIRandom(42);
  const playerId = args.playerId || 'ai-player';
  const engine = makeAIEngine(playerId);
  const life = {
    [playerId]: args.life,
    attacker: 40,
    bystander: 40,
  };
  const battlefield = [...args.attackers, ...args.blockers, ...(args.otherPermanents || [])];
  const gameState = {
    turn: 6,
    turnNumber: 6,
    step: GameStep.DECLARE_BLOCKERS,
    phase: 'combat',
    activePlayerIndex: 0,
    battlefield,
    life,
    players: [
      { id: playerId, life: args.life, battlefield } as any,
      { id: 'attacker', life: 40, battlefield: [] as any },
      { id: 'bystander', life: 40, battlefield: [] as any },
    ],
    commanderDamage: args.commanderDamage || {},
  } as unknown as GameState;

  const context: AIDecisionContext = {
    gameState,
    playerId,
    decisionType: AIDecisionType.DECLARE_BLOCKERS,
    options: [],
    constraints: { attackers: args.attackers },
  };

  const decision = await engine.makeDecision(context);
  const blockers = Array.isArray(decision.action?.blockers) ? decision.action.blockers : [];
  const keys = blockers
    .map((b: any) => `${b.blockerId}->${b.attackerId}`)
    .sort();
  const observed = keys.length === 0 ? 'block:none' : `block:${keys.join(',')}`;
  return { observed, detail: blockers };
}

export async function decideMulligan(args: {
  hand: Array<{ name: string; types?: string[]; type_line?: string }>;
  playerId?: string;
}): Promise<PuzzleResult> {
  seedAIRandom(42);
  const playerId = args.playerId || 'ai-player';
  const engine = makeAIEngine(playerId);
  const hand = args.hand.map((card, i) => ({
    id: `h${i}`,
    name: card.name,
    type_line: card.type_line || (card.types?.includes('Land') ? 'Basic Land' : 'Creature'),
    types: card.types || (String(card.type_line || '').toLowerCase().includes('land') ? ['Land'] : ['Creature']),
  }));
  const gameState = {
    turn: 0,
    turnNumber: 0,
    step: GameStep.UNTAP,
    phase: 'beginning',
    players: [{ id: playerId, life: 40, hand } as any],
    battlefield: [],
    life: { [playerId]: 40 },
  } as unknown as GameState;

  const context: AIDecisionContext = {
    gameState,
    playerId,
    decisionType: AIDecisionType.MULLIGAN,
    options: [],
    constraints: {},
  };

  const decision = await engine.makeDecision(context);
  const keep = Boolean(decision.action?.keep);
  return { observed: keep ? 'mulligan:keep' : 'mulligan:mulligan', detail: decision };
}

export function evaluatePuzzle(puzzle: Puzzle, result: PuzzleResult): PuzzleOutcome {
  const blunder = puzzle.forbidden.includes(result.observed);
  const matched = puzzle.acceptable.includes(result.observed);
  const passed = matched && !blunder;
  return {
    id: puzzle.id,
    category: puzzle.category,
    description: puzzle.description,
    observed: result.observed,
    passed,
    knownFailing: Boolean(puzzle.knownFailing),
    blunder,
    detail: result.detail,
  };
}

export function assertPuzzleOutcome(outcome: PuzzleOutcome, puzzle: Puzzle): void {
  if (outcome.knownFailing) {
    // Baseline miss: suite stays green; table still records the fail.
    // If v0 unexpectedly passes, keep green — drop knownFailing in a follow-up.
    return;
  }
  expect(
    outcome.passed,
    `${outcome.id}: observed "${outcome.observed}" not in acceptable [${puzzle.acceptable.join(', ')}]`,
  ).toBe(true);
}

export function formatPassTable(outcomes: PuzzleOutcome[]): string {
  const lines = [
    'id | category | result | observed | note',
    '-- | -------- | ------ | -------- | ----',
  ];
  for (const o of outcomes) {
    const result = o.passed ? 'PASS' : o.knownFailing ? 'FAIL(v0)' : 'FAIL';
    const note = o.blunder ? 'blunder' : o.knownFailing ? 'knownFailing' : '';
    lines.push(`${o.id} | ${o.category} | ${result} | ${o.observed} | ${note}`);
  }
  const pass = outcomes.filter((o) => o.passed).length;
  const known = outcomes.filter((o) => !o.passed && o.knownFailing).length;
  lines.push('');
  lines.push(`v0 pass: ${pass}/${outcomes.length} (knownFailing misses: ${known})`);
  return lines.join('\n');
}
