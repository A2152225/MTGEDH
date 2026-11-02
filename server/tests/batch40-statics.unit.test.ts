import { describe, expect, it } from 'vitest';
import { parseEchoNonManaCost } from '../src/state/modules/echoNonManaCost';
import { payableAlternativeCostOptions } from '../src/state/modules/alternativeCostOptions';
import { buildSacrificeTargetSelectionOptions } from '../../rules-engine/src/oracleIRExecutorBattlefieldSacrificeWhat';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor';
import { handleUpkeepSacrificeResponse } from '../src/socket/resolution-handlers/upkeepSacrificeResponseHandlers';

const TAJURU = "Spells and abilities your opponents control can't cause you to sacrifice permanents.";
const bear = (id: string, controller: string) => ({ id, controller, owner: controller, type_line: 'Creature - Bear', card: { name: id, type_line: 'Creature - Bear', oracle_text: '' } });
const preserver = (controller: string) => ({ id: 'taj', controller, owner: controller, type_line: 'Creature - Elf Shaman', card: { name: 'Tajuru Preserver', type_line: 'Creature - Elf Shaman', oracle_text: TAJURU } });
const noopIo: any = { to: () => ({ emit: () => {} }), emit: () => {} };

describe('B40 echo with a non-mana cost', () => {
  it('parses Echo\u2014Discard a card and Echo\u2014Pay N life', () => {
    expect(parseEchoNonManaCost('Flying, haste\nEcho\u2014Discard a card.')).toEqual({ cost: { kind: 'discard' }, label: 'Discard a card' });
    expect(parseEchoNonManaCost('Echo\u2014Pay 3 life.')).toEqual({ cost: { kind: 'life', amount: 3 }, label: 'Pay 3 life' });
    expect(parseEchoNonManaCost('Discard a card or sacrifice')?.cost.kind).toBe('discard');
    expect(parseEchoNonManaCost('Echo {3}{W}{W}')).toBeNull();
  });
});

describe('B40 alternative-cost affordability', () => {
  const state = (hand: any[]) => ({ battlefield: [], zones: { p1: { hand } }, life: { p1: 2 }, players: [{ id: 'p1', life: 2 }], manaPool: {} });
  it('offers only payable options', () => {
    expect(payableAlternativeCostOptions(state([]), 'p1', ['{3}', 'Discard a card'], [], () => false)).toEqual([]);
    expect(payableAlternativeCostOptions(state([{ id: 'c1', name: 'Opt' }]), 'p1', ['{3}', 'Discard a card'], [], () => false)).toEqual(['Discard a card']);
    expect(payableAlternativeCostOptions(state([]), 'p1', ['Pay 3 life', 'Pay 1 life'])).toEqual(['Pay 1 life']);
    expect(payableAlternativeCostOptions(state([]), 'p1', ['Sacrifice a creature', 'Pay 1 life'])).toEqual(['Pay 1 life']);
  });
});

describe('B40 Tajuru Preserver remaining sacrifice paths', () => {
  it('IR sacrifice prompt options exclude a protected player', () => {
    const steps = parseOracleTextToIR('Each opponent sacrifices a creature.', 'B40').abilities.flatMap((a: any) => a.steps || []);
    const step: any = steps.find((s: any) => s.kind === 'sacrifice');
    expect(step).toBeDefined();
    const state: any = {
      players: ['p1', 'p2', 'p3'].map((id) => ({ id, name: id })),
      battlefield: [bear('src', 'p1'), bear('p2-bear', 'p2'), preserver('p2'), bear('p3-bear', 'p3')],
    };
    const res = buildSacrificeTargetSelectionOptions(state, step, buildOracleIRExecutionContext({ controllerId: 'p1' as any, sourceId: 'src' }));
    const ids = (res?.options || []).map((o) => o.id);
    expect(ids).not.toContain('p2-bear');
    expect(ids).not.toContain('taj');
    expect(state.battlefield).toHaveLength(4);
  });
  it('upkeep sacrifice response ignores an opponent-caused sacrifice for a protected player', () => {
    const game: any = { state: { battlefield: [bear('p2-bear', 'p2'), preserver('p2')], players: [{ id: 'p1' }, { id: 'p2' }] } };
    const step: any = { id: 's1', type: 'upkeep_sacrifice', playerId: 'p2', sourceName: 'Edict', sourceController: 'p1', allowSourceSacrifice: false, creatures: [{ id: 'p2-bear' }] };
    handleUpkeepSacrificeResponse(noopIo, game, 'b40-upkeep', step, { stepId: 's1', playerId: 'p2', selections: 'p2-bear' } as any);
    expect(game.state.battlefield.map((p: any) => p.id)).toContain('p2-bear');
  });
});
