import { describe, expect, it } from 'vitest';
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec.js';
import { getIllegalDefendingPlayerRestriction, parseSelfCombatRestrictions } from '../../rules-engine/src/attackRestrictionText.js';

// B52 long-tail statics: Indomitable Archangel (trailing metalcraft condition), Curse of Hospitality, Xantcha.
const cr = (id: string, controller: string, oracle: string, extra: any = {}) => ({
  id, controller, owner: controller, tapped: false,
  card: { id: `${id}c`, name: extra.name || id, type_line: extra.type_line || 'Creature - Test', oracle_text: oracle, power: '2', toughness: '3' },
  ...extra,
});
const base = (battlefield: any[]): any => ({ players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], battlefield, turnPlayer: 'p1', phase: 'main1', zones: {} });
const grants = (state: any, perm: any) => getContinuousGrantedAbilitiesForPermanent(perm, state).map((a: any) => String(a).toLowerCase());

describe('B52 Indomitable Archangel', () => {
  const arch = cr('ia', 'p1', 'Flying\nMetalcraft \u2014 Artifacts you control have shroud as long as you control three or more artifacts.', { name: 'Indomitable Archangel' });
  const arts = [1, 2, 3].map(i => cr('a' + i, 'p1', '', { type_line: 'Artifact' }));
  it('grants shroud to artifacts with three artifacts', () => {
    expect(grants(base([arch, ...arts]), arts[0])).toContain('shroud');
  });
  it('no shroud with two artifacts, and never to non-artifact creatures', () => {
    expect(grants(base([arch, ...arts.slice(0, 2)]), arts[0])).not.toContain('shroud');
    expect(grants(base([arch, ...arts]), arch)).not.toContain('shroud');
  });
});

describe('B52 Curse of Hospitality', () => {
  it('grants trample only to creatures attacking the enchanted player', () => {
    const curse = cr('ch', 'p1', 'Enchant player\nCreatures attacking enchanted player have trample and "Whenever this creature deals combat damage to a player, that player exiles the top card of their library. Until end of turn, you may play that card."', { name: 'Curse of Hospitality', type_line: 'Enchantment - Aura Curse', attachedTo: 'p2', enchantedPlayerId: 'p2' });
    const atk = cr('x', 'p3', '', { attacking: 'p2' });
    const other = cr('y', 'p1', '', { attacking: 'p3' });
    const idle = cr('z', 'p3', '');
    const s = base([curse, atk, other, idle]);
    expect(grants(s, atk)).toContain('trample');
    expect(grants(s, other)).not.toContain('trample');
    expect(grants(s, idle)).not.toContain('trample');
  });
});

describe('B52 Xantcha (verified)', () => {
  const x = "Xantcha, Sleeper Agent enters under the control of an opponent of your choice.\nXantcha attacks each combat if able and can't attack its owner or planeswalkers its owner controls.";
  it('must attack, cannot attack owner or owner planeswalkers', () => {
    const r = parseSelfCombatRestrictions(x);
    expect(r.mustAttackEachCombat).toBe(true);
    expect(getIllegalDefendingPlayerRestriction({ oracleText: x, ownerId: 'p1', controllerId: 'p2', defendingPlayerId: 'p1' }).illegal).toBe(true);
    expect(getIllegalDefendingPlayerRestriction({ oracleText: x, ownerId: 'p1', controllerId: 'p2', defendingPlayerId: 'p1', targetIsOwnerPlaneswalker: true }).illegal).toBe(true);
    expect(getIllegalDefendingPlayerRestriction({ oracleText: x, ownerId: 'p1', controllerId: 'p2', defendingPlayerId: 'p3' }).illegal).toBe(false);
  });
});
