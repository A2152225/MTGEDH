import { describe, expect, it } from 'vitest';

import { parseActivatedAbilities } from '../../client/src/utils/activatedAbilityParser.js';
import { getAsEntersChoiceRequirements } from '../src/state/modules/asEntersChoiceRequirements.js';
import { getPlaneswalkerTemplateMatch } from '../src/state/planeswalker/templates/registry.js';
import { tryResolvePlaneswalkerLoyaltyTemplate } from '../src/state/planeswalker/templates/resolve.js';
import { detectDamageReplacementEffects } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsReplacementApply.js';

const JESKA_ORACLE =
  "Jeska, Thrice Reborn enters with a loyalty counter on it for each time you've cast a commander from the command zone this game.\n" +
  "0: Choose target creature. Until your next turn, if that creature would deal combat damage to one of your opponents, it deals triple that damage to that player instead.\n" +
  "−X: Jeska, Thrice Reborn deals X damage to each of up to three targets.\n" +
  "Jeska, Thrice Reborn can be your commander.\n" +
  "Partner";

const STUFFY_ORACLE =
  "Indestructible\n" +
  "As this creature enters, choose a player.\n" +
  "Whenever this creature is dealt damage, it deals that much damage to the chosen player.";

describe('Jeska loyalty and Stuffy Doll chosen player', () => {
  it('lists Jeska −X in the activated-ability menu', () => {
    const abilities = parseActivatedAbilities({
      id: 'jeska',
      name: 'Jeska, Thrice Reborn',
      type_line: 'Legendary Planeswalker — Jeska',
      oracle_text: JESKA_ORACLE,
    } as any);
    const labels = abilities.filter((a) => a.isLoyaltyAbility).map((a) => a.label);
    expect(labels).toContain('[0]');
    expect(labels).toContain('[-X]');
  });

  it('resolves the 0 ability as a until-next-turn triple-combat grant', () => {
    const effect =
      'Choose target creature. Until your next turn, if that creature would deal combat damage to one of your opponents, it deals triple that damage to that player instead.';
    expect(getPlaneswalkerTemplateMatch(effect)?.id).toBe('TRIPLE_COMBAT_DAMAGE_TO_OPPONENTS_UNTIL_YOUR_NEXT_TURN');

    const ctx: any = {
      bumpSeq: () => {},
      state: {
        turnNumber: 4,
        battlefield: [
          { id: 'bear_1', controller: 'p1', card: { name: 'Bear', type_line: 'Creature — Bear' } },
        ],
      },
    };
    const handled = tryResolvePlaneswalkerLoyaltyTemplate(
      ctx,
      'p1',
      'Jeska, Thrice Reborn',
      effect,
      { targets: ['bear_1'] },
    );
    expect(handled).toBe(true);
    expect(ctx.state.battlefield[0].untilNextTurnGrants?.[0]?.kind).toBe('triple_combat_damage_to_opponents');

    const effects = detectDamageReplacementEffects(ctx, 'p1', 'p2', true, 'bear_1', true);
    expect(effects.some((e) => e.type === 'triple')).toBe(true);
  });

  it('parses Stuffy Doll as a player as-enters choice, not a string option', () => {
    const reqs = getAsEntersChoiceRequirements({
      name: 'Stuffy Doll',
      oracle_text: STUFFY_ORACLE,
    });
    expect(reqs.some((r) => r.kind === 'player')).toBe(true);
    expect(reqs.every((r) => r.kind !== 'option')).toBe(true);
  });
});
