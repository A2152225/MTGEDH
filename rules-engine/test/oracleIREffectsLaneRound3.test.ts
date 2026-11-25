import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

const FENLURKER = "When this creature enters, each opponent exiles a card from their hand.\n{2}{B}: This creature gets +1/+1 until end of turn.";
const LICID = '{U}, {T}: Gliding Licid loses this ability and becomes an Aura enchantment with enchant creature. Attach it to target creature. You may pay {U} to end this effect.\nEnchanted creature has flying.';

function card(id: string, name: string) {
  return { id, name, type_line: 'Instant', mana_cost: '{1}', oracle_text: '' };
}

function perm(id: string, controller: PlayerID, name: string, typeLine: string) {
  return {
    id, controller, owner: controller, tapped: false, counters: {}, basePower: 2, baseToughness: 2,
    card: { id: `${id}_card`, name, type_line: typeLine, power: '2', toughness: '2', oracle_text: '' },
  };
}

function board(p2Hand: any[]): GameState {
  return {
    players: [
      { id: p1, name: 'P1', life: 40, hand: [card('mine', 'Mine')], graveyard: [], library: [], exile: [] },
      { id: p2, name: 'P2', life: 40, hand: p2Hand, graveyard: [], library: [], exile: [] },
    ],
    battlefield: [perm('licid', p1, 'Gliding Licid', 'Creature \u2014 Licid'), perm('bear', p1, 'Grizzly Bears', 'Creature \u2014 Bear')],
    stack: [],
  } as any;
}

function abilitySteps(text: string, name: string, type: string) {
  const ir = parseOracleTextToIR(text, name);
  return (ir.abilities || []).filter((ability: any) => ability.type === type).flatMap((ability: any) => ability.steps || []) as any[];
}

describe('effects lane round 3: hand exile choice (Yarok\'s Fenlurker)', () => {
  it('parses "each opponent exiles a card from their hand" as a discard-style choice with destination exile', () => {
    const [step] = abilitySteps(FENLURKER, "Yarok's Fenlurker", 'triggered');
    expect(step).toMatchObject({ kind: 'discard', who: { kind: 'each_opponent' }, amount: { kind: 'number', value: 1 }, destination: 'exile' });
  });

  it('exiles the lone card (not to the graveyard) and leaves the controller untouched', () => {
    const steps = abilitySteps(FENLURKER, "Yarok's Fenlurker", 'triggered');
    const result: any = applyOracleIRStepsToGameState(board([card('only', 'Only')]), steps, { controllerId: p1, sourceId: 'fen', sourceName: "Yarok's Fenlurker" } as any);
    const opp = result.state.players.find((p: any) => p.id === p2);
    expect(opp.hand).toHaveLength(0);
    expect(opp.exile.map((c: any) => c.id)).toEqual(['only']);
    expect(opp.graveyard).toHaveLength(0);
    expect(result.state.players.find((p: any) => p.id === p1).hand).toHaveLength(1);
  });

  it('waits on the player\'s choice with two cards, then exiles the chosen one', () => {
    const steps = abilitySteps(FENLURKER, "Yarok's Fenlurker", 'triggered');
    const hand = [card('a', 'A'), card('b', 'B')];
    const pending: any = applyOracleIRStepsToGameState(board(hand), steps, { controllerId: p1, sourceId: 'fen', sourceName: "Yarok's Fenlurker" } as any);
    expect(pending.state.players.find((p: any) => p.id === p2).hand).toHaveLength(2);
    expect((pending.automationGaps || []).some((gap: any) => gap.stepKind === 'discard')).toBe(true);

    const chosen: any = applyOracleIRStepsToGameState(board(hand), steps, {
      controllerId: p1, sourceId: 'fen', sourceName: "Yarok's Fenlurker", selectorContext: { chosenObjectIds: ['b'] },
    } as any);
    const opp = chosen.state.players.find((p: any) => p.id === p2);
    expect(opp.hand.map((c: any) => c.id)).toEqual(['a']);
    expect(opp.exile.map((c: any) => c.id)).toEqual(['b']);
  });

  it('does nothing to an empty hand', () => {
    const steps = abilitySteps(FENLURKER, "Yarok's Fenlurker", 'triggered');
    const result: any = applyOracleIRStepsToGameState(board([]), steps, { controllerId: p1, sourceId: 'fen', sourceName: "Yarok's Fenlurker" } as any);
    expect(result.state.players.find((p: any) => p.id === p2).exile).toHaveLength(0);
  });
});

describe('effects lane round 3: Licid becomes an Aura', () => {
  it('folds "Attach it to target creature. You may pay {U} to end this effect." into the become_aura activation', () => {
    const ir = parseOracleTextToIR(LICID, 'Gliding Licid');
    expect((ir.abilities || []).some((ability: any) => ability.type === 'spell')).toBe(false);
    const [step] = abilitySteps(LICID, 'Gliding Licid', 'activated');
    expect(step).toMatchObject({ kind: 'become_aura', enchant: { kind: 'raw', text: 'target creature' }, endEffectCost: '{U}' });
  });

  it('turns the Licid into a non-creature Aura attached to the chosen creature', () => {
    const steps = abilitySteps(LICID, 'Gliding Licid', 'activated');
    const result: any = applyOracleIRStepsToGameState(board([]), steps, {
      controllerId: p1, sourceId: 'licid', sourceName: 'Gliding Licid', targetPermanentId: 'bear', selectorContext: { chosenObjectIds: ['bear'] },
    } as any);
    const licid = result.state.battlefield.find((p: any) => p.id === 'licid');
    const bear = result.state.battlefield.find((p: any) => p.id === 'bear');
    expect(licid).toMatchObject({ attachedTo: 'bear', isAura: true, type_line: 'Enchantment \u2014 Aura', auraEndEffectCost: '{U}' });
    expect(licid.card.type_line).not.toMatch(/creature/i);
    expect(bear.attachments).toContain('licid');
  });
});
