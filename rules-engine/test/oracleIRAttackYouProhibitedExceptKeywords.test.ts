import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { GameState } from '../../shared/src/index.js';

// Quoted from mtg_data.db cards.text WHERE is_token = 0.
const ISLAND_SANCTUARY_ORACLE =
  "If you would draw a card during your draw step, instead you may skip that draw. If you do, until your next turn, you can't be attacked except by creatures with flying and/or islandwalk.";
const LOCK_LEADING =
  "until your next turn, you can't be attacked except by creatures with flying and/or islandwalk";
const LOCK_TRAILING =
  "you can't be attacked except by creatures with flying and/or islandwalk until your next turn";

function collectGrantSteps(text: string, name: string) {
  const ir = parseOracleTextToIR(text, name);
  return (ir.abilities || []).flatMap((ability) => ability.steps || [])
    .filter((step) => step.kind === 'grant_static_ability');
}

function makeState(): GameState {
  return {
    id: 'attack-you-except-keywords',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] },
    ],
    battlefield: [],
    stack: [],
    turnPlayer: 'p1',
    priority: 'p1',
    active: true,
    turnNumber: 4,
  } as unknown as GameState;
}

function applyGrants(text: string, sourceName: string) {
  const steps = collectGrantSteps(text, sourceName)
    .filter((step) => String((step as { duration?: string }).duration || '') === 'until_next_turn');
  return applyOracleIRStepsToGameState(
    makeState(),
    steps,
    buildOracleIRExecutionContext({
      controllerId: 'p1',
      sourceId: 'lock_1',
      sourceName,
      sourceObjectType: 'spell',
    } as any),
  );
}

describe('until-next-turn attack-you except-keywords oracle IR', () => {
  it('parses leading and trailing until-your-next-turn lock clauses', () => {
    expect(collectGrantSteps(LOCK_LEADING, 'Shore Refuge')[0]).toMatchObject({
      kind: 'grant_static_ability',
      duration: 'until_next_turn',
      effectText: ["can't be attacked except by creatures with flying and/or islandwalk"],
      target: expect.objectContaining({ text: 'you' }),
    });
    expect(collectGrantSteps(LOCK_TRAILING, 'Shore Refuge')[0]).toMatchObject({
      kind: 'grant_static_ability',
      duration: 'until_next_turn',
      effectText: ["can't be attacked except by creatures with flying and/or islandwalk"],
    });
  });

  it('does not parse idle Island Sanctuary replacement text as a continuous lock grant', () => {
    const grants = collectGrantSteps(ISLAND_SANCTUARY_ORACLE, 'Island Sanctuary');
    expect(grants.some((step) => {
      const text = Array.isArray((step as { effectText?: string[] }).effectText)
        ? String((step as { effectText?: string[] }).effectText?.[0] || '')
        : '';
      return text.toLowerCase().includes("can't be attacked except");
    })).toBe(false);
  });

  it('stamps lastingEffects.attackYouProhibitedExceptKeywords for the controller', () => {
    const result = applyGrants(LOCK_LEADING, 'Shore Refuge');
    expect(result.appliedSteps.map((step) => step.kind)).toContain('grant_static_ability');
    expect((result.state as any).lastingEffects).toEqual([
      expect.objectContaining({
        type: 'attackYouProhibitedExceptKeywords',
        duration: 'until_next_turn',
        targetPlayer: 'p1',
        keywords: ['flying', 'islandwalk'],
        source: 'Shore Refuge',
        controllerId: 'p1',
        turnApplied: 4,
      }),
    ]);
  });
});
