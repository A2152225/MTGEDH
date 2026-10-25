import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { GamePhase, GameStep } from '../../shared/src/index.js';
import type { PlayerID } from '../../shared/src';
import { parseMassGainControl, parseTargetedGainControl } from '../src/state/modules/gainControlOraclePatterns.js';
import { stampPermanentEntryTimestamp } from '../../rules-engine/src/permanentTimestamps.js';

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;
const emptyZone = () => ({ hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 });

const TEXT = {
  threaten: 'Untap target creature and gain control of it until end of turn. That creature gains haste until end of turn. (It can attack and {T} this turn.)',
  traitorous: 'Until end of turn, you gain control of target creature, untap it, and it gets +2/+0 and gains haste.',
  besmirch: "Until end of turn, gain control of target creature and it gains haste. Untap that creature. Goad it.",
  mobRuleBig: 'Gain control of all creatures with power 4 or greater until end of turn. Untap those creatures. They gain haste until end of turn.',
  mobRuleSmall: 'Gain control of all creatures with power 3 or less until end of turn. Untap those creatures. They gain haste until end of turn.',
};

function setup(id: string) {
  const g = createInitialGameState(id);
  const s: any = g.state;
  s.players = [p1, p2].map((pid) => ({ id: pid, name: pid, spectator: false, life: 40 }));
  s.turnOrder = [p1, p2]; s.turnPlayer = p1; s.activePlayer = p1; s.stack = [];
  s.zones = { [p1]: emptyZone(), [p2]: emptyZone() };
  s.battlefield = [];
  return g;
}
function creature(g: any, id: string, power: number) {
  const perm: any = { id, owner: p2, controller: p2, tapped: true, counters: {},
    card: { id: id + '_c', name: id, type_line: 'Creature \u2014 Beast', power: String(power), toughness: '4', oracle_text: '', zone: 'battlefield' } };
  g.state.battlefield.push(perm);
  stampPermanentEntryTimestamp(g.state, perm);
  return perm;
}
function cast(g: any, name: string, oracle: string, targets: string[] = []) {
  g.state.stack = [{ id: 'stk_' + name, type: 'spell', controller: p1, targets,
    card: { id: name + '_card', name, type_line: 'Sorcery', mana_cost: '{3}{R}', oracle_text: oracle } }];
  g.resolveTopOfStack();
}
function cleanup(g: any) {
  g.state.phase = GamePhase.ENDING; g.state.step = GameStep.CLEANUP;
  g.applyEvent({ type: 'nextStep' } as any);
}

describe('gain control oracle patterns', () => {
  it('parses the targeted and mass templates', () => {
    expect(parseTargetedGainControl(TEXT.threaten)).toEqual({ temporary: true, noun: 'creature' });
    expect(parseTargetedGainControl(TEXT.traitorous)?.temporary).toBe(true);
    expect(parseTargetedGainControl(TEXT.besmirch)?.temporary).toBe(true);
    expect(parseTargetedGainControl('Gain control of target creature.')).toEqual({ temporary: false, noun: 'creature' });
    expect(parseTargetedGainControl(TEXT.mobRuleBig)).toBeNull();
    expect(parseTargetedGainControl('Exchange control of two target creatures.')).toBeNull();
    expect(parseMassGainControl(TEXT.mobRuleBig)).toEqual({ temporary: true, minPower: 4 });
    expect(parseMassGainControl(TEXT.mobRuleSmall)).toEqual({ temporary: true, maxPower: 3 });
    expect(parseMassGainControl(TEXT.threaten)).toBeNull();
  });

  for (const [name, oracle] of [['Threaten', TEXT.threaten], ['Traitorous Instinct', TEXT.traitorous], ['Besmirch', TEXT.besmirch]] as const) {
    it(name + ' (real Oracle text) steals through the registry until end of turn', () => {
      const g = setup('t_gc_' + name);
      const bear = creature(g, 'bear', 2);
      cast(g, name, oracle, ['bear']);
      const live: any = g.state.battlefield.find((p: any) => p.id === 'bear');
      expect(live.controller).toBe(p1);
      expect(live.tapped).toBe(false);
      const entry = ((g.state as any).controlChangeEffects || []).find((e: any) => e.permanentId === 'bear');
      expect(entry?.newController).toBe(p1);
      expect(typeof entry?.ceTimestamp).toBe('number');
      cleanup(g);
      expect(g.state.battlefield.find((p: any) => p.id === 'bear')?.controller).toBe(p2);
    });
  }

  it('Mob Rule power 4 or greater / 3 or less picks the right creatures', () => {
    for (const [oracle, stolen] of [[TEXT.mobRuleBig, 'big'], [TEXT.mobRuleSmall, 'small']] as const) {
      const g = setup('t_gc_mob_' + stolen);
      creature(g, 'big', 5);
      creature(g, 'small', 2);
      cast(g, 'Mob Rule', oracle);
      const live = (id: string) => g.state.battlefield.find((p: any) => p.id === id) as any;
      expect(live('big').controller).toBe(stolen === 'big' ? p1 : p2);
      expect(live('small').controller).toBe(stolen === 'small' ? p1 : p2);
      expect(live(stolen).tapped).toBe(false);
      expect(typeof ((g.state as any).controlChangeEffects || []).find((e: any) => e.permanentId === stolen)?.ceTimestamp).toBe('number');
      cleanup(g);
      expect(g.state.battlefield.every((p: any) => p.controller === p2)).toBe(true);
    }
  });
});
