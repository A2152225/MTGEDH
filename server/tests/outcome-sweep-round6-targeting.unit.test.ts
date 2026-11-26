import { describe, expect, it } from 'vitest';

import { augmentCastTargetRequirements, splitMultiTargetClause } from '../src/socket/game-actions-handlers/castSpellTargetPatternFallbacks.js';
import {
  buildDependentPlayerObjectTargets,
  parseDependentPlayerObjectTarget,
  playerMeetsTargetCondition,
  prependDependentPlayerTarget,
} from '../src/socket/interaction-handlers/activatedDependentPlayerTargets.js';
import { getAsEntersChoiceRequirements } from '../src/state/modules/asEntersChoiceRequirements.js';

const KEEPER = '{B}, {T}: Choose target opponent who has at least two fewer creature cards in their graveyard than you do as you activate this ability. Destroy target nonblack creature that player controls.';

function perm(id: string, controller: string, typeLine: string, colors: string[] = []) {
  return { id, controller, owner: controller, tapped: false, counters: {}, card: { id: `${id}_c`, name: id, type_line: typeLine, colors, oracle_text: '' } };
}

function creatureCards(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `gy${i}`, name: `Dead ${i}`, type_line: 'Creature — Zombie' }));
}

describe('outcome sweep round 6 (targeting)', () => {
  it("restores the Chandra's Defeat prompt: red creature or red planeswalker", () => {
    const reqs: any = augmentCastTargetRequirements("chandra's defeat deals 5 damage to target red creature or red planeswalker.", undefined as any);
    expect(reqs?.targetTypes).toEqual(['creature', 'planeswalker']);
    expect(reqs?.castTargetTypeEntry).toBe('red');
    // Different adjectives still defer to the parser.
    expect(augmentCastTargetRequirements('destroy target green or white creature.', undefined as any)).toBeUndefined();
  });

  it('splits "and 7 damage to target creature of an opponent\'s choice" (Volcanic Offering)', () => {
    const parts = splitMultiTargetClause("Volcanic Offering deals 7 damage to target creature you don't control and 7 damage to target creature of an opponent's choice you don't control");
    expect(parts).toEqual(["target creature you don't control", "target creature you don't control"]);
    const lands = splitMultiTargetClause("Destroy target nonbasic land you don't control and target nonbasic land of an opponent's choice you don't control");
    expect(lands).toEqual(["target nonbasic land you don't control", "target nonbasic land you don't control"]);
  });

  it('parses the dependent player/object target and its graveyard condition (Keeper of the Dead)', () => {
    const info = parseDependentPlayerObjectTarget(KEEPER);
    expect(info).toMatchObject({ playerKind: 'opponent', objectEntry: 'nonblack creature', description: 'nonblack creature that player controls' });
    const state: any = { zones: { p1: { graveyard: creatureCards(3) }, p2: { graveyard: creatureCards(1) }, p3: { graveyard: creatureCards(2) } } };
    expect(playerMeetsTargetCondition(state, 'p2', 'p1', info!.playerCondition)).toBe(true);
    expect(playerMeetsTargetCondition(state, 'p3', 'p1', info!.playerCondition)).toBe(false);
  });

  it('offers only nonblack creatures of legal opponents and prepends that player on submit', () => {
    const game: any = { state: {
      players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }, { id: 'p3', name: 'P3' }],
      zones: { p1: { graveyard: creatureCards(3) }, p2: { graveyard: [] }, p3: { graveyard: creatureCards(2) } },
      battlefield: [
        perm('mine', 'p1', 'Creature — Bear', ['G']),
        perm('p2bear', 'p2', 'Creature — Bear', ['G']),
        perm('p2zombie', 'p2', 'Creature — Zombie', ['B']),
        perm('p2land', 'p2', 'Basic Land — Forest'),
        perm('p3bear', 'p3', 'Creature — Bear', ['G']),
      ],
      stack: [],
    } };
    const info = parseDependentPlayerObjectTarget(KEEPER)!;
    const targets = buildDependentPlayerObjectTargets(game, 'p1', info);
    expect(targets.map((t) => t.id)).toEqual(['p2bear']);
    const valid = [...targets];
    expect(prependDependentPlayerTarget(game, ['p2bear'], valid)).toEqual(['p2', 'p2bear']);
    expect(valid.some((t) => t.id === 'p2' && t.type === 'player')).toBe(true);
  });

  it('does not turn an activated "Choose target opponent" into an as-enters opponent choice', () => {
    const reqs = getAsEntersChoiceRequirements({ name: 'Keeper of the Dead', type_line: 'Creature — Human Wizard', oracle_text: KEEPER });
    expect(reqs.some((r: any) => r.kind === 'opponent')).toBe(false);
  });
});
