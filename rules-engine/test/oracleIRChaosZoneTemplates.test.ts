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
});
