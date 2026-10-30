import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { queueDuringResolutionShareTypeCastPromptFromOracleIRResult } from '../src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerImpulseDuringResolutionCastPrompts.js';
import { buildCastFromExilePromptOptions } from '../src/state/modules/triggerCastFromExileUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { applyEffectProgramZoneEvents } from '../src/state/modules/apply-event-handlers/applyEventEffectProgramZoneEvents.js';

const POSSIBILITY_STORM_ORACLE =
  'Whenever a player casts a spell from their hand, that player exiles it, then exiles cards from the top of their library until they exile a card that shares a card type with it. That player may cast that card without paying its mana cost. Then they put all cards exiled with this enchantment on the bottom of their library in a random order.';

describe('Possibility Storm until-hit free-cast prompt', () => {
  it('offers the shared-type library card, not the original spell', () => {
    const gameId = 'possibility_storm_until_hit_cast';
    ResolutionQueueManager.clearAllSteps(gameId);

    const ir = parseOracleTextToIR(POSSIBILITY_STORM_ORACLE, 'Possibility Storm');
    const steps = ir.abilities[0]?.steps ?? [];
    const result = applyOracleIRStepsToGameState(
      {
        id: gameId,
        format: 'commander',
        players: [
          {
            id: 'p1',
            name: 'P1',
            seat: 0,
            life: 40,
            library: [],
            hand: [],
            graveyard: [],
            exile: [],
          } as any,
          {
            id: 'p2',
            name: 'P2',
            seat: 1,
            life: 40,
            library: [
              { id: 'p2c1', name: 'Forest', type_line: 'Basic Land — Forest' },
              { id: 'p2c2', name: 'Llanowar Elves', type_line: 'Creature — Elf' },
              {
                id: 'p2c3',
                name: 'Shock',
                type_line: 'Instant',
                image_uris: { small: 'https://cards.example/shock-small.jpg', normal: 'https://cards.example/shock.jpg' },
              },
              { id: 'p2c4', name: 'Opt', type_line: 'Instant' },
            ],
            hand: [],
            graveyard: [],
            exile: [],
          } as any,
        ],
        battlefield: [],
        stack: [
          {
            id: 'stack_bolt',
            type: 'spell',
            controller: 'p2',
            owner: 'p2',
            card: {
              id: 'bolt_1',
              name: 'Lightning Bolt',
              type_line: 'Instant',
            },
          },
        ],
        turnPlayer: 'p1',
        priority: 'p1',
        active: true,
      } as any,
      steps,
      {
        controllerId: 'p1',
        sourceId: 'possibility-storm',
        sourceName: 'Possibility Storm',
        sourceObjectType: 'ability',
        selectorContext: { targetPlayerId: 'p2' as any },
        targetSpellId: 'stack_bolt',
      },
    );

    const state: any = result.state;
    const ctx = { gameId, state, isReplaying: false } as any;
    queueDuringResolutionShareTypeCastPromptFromOracleIRResult(ctx, state, result, {
      controller: 'p1' as any,
      sourceName: 'Possibility Storm',
      sourceId: 'possibility-storm',
      irCtx: {
        controllerId: 'p1' as any,
        sourceId: 'possibility-storm',
        sourceName: 'Possibility Storm',
        targetSpellId: 'stack_bolt',
        selectorContext: { targetPlayerId: 'p2' as any },
      } as any,
    });

    const p2 = state.players.find((player: any) => player.id === 'p2');
    const prompt = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step: any) => String(step?.castFromExileCardId || '') === 'p2c3',
    ) as any;
    const boltStillExiled = (p2.exile || []).some(
      (card: any) => String(card?.id || '') === 'bolt_1' || String(card?.copiedFromStackItemId || '') === 'stack_bolt',
    );

    expect(prompt).toBeTruthy();
    expect(prompt.playerId).toBe('p2');
    expect(prompt.castFromExileDeclineDestination).toBe('library_bottom_random');
    const castOption = (prompt.options || []).find((option: any) => option.id === 'cast');
    expect(castOption?.cardName).toBe('Shock');
    expect(castOption?.description).toBe('Instant');
    expect(castOption?.imageUrl).toBe('https://cards.example/shock.jpg');
    expect(castOption?.previewCard?.image_uris?.normal).toBe('https://cards.example/shock.jpg');
    expect(castOption?.previewCard?.name).toBe('Shock');
    expect(boltStillExiled).toBe(false);
    expect((p2.exile || []).map((card: any) => card.id)).toEqual(['p2c3']);
    ResolutionQueueManager.clearAllSteps(gameId);
  });

  it('keeps both faces of a double-faced hit for hover', () => {
    const [castOption] = buildCastFromExilePromptOptions({
      id: 'dfc',
      name: 'Delver of Secrets',
      layout: 'transform',
      card_faces: [
        {
          name: 'Delver of Secrets',
          type_line: 'Creature — Human Wizard',
          image_uris: { normal: 'https://cards.example/delver.jpg', small: 'https://cards.example/delver-small.jpg' },
        },
        {
          name: 'Insectile Aberration',
          type_line: 'Creature — Human Insect',
          image_uris: { normal: 'https://cards.example/aberration.jpg' },
        },
      ],
    });
    expect(castOption?.imageUrl).toBe('https://cards.example/delver.jpg');
    expect((castOption?.previewCard as any)?.card_faces).toHaveLength(2);
    expect((castOption?.previewCard as any)?.card_faces[1].name).toBe('Insectile Aberration');
  });

  it('removes a Possibility Storm-replaced cast from the replayed stack', () => {
    const ir = parseOracleTextToIR(POSSIBILITY_STORM_ORACLE, 'Possibility Storm');
    const result = applyOracleIRStepsToGameState(
      {
        id: 'possibility_storm_replay_stack',
        format: 'commander',
        players: [
          { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] },
          {
            id: 'p2',
            name: 'P2',
            seat: 1,
            life: 40,
            library: [
              { id: 'p2c1', name: 'Forest', type_line: 'Basic Land — Forest' },
              { id: 'p2c3', name: 'Shock', type_line: 'Instant' },
            ],
            hand: [],
            graveyard: [],
            exile: [],
          },
        ],
        battlefield: [],
        stack: [
          {
            id: 'stack_bolt',
            type: 'spell',
            controller: 'p2',
            owner: 'p2',
            card: { id: 'bolt_1', name: 'Lightning Bolt', type_line: 'Instant' },
          },
        ],
        turnPlayer: 'p1',
        priority: 'p1',
        active: true,
      } as any,
      ir.abilities[0]?.steps ?? [],
      {
        controllerId: 'p1',
        sourceId: 'possibility-storm',
        sourceName: 'Possibility Storm',
        sourceObjectType: 'ability',
        selectorContext: { targetPlayerId: 'p2' as any },
        targetSpellId: 'stack_bolt',
      },
    );

    const mutation = (result.replayMutations || []).find(
      (entry: any) => entry?.kind === 'effectProgramZoneMove' && entry?.fromZone === 'stack' && entry?.cardId === 'bolt_1',
    ) as any;
    expect(mutation?.stackItemId).toBe('stack_bolt');
    expect(mutation?.toZone).toBe('exile');

    const replay: any = {
      state: {
        stack: [
          {
            id: 'stack_bolt',
            type: 'spell',
            controller: 'p2',
            owner: 'p2',
            card: { id: 'bolt_1', name: 'Lightning Bolt', type_line: 'Instant' },
          },
          {
            id: 'stack_shock',
            type: 'spell',
            controller: 'p2',
            owner: 'p2',
            card: { id: 'p2c3', name: 'Shock', type_line: 'Instant' },
          },
        ],
        zones: {
          p2: { exile: [], exileCount: 0, hand: [], graveyard: [], library: [] },
        },
        battlefield: [],
      },
      bumpSeq() {},
    };

    expect(applyEffectProgramZoneEvents(replay, { type: 'effectProgramZoneMove', ...mutation })).toBe(true);
    expect(replay.state.stack.map((item: any) => item.id)).toEqual(['stack_shock']);
    expect(replay.state.zones.p2.exile.map((card: any) => card.id)).toEqual(['bolt_1']);

    replay.state.stack.unshift({
      id: 'stack_bolt',
      type: 'spell',
      controller: 'p2',
      owner: 'p2',
      card: { id: 'bolt_1', name: 'Lightning Bolt', type_line: 'Instant' },
    });
    expect(applyEffectProgramZoneEvents(replay, { type: 'effectProgramZoneMove', ...mutation })).toBe(true);
    expect(replay.state.stack.map((item: any) => item.id)).toEqual(['stack_shock']);
    expect(replay.state.zones.p2.exile).toHaveLength(1);
  });
});
