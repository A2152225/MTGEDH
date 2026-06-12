import { describe, expect, it } from 'vitest';

import {
  applyArcaneAdaptationToControllerCreatures,
  countControlledCreaturesOfChosenType,
  countControlledPermanentsOfChosenType,
  deriveCavernUncounterableForCreatureCast,
  filterHandCreatureCardsOfChosenType,
  getChosenTypeManaSpendRestriction,
  isCastCreatureTypeChoiceOracle,
  isCelestialReunionOracle,
  isEtbCreatureTypeChoiceOracle,
  parseActivationChosenTypeRevealTop,
  cardMatchesChosenTypeFilter,
  parseBeholdChosenTypeAdditionalCost,
  parseChosenTypeTopCardRevealToHand,
  parseChosenTypeCreatureEtbTrigger,
  parseChosenTypeCostReduction,
  parseChosenTypeLookRevealTopLibrary,
  parseChosenTypeManaSpendRestriction,
  parseChosenTypeUntilEndOfTurnBuff,
  parseChosenTypeDrawPerCreatureEffect,
  parseChosenTypeCounterEachCreatureEffect,
  parseActivationChosenTypeTopLibraryReveal,
  parseNextChosenTypeSpellFlashGrant,
  hasUnrestrictedChosenTypeManaAbility,
  isMetallicMimicOracle,
  isSacrificeCreatureOfChosenTypeCost,
  syncArcaneAdaptationForNewCreature,
} from '../src/state/modules/chosen-creature-type.js';
import {
  addCastSpellPaymentProducedMana,
  canUseRestrictedMana,
  payAbilityManaCostFromPool,
  parseFloatingPaymentPermanentId,
  resolvePaymentManaAbilitySpendRestriction,
  validateAbilityManaCostFromPool,
  validateAndConsumeManaCostFromPool,
  validateSelectedFloatingPoolMana,
} from '../src/socket/util.js';
import { canPayManaCostWithAvailableSources } from '../src/state/modules/mana-check.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond.js';
import { applyCreatureTypeSelection } from '../src/socket/creature-type.js';
import { cardHasCreatureType, permanentHasCreatureTypeNow } from '../src/state/creatureTypeNow.js';
import { getManaAbilitiesForPermanent } from '../src/state/modules/mana-abilities.js';
import {
  requiresCreatureTypeSelection,
  requiresCreatureTypeSelectionOnCast,
} from '../src/socket/creature-type.js';
import { detectETBTriggers, getDeathTriggers } from '../src/state/modules/triggered-abilities.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { canCastFromTop } from '../src/state/modules/game-state-effects.js';
import type { PlayerID } from '../../shared/src/index.js';
import { calculateAllPTBonuses } from '../src/state/utils.js';
import {
  spellHasChosenTypeFlashGrant,
  tryApplyCastingModifierGrantsFromText,
} from '../src/state/modules/casting-modifiers.js';
import { detectAdditionalCost } from '../src/socket/land-helpers.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('chosen creature type infrastructure', () => {
  it('parses chosen-type creature ETB triggers for Bloodline Pretender and Molten Echoes', () => {
    const bloodline =
      'As Bloodline Pretender enters the battlefield, choose a creature type.\n'
      + 'Whenever another creature you control of the chosen type enters, put a +1/+1 counter on this creature.';
    const molten =
      'As Molten Echoes enters the battlefield, choose a creature type.\n'
      + "Whenever a nontoken creature you control of the chosen type enters, create a token that's a copy of that creature. That token gains haste. Exile it at the beginning of the next end step.";

    expect(parseChosenTypeCreatureEtbTrigger(bloodline)).toEqual({
      effect: 'put a +1/+1 counter on this creature',
      anotherOnly: true,
      nontokenOnly: false,
      mandatory: true,
    });
    expect(parseChosenTypeCreatureEtbTrigger(molten)?.effect).toContain("create a token that's a copy of that creature");
    expect(parseChosenTypeCreatureEtbTrigger(molten)).toMatchObject({
      anotherOnly: false,
      nontokenOnly: true,
      mandatory: true,
    });

    const pretenderTriggers = detectETBTriggers(
      { name: 'Bloodline Pretender', oracle_text: bloodline },
      { id: 'pretender_1', controller: 'p1', chosenCreatureType: 'Goblin' },
    );
    expect(pretenderTriggers.some((trigger) => trigger.triggerType === 'chosen_type_creature_etb')).toBe(true);

    const echoesTriggers = detectETBTriggers(
      { name: 'Molten Echoes', oracle_text: molten },
      { id: 'echoes_1', controller: 'p1', chosenCreatureType: 'Goblin' },
    );
    expect(echoesTriggers.some((trigger) => trigger.triggerType === 'chosen_type_creature_etb')).toBe(true);
  });

  it('parses behold chosen-type additional costs and excludes them from resolve-time choices', () => {
    const celestial =
      'As an additional cost to cast this spell, you may choose a creature type and behold two creatures of that type.\n'
      + "Search your library for a creature card with mana value X or less, reveal it, put it into your hand, then shuffle. If this spell's additional cost was paid and the revealed card is the chosen type, put that card onto the battlefield instead of putting it into your hand.";

    expect(parseBeholdChosenTypeAdditionalCost(celestial)).toEqual({
      beholdCount: 2,
      optional: true,
    });
    expect(isCelestialReunionOracle(celestial)).toBe(true);
    expect(isCastCreatureTypeChoiceOracle(celestial)).toBe(false);
    expect(requiresCreatureTypeSelectionOnCast({ name: 'Celestial Reunion', oracle_text: celestial }).required).toBe(false);
    expect(detectAdditionalCost(celestial)).toEqual({
      type: 'behold_chosen_type',
      amount: 2,
      beholdIsOptional: true,
    });
  });

  it('separates ETB vs cast-time creature type choices', () => {
    const etb = "As Kindred Discovery enters, choose a creature type.\nWhenever a creature you control of the chosen type enters or attacks, draw a card.";
    const cast = 'Choose a creature type. Creatures you control of the chosen type get +1/+0 and gain haste until end of turn.';

    expect(isEtbCreatureTypeChoiceOracle(etb)).toBe(true);
    expect(isCastCreatureTypeChoiceOracle(etb)).toBe(false);
    expect(requiresCreatureTypeSelection({ name: 'Kindred Discovery', oracle_text: etb }).required).toBe(true);
    expect(requiresCreatureTypeSelectionOnCast({ name: 'Kindred Discovery', oracle_text: etb }).required).toBe(false);

    expect(isCastCreatureTypeChoiceOracle(cast)).toBe(true);
    expect(requiresCreatureTypeSelectionOnCast({ name: 'Kindred Charge', oracle_text: cast }).required).toBe(true);
    expect(requiresCreatureTypeSelection({ name: 'Kindred Charge', oracle_text: cast }).required).toBe(false);
  });

  it('parses generic chosen-type cost reduction text', () => {
    expect(parseChosenTypeCostReduction("Creature spells of the chosen type cost {2} less to cast.")).toEqual({
      amount: 2,
      creatureSpellsOnly: true,
    });
    expect(parseChosenTypeCostReduction("Spells of the chosen type cost {1} less to cast.")).toEqual({
      amount: 1,
      creatureSpellsOnly: false,
    });
  });

  it('detects Kindred Charge as a cast-time creature type choice', () => {
    const oracle =
      "Choose a creature type. For each creature you control of the chosen type, create a token that's a copy of that creature. Those tokens gain haste. Exile them at the beginning of the next end step.";
    expect(isCastCreatureTypeChoiceOracle(oracle)).toBe(true);
    expect(requiresCreatureTypeSelectionOnCast({ name: 'Kindred Charge', oracle_text: oracle }).required).toBe(true);
  });

  it('parses chosen-type until-end-of-turn buff text', () => {
    expect(
      parseChosenTypeUntilEndOfTurnBuff(
        'Choose a creature type. Creatures you control of the chosen type get +1/+0 and gain haste until end of turn.',
      ),
    ).toEqual({
      power: 1,
      toughness: 0,
      abilities: ['haste'],
    });
  });

  it('parses tribal mana lands and unrestricted chosen-type mana sources', () => {
    expect(parseChosenTypeManaSpendRestriction(
      'As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast spells of the chosen type.',
    )).toEqual({ creatureSpellsOnly: false });
    expect(hasUnrestrictedChosenTypeManaAbility(
      'As this artifact enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.\n{T}: Add one mana of any color.',
    )).toBe(true);
    expect(parseNextChosenTypeSpellFlashGrant(
      '{T}: The next spell of the chosen type you cast this turn can be cast as though it had flash.',
    )).toBe(true);
    expect(parseChosenTypeCounterEachCreatureEffect(
      'Whenever chaos ensues, choose a creature type. Put a +1/+1 counter on each creature you control of that type.',
    )).toBe(true);
  });

  it('parses chosen-type mana spend restrictions', () => {
    expect(parseChosenTypeManaSpendRestriction(
      '{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type.',
    )).toEqual({ creatureSpellsOnly: true });
    expect(parseChosenTypeManaSpendRestriction(
      '{T}: Add one mana of any color. Spend this mana only to cast spells of the chosen type.',
    )).toEqual({ creatureSpellsOnly: false });
    expect(parseChosenTypeManaSpendRestriction(
      '{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type or activate an ability of a creature source of the chosen type.',
    )).toEqual({ creatureSpellsOnly: true, allowsCreatureSourceAbilities: true });
  });

  it('annotates Echoing Cavern with chosen-type spell mana restriction', () => {
    const permanent = {
      id: 'cavern_1',
      controller: 'p1',
      chosenCreatureType: 'Elf',
      card: {
        name: 'Echoing Cavern',
        type_line: 'Land',
        oracle_text:
          'As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast spells of the chosen type.',
      },
    };
    const abilities = getManaAbilitiesForPermanent({ battlefield: [permanent] }, permanent, 'p1');
    const restricted = abilities.find((ability: any) => ability.spendRestriction?.restriction === 'chosen_type_spell');
    expect(restricted?.spendRestriction).toEqual({
      restriction: 'chosen_type_spell',
      restrictedTo: 'elf',
    });
  });

  it('applies Patchwork Banner +1/+1 to controlled creatures of the chosen type', () => {
    const playerId = 'p1' as PlayerID;
    const game = createInitialGameState('patchwork_banner_lord');
    game.applyEvent!({ type: 'join', playerId, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'banner_1',
        controller: playerId,
        chosenCreatureType: 'Goblin',
        card: {
          name: 'Patchwork Banner',
          type_line: 'Artifact',
          oracle_text:
            'As this artifact enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.\n{T}: Add one mana of any color.',
        },
      },
      {
        id: 'gob_1',
        controller: playerId,
        card: { name: 'Goblin Guide', type_line: 'Creature — Goblin Scout', power: '2', toughness: '2' },
      },
    ];
    const goblin = (game.state as any).battlefield.find((perm: any) => perm.id === 'gob_1');
    const bonuses = calculateAllPTBonuses(goblin, game.state);
    expect(bonuses.power).toBeGreaterThanOrEqual(1);
    expect(bonuses.toughness).toBeGreaterThanOrEqual(1);
  });

  it('grants flash to the next matching spell via Progenitor\'s Icon ability text', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('progenitors_icon_flash');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'icon_1',
      controller: p1,
      chosenCreatureType: 'Elf',
      card: {
        name: "Progenitor's Icon",
        type_line: 'Artifact',
        oracle_text:
          'As this artifact enters, choose a creature type.\n{T}: Add one mana of any color.\n{T}: The next spell of the chosen type you cast this turn can be cast as though it had flash.',
      },
    }];
    const abilityText = '{T}: The next spell of the chosen type you cast this turn can be cast as though it had flash.';
    const applied = tryApplyCastingModifierGrantsFromText(
      game.state,
      p1,
      abilityText,
      "Progenitor's Icon",
      { source: 'icon_1' },
    );
    expect(applied).toBe(true);
    expect(spellHasChosenTypeFlashGrant(game.state, p1, {
      type_line: 'Creature — Elf Warrior',
    })).toBe(true);
    expect(spellHasChosenTypeFlashGrant(game.state, p1, {
      type_line: 'Creature — Goblin Scout',
    })).toBe(false);
  });

  it('puts +1/+1 counters on each creature of the chosen type (Littjara chaos)', () => {
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState('littjara_chaos');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'elf_1',
        controller: p1,
        card: { name: 'Elvish Mystic', type_line: 'Creature — Elf Druid', power: '1', toughness: '1' },
      },
      {
        id: 'gob_1',
        controller: p1,
        card: { name: 'Goblin Guide', type_line: 'Creature — Goblin Scout', power: '2', toughness: '2' },
      },
    ];
    const chaosText =
      'Whenever chaos ensues, choose a creature type. Put a +1/+1 counter on each creature you control of that type.';
    executeTriggerEffect(game as any, p1, 'Littjara', chaosText, {
      source: 'plane_littjara',
      chosenCreatureType: 'Elf',
    });
    const elf = (game.state as any).battlefield.find((perm: any) => perm.id === 'elf_1');
    const gob = (game.state as any).battlefield.find((perm: any) => perm.id === 'gob_1');
    expect(elf?.counters?.['+1/+1']).toBe(1);
    expect(gob?.counters?.['+1/+1']).toBeUndefined();
  });

  it('annotates Secluded Courtyard with creature-source ability mana restriction', () => {
    const permanent = {
      id: 'courtyard_1',
      controller: 'p1',
      chosenCreatureType: 'Goblin',
      card: {
        name: 'Secluded Courtyard',
        type_line: 'Land',
        oracle_text:
          'As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type or activate an ability of a creature source of the chosen type.',
      },
    };
    expect(getChosenTypeManaSpendRestriction(permanent)).toEqual({
      restriction: 'chosen_type_creature_source',
      restrictedTo: 'goblin',
    });
  });

  it('filters hand creatures for Belbe-style chosen-type puts', () => {
    const hand = [
      { id: 'elf_1', type_line: 'Creature — Elf Warrior' },
      { id: 'gob_1', type_line: 'Creature — Goblin Scout' },
      { id: 'bolt_1', type_line: 'Instant' },
    ];
    expect(filterHandCreatureCardsOfChosenType(hand, 'Elf').map((card) => card.id)).toEqual(['elf_1']);
  });

  it('consumes restricted tribal mana when paying for a matching creature spell', () => {
    const pool: any = {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
      restricted: [{
        type: 'green',
        amount: 2,
        restriction: 'chosen_type_creature_spell',
        restrictedTo: 'elf',
      }],
    };
    const paid = validateAndConsumeManaCostFromPool(pool, '{1}{G}', {
      purpose: { isCreature: true, spellCard: { type_line: 'Creature — Elf Warrior' } },
    });
    expect(paid.ok).toBe(true);
    expect(pool.restricted?.length ?? 0).toBe(0);
  });

  it('routes explicit spell-payment production into the restricted mana pool', () => {
    const gameState: any = { manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } } };
    const selectedTotals = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    addCastSpellPaymentProducedMana(
      gameState,
      'p1',
      gameState.manaPool.p1,
      selectedTotals,
      { green: 1 },
      { restriction: 'chosen_type_creature_source', restrictedTo: 'goblin' },
      { id: 'courtyard_1', name: 'Secluded Courtyard' },
    );
    expect(gameState.manaPool.p1.green).toBe(0);
    expect(gameState.manaPool.p1.restricted?.[0]).toMatchObject({
      type: 'green',
      amount: 1,
      restriction: 'chosen_type_creature_source',
      restrictedTo: 'goblin',
    });
    expect(selectedTotals.green).toBe(1);
  });

  it('accepts floating restricted pool mana as an explicit spell payment source', () => {
    const pool: any = {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
      restricted: [{
        type: 'green',
        amount: 2,
        restriction: 'chosen_type_creature_spell',
        restrictedTo: 'elf',
      }],
    };
    expect(parseFloatingPaymentPermanentId('__pool__:restricted:0:1')).toEqual({ kind: 'restricted', index: 0 });
    const validationError = validateSelectedFloatingPoolMana(
      pool,
      { white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 0 },
      { 0: 2 },
      { isCreature: true, spellCard: { type_line: 'Creature — Elf Warrior' } },
    );
    expect(validationError).toBeNull();
  });

  it('validates deferred ability payments against restricted tribal mana without consuming', () => {
    const gameState: any = {
      manaPool: {
        p1: {
          white: 0,
          blue: 0,
          black: 0,
          red: 0,
          green: 0,
          colorless: 0,
          restricted: [{
            type: 'red',
            amount: 1,
            restriction: 'chosen_type_creature_source',
            restrictedTo: 'goblin',
          }],
        },
      },
    };
    const goblinSource = {
      card: { name: 'Goblin Cratermaker', type_line: 'Creature — Goblin Shaman' },
    };
    const validated = validateAbilityManaCostFromPool(gameState, 'p1', '{R}', goblinSource);
    expect(validated.ok).toBe(true);
    expect(gameState.manaPool.p1.restricted?.[0]?.amount).toBe(1);
  });

  it('lets Secluded Courtyard mana pay activation costs on matching creature sources', () => {
    const gameState: any = {
      manaPool: {
        p1: {
          white: 0,
          blue: 0,
          black: 0,
          red: 0,
          green: 0,
          colorless: 0,
          restricted: [{
            type: 'red',
            amount: 1,
            restriction: 'chosen_type_creature_source',
            restrictedTo: 'goblin',
          }],
        },
      },
    };
    const goblinSource = {
      card: { name: 'Goblin Cratermaker', type_line: 'Creature — Goblin Shaman' },
    };
    const paid = payAbilityManaCostFromPool(gameState, 'p1', '{R}', goblinSource, '[test]');
    expect(paid.ok).toBe(true);
    expect(gameState.manaPool.p1.restricted?.length ?? 0).toBe(0);
  });

  it('allows Secluded Courtyard mana for matching creature spells and creature-source abilities', () => {
    const entry = {
      type: 'red' as const,
      amount: 1,
      restriction: 'chosen_type_creature_source' as const,
      restrictedTo: 'goblin',
    };
    expect(canUseRestrictedMana(entry, {
      isCreature: true,
      spellCard: { type_line: 'Creature — Goblin Warrior' },
    })).toBe(true);
    expect(canUseRestrictedMana(entry, {
      isCreature: true,
      spellCard: { type_line: 'Creature — Elf Warrior' },
    })).toBe(false);
    expect(canUseRestrictedMana(entry, {
      isActivatedAbility: true,
      abilitySourceIsCreature: true,
      abilitySourceCreatureType: 'goblin',
    })).toBe(true);
    expect(canUseRestrictedMana(entry, {
      isActivatedAbility: true,
      abilitySourceIsCreature: true,
      abilitySourceCreatureType: 'elf',
    })).toBe(false);
  });

  it('annotates tribal mana sources with spend restrictions when a type is chosen', () => {
    const permanent = {
      id: 'cavern_1',
      controller: 'p1',
      chosenCreatureType: 'Elf',
      card: {
        name: 'Cavern of Souls',
        type_line: 'Land',
        oracle_text:
          'As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can\'t be countered.',
      },
    };
    const restriction = getChosenTypeManaSpendRestriction(permanent);
    expect(restriction).toEqual({
      restriction: 'chosen_type_creature_spell',
      restrictedTo: 'elf',
    });

    const abilities = getManaAbilitiesForPermanent({ battlefield: [permanent] }, permanent, 'p1');
    const anyColorAbility = abilities.find((ability) => ability.id === 'native_any');
    expect(anyColorAbility?.spendRestriction).toEqual({
      restriction: 'chosen_type_creature_spell',
      restrictedTo: 'elf',
    });
  });

  it('resolves client ability ids for chosen-type mana spend restrictions', () => {
    const gameState = {
      battlefield: [{
        id: 'ut_1',
        controller: 'p1',
        chosenCreatureType: 'Merfolk',
        card: {
          id: 'ut_card',
          name: 'Unclaimed Territory',
          type_line: 'Land',
          oracle_text:
            'As this land enters, choose a creature type.\n'
            + '{T}: Add {C}.\n'
            + '{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type.',
        },
      }],
    };
    const permanent = gameState.battlefield[0];

    expect(resolvePaymentManaAbilitySpendRestriction(
      gameState,
      permanent,
      'p1',
      'ut_card-ability-0',
    )).toBeNull();
    expect(resolvePaymentManaAbilitySpendRestriction(
      gameState,
      permanent,
      'p1',
      'ut_card-ability-1',
    )).toEqual({
      restriction: 'chosen_type_creature_spell',
      restrictedTo: 'merfolk',
    });
  });

  it('excludes restricted tribal any-color mana when checking enchantment castability', () => {
    const playerId = 'p1' as PlayerID;
    const state: any = {
      turnPlayer: playerId,
      battlefield: [
        {
          id: 'ut_1',
          controller: playerId,
          tapped: false,
          chosenCreatureType: 'Merfolk',
          card: {
            name: 'Unclaimed Territory',
            type_line: 'Land',
            oracle_text:
              'As this land enters, choose a creature type.\n'
              + '{T}: Add {C}.\n'
              + '{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type.',
          },
        },
        {
          id: 'forest_1',
          controller: playerId,
          tapped: false,
          card: { name: 'Forest', type_line: 'Basic Land — Forest' },
        },
        {
          id: 'harbor_1',
          controller: playerId,
          tapped: false,
          card: {
            name: 'Hinterland Harbor',
            type_line: 'Land',
            oracle_text: '{T}: Add {G} or {U}.',
          },
        },
      ],
      zones: {
        [playerId]: {
          hand: [
            {
              id: 'propaganda_1',
              name: 'Propaganda',
              type_line: 'Enchantment',
              mana_cost: '{2}{U}',
            },
            {
              id: 'merfolk_1',
              name: 'Merfolk Looter',
              type_line: 'Creature — Merfolk',
              mana_cost: '{1}{U}',
            },
          ],
        },
      },
      manaPool: {},
    };

    const propagandaPayable = canPayManaCostWithAvailableSources(
      state,
      playerId,
      { colors: { U: 1 }, generic: 2, hasX: false, hybrid: [], hybrids: [] },
      Infinity,
      {
        excludedHandCardIds: ['propaganda_1'],
        restrictedSpendPurpose: {
          isCreature: false,
          spellCard: state.zones[playerId].hand[0],
        },
      },
    );
    const merfolkPayable = canPayManaCostWithAvailableSources(
      state,
      playerId,
      { colors: { U: 1 }, generic: 1, hasX: false, hybrid: [], hybrids: [] },
      Infinity,
      {
        excludedHandCardIds: ['merfolk_1'],
        restrictedSpendPurpose: {
          isCreature: true,
          spellCard: state.zones[playerId].hand[1],
        },
      },
    );

    expect(propagandaPayable).toBe(true);
    expect(merfolkPayable).toBe(true);

    const castable = getCastableSpellCandidates({ state } as any, playerId, { mode: 'main' });
    const castableIds = castable.map((candidate) => String(candidate.card?.id || ''));
    expect(castableIds).toContain('propaganda_1');
    expect(castableIds).toContain('merfolk_1');
  });

  it('mirrors chosen creature type onto permanent.card for client badges', () => {
    const gameId = 'creature_type_badge_mirror';
    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'ut_1',
      controller: playerId,
      card: {
        id: 'ut_card',
        name: 'Unclaimed Territory',
        type_line: 'Land',
        oracle_text: 'As this land enters, choose a creature type.',
      },
    }];

    applyCreatureTypeSelection(null, game, gameId, playerId, 'ut_1', 'Unclaimed Territory', 'Merfolk', false);

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'ut_1');
    expect(permanent?.chosenCreatureType).toBe('Merfolk');
    expect(permanent?.card?.chosenCreatureType).toBe('Merfolk');
  });

  it('counts permanents and creatures of the chosen type', () => {
    const gameState = {
      battlefield: [
        {
          id: 'elf_1',
          controller: 'p1',
          card: { type_line: 'Creature — Elf Warrior' },
        },
        {
          id: 'gob_1',
          controller: 'p1',
          card: { type_line: 'Creature — Goblin' },
        },
        {
          id: 'horn_1',
          controller: 'p1',
          chosenCreatureType: 'Elf',
          card: { name: "Herald's Horn", type_line: 'Artifact' },
        },
      ],
    };
    expect(countControlledCreaturesOfChosenType(gameState, 'p1', 'Elf')).toBe(1);
    expect(countControlledPermanentsOfChosenType(gameState, 'p1', 'Elf')).toBe(1);
    expect(cardHasCreatureType({ type_line: 'Creature — Elf Druid' }, 'Elf')).toBe(true);
  });

  it('marks creature spells uncounterable when paid with matching Cavern of Souls mana', () => {
    const gameState = {
      battlefield: [
        {
          id: 'cavern_1',
          controller: 'p1',
          chosenCreatureType: 'Elf',
          card: {
            name: 'Cavern of Souls',
            type_line: 'Land',
            oracle_text:
              "As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered.",
          },
        },
      ],
    };
    const elfSpell = { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid' };
    const goblinSpell = { name: 'Goblin Guide', type_line: 'Creature — Goblin Scout' };

    expect(
      deriveCavernUncounterableForCreatureCast(gameState, 'p1', elfSpell, [{ permanentId: 'cavern_1' }]),
    ).toBe(true);
    expect(
      deriveCavernUncounterableForCreatureCast(gameState, 'p1', goblinSpell, [{ permanentId: 'cavern_1' }]),
    ).toBe(false);
    expect(
      deriveCavernUncounterableForCreatureCast(gameState, 'p1', elfSpell, []),
    ).toBe(false);
  });

  it('grants chosen type to all creatures via Arcane Adaptation', () => {
    const battlefield = [
      {
        id: 'adaptation_1',
        controller: 'p1',
        chosenCreatureType: 'Vampire',
        card: {
          name: 'Arcane Adaptation',
          type_line: 'Enchantment',
          oracle_text:
            'As this enchantment enters, choose a creature type.\nCreatures you control are the chosen type in addition to their other types.',
        },
      },
      {
        id: 'soldier_1',
        controller: 'p1',
        card: { type_line: 'Creature — Human Soldier' },
      },
    ];
    applyArcaneAdaptationToControllerCreatures(battlefield, 'p1', 'Vampire');
    expect(battlefield[1].grantedCreatureTypes).toEqual(['Vampire']);
    expect(permanentHasCreatureTypeNow(battlefield[1], 'Vampire')).toBe(true);

    const newcomer = {
      id: 'knight_1',
      controller: 'p1',
      card: { type_line: 'Creature — Human Knight' },
    };
    syncArcaneAdaptationForNewCreature({ battlefield }, newcomer);
    expect(newcomer.grantedCreatureTypes).toEqual(['Vampire']);
  });

  it('allows Realmwalker to cast matching creature spells from the top of the library', () => {
    const ctx = {
      state: {
        battlefield: [
          {
            id: 'realmwalker_1',
            controller: 'p1',
            chosenCreatureType: 'Elf',
            card: {
              name: 'Realmwalker',
              type_line: 'Creature — Elf Shaman',
              oracle_text:
                'As this creature enters, choose a creature type.\nYou may look at the top card of your library any time.\nYou may cast creature spells of the chosen type from the top of your library.',
            },
          },
        ],
      },
    } as any;

    expect(canCastFromTop(ctx, 'p1', { type_line: 'Creature — Elf Warrior' }).canCast).toBe(true);
    expect(canCastFromTop(ctx, 'p1', { type_line: 'Creature — Goblin Warrior' }).canCast).toBe(false);
    expect(canCastFromTop(ctx, 'p1', { type_line: 'Instant' }).canCast).toBe(false);
  });

  it('applies Plague Engineer debuff to opponents creatures of the chosen type', () => {
    const gameState = {
      battlefield: [
        {
          id: 'plague_1',
          controller: 'p2',
          chosenCreatureType: 'Zombie',
          card: {
            name: 'Plague Engineer',
            type_line: 'Creature — Phyrexian Carrier',
            oracle_text:
              'As this creature enters, choose a creature type.\nCreatures of the chosen type your opponents control get -1/-1.',
          },
        },
        {
          id: 'zombie_1',
          controller: 'p1',
          card: { type_line: 'Creature — Zombie', oracle_text: '' },
        },
      ],
    };
    const bonuses = calculateAllPTBonuses(gameState.battlefield[1], gameState);
    expect(bonuses.power).toBe(-1);
    expect(bonuses.toughness).toBe(-1);
  });

  it('fires Species Specialist only when a chosen-type creature you control dies', () => {
    const specialist = {
      id: 'specialist_1',
      controller: 'p1',
      chosenCreatureType: 'Elf',
      card: {
        name: 'Species Specialist',
        type_line: 'Creature — Human Druid',
        oracle_text:
          'As this creature enters, choose a creature type.\nWhenever a creature of the chosen type you control dies, draw a card.',
      },
    };
    const ctx = { state: { battlefield: [specialist] } } as any;
    const elf = {
      id: 'elf_1',
      controller: 'p1',
      card: { name: 'Elvish Mystic', type_line: 'Creature — Elf Druid' },
    };
    const goblin = {
      id: 'gob_1',
      controller: 'p1',
      card: { name: 'Goblin Guide', type_line: 'Creature — Goblin Scout' },
    };

    const elfTriggers = getDeathTriggers(ctx, elf, 'p1');
    const goblinTriggers = getDeathTriggers(ctx, goblin, 'p1');
    expect(elfTriggers.some((entry) => entry.source.cardName === 'Species Specialist')).toBe(true);
    expect(goblinTriggers.some((entry) => entry.source.cardName === 'Species Specialist')).toBe(false);
  });

  it('detects self enters-or-attacks triggers (Titan of Littjara)', () => {
    const card = {
      name: 'Titan of Littjara',
      oracle_text:
        'As Titan of Littjara enters, choose a creature type. Titan of Littjara is the chosen type.\nWhenever Titan of Littjara enters or attacks, draw a card.',
    };
    const permanent = { id: 'titan_1', controller: 'p1', chosenCreatureType: 'Merfolk', card };
    const triggers = detectETBTriggers(card, permanent);
    expect(triggers.some((trigger) => trigger.triggerType === 'self_enters_or_attacks')).toBe(true);
  });
});

describe('chosen-type creature ETB trigger resolution', () => {
  const p1 = 'p1' as PlayerID;

  it('resolves Molten Echoes by copying the entering creature with haste and exile scheduling', () => {
    const game = createInitialGameState('molten_echoes_trigger');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'echoes_1',
        controller: p1,
        chosenCreatureType: 'Goblin',
        card: {
          name: 'Molten Echoes',
          type_line: 'Enchantment',
          oracle_text:
            "Whenever a nontoken creature you control of the chosen type enters, create a token that's a copy of that creature. That token gains haste. Exile it at the beginning of the next end step.",
        },
      },
      {
        id: 'goblin_1',
        controller: p1,
        card: {
          id: 'goblin_card_1',
          name: 'Goblin Guide',
          type_line: 'Creature — Goblin Scout',
          power: '2',
          toughness: '2',
        },
      },
    ];

    executeTriggerEffect(
      game as any,
      p1,
      'Molten Echoes',
      "create a token that's a copy of that creature. That token gains haste. Exile it at the beginning of the next end step.",
      {
        source: 'echoes_1',
        permanentId: 'echoes_1',
        interveningIfSubjectPermanentId: 'goblin_1',
      },
    );

    const tokens = ((game.state as any).battlefield || []).filter((perm: any) => perm?.isToken);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.card?.name).toBe('Goblin Guide');
    expect(tokens[0]?.tempAbilities || []).toContain('haste');
    expect((game.state as any).pendingExileAtNextEndStep || []).toHaveLength(1);
  });

  it('parses Herald\'s Horn and Gathering Stone top-card reveal patterns', () => {
    const hornUpkeep =
      "At the beginning of your upkeep, look at the top card of your library. You may reveal that card if it's a creature card of the chosen type. If you do, put it into your hand.";
    const gatheringStone =
      "When this artifact enters and at the beginning of your upkeep, look at the top card of your library. If it's a card of the chosen type, you may reveal it and put it into your hand. If you don't put the card into your hand, you may put it into your graveyard.";

    expect(parseChosenTypeTopCardRevealToHand(hornUpkeep)).toEqual({
      creatureCardsOnly: true,
      allowGraveyardIfDeclined: false,
    });
    expect(parseChosenTypeTopCardRevealToHand(gatheringStone)).toEqual({
      creatureCardsOnly: false,
      allowGraveyardIfDeclined: true,
    });
    expect(cardMatchesChosenTypeFilter(
      { type_line: 'Creature — Elf Druid' },
      'Elf',
      true,
    )).toBe(true);
    expect(cardMatchesChosenTypeFilter(
      { type_line: 'Instant' },
      'Elf',
      false,
    )).toBe(false);
  });

  it('resolves Herald\'s Horn upkeep by drawing a matching top creature', () => {
    const hornEffect =
      "At the beginning of your upkeep, look at the top card of your library. You may reveal that card if it's a creature card of the chosen type. If you do, put it into your hand.";
    const game = createInitialGameState('heralds_horn_upkeep');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.libraries.set(p1, [
      { id: 'top_elf', name: 'Elvish Mystic', type_line: 'Creature — Elf Druid' },
    ] as any);
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        graveyard: [],
        exile: [],
        library: game.libraries.get(p1) || [],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [{
      id: 'horn_1',
      controller: p1,
      chosenCreatureType: 'Elf',
      card: { name: "Herald's Horn", type_line: 'Artifact' },
    }];

    executeTriggerEffect(game as any, p1, "Herald's Horn", hornEffect, {
      source: 'horn_1',
      permanentId: 'horn_1',
    });

    expect((game.state as any).zones?.[p1]?.hand?.[0]?.name).toBe('Elvish Mystic');
    expect((game.libraries.get(p1) || []).length).toBe(0);
  });

  it('parses batch-10 chosen-type patterns (Pol Jamaar, Icon of Ancestry, Metallic Mimic, Doom Cannon)', () => {
    const polJamaar =
      'When Pol Jamaar enters, choose a creature type. Draw a card for each creature you control of that type.';
    const convincingGeneral =
      '{3}, {T}: Choose a creature type. Draw a card for each creature you control of that type.';
    const iconAbility =
      '{3}, {T}: Look at the top three cards of your library. You may reveal a creature card of the chosen type from among them and put it into your hand. Put the rest on the bottom of your library in a random order.';
    const metallicMimic =
      'Each other creature you control of the chosen type enters with an additional +1/+1 counter on it.';
    const doomCannonCost =
      '{3}, {T}, Sacrifice a creature of the chosen type: This artifact deals 3 damage to any target.';

    expect(parseChosenTypeDrawPerCreatureEffect(polJamaar)).toBe(true);
    expect(parseChosenTypeDrawPerCreatureEffect(convincingGeneral)).toBe(true);
    expect(parseActivationChosenTypeTopLibraryReveal(iconAbility)).toEqual({
      lookCount: 3,
      creatureCardsOnly: true,
    });
    expect(isMetallicMimicOracle(metallicMimic)).toBe(true);
    expect(isSacrificeCreatureOfChosenTypeCost(doomCannonCost)).toBe(true);
  });

  it('parses Bloodline Shaman and For the Ancestors chosen-type patterns', () => {
    const shamanAbility =
      '{T}: Choose a creature type. Reveal the top card of your library. If that card is a creature card of the chosen type, put it into your hand. Otherwise, put it into your graveyard.';
    const ancestorsOracle =
      'Choose a creature type. Look at the top six cards of your library. You may reveal any number of cards of the chosen type from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in a random order.';

    expect(parseActivationChosenTypeRevealTop(shamanAbility)).toBe(true);
    expect(parseChosenTypeLookRevealTopLibrary(ancestorsOracle)).toEqual({ lookCount: 6 });
    expect(requiresCreatureTypeSelectionOnCast({ name: 'For the Ancestors', oracle_text: ancestorsOracle }).required).toBe(true);
  });

  it('resolves Bloodline Shaman reveal-top to hand or graveyard using activation-time chosen type', () => {
    const shamanAbility =
      '{T}: Choose a creature type. Reveal the top card of your library. If that card is a creature card of the chosen type, put it into your hand. Otherwise, put it into your graveyard.';
    const game = createInitialGameState('bloodline_shaman_reveal');
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.libraries.set(p1, [
      { id: 'top_elf', name: 'Elvish Mystic', type_line: 'Creature — Elf Druid' },
      { id: 'top_island', name: 'Island', type_line: 'Basic Land — Island' },
    ] as any);
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        graveyard: [],
        exile: [],
        library: game.libraries.get(p1) || [],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
        libraryCount: 2,
      },
    };

    executeTriggerEffect(game as any, p1, 'Bloodline Shaman', shamanAbility, {
      source: 'shaman_1',
      chosenCreatureType: 'Elf',
    });
    expect((game.state as any).zones?.[p1]?.hand || []).toHaveLength(1);
    expect((game.state as any).zones?.[p1]?.hand?.[0]?.name).toBe('Elvish Mystic');

    game.libraries.set(p1, [
      { id: 'top_goblin', name: 'Goblin Guide', type_line: 'Creature — Goblin Scout' },
    ] as any);
    (game.state as any).zones[p1].library = game.libraries.get(p1) || [];
    (game.state as any).zones[p1].libraryCount = 1;
    (game.state as any).zones[p1].hand = [];
    (game.state as any).zones[p1].handCount = 0;
    (game.state as any).zones[p1].graveyard = [];
    (game.state as any).zones[p1].graveyardCount = 0;

    executeTriggerEffect(game as any, p1, 'Bloodline Shaman', shamanAbility, {
      source: 'shaman_1',
      chosenCreatureType: 'Elf',
    });
    expect((game.state as any).zones?.[p1]?.hand || []).toHaveLength(0);
    expect((game.state as any).zones?.[p1]?.graveyard?.[0]?.name).toBe('Goblin Guide');
  });
});

describe('cast-time chosen-type spell resolution', () => {
  const p1 = 'p1' as PlayerID;

  function setupStackSpell(oracleText: string, cardName: string, chosenType: string, battlefield: any[] = []) {
    const game = createInitialGameState(`chosen_type_spell_${cardName.replace(/\s+/g, '_').toLowerCase()}`);
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = battlefield;
    (game.state as any).stack = [{
      id: 'spell_1',
      type: 'spell',
      controller: p1,
      chosenCreatureType: chosenType,
      card: {
        id: 'card_1',
        name: cardName,
        type_line: 'Sorcery',
        oracle_text: oracleText,
      },
    }];
    game.libraries.set(p1, [
      { id: 'draw_1', name: 'Island', type_line: 'Instant' },
      { id: 'draw_2', name: 'Forest', type_line: 'Land' },
    ] as any);
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        graveyard: [],
        exile: [],
        library: game.libraries.get(p1) || [],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
        libraryCount: 2,
      },
    };
    return game;
  }

  it('queues For the Ancestors top-six reveal with chosen-type selection filter', () => {
    const gameId = 'for_the_ancestors_resolve';
    ResolutionQueueManager.removeQueue(gameId);
    const oracle =
      'Choose a creature type. Look at the top six cards of your library. You may reveal any number of cards of the chosen type from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in a random order.';
    const game = createInitialGameState(gameId);
    (game as any).gameId = gameId;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).stack = [{
      id: 'spell_1',
      type: 'spell',
      controller: p1,
      chosenCreatureType: 'Elf',
      card: {
        id: 'card_1',
        name: 'For the Ancestors',
        type_line: 'Instant',
        oracle_text: oracle,
        chosenCreatureType: 'Elf',
      },
    }];
    game.libraries.set(p1, [
      { id: 'elf_1', name: 'Elvish Mystic', type_line: 'Creature — Elf Druid' },
      { id: 'gob_1', name: 'Goblin Guide', type_line: 'Creature — Goblin Scout' },
      { id: 'elf_2', name: 'Elvish Visionary', type_line: 'Creature — Elf Shaman' },
      { id: 'land_1', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'elf_3', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid' },
      { id: 'inst_1', name: 'Giant Growth', type_line: 'Instant' },
    ] as any);
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        graveyard: [],
        exile: [],
        library: game.libraries.get(p1) || [],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
        libraryCount: 6,
      },
    };

    resolveTopOfStack(game as any);

    const searchStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step: any) => step?.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(searchStep).toBeTruthy();
    expect((searchStep as any).chosenTypeSelectionFilter).toBe('Elf');
    expect((searchStep as any).minSelections).toBe(0);
    expect((searchStep as any).maxSelections).toBe(3);
    expect((searchStep as any).remainderRandomOrder).toBe(true);
    expect(((searchStep as any).availableCards || []).map((card: any) => card.id)).toEqual([
      'elf_1',
      'gob_1',
      'elf_2',
      'land_1',
      'elf_3',
      'inst_1',
    ]);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('resolves Harmonized Crescendo by drawing for each permanent of the chosen type', () => {
    const oracle =
      'Convoke\nChoose a creature type. Draw a card for each permanent you control of that type.';
    const game = setupStackSpell(oracle, 'Harmonized Crescendo', 'Merfolk', [
      {
        id: 'merfolk_1',
        controller: p1,
        card: { name: 'Merfolk Looter', type_line: 'Creature — Merfolk' },
      },
      {
        id: 'soldier_1',
        controller: p1,
        card: { name: 'Soldier', type_line: 'Creature — Human Soldier' },
      },
    ]);

    resolveTopOfStack(game as any);

    const hand = (game.state as any).zones?.[p1]?.hand || [];
    expect(hand).toHaveLength(1);
    expect((game.libraries.get(p1) || []).length).toBe(1);
  });

  it('queues Celestial Reunion library search with X cap and conditional battlefield metadata', () => {
    const gameId = 'celestial_reunion_resolve';
    ResolutionQueueManager.removeQueue(gameId);
    const oracle =
      'As an additional cost to cast this spell, you may choose a creature type and behold two creatures of that type.\n'
      + "Search your library for a creature card with mana value X or less, reveal it, put it into your hand, then shuffle. If this spell's additional cost was paid and the revealed card is the chosen type, put that card onto the battlefield instead of putting it into your hand.";
    const game = createInitialGameState(gameId);
    (game as any).gameId = gameId;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [];
    (game.state as any).stack = [{
      id: 'spell_1',
      type: 'spell',
      controller: p1,
      xValue: 3,
      additionalCostPaid: true,
      chosenCreatureType: 'Elf',
      card: {
        id: 'card_1',
        name: 'Celestial Reunion',
        type_line: 'Sorcery',
        oracle_text: oracle,
        additionalCostPaid: true,
        chosenCreatureType: 'Elf',
      },
    }];
    game.libraries.set(p1, [
      {
        id: 'elf_1',
        name: 'Elvish Mystic',
        type_line: 'Creature — Elf Druid',
        cmc: 1,
        power: '1',
        toughness: '1',
      },
      {
        id: 'gob_1',
        name: 'Goblin Guide',
        type_line: 'Creature — Goblin Scout',
        cmc: 1,
        power: '2',
        toughness: '2',
      },
    ] as any);
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        graveyard: [],
        exile: [],
        library: game.libraries.get(p1) || [],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
        libraryCount: 2,
      },
    };

    resolveTopOfStack(game as any);

    const searchStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step: any) => step?.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(searchStep).toBeTruthy();
    expect((searchStep as any).filter?.types).toEqual(['creature']);
    expect((searchStep as any).filter?.maxCmc).toBe(3);
    expect((searchStep as any).chosenTypeBattlefieldIfPaid).toEqual({
      chosenType: 'Elf',
      additionalCostPaid: true,
    });
    expect(((searchStep as any).availableCards || []).map((card: any) => card.id)).toEqual(['elf_1', 'gob_1']);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('queues Celestial Reunion library search without behold battlefield metadata when additional cost unpaid', () => {
    const gameId = 'celestial_reunion_resolve_unpaid';
    ResolutionQueueManager.removeQueue(gameId);
    const oracle =
      'As an additional cost to cast this spell, you may choose a creature type and behold two creatures of that type.\n'
      + "Search your library for a creature card with mana value X or less, reveal it, put it into your hand, then shuffle. If this spell's additional cost was paid and the revealed card is the chosen type, put that card onto the battlefield instead of putting it into your hand.";
    const game = createInitialGameState(gameId);
    (game as any).gameId = gameId;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [];
    (game.state as any).stack = [{
      id: 'spell_2',
      type: 'spell',
      controller: p1,
      xValue: 2,
      additionalCostPaid: false,
      card: {
        id: 'card_2',
        name: 'Celestial Reunion',
        type_line: 'Sorcery',
        oracle_text: oracle,
        additionalCostPaid: false,
      },
    }];
    game.libraries.set(p1, [
      {
        id: 'gob_1',
        name: 'Goblin Guide',
        type_line: 'Creature — Goblin Scout',
        cmc: 1,
        power: '2',
        toughness: '2',
      },
    ] as any);
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        graveyard: [],
        exile: [],
        library: game.libraries.get(p1) || [],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
        libraryCount: 1,
      },
    };

    resolveTopOfStack(game as any);

    const searchStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step: any) => step?.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(searchStep).toBeTruthy();
    expect((searchStep as any).filter?.maxCmc).toBe(2);
    expect((searchStep as any).chosenTypeBattlefieldIfPaid).toBeUndefined();
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('queues creature type choice when Bloodline Shaman ability resolves without a chosen type', () => {
    const gameId = 'bloodline_shaman_stack';
    ResolutionQueueManager.removeQueue(gameId);
    const abilityText =
      '{T}: Choose a creature type. Reveal the top card of your library. If that card is a creature card of the chosen type, put it into your hand. Otherwise, put it into your graveyard.';
    const game = createInitialGameState(gameId);
    (game as any).gameId = gameId;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).stack = [{
      id: 'ability_1',
      type: 'ability',
      controller: p1,
      source: 'shaman_perm',
      sourceName: 'Bloodline Shaman',
      description: abilityText,
      activatedAbilityText: abilityText,
    }];
    game.libraries.set(p1, [
      { id: 'top_elf', name: 'Elvish Mystic', type_line: 'Creature — Elf Druid' },
    ] as any);
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        graveyard: [],
        exile: [],
        library: game.libraries.get(p1) || [],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
        libraryCount: 1,
      },
    };

    resolveTopOfStack(game as any);

    const typeStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step: any) => step?.type === ResolutionStepType.CREATURE_TYPE_CHOICE);
    expect(typeStep).toBeTruthy();
    expect((typeStep as any).spellId).toBe('ability_1');
    expect((game.state as any).stack).toHaveLength(1);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('draws per matching creature when Pol Jamaar ETB trigger resolves with chosen type', () => {
    const triggerText =
      'When Pol Jamaar enters, choose a creature type. Draw a card for each creature you control of that type.';
    const gameId = 'pol_jamaar_draw';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    (game as any).gameId = gameId;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'pol_1',
        controller: p1,
        chosenCreatureType: 'Elf',
        card: { name: 'Pol Jamaar, Illusionist', type_line: 'Legendary Creature — Illusion Wizard' },
      },
      {
        id: 'elf_1',
        controller: p1,
        card: { name: 'Elvish Mystic', type_line: 'Creature — Elf Druid' },
      },
      {
        id: 'gob_1',
        controller: p1,
        card: { name: 'Goblin Guide', type_line: 'Creature — Goblin Scout' },
      },
    ];
    (game.state as any).stack = [{
      id: 'trigger_1',
      type: 'triggered_ability',
      controller: p1,
      source: 'pol_1',
      permanentId: 'pol_1',
      sourceName: 'Pol Jamaar, Illusionist',
      description: triggerText,
      effect: triggerText,
      chosenCreatureType: 'Elf',
    }];
    game.libraries.set(p1, [
      { id: 'draw_1', name: 'Island', type_line: 'Instant' },
      { id: 'draw_2', name: 'Forest', type_line: 'Land' },
    ] as any);
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        graveyard: [],
        exile: [],
        library: game.libraries.get(p1) || [],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
        libraryCount: 2,
      },
    };

    resolveTopOfStack(game as any);

    expect((game.state as any).zones?.[p1]?.hand || []).toHaveLength(1);
    expect((game.state as any).zones?.[p1]?.hand?.[0]?.name).toBe('Island');
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('draws per matching creature when The Convincing General activated ability resolves', () => {
    const abilityText =
      '{3}, {T}: Choose a creature type. Draw a card for each creature you control of that type.';
    const gameId = 'convincing_general_draw';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    (game as any).gameId = gameId;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'general_1',
        controller: p1,
        card: { name: 'The Convincing General', type_line: 'Legendary Creature — Shapeshifter' },
      },
      {
        id: 'elf_1',
        controller: p1,
        card: { name: 'Elvish Mystic', type_line: 'Creature — Elf Druid' },
      },
      {
        id: 'elf_2',
        controller: p1,
        card: { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid' },
      },
    ];
    (game.state as any).stack = [{
      id: 'ability_1',
      type: 'ability',
      controller: p1,
      source: 'general_1',
      sourceName: 'The Convincing General',
      description: abilityText,
      activatedAbilityText: abilityText,
      chosenCreatureType: 'Elf',
    }];
    game.libraries.set(p1, [
      { id: 'draw_1', name: 'Island', type_line: 'Instant' },
      { id: 'draw_2', name: 'Forest', type_line: 'Land' },
      { id: 'draw_3', name: 'Mountain', type_line: 'Land' },
    ] as any);
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        graveyard: [],
        exile: [],
        library: game.libraries.get(p1) || [],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
        libraryCount: 3,
      },
    };

    resolveTopOfStack(game as any);

    expect((game.state as any).zones?.[p1]?.hand || []).toHaveLength(2);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('queues Icon of Ancestry top-three reveal using ETB chosen creature type', () => {
    const abilityText =
      '{3}, {T}: Look at the top three cards of your library. You may reveal a creature card of the chosen type from among them and put it into your hand. Put the rest on the bottom of your library in a random order.';
    const gameId = 'icon_of_ancestry_reveal';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    (game as any).gameId = gameId;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'icon_1',
      controller: p1,
      chosenCreatureType: 'Elf',
      card: { name: 'Icon of Ancestry', type_line: 'Artifact' },
    }];
    (game.state as any).stack = [{
      id: 'ability_1',
      type: 'ability',
      controller: p1,
      source: 'icon_1',
      sourceName: 'Icon of Ancestry',
      description: abilityText,
      activatedAbilityText: abilityText,
    }];
    game.libraries.set(p1, [
      { id: 'top_elf', name: 'Elvish Mystic', type_line: 'Creature — Elf Druid' },
      { id: 'top_island', name: 'Island', type_line: 'Basic Land — Island' },
      { id: 'top_goblin', name: 'Goblin Guide', type_line: 'Creature — Goblin Scout' },
    ] as any);
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        graveyard: [],
        exile: [],
        library: game.libraries.get(p1) || [],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
        libraryCount: 3,
      },
    };

    resolveTopOfStack(game as any);

    const revealStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step: any) => step?.type === ResolutionStepType.LIBRARY_SEARCH && (step as any).chosenTypeSelectionFilter);
    expect(revealStep).toBeTruthy();
    expect((revealStep as any).contextValue).toBe(3);
    expect((revealStep as any).chosenTypeSelectionFilter).toBe('Elf');
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('resolves Kindred Charge by creating hasty token copies scheduled for exile', () => {
    const oracle =
      "Choose a creature type. For each creature you control of the chosen type, create a token that's a copy of that creature. Those tokens gain haste. Exile them at the beginning of the next end step.";
    const game = setupStackSpell(oracle, 'Kindred Charge', 'Elf', [
      {
        id: 'elf_1',
        controller: p1,
        card: { name: 'Elvish Mystic', type_line: 'Creature — Elf Druid', power: '1', toughness: '1' },
      },
    ]);

    resolveTopOfStack(game as any);

    const tokens = ((game.state as any).battlefield || []).filter((perm: any) => perm?.isToken);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.tempAbilities || []).toContain('haste');
    expect((game.state as any).pendingExileAtNextEndStep || []).toHaveLength(1);
  });
});

describe('chosen creature type card census', () => {
  it('expects roughly ninety oracle cards with choose-a-creature-type text', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const execFileAsync = promisify(execFile);
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const scriptPath = path.join(repoRoot, 'server/scripts/audit-chosen-creature-type.mjs');
    const { stdout } = await execFileAsync(process.execPath, [scriptPath], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
    const audit = JSON.parse(stdout);
    expect(audit.total).toBeGreaterThanOrEqual(85);
    expect(audit.total).toBeLessThanOrEqual(100);
    expect(audit.byTag.etb_choose).toBeGreaterThan(50);
    expect(audit.byTag.non_etb_choose).toBeGreaterThan(30);
  });
});
