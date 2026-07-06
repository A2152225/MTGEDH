import { describe, expect, it } from 'vitest';

import {
  BUILTIN_REPLACEMENT_EFFECT_SPECS,
  collectReplacementEffectSpecsFromState,
  evaluateDeclarativeReplacementEvent,
  evaluateReplacementEffectSpec,
} from '../src/state/modules/replacementEffectSpec.js';
import { upsertCompiledOracleIROverlaySync } from '../src/services/oracleIrCompiledOverlayStore.js';
import { evaluateMillReplacementEvent } from '../src/state/modules/replacement-effects.js';

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
});
