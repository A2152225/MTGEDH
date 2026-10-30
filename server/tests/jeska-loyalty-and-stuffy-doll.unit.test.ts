import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseActivatedAbilities } from '../../client/src/utils/activatedAbilityParser.js';
import { getAsEntersChoiceRequirements } from '../src/state/modules/asEntersChoiceRequirements.js';
import { collectActivatedAbilitySteps } from '../src/state/modules/oracleIrAbilityExecution.js';
import { resolveCombatDamageToOpponent } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsMillDamage.js';
import { getPlaneswalkerTemplateMatch } from '../src/state/planeswalker/templates/registry.js';
import { tryResolvePlaneswalkerLoyaltyTemplate } from '../src/state/planeswalker/templates/resolve.js';
import { detectDamageReplacementEffects } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsReplacementApply.js';
import { detectETBTriggers } from '../src/state/modules/triggers/etb-detection.js';
import { checkDamageReceivedTrigger } from '../src/state/modules/triggers/combat.js';
import { dispatchDamageReceivedTrigger } from '../src/state/modules/triggers/damage-received.js';

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

  it('live 0 ability triples the chosen creature\'s combat damage to an opponent', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const effect =
      '0: Choose target creature. Until your next turn, if that creature would deal combat damage to one of your opponents, it deals triple that damage to that player instead.';
    const steps = collectActivatedAbilitySteps(effect, 'Jeska, Thrice Reborn');
    expect(steps.map((step) => step.kind)).toEqual(['choose_target_creature', 'grant_temporary_ability']);

    const state: any = {
      turnNumber: 36,
      players: [
        { id: 'p1', life: 40 },
        { id: 'p2', life: 40 },
      ],
      battlefield: [
        {
          id: 'jeska',
          controller: 'p1',
          card: { name: 'Jeska, Thrice Reborn', type_line: 'Legendary Planeswalker — Jeska' },
        },
        {
          id: 'ozai',
          controller: 'p1',
          card: { name: 'Ozai, the Phoenix King', type_line: 'Legendary Creature — Human Noble' },
        },
        {
          id: 'bear',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        },
      ],
    };
    const irCtx = buildOracleIRExecutionContext({
      controllerId: 'p1',
      sourceId: 'jeska',
      sourceName: 'Jeska, Thrice Reborn',
      sourceObjectType: 'ability',
      targetCreatureId: 'ozai',
      targetPermanentId: 'ozai',
      selectorContext: {
        targetCreatureId: 'ozai',
        targetPermanentId: 'ozai',
        chosenObjectIds: ['ozai'],
      },
    });
    const result = applyOracleIRStepsToGameState(state, steps, irCtx, { allowOptional: true });
    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['choose_target_creature', 'grant_temporary_ability']);

    const ozai = result.state.battlefield.find((perm: any) => perm.id === 'ozai');
    const bear = result.state.battlefield.find((perm: any) => perm.id === 'bear');
    expect(ozai?.untilNextTurnGrants?.[0]?.kind).toBe('triple_combat_damage_to_opponents');
    expect(bear?.untilNextTurnGrants).toBeUndefined();

    const resolved = resolveCombatDamageToOpponent({ state: result.state } as any, {
      attackerCard: ozai.card,
      attackerPermanent: ozai,
      attackerController: 'p1',
      damageAmount: 7,
      defendingPlayerId: 'p2',
    });
    expect(resolved.damageDealt).toBe(21);
    expect(resolved.damageModifiers.some((line) => /tripl/i.test(line))).toBe(true);
  });

  it('parses Stuffy Doll as a player as-enters choice, not a string option', () => {
    const reqs = getAsEntersChoiceRequirements({
      name: 'Stuffy Doll',
      oracle_text: STUFFY_ORACLE,
    });
    expect(reqs.some((r) => r.kind === 'player')).toBe(true);
    expect(reqs.every((r) => r.kind !== 'option')).toBe(true);
  });

  it('does not queue a modal whose only option is the words "a player"', () => {
    const triggers = detectETBTriggers(
      { name: 'Stuffy Doll', oracle_text: STUFFY_ORACLE, type_line: 'Artifact Creature — Construct' },
      { id: 'doll', controller: 'p1' },
    );
    expect(triggers.some((trigger) => trigger.triggerType === 'etb_modal_choice')).toBe(false);
  });

  it('deals Stuffy Doll damage to the chosen player without a new target prompt', () => {
    const doll = {
      id: 'doll',
      controller: 'p1',
      chosenPlayer: 'king',
      card: {
        name: 'Stuffy Doll',
        type_line: 'Artifact Creature — Construct',
        oracle_text: STUFFY_ORACLE,
      },
    };
    const info = checkDamageReceivedTrigger(doll, 5);
    expect(info?.targetType).toBe('chosen_player');
    const ctx: any = {
      gameId: 'stuffy_chosen_player',
      bumpSeq: () => {},
      state: {
        life: { p1: 40, king: 40 },
        players: [{ id: 'p1', life: 40 }, { id: 'king', name: 'King', life: 40 }],
        battlefield: [doll],
      },
    };
    expect(dispatchDamageReceivedTrigger(ctx, info as any)).toBe(true);
    expect(ctx.state.life.king).toBe(35);
  });
});
