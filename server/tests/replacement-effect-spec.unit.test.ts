import { describe, expect, it } from 'vitest';

import {
  BUILTIN_REPLACEMENT_EFFECT_SPECS,
  collectReplacementEffectSpecsFromState,
  evaluateDeclarativeReplacementEvent,
  evaluateReplacementEffectSpec,
  summarizeLifeGainAmountReplacements,
  summarizeDrawAmountReplacements,
  summarizeTokenAmountReplacements,
} from '../src/state/modules/replacementEffectSpec.js';
import { applyLifeGain } from '../src/state/utils.js';
import { upsertCompiledOracleIROverlaySync } from '../src/services/oracleIrCompiledOverlayStore.js';
import {
  evaluateCounterPlacementReplacementEvent,
  evaluateMillReplacementEvent,
  evaluateLibrarySearchReplacementEvent,
} from '../src/state/modules/replacement-effects.js';
import { applyCounterModifications } from '../src/state/modules/counters_tokens.js';
import {
  calculateModifiedDamage,
  detectDamageReplacementEffects,
  detectLifeGainReplacementEffects,
  detectTokenCreationReplacementEffects,
  detectCounterReplacementEffects,
  detectMillReplacementEffects,
  applyMillReplacements,
  processLifeChange,
} from '../src/state/modules/game-state-effects.js';

describe('replacementEffectSpec (Phase 5.1 declarative registry)', () => {
  it('exposes builtin stack-to-exile, commander-zone, token, leave-battlefield, and finality specs', () => {
    expect(BUILTIN_REPLACEMENT_EFFECT_SPECS.some((spec) => spec.id === 'builtin-stack-graveyard-exile')).toBe(true);
    expect(BUILTIN_REPLACEMENT_EFFECT_SPECS.some((spec) => spec.id === 'builtin-commander-zone-replacement-choice')).toBe(true);
    expect(BUILTIN_REPLACEMENT_EFFECT_SPECS.some((spec) => spec.id === 'builtin-token-ceases-to-exist')).toBe(true);
    expect(BUILTIN_REPLACEMENT_EFFECT_SPECS.some((spec) => spec.id === 'builtin-leave-battlefield-exile-instead')).toBe(true);
    expect(BUILTIN_REPLACEMENT_EFFECT_SPECS.some((spec) => spec.id === 'builtin-finality-counter-exile-instead')).toBe(true);
  });

  it('redirects flashback stack resolution from graveyard to exile via declarative spec', () => {
    const stackItem = {
      id: 'flashback_stack_1',
      controller: 'p1',
      card: {
        id: 'flashback_card_1',
        name: 'Think Twice',
        type_line: 'Instant',
        castWithAbility: 'flashback',
      },
    };

    const result = evaluateDeclarativeReplacementEvent({
      type: 'zone-change',
      object: stackItem,
      objectId: stackItem.id,
      sourceZone: 'stack',
      destinationZone: 'graveyard',
      controller: 'p1',
      cause: 'spell_resolution',
    });

    expect(result).toMatchObject({
      applied: true,
      eventType: 'zone-change',
      effectId: 'stack-ability-exile-after-resolution',
      originalDestination: 'graveyard',
      replacementDestination: 'exile',
      reason: 'cast_with_ability_exiles_after_resolution',
      metadata: { castWithAbility: 'flashback' },
    });
  });

  it('redirects explicit exile-after-resolution markers via declarative spec', () => {
    const stackItem = {
      id: 'permission_stack_1',
      controller: 'p1',
      card: {
        id: 'permission_card_1',
        name: 'Borrowed Spell',
        type_line: 'Sorcery',
        exileAfterResolution: true,
      },
    };

    const result = evaluateReplacementEffectSpec(BUILTIN_REPLACEMENT_EFFECT_SPECS[0], {
      type: 'zone-change',
      object: stackItem,
      objectId: stackItem.id,
      sourceZone: 'stack',
      destinationZone: 'graveyard',
      controller: 'p1',
      cause: 'spell_resolution',
    });

    expect(result).toMatchObject({
      applied: true,
      effectId: 'stack-exile-after-resolution',
      replacementDestination: 'exile',
      reason: 'exile_after_resolution',
    });
  });

  it('evaluates commander zone replacement as a choice opportunity via declarative spec', () => {
    const commanderPermanent = {
      id: 'commander_perm_1',
      controller: 'p1',
      owner: 'p1',
      isCommander: true,
      card: {
        id: 'commander_card_1',
        name: 'Test Commander',
        type_line: 'Legendary Creature',
      },
    };

    const result = evaluateDeclarativeReplacementEvent({
      type: 'zone-change',
      object: commanderPermanent,
      objectId: commanderPermanent.id,
      sourceZone: 'battlefield',
      destinationZone: 'graveyard',
      controller: 'p1',
      owner: 'p1',
      cause: 'destroy',
    });

    expect(result).toMatchObject({
      applied: false,
      choiceRequired: true,
      eventType: 'zone-change',
      effectId: 'commander-zone-replacement-choice',
      sourceName: 'Test Commander',
      originalDestination: 'graveyard',
      replacementDestination: 'graveyard',
      replacementOptions: ['command', 'graveyard'],
      reason: 'commander_zone_replacement_choice',
      metadata: { commandZoneChoice: true, commanderId: 'commander_card_1' },
    });
  });

  it('recognizes commander replacement choices from command-zone metadata via declarative spec', () => {
    const commanderPermanent = {
      id: 'metadata_commander_perm_1',
      controller: 'p1',
      owner: 'p1',
      card: {
        id: 'metadata_commander_card_1',
        name: 'Metadata Commander',
        type_line: 'Legendary Creature',
      },
    };

    const result = evaluateDeclarativeReplacementEvent({
      type: 'zone-change',
      object: commanderPermanent,
      objectId: commanderPermanent.id,
      sourceZone: 'battlefield',
      destinationZone: 'hand',
      controller: 'p1',
      owner: 'p1',
      metadata: { commanderIds: ['metadata_commander_card_1'] },
    });

    expect(result).toMatchObject({
      applied: false,
      choiceRequired: true,
      effectId: 'commander-zone-replacement-choice',
      originalDestination: 'hand',
      replacementDestination: 'hand',
      replacementOptions: ['command', 'hand'],
      metadata: { commandZoneChoice: true, commanderId: 'metadata_commander_card_1' },
    });
  });

  it('collects replacement specs from compiled overlay STATIC/REPLACEMENT abilities on battlefield', () => {
    upsertCompiledOracleIROverlaySync({
      cardId: 'overlay-bruvac-test-id',
      name: 'Overlay Bruvac',
      envelope: {
        card_id: 'overlay-bruvac-test-id',
        abilities: [{
          ability_type: 'REPLACEMENT',
          effect_text: 'If an opponent would mill one or more cards, they mill twice that many cards instead.',
          steps: [],
          replacement_specs: [{
            id: 'mill-double-opponents',
            event: 'mill',
            match: { millingPlayerIsSourceController: true, targetIsOpponent: true },
            instead: { modify: 'double' },
            reason: 'overlay_mill_double',
          }],
        }],
      },
    });

    const specs = collectReplacementEffectSpecsFromState({
      battlefield: [{
        id: 'bruvac_perm_1',
        controller: 'p1',
        card: { id: 'overlay-bruvac-test-id', name: 'Overlay Bruvac', oracle_text: '' },
      }],
    });

    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      id: 'bruvac_perm_1:mill-double-opponents',
      event: 'mill',
      sourcePermanentId: 'bruvac_perm_1',
      sourceController: 'p1',
      sourceName: 'Overlay Bruvac',
      instead: { modify: 'double' },
    });
  });

  it('routes mill replacement through evaluateMillReplacementEvent with overlay specs', () => {
    upsertCompiledOracleIROverlaySync({
      cardId: 'overlay-water-crystal-test-id',
      name: 'Overlay Water Crystal',
      envelope: {
        card_id: 'overlay-water-crystal-test-id',
        abilities: [{
          ability_type: 'STATIC',
          effect_text: 'If an opponent would mill one or more cards, they mill that many cards plus four instead.',
          steps: [],
          replacement_specs: [{
            id: 'mill-plus-four',
            event: 'mill',
            match: { millingPlayerIsSourceController: true, targetIsOpponent: true },
            instead: { modify: 'add_flat', value: 4 },
          }],
        }],
      },
    });

    const state = {
      battlefield: [{
        id: 'water_crystal_perm_1',
        controller: 'p1',
        card: { id: 'overlay-water-crystal-test-id', name: 'Overlay Water Crystal', oracle_text: '' },
      }],
    };

    const result = evaluateMillReplacementEvent({
      state,
      millingPlayerId: 'p1',
      targetPlayerId: 'p2',
      count: 3,
    });

    expect(result).toMatchObject({
      applied: true,
      eventType: 'mill',
      originalAmount: 3,
      replacementAmount: 7,
      reason: 'mill_replacement',
    });
  });

  it('applies unnamed opponent mill double and plus-four without card-name routing', () => {
    const state = {
      battlefield: [
        {
          id: 'doubler_1',
          controller: 'p1',
          card: {
            name: 'Generic Mill Doubler',
            oracle_text:
              'If an opponent would mill one or more cards, they mill twice that many cards instead.',
          },
        },
        {
          id: 'plus_four_1',
          controller: 'p1',
          card: {
            name: 'Generic Mill Plus Four',
            oracle_text:
              'If an opponent would mill one or more cards, they mill that many cards plus four instead.',
          },
        },
      ],
    };

    expect(detectMillReplacementEffects({ state } as any, 'p1', 'p2').map((effect) => effect.source)).toEqual([
      'Generic Mill Doubler',
      'Generic Mill Plus Four',
    ]);
    expect(detectMillReplacementEffects({ state } as any, 'p1', 'p1')).toEqual([]);
    expect(applyMillReplacements({ state } as any, 3, 'p1', 'p2')).toEqual({
      finalCount: 14,
      appliedEffects: expect.arrayContaining([
        expect.stringContaining('Generic Mill Plus Four'),
        expect.stringContaining('Generic Mill Doubler'),
      ]),
    });

    const result = evaluateMillReplacementEvent({
      state,
      millingPlayerId: 'p1',
      targetPlayerId: 'p2',
      count: 3,
    });
    expect(result).toMatchObject({
      applied: true,
      eventType: 'mill',
      originalAmount: 3,
      replacementAmount: 14,
      reason: 'mill_replacement',
    });
  });

  it('applies unnamed library-search restrictions without card-name routing', () => {
    const state = {
      battlefield: [
        {
          id: 'prevent_1',
          controller: 'p2',
          card: {
            name: 'Generic Search Lock',
            oracle_text: 'Your opponents can\'t search libraries.',
          },
        },
        {
          id: 'named_without_oracle_1',
          controller: 'p2',
          card: {
            name: 'Ashiok, Dream Render',
            oracle_text: '',
          },
        },
      ],
    };

    const prevented = evaluateLibrarySearchReplacementEvent({
      state,
      searchingPlayerId: 'p1',
    });
    expect(prevented).toMatchObject({
      applied: true,
      effectId: 'library-search-prevented',
      reason: 'Generic Search Lock prevents library searching',
    });

    const selfSearch = evaluateLibrarySearchReplacementEvent({
      state,
      searchingPlayerId: 'p2',
    });
    expect(selfSearch.applied).not.toBe(true);

    const stacked = evaluateLibrarySearchReplacementEvent({
      state: {
        battlefield: [
          {
            id: 'limit_1',
            controller: 'p2',
            card: {
              name: 'Generic Top Four',
              oracle_text:
                'If an opponent would search a library, that player searches the top four cards of that library instead.',
            },
          },
          {
            id: 'pay_1',
            controller: 'p1',
            card: {
              name: 'Generic Search Tax',
              oracle_text:
                'Players can\'t search libraries. Any player may pay {2} for that player to ignore this effect until end of turn.',
            },
          },
          {
            id: 'control_1',
            controller: 'p2',
            card: {
              name: 'Generic Search Control',
              oracle_text: 'You control your opponents while they\'re searching their libraries.',
            },
          },
          {
            id: 'trigger_1',
            controller: 'p2',
            card: {
              name: 'Generic Search Punisher',
              oracle_text:
                'Whenever an opponent searches their library, that player sacrifices a creature of their choice and loses 10 life.',
            },
          },
        ],
      },
      searchingPlayerId: 'p1',
    });
    expect(stacked).toMatchObject({
      applied: true,
      effectId: 'library-search-limited',
      metadata: {
        canSearch: true,
        limitToTop: 4,
        controlledBy: 'p2',
        paymentRequired: { cardName: 'Generic Search Tax', amount: '{2}' },
      },
    });
    expect((stacked.metadata as any).triggerEffects).toEqual([
      { cardName: 'Generic Search Punisher', effect: 'Sacrifice a creature and lose 10 life', controllerId: 'p2' },
    ]);
  });

  it('evaluates finality counter graveyard redirect via declarative spec', () => {
    const creature = {
      id: 'finality_creature_1',
      controller: 'p1',
      counters: { finality: 1 },
      card: {
        id: 'finality_creature_card_1',
        name: 'Test Creature',
        type_line: 'Creature — Zombie',
      },
    };

    const result = evaluateDeclarativeReplacementEvent({
      type: 'zone-change',
      object: creature,
      objectId: creature.id,
      sourceZone: 'battlefield',
      destinationZone: 'graveyard',
      controller: 'p1',
      cause: 'destroy',
    });

    expect(result).toMatchObject({
      applied: true,
      effectId: 'finality-counter-exile-instead',
      replacementDestination: 'exile',
      reason: 'finality_counter',
    });
  });

  it('evaluates token battlefield exit as cease-to-exist via declarative spec', () => {
    const token = {
      id: 'token_1',
      controller: 'p1',
      isToken: true,
      card: { id: 'token_card_1', name: 'Spirit Token', type_line: 'Token Creature — Spirit' },
    };

    const result = evaluateDeclarativeReplacementEvent({
      type: 'zone-change',
      object: token,
      objectId: token.id,
      sourceZone: 'battlefield',
      destinationZone: 'hand',
      controller: 'p1',
      cause: 'bounce',
    });

    expect(result).toMatchObject({
      applied: true,
      effectId: 'token-ceases-to-exist',
      reason: 'token_left_battlefield',
      metadata: { ceasesToExist: true },
    });
  });

  it('collects oracle-pattern draw replacement specs from battlefield text', () => {
    const specs = collectReplacementEffectSpecsFromState({
      battlefield: [{
        id: 'notion_thief_1',
        controller: 'p2',
        card: {
          name: 'Notion Thief',
          oracle_text: "If an opponent would draw a card except the first one they draw in each of their draw steps, instead you draw a card.",
        },
      }],
    });

    expect(specs.some((spec) => spec.effectId === 'draw-replaced-by-opponent')).toBe(true);
  });

  it('routes Notion Thief draw replacement through declarative registry', () => {
    const state = {
      battlefield: [{
        id: 'notion_thief_1',
        controller: 'p2',
        card: {
          name: 'Notion Thief',
          oracle_text: "If an opponent would draw a card except the first one they draw in each of their draw steps, instead you draw a card.",
        },
      }],
    };

    const result = evaluateDeclarativeReplacementEvent({
      type: 'card-draw',
      state,
      playerId: 'p1',
      count: 1,
    }, state);

    expect(result).toMatchObject({
      applied: true,
      effectId: 'draw-replaced-by-opponent',
      sourceName: 'Notion Thief',
      originalAmount: 1,
      replacementAmount: 0,
      metadata: { playerId: 'p1', replacementPlayerId: 'p2' },
    });
  });

  it('routes Zur\'s Weirding draw replacement through declarative registry', () => {
    const state = {
      battlefield: [{
        id: 'zurs_weirding_1',
        controller: 'p2',
        card: {
          name: "Zur's Weirding",
          oracle_text: 'If a player would draw a card, that player reveals it instead. Then any other player may pay 4 life. If a player does, put the card into its owner\'s graveyard. Otherwise, that player puts it into their hand.',
        },
      }],
    };

    const result = evaluateDeclarativeReplacementEvent({
      type: 'card-draw',
      state,
      playerId: 'p1',
      count: 1,
      drawIndex: 0,
      metadata: { remainingDrawCountAfterChoice: 0 },
    }, state);

    expect(result).toMatchObject({
      applied: false,
      choiceRequired: true,
      effectId: 'zurs-weirding-draw-replacement',
      sourceName: "Zur's Weirding",
      reason: 'zurs_weirding_draw_replacement',
    });
  });

  it('routes Alms Collector shared draw through declarative registry', () => {
    const state = {
      battlefield: [{
        id: 'alms_collector_1',
        controller: 'p2',
        card: {
          name: 'Alms Collector',
          oracle_text: 'If an opponent would draw two or more cards, instead you and that player each draw a card.',
        },
      }],
    };

    const result = evaluateDeclarativeReplacementEvent({
      type: 'card-draw',
      state,
      playerId: 'p1',
      count: 2,
    }, state);

    expect(result).toMatchObject({
      applied: true,
      effectId: 'draw-replaced-by-shared-draw',
      sourceName: 'Alms Collector',
      originalAmount: 2,
      replacementAmount: 1,
      metadata: {
        playerId: 'p1',
        additionalDraws: [{ playerId: 'p2', count: 1 }],
      },
    });
  });

  it('collects oracle-pattern counter replacement specs without card-name routing', () => {
    const specs = collectReplacementEffectSpecsFromState({
      battlefield: [
        {
          id: 'fake_doubler_1',
          controller: 'p1',
          card: {
            name: 'Not A Real Card Name',
            oracle_text:
              'If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.',
          },
        },
        {
          id: 'fake_scales_1',
          controller: 'p1',
          card: {
            name: 'Also Fake',
            oracle_text:
              'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.',
          },
        },
        {
          id: 'fake_branching_1',
          controller: 'p1',
          card: {
            name: 'Still Fake',
            oracle_text:
              'If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on that creature instead.',
          },
        },
      ],
    });

    expect(specs.some((spec) => spec.effectId === 'permanent-counters-double')).toBe(true);
    expect(specs.some((spec) => spec.effectId === 'p1p1-counters-plus-one')).toBe(true);
    expect(specs.some((spec) => spec.effectId === 'p1p1-counters-double')).toBe(true);
  });

  it('applies Doubling Season + Hardened Scales via oracle-pattern counter specs', () => {
    const state = {
      battlefield: [
        {
          id: 'counter_target_1',
          controller: 'p1',
          card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
        },
        {
          id: 'doubling_season_1',
          controller: 'p1',
          card: {
            name: 'Wrong Name Season',
            oracle_text:
              'If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.',
          },
        },
        {
          id: 'hardened_scales_1',
          controller: 'p1',
          card: {
            name: 'Wrong Name Scales',
            oracle_text:
              'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.',
          },
        },
      ],
    };

    const modifiedDeltas = applyCounterModifications(state, 'counter_target_1', { '+1/+1': 2 });
    expect(modifiedDeltas).toEqual({ '+1/+1': 6 });

    const result = evaluateCounterPlacementReplacementEvent({
      state,
      targetPermanentId: 'counter_target_1',
      controllerId: 'p1',
      deltas: { '+1/+1': 2 },
      modifiedDeltas,
    });
    expect(result).toMatchObject({
      applied: true,
      effectId: 'counter-placement-modified',
      originalAmount: 2,
      replacementAmount: 6,
    });
  });

  it('applies unnamed global +1/+1 double and any-counter plus-one without card-name routing', () => {
    const state = {
      battlefield: [
        {
          id: 'bear_1',
          controller: 'p1',
          card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
        },
        {
          id: 'vigor_1',
          controller: 'p2',
          card: {
            name: 'Generic Global Counter Doubler',
            oracle_text:
              'If one or more +1/+1 counters would be put on a creature, twice that many +1/+1 counters are put on that creature instead.',
          },
        },
        {
          id: 'constrictor_1',
          controller: 'p1',
          card: {
            name: 'Generic Plus One',
            oracle_text:
              'If one or more counters would be put on an artifact or creature you control, that many plus one of each of those kinds of counters are put on that permanent instead.',
          },
        },
      ],
    };

    expect(detectCounterReplacementEffects({ state } as any, 'p1', '+1/+1').map((effect) => effect.source)).toEqual([
      'Generic Global Counter Doubler',
      'Generic Plus One',
    ]);
    expect(applyCounterModifications(state, 'bear_1', { '+1/+1': 2 })).toEqual({ '+1/+1': 6 });
    expect(applyCounterModifications(state, 'bear_1', { 'charge': 1 })).toEqual({ charge: 2 });
  });

  it('collects oracle-pattern damage replacement specs without card-name routing', () => {
    const furnaceOracle =
      'If a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.';
    const giselaOracle =
      'Flying, first strike\n'
      + 'If a source would deal damage to an opponent or a permanent an opponent controls, that source deals double that damage to that player or permanent instead.\n'
      + 'If a source would deal damage to you or a permanent you control, prevent half that damage, rounded up.';
    const angrathOracle =
      'If a source you control would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.';
    const emancipationOracle =
      'If a source you control would deal damage to a permanent or player, it deals triple that damage to that permanent or player instead.';
    const torbranOracle =
      'If a red source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.';
    const embermawOracle =
      'Trample\n'
      + 'If another red source you control would deal damage to a permanent or player, it deals that much damage plus 1 to that permanent or player instead.';

    const specs = collectReplacementEffectSpecsFromState({
      battlefield: [
        {
          id: 'fake_furnace_1',
          controller: 'p1',
          card: { name: 'Not Furnace', oracle_text: furnaceOracle },
        },
        {
          id: 'fake_gisela_1',
          controller: 'p1',
          card: { name: 'Not Gisela', oracle_text: giselaOracle },
        },
        {
          id: 'fake_angrath_1',
          controller: 'p1',
          card: { name: 'Not Angrath', oracle_text: angrathOracle },
        },
        {
          id: 'fake_emancipation_1',
          controller: 'p1',
          card: { name: 'Not Emancipation', oracle_text: emancipationOracle },
        },
        {
          id: 'fake_torbran_1',
          controller: 'p1',
          card: { name: 'Not Torbran', oracle_text: torbranOracle },
        },
        {
          id: 'fake_embermaw_1',
          controller: 'p1',
          card: { name: 'Not Embermaw', oracle_text: embermawOracle },
        },
      ],
    });

    expect(specs.some((spec) => spec.effectId === 'all-source-damage-double')).toBe(true);
    expect(specs.some((spec) => spec.effectId === 'damage-to-opponent-double')).toBe(true);
    expect(specs.some((spec) => spec.effectId === 'damage-to-you-prevent-half')).toBe(true);
    expect(specs.some((spec) => spec.effectId === 'source-you-control-damage-double')).toBe(true);
    expect(specs.some((spec) => spec.effectId === 'source-you-control-damage-triple')).toBe(true);
    expect(specs.some((spec) => spec.effectId === 'red-source-you-control-damage-plus-2')).toBe(true);
    expect(specs.some((spec) => spec.effectId === 'another-red-source-you-control-damage-plus-1')).toBe(true);
  });

  it('applies enchanted-creature combat double from oracle text + attachedTo (Sound of Drums shape)', () => {
    const soundOfDrumsOracle =
      'Enchant creature\n'
      + 'Enchanted creature is goaded.\n'
      + 'If enchanted creature would deal combat damage to a permanent or player, it deals double that damage instead.\n'
      + '{2}{R}: Return this card from your graveyard to your hand.';

    const specs = collectReplacementEffectSpecsFromState({
      battlefield: [
        {
          id: 'attacker_1',
          controller: 'p1',
          card: { name: 'Goaded Bear', type_line: 'Creature — Bear' },
        },
        {
          id: 'aura_1',
          controller: 'p1',
          attachedTo: 'attacker_1',
          card: { name: 'Anonymous Aura', oracle_text: soundOfDrumsOracle },
        },
      ],
    });
    expect(specs.some((spec) => spec.effectId === 'enchanted-creature-combat-damage-double')).toBe(true);

    const ctx = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [
          {
            id: 'attacker_1',
            controller: 'p1',
            card: { name: 'Goaded Bear', type_line: 'Creature — Bear' },
          },
          {
            id: 'aura_1',
            controller: 'p1',
            attachedTo: 'attacker_1',
            card: { name: 'Anonymous Aura', oracle_text: soundOfDrumsOracle },
          },
        ],
      },
    } as any;

    expect(calculateModifiedDamage(ctx, 3, 'p1', 'p2', 'attacker_1', true).amount).toBe(6);
    expect(calculateModifiedDamage(ctx, 3, 'p1', 'p2', 'other_creature', true).amount).toBe(3);
    // Non-combat damage from the enchanted creature must not double.
    expect(calculateModifiedDamage(ctx, 3, 'p1', 'p2', 'attacker_1', false).amount).toBe(3);
    // Permanent combat path uses the target permanent's controller as damageReceiver.
    expect(calculateModifiedDamage(ctx, 2, 'p1', 'p2', 'attacker_1', true).amount).toBe(4);
  });

  it('applies Furnace-style all-damage double via oracle-pattern detect path', () => {
    const furnaceOracle =
      'If a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.';
    const ctx = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [
          {
            id: 'fake_furnace_1',
            controller: 'p1',
            card: { name: 'Anonymous Furnace', oracle_text: furnaceOracle },
          },
        ],
      },
    } as any;

    const effects = detectDamageReplacementEffects(ctx, 'p2', 'p1', true);
    expect(effects.some((effect) => effect.type === 'double')).toBe(true);

    const modified = calculateModifiedDamage(ctx, 3, 'p2', 'p1');
    expect(modified.amount).toBe(6);
  });

  it('applies Gisela-style opponent-double / self-halve from oracle text alone', () => {
    const giselaOracle =
      'Flying, first strike\n'
      + 'If a source would deal damage to an opponent or a permanent an opponent controls, that source deals double that damage to that player or permanent instead.\n'
      + 'If a source would deal damage to you or a permanent you control, prevent half that damage, rounded up.';
    const ctx = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [
          {
            id: 'fake_gisela_1',
            controller: 'p1',
            card: { name: 'Anonymous Angel', oracle_text: giselaOracle },
          },
        ],
      },
    } as any;

    // Damage to opponent of Gisela's controller doubles (any source).
    expect(calculateModifiedDamage(ctx, 4, 'p2', 'p2').amount).toBe(8);
    // Damage to Gisela's controller: prevent half rounded up ⇒ remaining floor half.
    expect(calculateModifiedDamage(ctx, 5, 'p2', 'p1').amount).toBe(2);
  });

  it('applies Emancipation-style triple and Torbran-style plus-2 from oracle text alone', () => {
    const emancipationOracle =
      'If a source you control would deal damage to a permanent or player, it deals triple that damage to that permanent or player instead.';
    const cityOracle =
      'Convoke\n'
      + 'If a source you control would deal damage to a permanent or player, it deals triple that damage instead.';
    const torbranOracle =
      'If a red source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.';

    const tripleCtx = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [
          {
            id: 'fake_emancipation_1',
            controller: 'p1',
            card: { name: 'Anonymous Emancipation', oracle_text: emancipationOracle },
          },
        ],
      },
    } as any;
    expect(calculateModifiedDamage(tripleCtx, 3, 'p1', 'p2').amount).toBe(9);
    expect(calculateModifiedDamage(tripleCtx, 3, 'p2', 'p1').amount).toBe(3);

    const cityCtx = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [
          {
            id: 'fake_city_1',
            controller: 'p1',
            card: { name: 'Anonymous City', oracle_text: cityOracle },
          },
        ],
      },
    } as any;
    expect(calculateModifiedDamage(cityCtx, 2, 'p1', 'p2').amount).toBe(6);

    const torbranCtx = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [
          {
            id: 'fake_torbran_1',
            controller: 'p1',
            card: { name: 'Anonymous Torbran', oracle_text: torbranOracle },
          },
        ],
      },
    } as any;
    expect(calculateModifiedDamage(torbranCtx, 3, 'p1', 'p2').amount).toBe(5);
    expect(calculateModifiedDamage(torbranCtx, 3, 'p1', 'p1').amount).toBe(3);
  });

  it('applies Vorinclex-style you-double / opponent-halve from oracle text alone', () => {
    const vorinclexOracle =
      'Trample, haste\n'
      + 'If you would put one or more counters on a permanent or player, put twice that many of each of those kinds of counters on that permanent or player instead.\n'
      + 'If an opponent would put one or more counters on a permanent or player, they put half that many of each of those kinds of counters on that permanent or player instead, rounded down.';

    const yourCreatureState = {
      battlefield: [
        {
          id: 'your_bear',
          controller: 'p1',
          card: { name: 'Bear', type_line: 'Creature — Bear' },
        },
        {
          id: 'praetor_1',
          controller: 'p1',
          card: { name: 'Anonymous Praetor', oracle_text: vorinclexOracle },
        },
      ],
    };
    expect(applyCounterModifications(yourCreatureState, 'your_bear', { '+1/+1': 3 })).toEqual({ '+1/+1': 6 });

    const oppCreatureState = {
      battlefield: [
        {
          id: 'opp_bear',
          controller: 'p2',
          card: { name: 'Bear', type_line: 'Creature — Bear' },
        },
        {
          id: 'praetor_1',
          controller: 'p1',
          card: { name: 'Anonymous Praetor', oracle_text: vorinclexOracle },
        },
      ],
    };
    expect(applyCounterModifications(oppCreatureState, 'opp_bear', { '+1/+1': 3 })).toEqual({ '+1/+1': 1 });
  });

  it('routes dredge draw replacement through declarative registry before opponent effects', () => {
    const state = {
      zones: {
        p1: {
          hand: [],
          libraryCount: 5,
          graveyard: [
            { id: 'stinkweed_imp_1', name: 'Stinkweed Imp', oracle_text: 'Flying\nDredge 5' },
          ],
        },
      },
      battlefield: [{
        id: 'notion_thief_1',
        controller: 'p2',
        card: {
          name: 'Notion Thief',
          oracle_text: "If an opponent would draw a card except the first one they draw in each of their draw steps, instead you draw a card.",
        },
      }],
    };

    const result = evaluateDeclarativeReplacementEvent({
      type: 'card-draw',
      state,
      playerId: 'p1',
      count: 1,
    }, state);

    expect(result).toMatchObject({
      applied: false,
      choiceRequired: true,
      effectId: 'dredge-draw-replacement-choice',
      reason: 'dredge_replacement_choice',
    });
    expect((result?.metadata as any)?.dredgeOptions).toEqual([
      { cardId: 'stinkweed_imp_1', cardName: 'Stinkweed Imp', dredge: 5 },
    ]);
  });

  it('prevents life gain via oracle-pattern declarative specs (Players can\'t gain life)', () => {
    const state = {
      life: { p1: 30, p2: 40 },
      battlefield: [{
        id: 'sulfuric_vortex_1',
        controller: 'p2',
        card: {
          name: 'Sulfuric Vortex',
          oracle_text: "At the beginning of each player's upkeep, Sulfuric Vortex deals 1 damage to that player. Players can't gain life.",
        },
      }],
    };

    const result = evaluateDeclarativeReplacementEvent({
      type: 'life-gain',
      state,
      playerId: 'p1',
      amount: 3,
    }, state);

    expect(result).toMatchObject({
      applied: true,
      effectId: 'life-gain-prevented',
      sourceName: 'Sulfuric Vortex',
      originalAmount: 3,
      replacementAmount: 0,
      preventedAmount: 3,
      reason: 'life_gain_prevented',
    });
  });

  it('prevents opponent life gain via oracle-pattern declarative specs', () => {
    const state = {
      life: { p1: 30, p2: 40 },
      battlefield: [{
        id: 'erebos_1',
        controller: 'p2',
        card: {
          name: 'Erebos, God of the Dead',
          oracle_text: "Your opponents can't gain life.",
        },
      }],
    };

    const blocked = evaluateDeclarativeReplacementEvent({
      type: 'life-gain',
      state,
      playerId: 'p1',
      amount: 2,
    }, state);
    expect(blocked).toMatchObject({
      applied: true,
      effectId: 'life-gain-prevented',
      sourceName: 'Erebos, God of the Dead',
    });

    const allowed = evaluateDeclarativeReplacementEvent({
      type: 'life-gain',
      state,
      playerId: 'p2',
      amount: 2,
    }, state);
    expect(allowed).toBeNull();
  });

  it('reverses opponent life gain to loss via oracle-pattern declarative specs', () => {
    const state = {
      life: { p1: 30, p2: 40 },
      battlefield: [{
        id: 'tainted_remedy_1',
        controller: 'p2',
        card: {
          name: 'Tainted Remedy',
          oracle_text: 'If an opponent would gain life, that player loses that much life instead.',
        },
      }],
    };

    const result = evaluateDeclarativeReplacementEvent({
      type: 'life-gain',
      state,
      playerId: 'p1',
      amount: 4,
    }, state);

    expect(result).toMatchObject({
      applied: true,
      effectId: 'life-gain-reversed-to-loss',
      sourceName: 'Tainted Remedy',
      originalAmount: 4,
      replacementAmount: -4,
      reason: 'life_gain_reversed_to_loss',
      metadata: { reversedToLoss: true },
    });
  });

  it('routes Rest in Peace graveyard-to-exile replacement through declarative registry', () => {
    const state = {
      battlefield: [{
        id: 'rest_in_peace_1',
        controller: 'p2',
        card: {
          name: 'Rest in Peace',
          oracle_text: 'If a card would be put into a graveyard from anywhere, exile it instead.',
        },
      }],
    };

    const result = evaluateDeclarativeReplacementEvent({
      type: 'zone-change',
      object: {
        id: 'bolt_1',
        name: 'Lightning Bolt',
        type_line: 'Instant',
      },
      objectId: 'bolt_1',
      sourceZone: 'stack',
      destinationZone: 'graveyard',
      controller: 'p1',
      cause: 'spell_resolution',
    }, state);

    expect(result).toMatchObject({
      applied: true,
      effectId: 'graveyard-to-exile-replacement',
      sourceName: 'Rest in Peace',
      originalDestination: 'graveyard',
      replacementDestination: 'exile',
      reason: 'graveyard_to_exile_replacement',
    });
  });

  it('does not treat Blightsteel self-shuffle as graveyard-to-exile replacement', () => {
    const state = {
      battlefield: [{
        id: 'blightsteel_1',
        controller: 'p1',
        card: {
          name: 'Blightsteel Colossus',
          type_line: 'Artifact Creature — Phyrexian Golem',
          oracle_text: 'Trample, infect, indestructible\nIf Blightsteel Colossus would be put into a graveyard from anywhere, reveal it and shuffle it into its owner\'s library instead.',
        },
      }],
    };

    const specs = collectReplacementEffectSpecsFromState(state);
    expect(specs.some((spec) => spec.effectId === 'graveyard-to-exile-replacement')).toBe(false);
  });

  it('routes creature-would-die exile replacement through declarative registry', () => {
    const state = {
      battlefield: [{
        id: 'graf_replacement_1',
        controller: 'p2',
        card: {
          name: 'Test Replacement',
          oracle_text: 'If a creature would die, exile it instead.',
        },
      }],
    };

    const result = evaluateDeclarativeReplacementEvent({
      type: 'zone-change',
      object: {
        id: 'bear_1',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
      },
      objectId: 'bear_1',
      sourceZone: 'battlefield',
      destinationZone: 'graveyard',
      controller: 'p1',
      cause: 'destroy',
    }, state);

    expect(result).toMatchObject({
      applied: true,
      effectId: 'creature-die-exile-instead',
      sourceName: 'Test Replacement',
      replacementDestination: 'exile',
      reason: 'creature_die_exile_instead',
    });
  });

  it('routes Blightsteel self-shuffle replacement through declarative registry', () => {
    const blightsteel = {
      id: 'blightsteel_card',
      name: 'Blightsteel Colossus',
      type_line: 'Artifact Creature — Phyrexian Golem',
      oracle_text: 'Trample, infect, indestructible\nIf Blightsteel Colossus would be put into a graveyard from anywhere, reveal it and shuffle it into its owner\'s library instead.',
    };

    const result = evaluateDeclarativeReplacementEvent({
      type: 'zone-change',
      object: blightsteel,
      objectId: 'blightsteel_card',
      sourceZone: 'battlefield',
      destinationZone: 'graveyard',
      controller: 'p1',
      cause: 'destroy',
    });

    expect(result).toMatchObject({
      applied: true,
      effectId: 'self-shuffle-into-library',
      sourceName: 'Blightsteel Colossus',
      originalDestination: 'graveyard',
      replacementDestination: 'library',
      reason: 'graveyard_self_shuffle_into_library',
      metadata: { shuffleIntoOwnerLibrary: true },
    });
  });

  it('does not first-match amount-modify life-gain so +1 and doubles can stack', () => {
    const state = {
      life: { p1: 30 },
      battlefield: [{
        id: 'doubler_1',
        controller: 'p1',
        card: {
          name: 'Generic Life Doubler',
          oracle_text: 'If you would gain life, you gain twice that much life instead.',
        },
      }],
    };

    expect(evaluateDeclarativeReplacementEvent({
      type: 'life-gain',
      state,
      playerId: 'p1',
      amount: 3,
    }, state)).toBeNull();

    expect(summarizeLifeGainAmountReplacements(state, 'p1')).toEqual({
      extraLife: 0,
      multiplier: 2,
      extraSources: [],
      doubleSources: ['Generic Life Doubler'],
    });
  });

  it('applies oracle-pattern life-gain +1 then double without card-name routing', () => {
    const state = {
      life: { p1: 20, p2: 40 },
      startingLife: 40,
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [
        {
          id: 'plus_1',
          controller: 'p1',
          card: {
            name: 'Generic Plus One',
            oracle_text: 'If you would gain life, you gain that much life plus 1 instead.',
          },
        },
        {
          id: 'doubler_1',
          controller: 'p1',
          card: {
            name: 'Generic Life Doubler',
            oracle_text: 'If you would gain life, you gain twice that much life instead.',
          },
        },
        {
          id: 'opponent_doubler',
          controller: 'p2',
          card: {
            name: 'Opponent Doubler',
            oracle_text: 'If you would gain life, you gain twice that much life instead.',
          },
        },
      ],
    };

    const summary = summarizeLifeGainAmountReplacements(state, 'p1');
    expect(summary.extraLife).toBe(1);
    expect(summary.multiplier).toBe(2);
    expect(summary.extraSources).toEqual(['Generic Plus One']);
    expect(summary.doubleSources).toEqual(['Generic Life Doubler']);

    const result = applyLifeGain(state, 'p1', 3, 'test');
    expect(result.actualChange).toBe(8);
    expect(state.life.p1).toBe(28);
  });

  it('applies Angel of Vitality plus-1 only when the gaining player has 25 or more life', () => {
    const makeState = (life: number) => ({
      life: { p1: life },
      startingLife: 40,
      players: [{ id: 'p1' }],
      battlefield: [{
        id: 'angel_1',
        controller: 'p1',
        card: {
          name: 'Angel of Vitality',
          oracle_text: 'If you would gain life and you have 25 or more life, you gain that much life plus 1 instead.',
        },
      }],
    });

    const below = makeState(24);
    expect(summarizeLifeGainAmountReplacements(below, 'p1').extraLife).toBe(0);
    expect(applyLifeGain(below, 'p1', 2, 'test').actualChange).toBe(2);

    const atThreshold = makeState(25);
    expect(summarizeLifeGainAmountReplacements(atThreshold, 'p1').extraLife).toBe(1);
    expect(applyLifeGain(atThreshold, 'p1', 2, 'test').actualChange).toBe(3);
  });

  it('does not first-match amount-modify extra-draw so doubles can stack', () => {
    const state = {
      battlefield: [{
        id: 'archive_1',
        controller: 'p1',
        card: {
          name: 'Generic Extra Draw',
          oracle_text: 'If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.',
        },
      }],
    };

    expect(evaluateDeclarativeReplacementEvent({
      type: 'card-draw',
      state,
      playerId: 'p1',
      count: 1,
    }, state)).toBeNull();

    expect(summarizeDrawAmountReplacements(state, 'p1')).toEqual({
      extraCards: 0,
      multiplier: 2,
      extraSources: [],
      doubleSources: ['Generic Extra Draw'],
    });
  });

  it('skips except-first extra-draw on the first draw-step draw and isolates opponent copies', () => {
    const state = {
      battlefield: [
        {
          id: 'archive_1',
          controller: 'p1',
          card: {
            name: 'Generic Extra Draw',
            oracle_text: 'If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.',
          },
        },
        {
          id: 'archive_2',
          controller: 'p1',
          card: {
            name: 'Second Extra Draw',
            oracle_text: 'If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.',
          },
        },
        {
          id: 'opponent_archive',
          controller: 'p2',
          card: {
            name: 'Opponent Extra Draw',
            oracle_text: 'If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.',
          },
        },
      ],
    };

    expect(summarizeDrawAmountReplacements(state, 'p1', { isFirstDrawStepDraw: true }).multiplier).toBe(1);
    expect(summarizeDrawAmountReplacements(state, 'p1').multiplier).toBe(4);
    expect(summarizeDrawAmountReplacements(state, 'p1').doubleSources).toEqual([
      'Generic Extra Draw',
      'Second Extra Draw',
    ]);
    expect(summarizeDrawAmountReplacements(state, 'p2').multiplier).toBe(2);
  });

  it('applies unconditional extra-draw including the first draw-step draw', () => {
    const state = {
      battlefield: [{
        id: 'reflection_1',
        controller: 'p1',
        card: {
          name: 'Generic Unconditional Extra Draw',
          oracle_text: 'If you would draw a card, draw two cards instead.',
        },
      }],
    };

    expect(summarizeDrawAmountReplacements(state, 'p1', { isFirstDrawStepDraw: true }).multiplier).toBe(2);
    expect(summarizeDrawAmountReplacements(state, 'p1').multiplier).toBe(2);
  });

  it('matches combined life-gain and except-first extra-draw oracle on the same permanent', () => {
    const state = {
      battlefield: [{
        id: 'archive_1',
        controller: 'p1',
        card: {
          name: 'Generic Archive',
          oracle_text: 'If you would gain life, you gain twice that much life instead.\nIf you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.',
        },
      }],
    };

    expect(summarizeLifeGainAmountReplacements(state, 'p1').multiplier).toBe(2);
    expect(summarizeDrawAmountReplacements(state, 'p1').multiplier).toBe(2);
    expect(summarizeDrawAmountReplacements(state, 'p1', { isFirstDrawStepDraw: true }).multiplier).toBe(1);
  });

  it('applies oracle-pattern life-gain doubles through processLifeChange without card-name routing', () => {
    const ctx = {
      state: {
        life: { p1: 20, p2: 40 },
        startingLife: 40,
        battlefield: [
          {
            id: 'doubler_1',
            controller: 'p1',
            card: {
              name: 'Generic Life Doubler',
              oracle_text: 'If you would gain life, you gain twice that much life instead.',
            },
          },
          {
            id: 'opponent_doubler',
            controller: 'p2',
            card: {
              name: 'Opponent Doubler',
              oracle_text: 'If you would gain life, you gain twice that much life instead.',
            },
          },
        ],
      },
    };

    expect(detectLifeGainReplacementEffects(ctx as any, 'p1').map((effect) => effect.source)).toEqual([
      'Generic Life Doubler',
    ]);
    expect(processLifeChange(ctx as any, 'p1', 3, true)).toMatchObject({
      finalAmount: 6,
      prevented: false,
    });
  });

  it('does not first-match amount-modify token doubles so they can stack', () => {
    const state = {
      battlefield: [
        {
          id: 'procession_1',
          controller: 'p1',
          card: {
            name: 'Generic Token Doubler',
            oracle_text: 'If one or more tokens would be created under your control, twice that many of those tokens are created instead.',
          },
        },
        {
          id: 'vigor_1',
          controller: 'p2',
          card: {
            name: 'Generic Global Token Doubler',
            oracle_text: 'If one or more tokens would be created, twice that many of those tokens are created instead.',
          },
        },
        {
          id: 'ojer_1',
          controller: 'p1',
          card: {
            name: 'Generic Creature Token Tripler',
            oracle_text: 'If one or more creature tokens would be created under your control, three times that many creature tokens are created instead.',
          },
        },
      ],
    };

    expect(evaluateDeclarativeReplacementEvent({
      type: 'token-creation',
      state,
      controllerId: 'p1',
      count: 1,
      tokenName: 'Soldier',
      tokenTypeLine: 'Token Creature — Soldier',
    }, state)).toBeNull();

    expect(summarizeTokenAmountReplacements(state, 'p1', {
      tokenName: 'Soldier',
      tokenTypeLine: 'Token Creature — Soldier',
    })).toEqual({
      extraTokens: 0,
      multiplier: 12,
      extraSources: [],
      doubleSources: ['Generic Token Doubler', 'Generic Global Token Doubler', 'Generic Creature Token Tripler'],
    });

    expect(summarizeTokenAmountReplacements(state, 'p2', {
      tokenName: 'Soldier',
      tokenTypeLine: 'Token Creature — Soldier',
    }).multiplier).toBe(2);

    expect(summarizeTokenAmountReplacements(state, 'p1', {
      tokenName: 'Treasure',
      tokenTypeLine: 'Token Artifact — Treasure',
    }).multiplier).toBe(4);

    expect(detectTokenCreationReplacementEffects({ state } as any, 'p1').map((effect) => effect.source)).toEqual([
      'Generic Token Doubler',
      'Generic Global Token Doubler',
      'Generic Creature Token Tripler',
    ]);
  });
});
