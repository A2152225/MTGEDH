import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { isSingleTargetDamagePhrase } from '../src/oracleIRExecutorDamageBoundTargetFallback';
import { getMarkedDamage } from '../../shared/src/markedDamage.js';

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

function stepsFor(text: string) {
  const ir = parseOracleTextToIR(text, 'Test Source');
  return (ir.abilities || []).flatMap((ability) => ability.steps || []) as any[];
}

function perm(id: string, controller: PlayerID, name: string, typeLine: string, power?: number, toughness?: number, extra: any = {}) {
  return {
    id, controller, owner: controller, tapped: false, counters: {}, basePower: power, baseToughness: toughness, ...extra,
    card: {
      id: `${id}_card`, name, type_line: typeLine,
      power: power === undefined ? undefined : String(power), toughness: toughness === undefined ? undefined : String(toughness),
      colors: extra.colors || [], mana_cost: extra.mana_cost || '{2}', oracle_text: '',
    },
  };
}

function board(extra: any[] = [], stateExtra: any = {}): GameState {
  return {
    players: [
      { id: p1, name: 'P1', life: 40, hand: [], graveyard: [], library: [], exile: [] },
      { id: p2, name: 'P2', life: 40, hand: [], graveyard: [], library: [], exile: [] },
    ],
    life: { [p1]: 40, [p2]: 40 },
    battlefield: [
      perm('bear', p1, 'Grizzly Bears', 'Creature — Bear', 2, 2, { colors: ['G'] }),
      perm('giant', p2, 'Hill Giant', 'Creature — Giant', 3, 3, { colors: ['R'], mana_cost: '{3}{R}' }),
      perm('wurm', p2, 'Craw Wurm', 'Creature — Wurm', 6, 4, { colors: ['G'] }),
      ...extra,
    ],
    stack: [],
    ...stateExtra,
  } as unknown as GameState;
}

function run(state: GameState, text: string, ctx: Record<string, unknown>) {
  const base = buildOracleIRExecutionContext({ controllerId: p1, sourceName: 'Test Source', ...ctx } as any);
  return applyOracleIRStepsToGameState(state, stepsFor(text) as any, base as any, { allowOptional: true } as any) as any;
}

const find = (state: any, id: string) => (state.battlefield || []).find((p: any) => p.id === id);

describe('revealed-hand discard ("you choose a nonland card from it")', () => {
  const text = 'Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.';

  it('parses into one discard step chosen by you from the revealed hand', () => {
    const discard = stepsFor(text).find((s) => s.kind === 'discard');
    expect(discard).toMatchObject({ revealedHandChoice: true, chooser: { kind: 'you' }, target: { kind: 'raw', text: 'nonland card' } });
    expect(stepsFor(text).some((s) => s.kind === 'choose_card_name')).toBe(false);
  });

  it('discards the only eligible card from the target player\'s hand', () => {
    const state: any = board();
    state.players[1].hand = [
      { id: 'h_land', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'h_bolt', name: 'Lightning Bolt', type_line: 'Instant' },
    ];
    const result = run(state, text, { sourceId: 'spell1', targetPlayerId: p2, targetOpponentId: p2 });
    const p2After = result.state.players.find((p: any) => p.id === p2);
    expect(p2After.hand.map((c: any) => c.id)).toEqual(['h_land']);
    expect(p2After.graveyard.map((c: any) => c.id)).toContain('h_bolt');
  });
});

describe('single-target damage never spreads to every matching permanent', () => {
  it('recognises single-target phrases', () => {
    expect(isSingleTargetDamagePhrase('target creature or planeswalker')).toBe(true);
    expect(isSingleTargetDamagePhrase('each creature and each player')).toBe(false);
  });

  it('damages only the bound creature', () => {
    const result = run(board(), 'This spell deals 3 damage to target creature or planeswalker.', { sourceId: 'spell1', targetCreatureId: 'giant', targetPermanentId: 'giant' });
    expect(Number(find(result.state, 'giant')?.damageMarked || 0)).toBe(3);
    expect(Number(find(result.state, 'wurm')?.damageMarked || 0)).toBe(0);
  });
});

describe('where-X amounts', () => {
  it('counts other spells cast this turn from the live spellsCastThisTurn list (Thunder Salvo)', () => {
    const state = board([], { spellsCastThisTurn: [{ casterId: 'p1' }, { casterId: 'p1' }, { casterId: 'p2' }, { casterId: 'p1' }] });
    const result = run(state, "This spell deals X damage to target creature, where X is 2 plus the number of other spells you've cast this turn.", {
      sourceId: 'spell1', sourceObjectType: 'spell', targetCreatureId: 'giant', targetPermanentId: 'giant',
    });
    expect(Number(find(result.state, 'giant')?.damageMarked || 0)).toBe(4);
  });

  it('reads "its mana value" from the targeted creature (Great Defender)', () => {
    const result = run(board(), 'Target creature gets +0/+X until end of turn, where X is its mana value.', {
      sourceId: 'spell1', sourceObjectType: 'spell', targetCreatureId: 'giant', targetPermanentId: 'giant',
    });
    expect(result.skippedSteps || []).toHaveLength(0);
    expect(JSON.stringify(find(result.state, 'giant'))).toContain('"toughness":4');
  });
});

describe('Keyrune animation', () => {
  const text = 'This artifact becomes a 2/2 black and green Insect artifact creature with deathtouch until end of turn.';

  it('parses colors, keywords and the until-end-of-turn duration', () => {
    const step = stepsFor(text).find((s) => s.kind === 'animate_permanent');
    expect(step).toMatchObject({ colors: ['B', 'G'], abilities: ['deathtouch'], duration: 'end_of_turn', power: 2, toughness: 2 });
    expect(step.addTypes).toEqual(['Insect', 'artifact', 'creature']);
  });

  it('animates the source and records what to restore at cleanup', () => {
    const state = board([perm('keyrune', p1, 'Golgari Keyrune', 'Artifact')]);
    const result = run(state, text, { sourceId: 'keyrune', sourceObjectType: 'permanent' });
    const keyrune = find(result.state, 'keyrune');
    expect(keyrune.colors).toEqual(['B', 'G']);
    expect(keyrune.power).toBe(2);
    const effect = (keyrune.temporaryEffects || []).find((e: any) => e.animateRevert);
    expect(effect?.animateRevert?.card?.type_line).toBe('Artifact');
    expect(effect?.grantedAbilities).toEqual(['deathtouch']);
  });
});

describe('group antecedents and counter moves', () => {
  it('"Untap all creatures you control. They gain ..." grants to that group (Join Shields)', () => {
    const state = board([perm('elf', p1, 'Llanowar Elves', 'Creature — Elf', 1, 1, { tapped: true })]);
    const result = run(state, 'Untap all creatures you control. They gain hexproof and indestructible until end of turn.', { sourceId: 'spell1' });
    for (const id of ['bear', 'elf']) {
      expect(JSON.stringify(find(result.state, id)?.temporaryEffects || [])).toContain('hexproof');
    }
    expect(find(result.state, 'giant')?.temporaryEffects).toBeUndefined();
  });

  it('moves any number of counters from the first target to the second (Bioshift)', () => {
    const state = board([perm('elf', p1, 'Llanowar Elves', 'Creature — Elf', 1, 1, { counters: { '+1/+1': 3 } })]);
    const result = run(state, 'Move any number of +1/+1 counters from target creature onto another target creature with the same controller.', {
      sourceId: 'spell1', selectorContext: { chosenObjectIds: ['elf', 'bear'] }, chosenObjectIds: ['elf', 'bear'], targetCreatureId: 'elf',
    });
    expect(find(result.state, 'elf')?.counters?.['+1/+1'] ?? 0).toBe(0);
    expect(find(result.state, 'bear')?.counters?.['+1/+1']).toBe(3);
  });
});

describe('modal spells whose bullets are only targets', () => {
  it('applies the shared sentence to each bullet (Call Damage Control)', () => {
    const text = 'Choose up to two. Return those cards from your graveyard to your hand.\n• Target artifact card.\n• Target creature card.\n• Target enchantment card.\n• Target land card.';
    const modal = stepsFor(text).find((s) => s.kind === 'choose_mode');
    expect(modal).toMatchObject({ minModes: 0, maxModes: 2 });
    expect(modal.modes).toHaveLength(4);
    expect(modal.modes[1].steps[0]).toMatchObject({ kind: 'move_zone', to: 'hand', what: { text: 'target creature card from your graveyard' } });
  });
});

describe('sentence-level Then after a spell If clause', () => {
  const brawl = "Choose target creature you control and target creature you don't control. If you control three or more snow permanents, the creature you control gets +1/+0 and gains indestructible until end of turn. Then those creatures fight each other.";

  it('keeps Blizzard Brawl\'s fight outside the snow conditional', () => {
    const steps = stepsFor(brawl);
    const fight = steps.find((s) => /fight each other/i.test(String(s.raw || '')));
    expect(fight).toBeTruthy();
    expect(fight.kind).toBe('deal_damage');
    for (const s of steps.filter((x) => x.kind === 'conditional')) {
      expect(JSON.stringify(s)).not.toMatch(/fight/i);
    }
  });

  it('fights without three snow permanents', () => {
    const result = run(board(), brawl, { selectorContext: { chosenObjectIds: ['bear', 'giant'] } });
    const byId = (id: string) => ((result.state as any).battlefield || []).find((p: any) => p.id === id);
    expect(getMarkedDamage(byId('giant'))).toBe(2);
    expect(getMarkedDamage(byId('bear'))).toBe(3);
  });

  it('keeps a same-sentence ", then" inside the If clause', () => {
    const steps = stepsFor("If the result is equal to this Vehicle's mana value, sacrifice this Vehicle, then it deals that much damage to any target.");
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('conditional');
    expect(steps[0].steps.map((s: any) => s.kind)).toEqual(['sacrifice', 'deal_damage']);
  });
});

describe('targeted destroy never retargets', () => {
  it('destroys nothing when the bound target is not a Vehicle (Crash and Burn mode 1)', () => {
    const state = board([perm('cart', p2, 'Smuggler\'s Copter', 'Artifact — Vehicle', 3, 3)]);
    const result = run(state, 'Destroy target Vehicle.', { targetPermanentId: 'giant' });
    const ids = ((result.state as any).battlefield || []).map((p: any) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['bear', 'giant', 'wurm', 'cart']));
    expect(result.skippedSteps).toHaveLength(0);
  });

  it('still destroys the chosen Vehicle', () => {
    const state = board([perm('cart', p2, 'Smuggler\'s Copter', 'Artifact — Vehicle', 3, 3)]);
    const result = run(state, 'Destroy target Vehicle.', { targetPermanentId: 'cart' });
    const ids = ((result.state as any).battlefield || []).map((p: any) => p.id);
    expect(ids).not.toContain('cart');
    expect(ids).toEqual(expect.arrayContaining(['bear', 'giant', 'wurm']));
  });
});
