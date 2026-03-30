import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import { createContext } from '../src/state/context';
import type { PlayerID, KnownCardRef } from '../../shared/src';
import { GamePhase } from '../../shared/src';
import { handleElixirShuffle } from '../src/state/modules/zone-manipulation';
import { detectXAbility, executeXAbility } from '../src/state/modules/x-activated-abilities';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { detectSpellCastTriggers } from '../src/state/modules/triggered-abilities';
import { viewFor } from '../src/state/modules/view';

describe('Stack / zone regression effects', () => {
  it('Kynaios creates queued land-or-draw choices even when the trigger description is truncated', () => {
    const gameId = 'kynaios_truncated_description_regression';
    ResolutionQueueManager.removeQueue(gameId);

    const g = createInitialGameState(gameId);

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' });
    g.applyEvent!({ type: 'join', playerId: p3, name: 'Player 3' });

    g.importDeckResolved(p1, [
      { id: 'draw_p1_1', name: 'Island', type_line: 'Basic Land - Island' } as any,
    ]);

    (g.state as any).turnPlayer = p1;
    (g.state as any).activePlayer = p1;
    (g.state as any).zones[p1] = { hand: [{ id: 'plains_1', name: 'Plains', type_line: 'Basic Land - Plains' }], handCount: 1, libraryCount: 1, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
    (g.state as any).zones[p2] = { hand: [{ id: 'forest_1', name: 'Forest', type_line: 'Basic Land - Forest' }], handCount: 1, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
    (g.state as any).zones[p3] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };

    (g.state as any).stack = [
      {
        id: 'kynaios_trigger_1',
        type: 'triggered_ability',
        controller: p1,
        sourceName: 'Kynaios and Tiro of Meletis',
        description: 'draw a card.',
        permanentId: 'kynaios_perm_1',
        triggerType: 'end_step',
        gameId,
      },
    ];

    g.resolveTopOfStack();

  expect((g.state as any).zones[p1].handCount).toBe(2);
  expect((g.state as any).zones[p1].hand.map((card: any) => card.id)).toContain('draw_p1_1');

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.filter((step: any) => step.type === 'kynaios_choice')).toHaveLength(3);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it("Nature's Claim grants 4 life to destroyed permanent's controller", () => {
    const g = createInitialGameState('natures_claim_life_gain');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' });

    // Put a target artifact on battlefield under p2.
    (g.state as any).battlefield = [
      {
        id: 'sol_ring_1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'sol_ring_card',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}{C}.',
        } as any,
      } as any,
    ];

    const startingLife = (g.state as any).life?.[p2];
    expect(startingLife).toBe(40);

    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      {
        id: 'claim_1',
        name: "Nature's Claim",
        type_line: 'Instant',
        oracle_text: 'Destroy target artifact or enchantment. Its controller gains 4 life.',
        mana_cost: '{G}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'claim_1',
      targets: [{ kind: 'permanent', id: 'sol_ring_1' }],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);

    g.resolveTopOfStack();

    expect((g.state as any).life?.[p2]).toBe(44);
  });

  it('Elixir of Immortality shuffle moves graveyard + itself into library', () => {
    const ctx = createContext('elixir_shuffle_regression');

    const p1 = 'p1' as PlayerID;

    // Minimal zones + library state
    (ctx.state as any).players = [{ id: p1, name: 'Player 1', seat: 0 }] as any;
    (ctx.state as any).zones[p1] = {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [
        { id: 'gy_1', name: 'Grave Card 1', type_line: 'Sorcery', zone: 'graveyard' },
        { id: 'gy_2', name: 'Grave Card 2', type_line: 'Instant', zone: 'graveyard' },
      ],
      graveyardCount: 2,
      exile: [],
      exileCount: 0,
    } as any;

    ctx.libraries.set(p1, [
      { id: 'lib_1', name: 'Library Card', type_line: 'Creature', zone: 'library' } as any,
    ]);

    (ctx.state as any).battlefield = [
      {
        id: 'elixir_perm_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'elixir_card_1',
          name: 'Elixir of Immortality',
          type_line: 'Artifact',
          oracle_text: '{2}, {T}: You gain 5 life. Shuffle this artifact and your graveyard into their owner\'s library.',
        },
      } as any,
    ];

    const shuffledCount = handleElixirShuffle(ctx as any, p1, 'elixir_perm_1');
    expect(shuffledCount).toBe(3);

    // Elixir removed from battlefield
    expect((ctx.state as any).battlefield.some((p: any) => p?.id === 'elixir_perm_1')).toBe(false);

    // Graveyard emptied
    expect((ctx.state as any).zones?.[p1]?.graveyard?.length || 0).toBe(0);

    // Library now contains original + graveyard + elixir
    const lib = ctx.libraries.get(p1) || [];
    const ids = new Set(lib.map((c: any) => c?.id));
    expect(ids.has('lib_1')).toBe(true);
    expect(ids.has('gy_1')).toBe(true);
    expect(ids.has('gy_2')).toBe(true);
    expect(ids.has('elixir_card_1')).toBe(true);
  });

  it('parses generic bottom-then-reveal-until-nonland spell-cast triggers with once-per-turn metadata', () => {
    const triggers = detectSpellCastTriggers(
      {
        id: 'neera_card',
        name: 'Neera, Wild Mage',
        type_line: 'Legendary Creature — Human Elf Shaman',
        oracle_text:
          "Whenever you cast a spell, you may put it on the bottom of its owner's library. If you do, reveal cards from the top of your library until you reveal a nonland card. You may cast it without paying its mana cost. Put the rest on the bottom of your library in a random order. This ability triggers only once each turn.",
      },
      { id: 'neera_perm', controller: 'p1' }
    );

    const trigger = triggers.find((entry) => entry.replacementEffect?.kind === 'bottom_spell_reveal_until_nonland');
    expect(trigger).toBeDefined();
    expect(trigger?.spellCondition).toBe('any');
    expect(trigger?.mandatory).toBe(false);
    expect(trigger?.oncePerTurn).toBe(true);
  });

  it('shows a revealed nonpermanent top card to viewers while it remains on top', () => {
    const ctx = createContext('revealed_library_top_regression');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    (ctx.state as any).players = [
      { id: p1, name: 'Player 1', seat: 0 },
      { id: p2, name: 'Player 2', seat: 1 },
    ] as any;
    (ctx.state as any).zones[p1] = { hand: [], handCount: 0, libraryCount: 1, graveyard: [], graveyardCount: 0 } as any;
    (ctx.state as any).zones[p2] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any;

    ctx.libraries.set(p1, [
      { id: 'top_spell', name: 'Counterspell', type_line: 'Instant', oracle_text: 'Counter target spell.' } as any,
    ]);
    ctx.revealedLibraryTopByOwner.set(p1, {
      cardId: 'top_spell',
      viewers: new Set([p1, p2]),
    });

    const visible = viewFor(ctx as any, p2, false);
    expect((visible.zones as any)[p1]?.libraryTop?.name).toBe('Counterspell');

    ctx.libraries.set(p1, [
      { id: 'new_top', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' } as any,
    ]);

    const hidden = viewFor(ctx as any, p2, false);
    expect((hidden.zones as any)[p1]?.libraryTop).toBeUndefined();
  });

  it('Steel Hellkite {X} destroys nonland permanents with mana value X for damaged opponents', () => {
    const ctx = createContext('steel_hellkite_x_ability');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    (ctx.state as any).players = [
      { id: p1, name: 'Player 1', seat: 0 } as any,
      { id: p2, name: 'Player 2', seat: 1 } as any,
    ];

    (ctx.state as any).zones[p1] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any;
    (ctx.state as any).zones[p2] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any;

    const steelOracle = [
      'Flying',
      '{X}: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by Steel Hellkite this turn.',
    ].join('\n');

    const steel = {
      id: 'steel_perm_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'steel_card_1',
        name: 'Steel Hellkite',
        type_line: 'Artifact Creature — Dragon',
        oracle_text: steelOracle,
        mana_cost: '{6}',
        cmc: 6,
        power: '5',
        toughness: '5',
      },
      dealtCombatDamageTo: new Set<string>([p2]),
    } as any;

    const oppMv2 = {
      id: 'opp_art_2',
      controller: p2,
      owner: p2,
      card: {
        id: 'opp_art_2_card',
        name: 'Mind Stone',
        type_line: 'Artifact',
        mana_cost: '{2}',
        cmc: 2,
      },
    } as any;

    const oppMv3 = {
      id: 'opp_art_3',
      controller: p2,
      owner: p2,
      card: {
        id: 'opp_art_3_card',
        name: 'Chromatic Lantern',
        type_line: 'Artifact',
        mana_cost: '{3}',
        cmc: 3,
      },
    } as any;

    const oppLand = {
      id: 'opp_land_2',
      controller: p2,
      owner: p2,
      card: {
        id: 'opp_land_2_card',
        name: 'Island',
        type_line: 'Basic Land — Island',
      },
    } as any;

    const myMv2 = {
      id: 'my_art_2',
      controller: p1,
      owner: p1,
      card: {
        id: 'my_art_2_card',
        name: 'Fellwar Stone',
        type_line: 'Artifact',
        mana_cost: '{2}',
        cmc: 2,
      },
    } as any;

    (ctx.state as any).battlefield = [steel, oppMv2, oppMv3, oppLand, myMv2];

    const info = detectXAbility(steelOracle, 'steel hellkite');
    expect(info).toBeTruthy();
    expect(info?.requiresCombatDamage).toBe(true);

    const result = executeXAbility(ctx as any, p1, steel, 2, info as any);
    expect(result.success).toBe(true);
    expect(result.destroyedCount).toBe(1);

    const battlefieldIds = new Set(((ctx.state as any).battlefield || []).map((p: any) => p?.id));
    expect(battlefieldIds.has('opp_art_2')).toBe(false); // destroyed
    expect(battlefieldIds.has('opp_art_3')).toBe(true); // survives (mv 3)
    expect(battlefieldIds.has('opp_land_2')).toBe(true); // lands are excluded
    expect(battlefieldIds.has('my_art_2')).toBe(true); // your permanents are excluded

    const gy = (ctx.state as any).zones?.[p2]?.graveyard || [];
    expect(gy.some((c: any) => c?.id === 'opp_art_2_card')).toBe(true);
  });
});
