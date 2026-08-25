import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { GameState } from '../../shared/src/index.js';

// Quoted from mtg_data.db cards.text WHERE is_token = 0.
const DETECTION_TOWER_ORACLE =
  "{T}: Add {C}.\n{1}, {T}: Until end of turn, your opponents and creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.";
const ARCANE_LIGHTHOUSE_ORACLE =
  "{T}: Add {C}.\n{1}, {T}: Until end of turn, creatures your opponents control lose hexproof and shroud and can't have hexproof or shroud.";
const DETECTION_TOWER_EFFECT =
  "Until end of turn, your opponents and creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.";
const ARCANE_LIGHTHOUSE_EFFECT =
  "Until end of turn, creatures your opponents control lose hexproof and shroud and can't have hexproof or shroud.";
const GLARING_SPOTLIGHT_ORACLE =
  "Creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.\n{3}, Sacrifice this artifact: Creatures you control gain hexproof until end of turn and can't be blocked this turn.";
const NOWHERE_TO_RUN_ORACLE =
  "Flash\nWhen this enchantment enters, target creature an opponent controls gets -3/-3 until end of turn.\nCreatures your opponents control can be the targets of spells and abilities as though they didn't have hexproof. Ward abilities of those creatures don't trigger.";
const KAYA_BANE_ORACLE =
  "Your opponents and permanents your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.\n[−3]: Exile target creature.";

const MARKER = 'until-eot-protection-override';

function collectOverrideSteps(text: string, name: string) {
  const ir = parseOracleTextToIR(text, name);
  return (ir.abilities || []).flatMap((ability) => ability.steps || [])
    .filter((step) => {
      if (step.kind !== 'grant_static_ability') return false;
      const tokens = Array.isArray((step as { effectText?: string[] }).effectText)
        ? (step as { effectText: string[] }).effectText
        : [];
      return tokens.some((token) => String(token || '').toLowerCase() === MARKER);
    });
}

function makeState(): GameState {
  return {
    id: 'until-eot-protection-override',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] },
      { id: 'p3', name: 'P3', seat: 2, life: 40, library: [], hand: [], graveyard: [] },
    ],
    battlefield: [],
    stack: [],
    turnPlayer: 'p1',
    priority: 'p1',
    active: true,
  } as unknown as GameState;
}

function applyOverride(text: string, sourceName: string) {
  return applyOracleIRStepsToGameState(
    makeState(),
    collectOverrideSteps(text, sourceName),
    buildOracleIRExecutionContext({
      controllerId: 'p1',
      sourceId: 'land_1',
      sourceName,
      sourceObjectType: 'permanent',
    } as any),
  );
}

describe('until-EOT protection override oracle IR', () => {
  it('parses Detection Tower activation as asThoughController grant duration end_of_turn', () => {
    const steps = collectOverrideSteps(DETECTION_TOWER_ORACLE, 'Detection Tower');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual(expect.objectContaining({
      kind: 'grant_static_ability',
      duration: 'end_of_turn',
      effectText: expect.arrayContaining([
        MARKER,
        'asThoughController',
        'scope:opponent_creatures',
        'scope:player_opponents',
        'ability:hexproof',
      ]),
    }));
    expect(collectOverrideSteps(DETECTION_TOWER_EFFECT, 'Detection Tower')).toHaveLength(1);
  });

  it('parses Arcane Lighthouse activation as true lose hexproof and shroud', () => {
    const steps = collectOverrideSteps(ARCANE_LIGHTHOUSE_ORACLE, 'Arcane Lighthouse');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual(expect.objectContaining({
      kind: 'grant_static_ability',
      duration: 'end_of_turn',
      effectText: expect.arrayContaining([
        MARKER,
        'remove',
        'scope:opponent_creatures',
        'ability:hexproof',
        'ability:shroud',
      ]),
    }));
    expect(collectOverrideSteps(ARCANE_LIGHTHOUSE_EFFECT, 'Arcane Lighthouse')).toHaveLength(1);
  });

  it('does not steal Glaring Spotlight grant-hexproof or continuous as-though statics', () => {
    expect(collectOverrideSteps(GLARING_SPOTLIGHT_ORACLE, 'Glaring Spotlight')).toEqual([]);
    expect(collectOverrideSteps(NOWHERE_TO_RUN_ORACLE, 'Nowhere to Run')).toEqual([]);
    expect(collectOverrideSteps(KAYA_BANE_ORACLE, 'Kaya, Bane of the Dead')).toEqual([]);
  });

  it('stamps lastingEffects protectionKeywordOverride for Detection Tower', () => {
    const result = applyOverride(DETECTION_TOWER_ORACLE, 'Detection Tower');
    expect((result.state as any).lastingEffects).toEqual([
      expect.objectContaining({
        type: 'protectionKeywordOverride',
        duration: 'end_of_turn',
        sourceController: 'p1',
        mode: 'asThoughController',
        abilities: ['hexproof'],
        scopes: expect.arrayContaining(['opponent_creatures', 'player_opponents']),
      }),
    ]);
  });

  it('stamps lastingEffects protectionKeywordOverride for Arcane Lighthouse', () => {
    const result = applyOverride(ARCANE_LIGHTHOUSE_ORACLE, 'Arcane Lighthouse');
    expect((result.state as any).lastingEffects).toEqual([
      expect.objectContaining({
        type: 'protectionKeywordOverride',
        duration: 'end_of_turn',
        sourceController: 'p1',
        mode: 'remove',
        abilities: expect.arrayContaining(['hexproof', 'shroud']),
        scopes: ['opponent_creatures'],
      }),
    ]);
  });
});
