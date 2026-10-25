import { afterEach, describe, expect, it } from 'vitest';
import { applyOptionalDrawStepSkipLifeToState } from '../../rules-engine/src/optionalDrawStepSkipLife.js';
import { registerLifeGainAmountResolver } from '../../rules-engine/src/lifeGainReplacementHook.js';
import { checkEvasionAbilities } from '../../rules-engine/src/actions/combat-handlers/combatLegalityHelpers.js';
import { canBlockAttacker } from '../src/socket/combat-handlers/combatLegalityGates.js';
import { untapPermanentsForPlayer } from '../src/state/modules/turn-handlers/turnUntapPermanents.js';
import { getUntapStepLimits } from '../src/state/modules/untapStepLimits.js';

function perm(id: string, name: string, type: string, oracle: string, controller = 'p1', extra: any = {}): any {
  return { id, controller, owner: controller, tapped: false, counters: {}, ...extra, card: { id: id + '_c', name, type_line: type, oracle_text: oracle, keywords: extra.keywords || [], colors: extra.colors || [] } };
}
const untap = (battlefield: any[], pid = 'p1') => untapPermanentsForPlayer({ state: { battlefield, players: [{ id: 'p1' }, { id: 'p2' }] } } as any, pid);

describe('batch27 defender-controls unblockable (shared module) on both block paths', () => {
  const beebles = perm('bb', 'Bouncing Beebles', 'Creature - Beeble', "Bouncing Beebles can't be blocked as long as defending player controls an artifact.", 'p1', { attacking: 'p2' });
  const bear = perm('g', 'Bear', 'Creature - Bear', '', 'p2');
  const relic = perm('a', 'Relic', 'Artifact', '', 'p2');
  it('server canBlockAttacker', () => {
    expect(canBlockAttacker(bear, beebles, [beebles, bear], 'p2').canBlock).toBe(true);
    expect(canBlockAttacker(bear, beebles, [beebles, bear, relic], 'p2').canBlock).toBe(false);
  });
  it('rules-engine checkEvasionAbilities', () => {
    expect(checkEvasionAbilities(bear, beebles, [beebles, bear]).canParticipate).toBe(true);
    expect(checkEvasionAbilities(bear, beebles, [beebles, bear, relic]).canParticipate).toBe(false);
  });
});

describe('batch27 Fasting life through lifegain replacements', () => {
  afterEach(() => registerLifeGainAmountResolver(null));
  const mk = (): any => ({ turnNumber: 4, battlefield: [perm('fa', 'Fasting', 'Enchantment', 'you may skip that step instead. If you do, you gain 2 life.', 'p1', { optionalDrawStepSkipTurn: 4 })], players: [{ id: 'p1', life: 20 }], life: { p1: 20 } });
  it('doubles with a Rhox Faithmender-style resolver', () => {
    registerLifeGainAmountResolver((_s, _p, a) => a * 2);
    const r = applyOptionalDrawStepSkipLifeToState(mk(), 'p1');
    expect(r.gained).toBe(4);
    expect(r.state.players[0].life).toBe(24);
  });
  it('becomes a loss with a Tainted Remedy-style resolver and still marks the turn', () => {
    registerLifeGainAmountResolver((_s, _p, a) => -a);
    const r = applyOptionalDrawStepSkipLifeToState(mk(), 'p1');
    expect(r.state.players[0].life).toBe(18);
    expect(applyOptionalDrawStepSkipLifeToState(r.state, 'p1').gained).toBe(0);
  });
});

describe('batch27 untap restrictions', () => {
  it('Choke stops Islands only', () => {
    const choke = perm('ch', 'Choke', 'Enchantment', "Islands don't untap during their controllers' untap steps.", 'p2');
    const island = perm('i', 'Island', 'Basic Land - Island', '', 'p1', { tapped: true });
    const forest = perm('f', 'Forest', 'Basic Land - Forest', '', 'p1', { tapped: true });
    untap([choke, island, forest]);
    expect(island.tapped).toBe(true);
    expect(forest.tapped).toBe(false);
  });
  it('Magnetic Mountain stops blue creatures only', () => {
    const mm = perm('mm', 'Magnetic Mountain', 'Enchantment', "Blue creatures don't untap during their controllers' untap steps.", 'p2');
    const blue = perm('u', 'Merfolk', 'Creature - Merfolk', '', 'p1', { tapped: true, colors: ['U'] });
    const red = perm('r', 'Goblin', 'Creature - Goblin', '', 'p1', { tapped: true, colors: ['R'] });
    untap([mm, blue, red]);
    expect(blue.tapped).toBe(true);
    expect(red.tapped).toBe(false);
  });
  it('Imi Statue lets only one artifact untap; creatures are unaffected', () => {
    const imi = perm('im', 'Imi Statue', 'Artifact', "Players can't untap more than one artifact during their untap steps.", 'p2');
    const a1 = perm('a1', 'Rock', 'Artifact', '', 'p1', { tapped: true });
    const a2 = perm('a2', 'Ring', 'Artifact', '', 'p1', { tapped: true });
    const c = perm('c', 'Bear', 'Creature - Bear', '', 'p1', { tapped: true });
    untap([imi, a1, a2, c]);
    expect([a1.tapped, a2.tapped].filter((t) => !t).length).toBe(1);
    expect(c.tapped).toBe(false);
  });
  it('Winter Orb applies only while untapped; opponent-only caps spare the controller', () => {
    const orb = perm('wo', 'Winter Orb', 'Artifact', "As long as Winter Orb is untapped, players can't untap more than one land during their untap steps.", 'p2');
    expect(getUntapStepLimits({ battlefield: [orb] }, 'p1')).toEqual([{ kind: 'land', max: 1, sourceId: 'wo' }]);
    expect(getUntapStepLimits({ battlefield: [{ ...orb, tapped: true }] }, 'p1')).toEqual([]);
    const emblem = perm('e', 'Emblem', 'Emblem', "Your opponents can't untap more than two permanents during their untap steps.", 'p2');
    expect(getUntapStepLimits({ battlefield: [emblem] }, 'p2')).toEqual([]);
    expect(getUntapStepLimits({ battlefield: [emblem] }, 'p1')[0]?.max).toBe(2);
  });
});
