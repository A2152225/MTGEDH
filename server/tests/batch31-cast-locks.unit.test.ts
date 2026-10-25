import { describe, expect, it } from 'vitest';
import { enforceGraveyardSpellCastTiming } from '../src/socket/interaction-handlers/interactionGraveyardCastCostAndTimingRules.js';
import { opponentTurnCastProhibitionReason, zoneCastProhibitionReason } from '../src/state/modules/batch31CastLocks.js';
import { trimAssignmentsToMaximumBlockers } from '../src/socket/combat-handlers/combatBatch30BlockLimits.js';
import { artifactOrColorBlockOnlyReason } from '../src/socket/combat-handlers/combatBatch31BlockRestrictions.js';

function perm(id: string, name: string, type: string, oracle: string, controller = 'p1', extra: any = {}): any {
  return { id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', name, type_line: type, oracle_text: oracle, ...(extra.card || {}) } };
}
const TEFERI = perm('t', 'Teferi, Time Raveler', 'Legendary Planeswalker', 'Each opponent can cast spells only any time they could cast a sorcery.', 'p1');

describe('batch31 Teferi lock on graveyard casts (flashback etc.)', () => {
  const bolt = { id: 'fb', name: 'Fiery Temper', type_line: 'Instant', oracle_text: 'Flashback {R}' };
  const run = (battlefield: any[], playerId: string, extra: any = {}) => {
    const errors: any[] = [];
    const ok = enforceGraveyardSpellCastTiming({
      game: { state: { battlefield, turnPlayer: 'p1', phase: 'combat', step: 'DECLARE_ATTACKERS', stack: [], ...extra } },
      playerId, card: bolt, abilityId: 'flashback', emitError: (e) => errors.push(e),
    });
    return { ok, errors };
  };
  it('lets an instant flashback through without Teferi', () => {
    expect(run([], 'p2').ok).toBe(true);
  });
  it("blocks an opponent's instant flashback off-turn while Teferi is out", () => {
    const r = run([TEFERI], 'p2');
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe('SORCERY_TIMING');
  });
  it("does not restrict Teferi's controller", () => {
    expect(run([TEFERI], 'p1').ok).toBe(true);
  });
});

describe('batch31 zone cast locks (Grafdigger\'s Cage)', () => {
  const cage = perm('c', "Grafdigger's Cage", 'Artifact', "Creature cards in graveyards and libraries can't enter the battlefield.\nPlayers can't cast spells from graveyards or libraries.");
  it('blocks graveyard and library casts for every player', () => {
    const st = { battlefield: [cage] };
    expect(zoneCastProhibitionReason(st, 'p1', 'graveyard')).toMatch(/graveyards/);
    expect(zoneCastProhibitionReason(st, 'p2', 'library')).toMatch(/libraries/);
    expect(zoneCastProhibitionReason({ battlefield: [] }, 'p2', 'graveyard')).toBeNull();
  });
});

describe('batch31 Grand Abolisher turn lock', () => {
  const ga = perm('g', 'Grand Abolisher', 'Creature', "During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments.");
  it("locks opponents only during its controller's turn", () => {
    expect(opponentTurnCastProhibitionReason({ battlefield: [ga], turnPlayer: 'p1' }, 'p2')).toMatch(/Grand Abolisher/);
    expect(opponentTurnCastProhibitionReason({ battlefield: [ga], turnPlayer: 'p1' }, 'p1')).toBeNull();
    expect(opponentTurnCastProhibitionReason({ battlefield: [ga], turnPlayer: 'p2' }, 'p2')).toBeNull();
  });
});

describe('batch31 AI max-blocker trimming', () => {
  it('drops blockers beyond the cap and keeps other attackers intact', () => {
    const rhino = perm('a', 'Charging Rhino', 'Creature', "Charging Rhino can't be blocked by more than one creature.");
    const bear = perm('a2', 'Bear', 'Creature', '');
    const bf = [rhino, bear];
    const out = trimAssignmentsToMaximumBlockers(bf, [
      { attackerId: 'a', blockerId: 'b1' }, { attackerId: 'a', blockerId: 'b2' },
      { attackerId: 'a2', blockerId: 'b3' }, { attackerId: 'a2', blockerId: 'b4' },
    ]);
    expect(out.map((x) => x.blockerId)).toEqual(['b1', 'b3', 'b4']);
  });
});

describe('batch31 artifact-and/or-color block restriction', () => {
  const amrou = perm('a', 'Amrou Seekers', 'Creature', "Amrou Seekers can't be blocked except by artifact creatures and/or white creatures.");
  it('allows artifact or white blockers only', () => {
    expect(artifactOrColorBlockOnlyReason(perm('b', 'Bear', 'Creature', '', 'p2', { card: { colors: ['G'] } }), amrou)).toMatch(/white/);
    expect(artifactOrColorBlockOnlyReason(perm('w', 'Knight', 'Creature', '', 'p2', { card: { colors: ['W'] } }), amrou)).toBeNull();
    expect(artifactOrColorBlockOnlyReason(perm('m', 'Myr', 'Artifact Creature', '', 'p2', { card: { colors: [] } }), amrou)).toBeNull();
    expect(artifactOrColorBlockOnlyReason(perm('k', 'Lion', 'Creature', '', 'p2', { card: { mana_cost: '{1}{W}' } }), amrou)).toBeNull();
  });
});
