import { describe, expect, it, vi } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import {
  tryParseOwnedPermanentsShuffleRevealTemplate,
  tryParseRepeatedZoneDraftAuctionTemplate,
  tryParseSeparateControlledPermanentsIntoPilesTemplate,
  tryParseLibraryChaosExchangeTemplate,
  tryParseRandomControlAssignmentTemplate,
} from '../src/oracleIRParserChaosZoneTemplates.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';
import { isSpellEffectFullyIrWired } from '../../server/src/state/modules/oracleIrSpellLegacyRouting.js';
import { resolveRepeatedZoneDraftAuraAttachId } from '../src/oracleIRExecutorRepeatedZoneDraft.js';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes.js';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';

const WARP_WORLD_TEXT =
  "Each player shuffles all permanents they own into their library, then reveals that many cards from the top of their library. Each player puts all artifact, creature, and land cards revealed this way onto the battlefield, then does the same for enchantment cards, then puts all cards revealed this way that weren't put onto the battlefield on the bottom of their library.";

const GLIMPSE_OF_TOMORROW_TEXT =
  "Shuffle all permanents you own into your library, then reveal that many cards from the top of your library. Put all non-Aura permanent cards revealed this way onto the battlefield, then do the same for Aura cards, then put the rest on the bottom of your library in a random order.";

const THIEVES_AUCTION_TEXT =
  "Exile all nontoken permanents. Starting with you, each player chooses one of the exiled cards and puts it onto the battlefield tapped under their control. Repeat this process until all cards exiled this way have been chosen.";
const WHIMS_OF_THE_FATES_TEXT =
  'Starting with you, each player separates all permanents they control into three piles. Then each player chooses one of their piles at random and sacrifices those permanents. (Piles can be empty.)';
const GUFF_REWRITES_HISTORY_TEXT =
  "For each player, choose target nonenchantment, nonland permanent that player controls. Those permanents' owners shuffle them into their libraries. Each player who controlled one of those permanents exiles cards from the top of their library until they exile a nonland card, then puts the rest on the bottom of their library in a random order. Each player may cast the nonland card they exiled without paying its mana cost.";
const AUDACIOUS_SWAP_TEXT =
  "The owner of target nonenchantment permanent shuffles it into their library, then exiles the top card of their library. If it's a land card, they put it onto the battlefield. Otherwise, they may cast it without paying its mana cost.";
const SCRAMBLEVERSE_TEXT =
  'For each nonland permanent, choose a player at random. Then each player gains control of each permanent for which they were chosen. Untap those permanents.';

describe('Oracle IR chaos zone template parsing', () => {
  it('parses Warp World into 5 steps', () => {
    const steps = tryParseOwnedPermanentsShuffleRevealTemplate(WARP_WORLD_TEXT);
    expect(steps).not.toBeNull();
    expect(steps?.map((step) => step.kind)).toEqual([
      'move_zone',
      'reveal_top',
      'move_zone',
      'move_zone',
      'move_zone',
    ]);
    const shuffleStep = steps?.[0] as any;
    expect(shuffleStep.who?.kind).toBe('each_player');
    expect(shuffleStep.to).toBe('library');
    const revealStep = steps?.[1] as any;
    expect(revealStep.who?.kind).toBe('each_player');
    expect(revealStep.amount?.kind).toBe('reference_amount');
    const firstWave = steps?.[2] as any;
    expect(firstWave.what?.text).toMatch(/artifact, creature, and land/i);
    expect(firstWave.battlefieldController?.kind).toBe('owner_of_moved_cards');
    const secondWave = steps?.[3] as any;
    expect(secondWave.what?.text).toMatch(/enchantment/i);
    const remainder = steps?.[4] as any;
    expect(remainder.to).toBe('library');
  });

  it('parses Glimpse of Tomorrow into 5 steps including the random-order rest', () => {
    const steps = tryParseOwnedPermanentsShuffleRevealTemplate(GLIMPSE_OF_TOMORROW_TEXT);
    expect(steps).not.toBeNull();
    expect(steps?.map((step) => step.kind)).toEqual([
      'move_zone',
      'reveal_top',
      'move_zone',
      'move_zone',
      'move_zone',
    ]);
    const shuffleStep = steps?.[0] as any;
    expect(shuffleStep.who).toBeUndefined();
    const firstWave = steps?.[2] as any;
    expect(firstWave.what?.text).toMatch(/non-aura permanent/i);
    const secondWave = steps?.[3] as any;
    expect(secondWave.what?.text).toMatch(/aura/i);
    const remainder = steps?.[4] as any;
    expect(remainder.to).toBe('library');
    expect(remainder.raw).toMatch(/random order/i);
  });

  it("parses Thieves' Auction into exile + repeated_zone_draft", () => {
    const steps = tryParseRepeatedZoneDraftAuctionTemplate(THIEVES_AUCTION_TEXT);
    expect(steps).not.toBeNull();
    expect(steps?.map((step) => step.kind)).toEqual(['exile', 'repeated_zone_draft']);
    const exileStep = steps?.[0] as any;
    expect(exileStep.target?.text).toMatch(/all nontoken permanents/i);
    const draftStep = steps?.[1] as any;
    expect(draftStep.whoStarts?.kind).toBe('you');
    expect(draftStep.chooserOrder).toBe('turn_order');
    expect(draftStep.destination).toBe('battlefield');
    expect(draftStep.entersTapped).toBe(true);
    expect(draftStep.battlefieldController?.kind).toBe('chooser');
  });

  it('parses an each-player three-pile random sacrifice as an interactive step', () => {
    const steps = tryParseSeparateControlledPermanentsIntoPilesTemplate(WHIMS_OF_THE_FATES_TEXT);
    expect(steps).toHaveLength(1);
    expect(steps?.[0]).toMatchObject({
      kind: 'separate_into_piles',
      pileCount: 3,
      allowEmptyPiles: true,
      randomPileAction: 'sacrifice',
      who: { kind: 'each_player' },
      startingWith: { kind: 'you' },
    });

    const parsed = parseOracleTextToIR(WHIMS_OF_THE_FATES_TEXT, 'Whims of the Fates');
    expect(parsed.abilities[0]?.steps.map((step) => step.kind)).toEqual(['separate_into_piles']);
  });

  it('parses each-player exile-until-nonland history exchange', () => {
    expect(tryParseLibraryChaosExchangeTemplate(GUFF_REWRITES_HISTORY_TEXT)?.[0]).toMatchObject({
      kind: 'library_chaos_exchange',
      targetMode: 'one_per_player',
      exileMode: 'until_nonland',
      bottomRestRandom: true,
    });
    const parsed = parseOracleTextToIR(GUFF_REWRITES_HISTORY_TEXT, 'History Exchange');
    expect(parsed.abilities[0]?.steps.map((step) => step.kind)).toEqual(['library_chaos_exchange']);
  });

  it('parses a single-target top-card land-or-free-cast exchange', () => {
    expect(tryParseLibraryChaosExchangeTemplate(AUDACIOUS_SWAP_TEXT)?.[0]).toMatchObject({
      kind: 'library_chaos_exchange',
      targetMode: 'single_target',
      exileMode: 'top_card',
      putLandOntoBattlefield: true,
    });
    const parsed = parseOracleTextToIR(`Casualty 2\n${AUDACIOUS_SWAP_TEXT}`, 'Audacious Exchange');
    expect(parsed.abilities.find((ability) => ability.type === 'spell')?.steps.map((step) => step.kind))
      .toEqual(['library_chaos_exchange']);
  });
});

describe('Oracle IR Warp World executor dry-run', () => {
  it('shuffles owned permanents per player, reveals typed waves onto battlefield, and bottoms the remainder', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    const state = {
      players: [
        {
          id: p1,
          hand: [],
          graveyard: [],
          library: [{ id: 'card_p1_instant', name: 'P1 Bolt', type_line: 'Instant' }],
        },
        {
          id: p2,
          hand: [],
          graveyard: [],
          library: [],
        },
      ],
      battlefield: [
        {
          id: 'perm_p1_creature',
          owner: p1,
          controller: p1,
          card: { id: 'card_p1_creature', name: 'P1 Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        },
        {
          id: 'perm_p1_land',
          owner: p1,
          controller: p1,
          card: { id: 'card_p1_land', name: 'P1 Forest', type_line: 'Land — Forest' },
        },
        {
          id: 'perm_p1_token',
          owner: p1,
          controller: p1,
          isToken: true,
          card: { id: 'card_p1_token', name: 'P1 Token', type_line: 'Creature Token — Spirit' },
        },
        {
          id: 'perm_p2_enchant',
          owner: p2,
          controller: p2,
          card: { id: 'card_p2_enchant', name: 'P2 Aura', type_line: 'Enchantment' },
        },
        {
          id: 'perm_p2_land',
          owner: p2,
          controller: p2,
          card: { id: 'card_p2_land', name: 'P2 Island', type_line: 'Land — Island' },
        },
      ],
      life: { [p1]: 40, [p2]: 40 },
    } as unknown as GameState;

    const steps = collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World');
    expect(steps.map((step) => step.kind)).toEqual([
      'move_zone',
      'reveal_top',
      'move_zone',
      'move_zone',
      'move_zone',
    ]);

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'warp_world_spell',
      sourceName: 'Warp World',
      sourceObjectType: 'spell',
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as GameState;

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual([
      'move_zone',
      'reveal_top',
      'move_zone',
      'move_zone',
      'move_zone',
    ]);

    const battlefield = (nextState.battlefield || []) as any[];
    // Both players' original permanents left the battlefield (to library or, for the
    // token, ceasing to exist); typed waves reconstituted the two real permanents each.
    expect(battlefield).toHaveLength(4);
    expect(battlefield.some((perm) => perm?.card?.name === 'P1 Token')).toBe(false);

    const p1Battlefield = battlefield.filter((perm) => perm.owner === p1);
    const p2Battlefield = battlefield.filter((perm) => perm.owner === p2);
    expect(p1Battlefield.map((perm) => perm.card?.name).sort()).toEqual(['P1 Bear', 'P1 Forest']);
    expect(p2Battlefield.map((perm) => perm.card?.name).sort()).toEqual(['P2 Aura', 'P2 Island']);
    for (const perm of battlefield) {
      expect(perm.controller).toBe(perm.owner);
    }

    const nextP1 = nextState.players.find((entry: any) => entry.id === p1) as any;
    const nextP2 = nextState.players.find((entry: any) => entry.id === p2) as any;
    // The instant wasn't a permanent type eligible for either wave, so it's the
    // "revealed this way" remainder and lands on the bottom of the owner's library.
    expect(nextP1.library.map((card: any) => card.id)).toEqual(['card_p1_instant']);
    expect(nextP2.library).toHaveLength(0);
  });

  it('reveals that many after shuffle on the server-bridge path (no 903.9a)', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const state = {
      players: [
        {
          id: p1,
          hand: [],
          graveyard: [],
          library: [{ id: 'card_p1_instant', name: 'P1 Bolt', type_line: 'Instant' }],
        },
        {
          id: p2,
          hand: [],
          graveyard: [],
          library: [],
        },
      ],
      battlefield: [
        {
          id: 'perm_p1_creature',
          owner: p1,
          controller: p1,
          card: { id: 'card_p1_creature', name: 'P1 Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        },
        {
          id: 'perm_p1_land',
          owner: p1,
          controller: p1,
          card: { id: 'card_p1_land', name: 'P1 Forest', type_line: 'Land — Forest' },
        },
        {
          id: 'perm_p2_enchant',
          owner: p2,
          controller: p2,
          card: { id: 'card_p2_enchant', name: 'P2 Aura', type_line: 'Enchantment' },
        },
        {
          id: 'perm_p2_land',
          owner: p2,
          controller: p2,
          card: { id: 'card_p2_land', name: 'P2 Island', type_line: 'Land — Island' },
        },
      ],
      life: { [p1]: 40, [p2]: 40 },
    } as unknown as GameState;

    const ledger = createEmptyStepLedger();
    const haltState: OracleIRTransitionHaltState = { halted: false, deferred: [] };
    const serverBridge = createOracleIRServerExecutionBridge({
      state,
      ledger,
      interactivePlayerChoices: true,
      haltState,
    });
    const result = applyOracleIRStepsToGameState(
      state,
      collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World'),
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'warp_world_spell',
        sourceName: 'Warp World',
        sourceObjectType: 'spell',
        serverBridge,
        transitionHaltState: haltState,
        stepLedger: ledger,
        appliedStepKinds: new Map(),
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
    );
    randomSpy.mockRestore();

    expect(result.skippedSteps?.map((step) => step.kind)).not.toContain('reveal_top');
    expect(result.appliedSteps?.map((step) => step.kind)).toContain('reveal_top');
    expect(result.lastMovedCountByPlayer).toEqual({ [p1]: 2, [p2]: 2 });
    expect(result.log?.some((line) => /reveals /i.test(String(line || '')))).toBe(true);
    expect((result.state.battlefield || []).length).toBeGreaterThan(0);
  });

  it('puts a shuffled permanent even when a hand card shares its id', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const p1 = 'p1' as PlayerID;
    const sharedId = 'shared_mountain_id';
    const state = {
      players: [
        {
          id: p1,
          hand: [{ id: sharedId, name: 'Hand Mountain', type_line: 'Basic Land — Mountain' }],
          graveyard: [],
          library: [{ id: 'card_bolt', name: 'Bolt', type_line: 'Instant' }],
        },
      ],
      battlefield: [
        {
          id: 'perm_mountain',
          owner: p1,
          controller: p1,
          card: { id: sharedId, name: 'Board Mountain', type_line: 'Basic Land — Mountain' },
        },
      ],
      life: { [p1]: 40 },
    } as unknown as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World'),
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'warp_world_spell',
        sourceName: 'Warp World',
        sourceObjectType: 'spell',
      }),
      { allowOptional: true },
    );
    randomSpy.mockRestore();

    const battlefield = (result.state.battlefield || []) as any[];
    expect(battlefield.map((perm) => perm?.card?.name)).toEqual(['Board Mountain']);
    const nextP1 = result.state.players.find((entry: any) => entry.id === p1) as any;
    expect(nextP1.hand.map((card: any) => card.name)).toEqual(['Hand Mountain']);
  });

  it('puts each owner\'s permanents when two libraries share the same card id', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const sharedId = 'shared_mountain_id';
    const state = {
      players: [
        { id: p1, hand: [], graveyard: [], library: [] },
        { id: p2, hand: [], graveyard: [], library: [] },
      ],
      battlefield: [
        {
          id: 'perm_p1',
          owner: p1,
          controller: p1,
          card: { id: sharedId, name: 'P1 Mountain', type_line: 'Basic Land — Mountain' },
        },
        {
          id: 'perm_p2',
          owner: p2,
          controller: p2,
          card: { id: sharedId, name: 'P2 Mountain', type_line: 'Basic Land — Mountain' },
        },
      ],
      life: { [p1]: 40, [p2]: 40 },
    } as unknown as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World'),
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'warp_world_spell',
        sourceName: 'Warp World',
        sourceObjectType: 'spell',
      }),
      { allowOptional: true },
    );
    randomSpy.mockRestore();

    const battlefield = (result.state.battlefield || []) as any[];
    expect(battlefield).toHaveLength(2);
    expect(battlefield.filter((perm) => perm.owner === p1).map((perm) => perm.card?.name)).toEqual(['P1 Mountain']);
    expect(battlefield.filter((perm) => perm.owner === p2).map((perm) => perm.card?.name)).toEqual(['P2 Mountain']);
  });

  it('puts each owner\'s shared-id permanents through the server bridge', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    const sharedId = 'shared_mountain_id';
    const state = {
      players: [
        { id: p1, hand: [], graveyard: [], library: [] },
        { id: p2, hand: [], graveyard: [], library: [] },
        { id: p3, hand: [], graveyard: [], library: [] },
      ],
      battlefield: [
        {
          id: 'perm_p1',
          owner: p1,
          controller: p1,
          card: { id: sharedId, name: 'P1 Mountain', type_line: 'Basic Land — Mountain' },
        },
        {
          id: 'perm_p2',
          owner: p2,
          controller: p2,
          card: { id: sharedId, name: 'P2 Mountain', type_line: 'Basic Land — Mountain' },
        },
        {
          id: 'perm_p3',
          owner: p3,
          controller: p3,
          card: { id: sharedId, name: 'P3 Mountain', type_line: 'Basic Land — Mountain' },
        },
      ],
      life: { [p1]: 40, [p2]: 40, [p3]: 40 },
    } as unknown as GameState;

    const ledger = createEmptyStepLedger();
    const haltState: OracleIRTransitionHaltState = { halted: false, deferred: [] };
    const serverBridge = createOracleIRServerExecutionBridge({
      state,
      ledger,
      interactivePlayerChoices: true,
      haltState,
    });
    const result = applyOracleIRStepsToGameState(
      state,
      collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World'),
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'warp_world_spell',
        sourceName: 'Warp World',
        sourceObjectType: 'spell',
        serverBridge,
        transitionHaltState: haltState,
        stepLedger: ledger,
        appliedStepKinds: new Map(),
      }),
      { allowOptional: true },
    );
    randomSpy.mockRestore();

    const battlefield = (result.state.battlefield || []) as any[];
    expect(battlefield).toHaveLength(3);
    expect(battlefield.filter((perm) => perm.owner === p1).map((perm) => perm.card?.name)).toEqual(['P1 Mountain']);
    expect(battlefield.filter((perm) => perm.owner === p2).map((perm) => perm.card?.name)).toEqual(['P2 Mountain']);
    expect(battlefield.filter((perm) => perm.owner === p3).map((perm) => perm.card?.name)).toEqual(['P3 Mountain']);
    expect(result.skippedSteps?.map((step) => step.kind)).not.toContain('move_zone');
  });

  it('does not skip reveal/put when the revealed pile includes a commander', () => {
    const p1 = 'p1' as PlayerID;
    const state = {
      players: [
        {
          id: p1,
          hand: [],
          graveyard: [],
          library: [{
            id: 'card_cmd',
            name: 'Command Bear',
            type_line: 'Legendary Creature — Bear',
            isCommander: true,
          }],
        },
      ],
      battlefield: [],
      commandZone: { [p1]: { commanderIds: ['card_cmd'], inCommandZone: [], commanderCards: [] } },
      life: { [p1]: 40 },
    } as unknown as GameState;

    const ledger = createEmptyStepLedger();
    const haltState: OracleIRTransitionHaltState = { halted: false, deferred: [] };
    const serverBridge = createOracleIRServerExecutionBridge({
      state,
      ledger,
      interactivePlayerChoices: true,
      haltState,
    });
    const steps = collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World');
    const result = applyOracleIRStepsToGameState(
      state,
      steps.slice(1),
      {
        ...buildOracleIRExecutionContext({
          controllerId: p1,
          sourceId: 'warp_world_spell',
          sourceName: 'Warp World',
          sourceObjectType: 'spell',
          serverBridge,
          transitionHaltState: haltState,
          stepLedger: ledger,
          appliedStepKinds: new Map(),
        }),
        lastMovedCountByPlayer: { [p1]: 1 },
      },
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
    );

    expect(haltState.halted).toBe(false);
    expect(result.skippedSteps?.map((step) => step.kind)).not.toContain('reveal_top');
    expect((result.state.battlefield || []).map((perm: any) => perm?.card?.name)).toEqual(['Command Bear']);
  });

  it('clears observation halt so Warp World put still runs after a deferred library observation', () => {
    const p1 = 'p1' as PlayerID;
    const haltState: OracleIRTransitionHaltState = { halted: false, deferred: [] };
    const serverBridge = {
      proposeTransitions(transitions: readonly any[]) {
        const isObservation = (transitions || []).some((entry) =>
          String(entry?.cause || entry?.event?.cause || '').includes('library_observation'),
        );
        if (isObservation) {
          haltState.halted = true;
          haltState.deferred = [{ id: 'obs' } as any];
          return { halt: true, deferred: haltState.deferred };
        }
        return { halt: false, ready: transitions };
      },
    };
    const state = {
      players: [
        {
          id: p1,
          hand: [],
          graveyard: [],
          library: [{ id: 'card_bear', name: 'Bear', type_line: 'Creature — Bear' }],
        },
      ],
      battlefield: [],
      life: { [p1]: 40 },
    } as unknown as GameState;
    const steps = collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World');
    const result = applyOracleIRStepsToGameState(
      state,
      steps.slice(1),
      {
        ...buildOracleIRExecutionContext({
          controllerId: p1,
          sourceId: 'warp_world_spell',
          sourceName: 'Warp World',
          sourceObjectType: 'spell',
          serverBridge: serverBridge as any,
          transitionHaltState: haltState,
          stepLedger: createEmptyStepLedger(),
          appliedStepKinds: new Map(),
        }),
        lastMovedCountByPlayer: { [p1]: 1 },
      },
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
    );

    expect(haltState.halted).toBe(false);
    expect(result.skippedSteps?.map((step) => step.kind)).not.toContain('reveal_top');
    expect((result.state.battlefield || []).map((perm: any) => perm?.card?.name)).toEqual(['Bear']);
  });

  it('shuffles owned permanents into the attached server library map, not only player.library', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const p1 = 'p1' as PlayerID;
    const serverLibraries = new Map<string, any[]>([
      [p1, [{ id: 'card_bolt', name: 'Bolt', type_line: 'Instant' }]],
    ]);
    const state = {
      players: [
        {
          id: p1,
          hand: [],
          graveyard: [],
          library: [{ id: 'card_bolt', name: 'Bolt', type_line: 'Instant' }],
        },
      ],
      battlefield: [
        {
          id: 'perm_land',
          owner: p1,
          controller: p1,
          card: { id: 'card_land', name: 'Forest', type_line: 'Land — Forest' },
        },
      ],
      life: { [p1]: 40 },
      __serverLibraries: serverLibraries,
    } as unknown as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World'),
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'warp_world_spell',
        sourceName: 'Warp World',
        sourceObjectType: 'spell',
      }),
      { allowOptional: true },
    );
    randomSpy.mockRestore();

    const nextLib = (result.state as any).__serverLibraries.get(p1) as any[];
    const playerLib = (result.state.players.find((entry: any) => entry.id === p1) as any).library as any[];
    expect(nextLib.map((card: any) => card.id)).toEqual(playerLib.map((card: any) => card.id));
    expect((result.state.battlefield || []).some((perm: any) => perm?.card?.name === 'Forest')).toBe(true);
  });

  it('is fully IR-wired as a spell', () => {
    expect(isSpellEffectFullyIrWired(WARP_WORLD_TEXT, 'Warp World')).toBe(true);
  });

  it('puts leftover revealed nonpermanents on the bottom, leaving unrevealed cards above them', () => {
    // Identity shuffle: Math.random ≈ 1 ⇒ Fisher–Yates never swaps.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;

    const state = {
      players: [
        {
          id: p1,
          hand: [],
          graveyard: [],
          library: [
            { id: 'card_bolt', name: 'Bolt', type_line: 'Instant' },
            { id: 'card_extra_1', name: 'Extra 1', type_line: 'Instant' },
            { id: 'card_extra_2', name: 'Extra 2', type_line: 'Instant' },
          ],
        },
      ],
      battlefield: [
        {
          id: 'perm_bear',
          owner: p1,
          controller: p1,
          card: { id: 'card_bear', name: 'Bear', type_line: 'Creature — Bear' },
        },
      ],
      life: { [p1]: 40 },
    } as unknown as GameState;

    const steps = collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World');
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'warp_world_spell',
      sourceName: 'Warp World',
      sourceObjectType: 'spell',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    randomSpy.mockRestore();

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual([
      'move_zone',
      'reveal_top',
      'move_zone',
      'move_zone',
      'move_zone',
    ]);
    expect(result.skippedSteps || []).toEqual([]);

    const nextP1 = result.state.players.find((entry: any) => entry.id === p1) as any;
    // Bear shuffled to the bottom then identity-shuffled; one card revealed (Bolt).
    // Bolt is not a permanent type, so the remainder wave puts it on the bottom.
    expect(nextP1.library.map((card: any) => card.id)).toEqual([
      'card_extra_1',
      'card_extra_2',
      'card_bear',
      'card_bolt',
    ]);
    const battlefield = (result.state.battlefield || []) as any[];
    expect(battlefield).toHaveLength(0);
  });

  it('counts tokens toward "that many" without putting them into the library', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;

    const state = {
      players: [
        {
          id: p1,
          hand: [],
          graveyard: [],
          library: [
            { id: 'card_a', name: 'A', type_line: 'Instant' },
            { id: 'card_b', name: 'B', type_line: 'Instant' },
            { id: 'card_c', name: 'C', type_line: 'Instant' },
          ],
        },
      ],
      battlefield: [
        {
          id: 'perm_token',
          owner: p1,
          controller: p1,
          isToken: true,
          card: { id: 'card_token', name: 'Spirit', type_line: 'Creature Token — Spirit' },
        },
      ],
      life: { [p1]: 40 },
    } as unknown as GameState;

    const steps = collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World');
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'warp_world_spell',
      sourceName: 'Warp World',
      sourceObjectType: 'spell',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    randomSpy.mockRestore();

    expect((result.state.battlefield || []) as any[]).toHaveLength(0);
    const nextP1 = result.state.players.find((entry: any) => entry.id === p1) as any;
    // Token counted as 1 permanent → reveal A → remainder bottoms A.
    expect(nextP1.library.map((card: any) => card.id)).toEqual(['card_b', 'card_c', 'card_a']);
  });

  it('puts planeswalkers with the remainder instead of onto the battlefield', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;

    const state = {
      players: [
        { id: p1, hand: [], graveyard: [], library: [] },
      ],
      battlefield: [
        {
          id: 'perm_pw',
          owner: p1,
          controller: p1,
          card: { id: 'card_pw', name: 'Chandra', type_line: 'Legendary Planeswalker — Chandra' },
        },
      ],
      life: { [p1]: 40 },
    } as unknown as GameState;

    const steps = collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World');
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'warp_world_spell',
      sourceName: 'Warp World',
      sourceObjectType: 'spell',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    randomSpy.mockRestore();

    expect((result.state.battlefield || []) as any[]).toHaveLength(0);
    const nextP1 = result.state.players.find((entry: any) => entry.id === p1) as any;
    expect(nextP1.library.map((card: any) => card.name)).toEqual(['Chandra']);
  });

  it('puts an enchantment creature onto the battlefield only in the first typed wave', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;

    const state = {
      players: [
        { id: p1, hand: [], graveyard: [], library: [] },
      ],
      battlefield: [
        {
          id: 'perm_god',
          owner: p1,
          controller: p1,
          card: { id: 'card_god', name: 'Nyx Ram', type_line: 'Enchantment Creature — Sheep' },
        },
      ],
      life: { [p1]: 40 },
    } as unknown as GameState;

    const steps = collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World');
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'warp_world_spell',
      sourceName: 'Warp World',
      sourceObjectType: 'spell',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    randomSpy.mockRestore();

    const battlefield = (result.state.battlefield || []) as any[];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.card?.name || battlefield[0]?.name).toBe('Nyx Ram');
    const nextP1 = result.state.players.find((entry: any) => entry.id === p1) as any;
    expect(nextP1.library).toHaveLength(0);
  });

  it('counts a commander that goes to the command zone toward "that many"', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;

    const state = {
      players: [
        {
          id: p1,
          hand: [],
          graveyard: [],
          library: [
            { id: 'card_bolt', name: 'Lightning Bolt', type_line: 'Instant' },
            { id: 'card_shock', name: 'Shock', type_line: 'Instant' },
          ],
          commandZone: [],
        },
      ],
      battlefield: [
        {
          id: 'perm_cmd',
          owner: p1,
          controller: p1,
          isCommander: true,
          card: { id: 'card_cmd', name: 'Command Bear', type_line: 'Legendary Creature — Bear', isCommander: true },
        },
      ],
      life: { [p1]: 40 },
    } as unknown as GameState;

    const steps = collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World');
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'warp_world_spell',
      sourceName: 'Warp World',
      sourceObjectType: 'spell',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    randomSpy.mockRestore();

    expect((result.state.battlefield || []) as any[]).toHaveLength(0);
    const nextP1 = result.state.players.find((entry: any) => entry.id === p1) as any;
    expect(nextP1.commandZone.map((card: any) => card.name)).toEqual(['Command Bear']);
    expect(((result.state as any).commandZone?.[p1]?.inCommandZone || [])).toContain('card_cmd');
    expect(nextP1.library.map((card: any) => card.name)).not.toContain('Command Bear');
    // Counted 1 permanent → revealed one instant → remainder bottoms it. Neither library
    // card was a permanent type, so the battlefield stays empty.
    expect(nextP1.library).toHaveLength(2);
    expect(nextP1.library.map((card: any) => card.name).sort()).toEqual(['Lightning Bolt', 'Shock']);
  });

  it('attaches enchantment-wave Auras only to wave-1 hosts and bottoms illegal Auras', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;

    const state = {
      players: [
        { id: p1, hand: [], graveyard: [], library: [] },
      ],
      battlefield: [
        {
          id: 'perm_bear',
          owner: p1,
          controller: p1,
          card: { id: 'card_bear', name: 'Bear', type_line: 'Creature — Bear' },
        },
        {
          id: 'perm_anthem',
          owner: p1,
          controller: p1,
          card: { id: 'card_anthem', name: 'Glorious Anthem', type_line: 'Enchantment' },
        },
        {
          id: 'perm_pacifism',
          owner: p1,
          controller: p1,
          card: {
            id: 'card_pacifism',
            name: 'Pacifism',
            type_line: 'Enchantment — Aura',
            oracle_text: 'Enchant creature',
          },
        },
        {
          id: 'perm_control',
          owner: p1,
          controller: p1,
          card: {
            id: 'card_control',
            name: 'Control Magic',
            type_line: 'Enchantment — Aura',
            oracle_text: 'Enchant enchantment',
          },
        },
      ],
      life: { [p1]: 40 },
    } as unknown as GameState;

    const steps = collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World');
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'warp_world_spell',
      sourceName: 'Warp World',
      sourceObjectType: 'spell',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    randomSpy.mockRestore();

    const battlefield = (result.state.battlefield || []) as any[];
    const byName = Object.fromEntries(
      battlefield.map((perm) => [perm.card?.name || perm.name, perm]),
    );
    expect(byName.Bear).toBeTruthy();
    expect(byName['Glorious Anthem']).toBeTruthy();
    expect(byName.Pacifism).toBeTruthy();
    expect(byName.Pacifism.attachedTo).toBe(byName.Bear.id);
    expect(byName.Bear.attachments).toContain(byName.Pacifism.id);
    // Same-wave enchantments are not legal Aura hosts (2009 ruling 5).
    expect(byName['Control Magic']).toBeFalsy();
    const nextP1 = result.state.players.find((entry: any) => entry.id === p1) as any;
    expect(nextP1.library.map((card: any) => card.name)).toEqual(['Control Magic']);
  });
});

describe("Oracle IR Thieves' Auction executor dry-run", () => {
  it('exiles nontoken permanents then drafts them onto the battlefield tapped under rotating controllers', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    const state = {
      players: [
        { id: p1, hand: [], graveyard: [], library: [], exile: [] },
        { id: p2, hand: [], graveyard: [], library: [], exile: [] },
      ],
      battlefield: [
        { id: 'perm_a', owner: p2, controller: p2, card: { id: 'card_a', name: 'Card A', type_line: 'Creature' } },
        { id: 'perm_b', owner: p1, controller: p1, card: { id: 'card_b', name: 'Card B', type_line: 'Artifact' } },
        { id: 'perm_c', owner: p2, controller: p2, card: { id: 'card_c', name: 'Card C', type_line: 'Land' } },
        {
          id: 'perm_token',
          owner: p1,
          controller: p1,
          isToken: true,
          card: { id: 'card_token', name: 'Token Creature', type_line: 'Creature Token' },
        },
      ],
      life: { [p1]: 40, [p2]: 40 },
    } as unknown as GameState;

    const steps = collectOracleEffectSteps(THIEVES_AUCTION_TEXT, "Thieves' Auction");
    expect(steps.map((step) => step.kind)).toEqual(['exile', 'repeated_zone_draft']);

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'auction_spell',
      sourceName: "Thieves' Auction",
      sourceObjectType: 'spell',
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as GameState;

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['exile', 'repeated_zone_draft']);

    const battlefield = (nextState.battlefield || []) as any[];
    // The token was exiled-immune (nontoken-only target) and stays put; the three
    // nontoken permanents were drafted back tapped, starting with the controller.
    expect(battlefield).toHaveLength(4);
    const tokenPerm = battlefield.find((perm) => perm.id === 'perm_token');
    expect(tokenPerm).toBeTruthy();
    expect(tokenPerm.tapped).toBeFalsy();

    const draftedPerms = battlefield.filter((perm) => perm.id !== 'perm_token');
    expect(draftedPerms).toHaveLength(3);
    for (const perm of draftedPerms) {
      expect(perm.tapped).toBe(true);
    }

    const byName = Object.fromEntries(draftedPerms.map((perm) => [perm.card?.name, perm]));
    // Pick order follows turn order starting with the controller (p1, p2, p1, ...),
    // independent of who originally owned each exiled card.
    expect(byName['Card A'].owner).toBe(p2);
    expect(byName['Card A'].controller).toBe(p1);
    expect(byName['Card B'].owner).toBe(p1);
    expect(byName['Card B'].controller).toBe(p2);
    expect(byName['Card C'].owner).toBe(p2);
    expect(byName['Card C'].controller).toBe(p1);

    const nextP1 = nextState.players.find((entry: any) => entry.id === p1) as any;
    const nextP2 = nextState.players.find((entry: any) => entry.id === p2) as any;
    expect(nextP1.exile).toHaveLength(0);
    expect(nextP2.exile).toHaveLength(0);
  });

  it('is fully IR-wired as a spell', () => {
    expect(isSpellEffectFullyIrWired(THIEVES_AUCTION_TEXT, "Thieves' Auction")).toBe(true);
  });

  it('queues a player-choice gap instead of auto-drafting when interactive', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const state = {
      players: [
        { id: p1, hand: [], graveyard: [], library: [], exile: [] },
        { id: p2, hand: [], graveyard: [], library: [], exile: [] },
      ],
      battlefield: [
        { id: 'perm_a', owner: p1, controller: p1, card: { id: 'card_a', name: 'Bear', type_line: 'Creature — Bear' } },
        { id: 'perm_b', owner: p2, controller: p2, card: { id: 'card_b', name: 'Forest', type_line: 'Land — Forest' } },
      ],
      life: { [p1]: 40, [p2]: 40 },
    } as unknown as GameState;

    const steps = collectOracleEffectSteps(THIEVES_AUCTION_TEXT, "Thieves' Auction");
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'auction_spell',
      sourceName: "Thieves' Auction",
      sourceObjectType: 'spell',
      interactivePlayerChoices: true,
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['exile']);
    expect(result.skippedSteps?.some((step) => step.kind === 'repeated_zone_draft')).toBe(true);
    const gap = (result.automationGaps || []).find((entry) => entry.stepKind === 'repeated_zone_draft');
    expect(gap?.reasonCode).toBe('player_choice_required');
    expect(gap?.metadata?.chooserOrder).toEqual([p1, p2]);
    expect(Array.isArray(gap?.metadata?.remainingCardIds) && (gap?.metadata?.remainingCardIds as string[]).length).toBe(2);
  });

  it('leaves tokens on the battlefield when they are the only permanents', () => {
    const p1 = 'p1' as PlayerID;
    const state = {
      players: [{ id: p1, hand: [], graveyard: [], library: [], exile: [] }],
      battlefield: [
        {
          id: 'perm_token',
          owner: p1,
          controller: p1,
          isToken: true,
          card: { id: 'card_token', name: 'Spirit', type_line: 'Creature Token — Spirit' },
        },
      ],
      life: { [p1]: 40 },
    } as unknown as GameState;

    const steps = collectOracleEffectSteps(THIEVES_AUCTION_TEXT, "Thieves' Auction");
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'auction_spell',
      sourceName: "Thieves' Auction",
      sourceObjectType: 'spell',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const battlefield = (result.state.battlefield || []) as any[];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0].id).toBe('perm_token');
    expect(battlefield[0].tapped).toBeFalsy();
  });

  it('leaves an Aura in exile when nothing can legally enchant it', () => {
    const p1 = 'p1' as PlayerID;
    const state = {
      players: [{ id: p1, hand: [], graveyard: [], library: [], exile: [] }],
      battlefield: [
        {
          id: 'perm_aura',
          owner: p1,
          controller: p1,
          card: {
            id: 'card_aura',
            name: 'Pacifism',
            type_line: 'Enchantment — Aura',
            oracle_text: 'Enchant creature',
          },
        },
      ],
      life: { [p1]: 40 },
    } as unknown as GameState;

    const steps = collectOracleEffectSteps(THIEVES_AUCTION_TEXT, "Thieves' Auction");
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'auction_spell',
      sourceName: "Thieves' Auction",
      sourceObjectType: 'spell',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect((result.state.battlefield || []) as any[]).toHaveLength(0);
    const nextP1 = result.state.players.find((entry: any) => entry.id === p1) as any;
    expect(nextP1.exile.map((card: any) => card.name)).toEqual(['Pacifism']);
  });

  it('skips an Aura until a legal host is drafted, then attaches it', () => {
    const p1 = 'p1' as PlayerID;
    const state = {
      players: [{ id: p1, hand: [], graveyard: [], library: [], exile: [] }],
      battlefield: [
        {
          id: 'perm_aura',
          owner: p1,
          controller: p1,
          card: {
            id: 'card_aura',
            name: 'Pacifism',
            type_line: 'Enchantment — Aura',
            oracle_text: 'Enchant creature',
          },
        },
        {
          id: 'perm_bear',
          owner: p1,
          controller: p1,
          card: { id: 'card_bear', name: 'Bear', type_line: 'Creature — Bear' },
        },
      ],
      life: { [p1]: 40 },
    } as unknown as GameState;

    const steps = collectOracleEffectSteps(THIEVES_AUCTION_TEXT, "Thieves' Auction");
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'auction_spell',
      sourceName: "Thieves' Auction",
      sourceObjectType: 'spell',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const battlefield = (result.state.battlefield || []) as any[];
    expect(battlefield).toHaveLength(2);
    const bear = battlefield.find((perm) => perm.card?.name === 'Bear' || perm.name === 'Bear');
    const aura = battlefield.find((perm) => perm.card?.name === 'Pacifism' || perm.name === 'Pacifism');
    expect(bear).toBeTruthy();
    expect(aura).toBeTruthy();
    expect(aura.attachedTo).toBe(bear.id);
    expect(bear.attachments).toContain(aura.id);
    expect(aura.tapped).toBe(true);
    expect(bear.tapped).toBe(true);
    const nextP1 = result.state.players.find((entry: any) => entry.id === p1) as any;
    expect(nextP1.exile).toHaveLength(0);
  });

  it('puts a player-enchanting Aura onto the battlefield attached to the chooser', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const state = {
      players: [
        { id: p1, hand: [], graveyard: [], library: [], exile: [] },
        { id: p2, hand: [], graveyard: [], library: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'perm_curse',
          owner: p1,
          controller: p1,
          card: {
            id: 'card_curse',
            name: 'Curse of Exhaustion',
            type_line: 'Enchantment — Aura Curse',
            oracle_text: 'Enchant player\nEnchanted player can\'t cast more than one spell each turn.',
          },
        },
      ],
      life: { [p1]: 40, [p2]: 40 },
    } as unknown as GameState;

    const steps = collectOracleEffectSteps(THIEVES_AUCTION_TEXT, "Thieves' Auction");
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'auction_spell',
      sourceName: "Thieves' Auction",
      sourceObjectType: 'spell',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const battlefield = (result.state.battlefield || []) as any[];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0].card?.name || battlefield[0].name).toBe('Curse of Exhaustion');
    expect(battlefield[0].enchantedPlayerId).toBe(p1);
    expect(battlefield[0].attachedTo).toBe(p1);
    expect(battlefield[0].tapped).toBe(true);
  });

  it('honors a preferred legal Aura host when attaching a drafted Aura', () => {
    const p1 = 'p1' as PlayerID;
    const state = {
      players: [{ id: p1 }],
      battlefield: [
        { id: 'perm_bear_a', controller: p1, card: { name: 'Bear A', type_line: 'Creature — Bear' } },
        { id: 'perm_bear_b', controller: p1, card: { name: 'Bear B', type_line: 'Creature — Bear' } },
      ],
    };
    const aura = {
      name: 'Pacifism',
      type_line: 'Enchantment — Aura',
      oracle_text: 'Enchant creature',
    };
    expect(resolveRepeatedZoneDraftAuraAttachId(state, aura, p1)).toBe('perm_bear_a');
    expect(resolveRepeatedZoneDraftAuraAttachId(state, aura, p1, 'perm_bear_b')).toBe('perm_bear_b');
  });
});

describe('Oracle IR random control assignment (Scrambleverse)', () => {
  it('parses for-each-permanent random assignment into gain_control then untap', () => {
    const steps = tryParseRandomControlAssignmentTemplate(SCRAMBLEVERSE_TEXT);
    expect(steps).not.toBeNull();
    expect(steps?.map((step) => step.kind)).toEqual(['gain_control', 'tap_or_untap']);
    const gain = steps?.[0] as any;
    expect(gain.what?.text).toMatch(/nonland/i);
    expect(gain.newController?.kind).toBe('each_player');
    const untap = steps?.[1] as any;
    expect(untap.mode).toBe('untap');
    expect(untap.target?.text).toMatch(/those permanents/i);
  });

  it('collects the same two steps from full oracle text', () => {
    const parsed = parseOracleTextToIR(SCRAMBLEVERSE_TEXT, 'Scrambleverse');
    const steps = collectOracleEffectSteps(SCRAMBLEVERSE_TEXT, 'Scrambleverse');
    expect(parsed.abilities[0]?.steps?.map((step: any) => step.kind)).toEqual(['gain_control', 'tap_or_untap']);
    expect(steps.map((step) => step.kind)).toEqual(['gain_control', 'tap_or_untap']);
  });

  it('randomly reassigns nonland permanents, leaves lands, and untaps the assigned permanents without a target prompt', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    const state = {
      players: [
        { id: p1, hand: [], graveyard: [], library: [], exile: [] },
        { id: p2, hand: [], graveyard: [], library: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'perm_p1_bear',
          owner: p1,
          controller: p1,
          tapped: true,
          card: { id: 'card_p1_bear', name: 'P1 Bear', type_line: 'Creature — Bear' },
        },
        {
          id: 'perm_p1_land',
          owner: p1,
          controller: p1,
          tapped: true,
          card: { id: 'card_p1_land', name: 'P1 Forest', type_line: 'Land — Forest' },
        },
        {
          id: 'perm_p2_rock',
          owner: p2,
          controller: p2,
          tapped: true,
          card: { id: 'card_p2_rock', name: 'P2 Sol Ring', type_line: 'Artifact' },
        },
        {
          id: 'perm_p2_land',
          owner: p2,
          controller: p2,
          tapped: true,
          card: { id: 'card_p2_land', name: 'P2 Island', type_line: 'Land — Island' },
        },
      ],
      life: { [p1]: 40, [p2]: 40 },
    } as unknown as GameState;

    const steps = collectOracleEffectSteps(SCRAMBLEVERSE_TEXT, 'Scrambleverse');
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'scrambleverse_spell',
      sourceName: 'Scrambleverse',
      sourceObjectType: 'spell',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    randomSpy.mockRestore();

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['gain_control', 'tap_or_untap']);
    expect(result.skippedSteps || []).toEqual([]);
    expect(result.automationGaps || []).toEqual([]);

    const battlefield = (result.state.battlefield || []) as any[];
    const byId = Object.fromEntries(battlefield.map((perm) => [perm.id, perm]));
    expect(byId.perm_p1_bear.controller).toBe(p2);
    expect(byId.perm_p2_rock.controller).toBe(p2);
    expect(byId.perm_p1_land.controller).toBe(p1);
    expect(byId.perm_p2_land.controller).toBe(p2);
    expect(byId.perm_p1_bear.tapped).toBe(false);
    expect(byId.perm_p2_rock.tapped).toBe(false);
    expect(byId.perm_p1_land.tapped).toBe(true);
    expect(byId.perm_p2_land.tapped).toBe(true);
  });

  it('is fully IR-wired as a spell', () => {
    expect(isSpellEffectFullyIrWired(SCRAMBLEVERSE_TEXT, 'Scrambleverse')).toBe(true);
  });

  it('assigns tokens and leaves attached equipment on its bearer', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    const state = {
      players: [
        { id: p1, hand: [], graveyard: [], library: [], exile: [] },
        { id: p2, hand: [], graveyard: [], library: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'perm_p1_bear',
          owner: p1,
          controller: p1,
          tapped: true,
          attachments: ['perm_p1_sword'],
          card: { id: 'card_p1_bear', name: 'P1 Bear', type_line: 'Creature — Bear' },
        },
        {
          id: 'perm_p1_sword',
          owner: p1,
          controller: p1,
          tapped: true,
          attachedTo: 'perm_p1_bear',
          card: { id: 'card_p1_sword', name: 'P1 Sword', type_line: 'Artifact — Equipment' },
        },
        {
          id: 'perm_p1_token',
          owner: p1,
          controller: p1,
          isToken: true,
          tapped: true,
          card: { id: 'card_p1_token', name: 'P1 Spirit', type_line: 'Creature Token — Spirit' },
        },
      ],
      life: { [p1]: 40, [p2]: 40 },
    } as unknown as GameState;

    const steps = collectOracleEffectSteps(SCRAMBLEVERSE_TEXT, 'Scrambleverse');
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'scrambleverse_spell',
      sourceName: 'Scrambleverse',
      sourceObjectType: 'spell',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    randomSpy.mockRestore();

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['gain_control', 'tap_or_untap']);
    const battlefield = (result.state.battlefield || []) as any[];
    const byId = Object.fromEntries(battlefield.map((perm) => [perm.id, perm]));
    expect(byId.perm_p1_bear.controller).toBe(p2);
    expect(byId.perm_p1_sword.controller).toBe(p2);
    expect(byId.perm_p1_token.controller).toBe(p2);
    expect(byId.perm_p1_sword.attachedTo).toBe('perm_p1_bear');
    expect(byId.perm_p1_bear.tapped).toBe(false);
    expect(byId.perm_p1_sword.tapped).toBe(false);
    expect(byId.perm_p1_token.tapped).toBe(false);
  });
});

describe('Oracle IR Warp World interactive choices', () => {
  function interactiveCtx(controllerId: PlayerID, extra?: Record<string, unknown>) {
    return buildOracleIRExecutionContext({
      controllerId,
      sourceId: 'warp_world_spell',
      sourceName: 'Warp World',
      sourceObjectType: 'spell',
      interactivePlayerChoices: true,
      ...extra,
    });
  }

  it('skips the shuffle until a commander library-or-command choice is supplied', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;
    const state = {
      players: [{ id: p1, hand: [], graveyard: [], library: [{ id: 'card_bolt', name: 'Lightning Bolt', type_line: 'Instant' }], commandZone: [] }],
      battlefield: [
        {
          id: 'perm_cmd',
          owner: p1,
          controller: p1,
          isCommander: true,
          card: { id: 'card_cmd', name: 'Command Bear', type_line: 'Legendary Creature — Bear', isCommander: true },
        },
      ],
      life: { [p1]: 40 },
    } as unknown as GameState;
    const steps = collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World');
    const skipped = applyOracleIRStepsToGameState(state, steps, interactiveCtx(p1), {
      allowOptional: true,
      haltOnPlayerChoiceRequired: true,
    });
    expect(skipped.appliedSteps || []).toHaveLength(0);
    const gap = (skipped.automationGaps || []).find((entry) => entry.reasonCode === 'player_choice_required');
    expect(gap?.metadata?.warpWorldChoice).toBe('commander_library');
    expect(gap?.metadata?.pendingCommanderPermanentId).toBe('perm_cmd');

    const toLibrary = applyOracleIRStepsToGameState(
      state,
      steps,
      interactiveCtx(p1, { selectorContext: { commanderLibraryChoices: { perm_cmd: 'library' } } }),
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
    );
    const nextP1 = toLibrary.state.players.find((entry: any) => entry.id === p1) as any;
    expect(nextP1.library.map((card: any) => card.name)).toContain('Command Bear');
    expect(nextP1.commandZone || []).toHaveLength(0);

    const toCommand = applyOracleIRStepsToGameState(
      state,
      steps,
      interactiveCtx(p1, { selectorContext: { commanderLibraryChoices: { perm_cmd: 'command' } } }),
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
    );
    const commandP1 = toCommand.state.players.find((entry: any) => entry.id === p1) as any;
    expect(commandP1.commandZone.map((card: any) => card.name)).toEqual(['Command Bear']);
    expect(commandP1.library.map((card: any) => card.name)).not.toContain('Command Bear');
    randomSpy.mockRestore();
  });

  it('skips the enchantment wave until an Aura with multiple hosts is announced', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;
    const state = {
      players: [
        {
          id: p1,
          hand: [],
          graveyard: [],
          library: [
            { id: 'card_bear', name: 'Bear', type_line: 'Creature — Bear' },
            { id: 'card_wolf', name: 'Wolf', type_line: 'Creature — Wolf' },
            { id: 'card_pac', name: 'Pacifism', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature' },
          ],
        },
      ],
      battlefield: [
        { id: 'perm_a', owner: p1, controller: p1, card: { id: 'card_a', name: 'Forest', type_line: 'Land — Forest' } },
        { id: 'perm_b', owner: p1, controller: p1, card: { id: 'card_b', name: 'Island', type_line: 'Land — Island' } },
        { id: 'perm_c', owner: p1, controller: p1, card: { id: 'card_c', name: 'Mountain', type_line: 'Land — Mountain' } },
      ],
      life: { [p1]: 40 },
    } as unknown as GameState;
    const steps = collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World');
    const skipped = applyOracleIRStepsToGameState(state, steps, interactiveCtx(p1), {
      allowOptional: true,
      haltOnPlayerChoiceRequired: true,
    });
    const gap = (skipped.automationGaps || []).find((entry) => entry.metadata?.warpWorldChoice === 'aura_attach');
    expect(gap?.metadata?.pendingAuraCardId).toBe('card_pac');
    const legal = (gap?.metadata?.legalAttachIds || []) as string[];
    expect(legal.length).toBeGreaterThanOrEqual(2);

    const skippedWave = (skipped.skippedSteps || []).find((step) => /enchantment/i.test(String((step as any).raw || '')));
    expect(skippedWave).toBeTruthy();
    const resumeSteps = [skippedWave!, ...(skipped.pendingContinuationSteps || [])];
    const hostId = legal[1];
    const resumed = applyOracleIRStepsToGameState(
      skipped.state,
      resumeSteps,
      interactiveCtx(p1, {
        currentStepIndex: (skipped.appliedSteps || []).length,
        lastMovedCards: skipped.lastMovedCards,
        selectorContext: { auraAttachByCardId: { card_pac: hostId } },
        stepLedger: (skipped.state as any).oracleIrStepLedger,
        appliedStepKinds: (skipped.state as any).oracleIrAppliedStepKinds,
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
    );
    randomSpy.mockRestore();
    const aura = ((resumed.state.battlefield || []) as any[]).find((perm) => perm.card?.name === 'Pacifism' || perm.name === 'Pacifism');
    expect(aura).toBeTruthy();
    expect(aura?.attachedTo).toBe(hostId);
  });

  it('skips remainder any-order until a per-player bottom order is supplied', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;
    const state = {
      players: [
        {
          id: p1,
          hand: [],
          graveyard: [],
          library: [
            { id: 'card_bolt', name: 'Lightning Bolt', type_line: 'Instant' },
            { id: 'card_shock', name: 'Shock', type_line: 'Instant' },
            { id: 'card_cancel', name: 'Cancel', type_line: 'Instant' },
          ],
        },
      ],
      battlefield: [
        { id: 'perm_a', owner: p1, controller: p1, card: { id: 'card_a', name: 'Forest', type_line: 'Land — Forest' } },
        { id: 'perm_b', owner: p1, controller: p1, card: { id: 'card_b', name: 'Island', type_line: 'Land — Island' } },
      ],
      life: { [p1]: 40 },
    } as unknown as GameState;
    const steps = collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World');
    const skipped = applyOracleIRStepsToGameState(state, steps, interactiveCtx(p1), {
      allowOptional: true,
      haltOnPlayerChoiceRequired: true,
    });
    const gap = (skipped.automationGaps || []).find((entry) => entry.metadata?.warpWorldChoice === 'remainder_any_order');
    expect(gap?.metadata?.pendingRemainderPlayerId).toBe(p1);
    expect(gap?.metadata?.remainderCardIds).toEqual(['card_bolt', 'card_shock']);
    expect(gap?.metadata?.allRemainderCardIds).toEqual(['card_bolt', 'card_shock']);
    const remainderSnapshots = JSON.parse(String(gap?.metadata?.remainderCardsJson || '[]')) as Array<{ id?: string; name?: string }>;
    expect(remainderSnapshots.map((card) => card.name)).toEqual(['Lightning Bolt', 'Shock']);

    const remainderStep = (skipped.skippedSteps || []).find((step) =>
      /weren't put onto the battlefield/i.test(String((step as any).raw || '')),
    );
    expect(remainderStep).toBeTruthy();
    const resumed = applyOracleIRStepsToGameState(
      skipped.state,
      [remainderStep!, ...(skipped.pendingContinuationSteps || [])],
      interactiveCtx(p1, {
        currentStepIndex: (skipped.appliedSteps || []).length,
        lastMovedCards: skipped.lastMovedCards,
        selectorContext: { libraryBottomOrderByPlayer: { [p1]: ['card_shock', 'card_bolt'] } },
        stepLedger: (skipped.state as any).oracleIrStepLedger,
        appliedStepKinds: (skipped.state as any).oracleIrAppliedStepKinds,
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
    );
    randomSpy.mockRestore();
    const nextP1 = resumed.state.players.find((entry: any) => entry.id === p1) as any;
    const names = nextP1.library.map((card: any) => card.name);
    const shockIdx = names.lastIndexOf('Shock');
    const boltIdx = names.lastIndexOf('Lightning Bolt');
    expect(shockIdx).toBeGreaterThanOrEqual(0);
    expect(boltIdx).toBeGreaterThan(shockIdx);
  });

  it('does not prompt remainder order when the rest is random', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;
    const state = {
      players: [
        {
          id: p1,
          hand: [],
          graveyard: [],
          library: [
            { id: 'card_bolt', name: 'Lightning Bolt', type_line: 'Instant' },
            { id: 'card_shock', name: 'Shock', type_line: 'Instant' },
            { id: 'card_cancel', name: 'Cancel', type_line: 'Instant' },
          ],
        },
      ],
      battlefield: [
        { id: 'perm_a', owner: p1, controller: p1, card: { id: 'card_a', name: 'Forest', type_line: 'Land — Forest' } },
        { id: 'perm_b', owner: p1, controller: p1, card: { id: 'card_b', name: 'Island', type_line: 'Land — Island' } },
      ],
      life: { [p1]: 40 },
    } as unknown as GameState;
    const steps = collectOracleEffectSteps(GLIMPSE_OF_TOMORROW_TEXT, 'Glimpse of Tomorrow');
    const applied = applyOracleIRStepsToGameState(state, steps, interactiveCtx(p1), {
      allowOptional: true,
      haltOnPlayerChoiceRequired: true,
    });
    randomSpy.mockRestore();
    expect((applied.automationGaps || []).some((entry) => entry.metadata?.warpWorldChoice === 'remainder_any_order')).toBe(false);
    expect(applied.appliedSteps?.map((step) => step.kind)).toEqual([
      'move_zone',
      'reveal_top',
      'move_zone',
      'move_zone',
      'move_zone',
    ]);
  });

  it('prompts Aura attach APNAP when two players each have an Aura with multiple hosts', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const state = {
      players: [
        {
          id: p1,
          hand: [],
          graveyard: [],
          library: [
            { id: 'card_bear1', name: 'Bear', type_line: 'Creature — Bear' },
            { id: 'card_wolf1', name: 'Wolf', type_line: 'Creature — Wolf' },
            { id: 'card_pac1', name: 'Pacifism', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature' },
          ],
        },
        {
          id: p2,
          hand: [],
          graveyard: [],
          library: [
            { id: 'card_bear2', name: 'Bear', type_line: 'Creature — Bear' },
            { id: 'card_wolf2', name: 'Wolf', type_line: 'Creature — Wolf' },
            { id: 'card_pac2', name: 'Pacifism', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature' },
          ],
        },
      ],
      battlefield: [
        { id: 'perm_f1', owner: p1, controller: p1, card: { id: 'card_f1', name: 'Forest', type_line: 'Land — Forest' } },
        { id: 'perm_i1', owner: p1, controller: p1, card: { id: 'card_i1', name: 'Island', type_line: 'Land — Island' } },
        { id: 'perm_m1', owner: p1, controller: p1, card: { id: 'card_m1', name: 'Mountain', type_line: 'Land — Mountain' } },
        { id: 'perm_f2', owner: p2, controller: p2, card: { id: 'card_f2', name: 'Forest', type_line: 'Land — Forest' } },
        { id: 'perm_i2', owner: p2, controller: p2, card: { id: 'card_i2', name: 'Island', type_line: 'Land — Island' } },
        { id: 'perm_m2', owner: p2, controller: p2, card: { id: 'card_m2', name: 'Mountain', type_line: 'Land — Mountain' } },
      ],
      turnOrder: [p1, p2],
      activePlayerIndex: 0,
      life: { [p1]: 40, [p2]: 40 },
    } as unknown as GameState;
    const steps = collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World');
    const skipped = applyOracleIRStepsToGameState(state, steps, interactiveCtx(p1), {
      allowOptional: true,
      haltOnPlayerChoiceRequired: true,
    });
    const gap = (skipped.automationGaps || []).find((entry) => entry.metadata?.warpWorldChoice === 'aura_attach');
    expect(gap?.metadata?.pendingAuraChooserId).toBe(p1);
    expect(gap?.metadata?.pendingAuraCardId).toBe('card_pac1');
    const legal = (gap?.metadata?.legalAttachIds || []) as string[];
    const skippedWave = (skipped.skippedSteps || []).find((step) => /enchantment/i.test(String((step as any).raw || '')));
    const resumed = applyOracleIRStepsToGameState(
      skipped.state,
      [skippedWave!, ...(skipped.pendingContinuationSteps || [])],
      interactiveCtx(p1, {
        currentStepIndex: (skipped.appliedSteps || []).length,
        lastMovedCards: skipped.lastMovedCards,
        selectorContext: { auraAttachByCardId: { card_pac1: legal[0] } },
        stepLedger: (skipped.state as any).oracleIrStepLedger,
        appliedStepKinds: (skipped.state as any).oracleIrAppliedStepKinds,
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
    );
    randomSpy.mockRestore();
    const nextGap = (resumed.automationGaps || []).find((entry) => entry.metadata?.warpWorldChoice === 'aura_attach');
    expect(nextGap?.metadata?.pendingAuraChooserId).toBe(p2);
    expect(nextGap?.metadata?.pendingAuraCardId).toBe('card_pac2');
  });
});

