import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { triggerETBEffectsForPermanent } from '../src/state/modules/stack';

describe('Intervening-if ETB triggers', () => {
  it('matches ETB trigger required type phrases with token/nontoken qualifiers', () => {
    const g = createInitialGameState('t_etb_required_type_token_qualifiers');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const watcherNontoken = {
      id: 'watch_nontoken',
      controller: p1,
      owner: p1,
      card: {
        id: 'watch_nontoken_card',
        name: 'Nontoken Watcher',
        type_line: 'Enchantment',
        oracle_text: 'Whenever another nontoken creature enters the battlefield under your control, draw a card.',
      },
      tapped: false,
    };

    const watcherToken = {
      id: 'watch_token',
      controller: p1,
      owner: p1,
      card: {
        id: 'watch_token_card',
        name: 'Token Watcher',
        type_line: 'Enchantment',
        oracle_text: 'Whenever another token creature enters the battlefield under your control, draw a card.',
      },
      tapped: false,
    };

    (g.state.battlefield as any).push(watcherNontoken);
    (g.state.battlefield as any).push(watcherToken);

    // Nontoken creature should satisfy the nontoken watcher and not the token watcher.
    const enteringNontoken = {
      id: 'nontoken_1',
      controller: p1,
      owner: p1,
      card: { id: 'nontoken_1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
      tapped: false,
    };
    (g.state.battlefield as any).push(enteringNontoken);
    triggerETBEffectsForPermanent(g as any, enteringNontoken, p1);
    expect(((g.state.stack || []) as any[]).some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Nontoken Watcher')).toBe(
      true
    );
    expect(((g.state.stack || []) as any[]).some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Token Watcher')).toBe(
      false
    );

    // Token creature should satisfy the token watcher and not the nontoken watcher.
    g.state.stack = [] as any;
    const enteringToken = {
      id: 'token_1',
      controller: p1,
      owner: p1,
      isToken: true,
      card: { id: 'token_1_card', name: 'Test Token', type_line: 'Token Creature — Elf', oracle_text: '' },
      tapped: false,
    };
    (g.state.battlefield as any).push(enteringToken);
    triggerETBEffectsForPermanent(g as any, enteringToken, p1);
    expect(((g.state.stack || []) as any[]).some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Nontoken Watcher')).toBe(
      false
    );
    expect(((g.state.stack || []) as any[]).some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Token Watcher')).toBe(
      true
    );
  });

  it('matches ETB trigger required type phrases with multiple words (e.g. "artifact creature")', () => {
    const g = createInitialGameState('t_etb_required_type_multiword');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const watcherArtifactCreature = {
      id: 'watch_artifact_creature',
      controller: p1,
      owner: p1,
      card: {
        id: 'watch_artifact_creature_card',
        name: 'Artifact Creature Watcher',
        type_line: 'Enchantment',
        oracle_text: 'Whenever another artifact creature enters the battlefield under your control, draw a card.',
      },
      tapped: false,
    };
    (g.state.battlefield as any).push(watcherArtifactCreature);

    // Non-artifact creature should NOT satisfy "artifact creature".
    const enteringCreatureOnly = {
      id: 'creature_only_1',
      controller: p1,
      owner: p1,
      card: { id: 'creature_only_1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
      tapped: false,
    };
    (g.state.battlefield as any).push(enteringCreatureOnly);
    triggerETBEffectsForPermanent(g as any, enteringCreatureOnly, p1);
    expect(
      ((g.state.stack || []) as any[]).some(
        (s) => s?.type === 'triggered_ability' && s?.sourceName === 'Artifact Creature Watcher'
      )
    ).toBe(false);

    // Artifact creature SHOULD satisfy "artifact creature".
    g.state.stack = [] as any;
    const enteringArtifactCreature = {
      id: 'artifact_creature_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'artifact_creature_1_card',
        name: 'Ornithopter',
        type_line: 'Artifact Creature — Thopter',
        oracle_text: '',
      },
      tapped: false,
    };
    (g.state.battlefield as any).push(enteringArtifactCreature);
    triggerETBEffectsForPermanent(g as any, enteringArtifactCreature, p1);
    expect(
      ((g.state.stack || []) as any[]).some(
        (s) => s?.type === 'triggered_ability' && s?.sourceName === 'Artifact Creature Watcher'
      )
    ).toBe(true);
  });

  it('matches ETB trigger required type phrases with hyphenated "non-token" spelling', () => {
    const g = createInitialGameState('t_etb_required_type_non_token_spelling');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const watcherNonToken = {
      id: 'watch_non_token',
      controller: p1,
      owner: p1,
      card: {
        id: 'watch_non_token_card',
        name: 'Non-Token Watcher',
        type_line: 'Enchantment',
        oracle_text: 'Whenever another non-token creature enters the battlefield under your control, draw a card.',
      },
      tapped: false,
    };
    (g.state.battlefield as any).push(watcherNonToken);

    // Token creature should NOT satisfy "non-token creature".
    const enteringToken = {
      id: 'token_non_token_test_1',
      controller: p1,
      owner: p1,
      isToken: true,
      card: { id: 'token_non_token_test_1_card', name: 'Test Token', type_line: 'Token Creature — Elf', oracle_text: '' },
      tapped: false,
    };
    (g.state.battlefield as any).push(enteringToken);
    triggerETBEffectsForPermanent(g as any, enteringToken, p1);
    expect(
      ((g.state.stack || []) as any[]).some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Non-Token Watcher')
    ).toBe(false);

    // Nontoken creature SHOULD satisfy "non-token creature".
    g.state.stack = [] as any;
    const enteringNontoken = {
      id: 'nontoken_non_token_test_1',
      controller: p1,
      owner: p1,
      card: { id: 'nontoken_non_token_test_1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
      tapped: false,
    };
    (g.state.battlefield as any).push(enteringNontoken);
    triggerETBEffectsForPermanent(g as any, enteringNontoken, p1);
    expect(
      ((g.state.stack || []) as any[]).some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Non-Token Watcher')
    ).toBe(true);
  });

  it('matches subtype required type phrases against type_line with em dash subtypes (e.g. "Creature — Bear")', () => {
    const g = createInitialGameState('t_etb_required_type_subtype_em_dash');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const watcherBear = {
      id: 'watch_bear',
      controller: p1,
      owner: p1,
      card: {
        id: 'watch_bear_card',
        name: 'Bear Watcher',
        type_line: 'Enchantment',
        oracle_text: 'Whenever another Bear enters the battlefield under your control, draw a card.',
      },
      tapped: false,
    };
    (g.state.battlefield as any).push(watcherBear);

    const enteringBear = {
      id: 'bear_em_dash_1',
      controller: p1,
      owner: p1,
      card: { id: 'bear_em_dash_1_card', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
      tapped: false,
    };
    (g.state.battlefield as any).push(enteringBear);
    triggerETBEffectsForPermanent(g as any, enteringBear, p1);
    expect(((g.state.stack || []) as any[]).some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Bear Watcher')).toBe(true);

    g.state.stack = [] as any;
    const enteringBeast = {
      id: 'beast_em_dash_1',
      controller: p1,
      owner: p1,
      card: { id: 'beast_em_dash_1_card', name: 'Runeclaw Bear', type_line: 'Creature — Beast', oracle_text: '' },
      tapped: false,
    };
    (g.state.battlefield as any).push(enteringBeast);
    triggerETBEffectsForPermanent(g as any, enteringBeast, p1);
    expect(((g.state.stack || []) as any[]).some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Bear Watcher')).toBe(false);
  });

  it('matches subtype required type phrases with hyphens (e.g. "Assembly-Worker")', () => {
    const g = createInitialGameState('t_etb_required_type_subtype_hyphen');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const watcherAssemblyWorker = {
      id: 'watch_assembly_worker',
      controller: p1,
      owner: p1,
      card: {
        id: 'watch_assembly_worker_card',
        name: 'Assembly-Worker Watcher',
        type_line: 'Enchantment',
        oracle_text: 'Whenever another Assembly-Worker enters the battlefield under your control, draw a card.',
      },
      tapped: false,
    };
    (g.state.battlefield as any).push(watcherAssemblyWorker);

    const enteringThopter = {
      id: 'thopter_not_worker_1',
      controller: p1,
      owner: p1,
      card: { id: 'thopter_not_worker_1_card', name: 'Ornithopter', type_line: 'Artifact Creature — Thopter', oracle_text: '' },
      tapped: false,
    };
    (g.state.battlefield as any).push(enteringThopter);
    triggerETBEffectsForPermanent(g as any, enteringThopter, p1);
    expect(
      ((g.state.stack || []) as any[]).some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Assembly-Worker Watcher')
    ).toBe(false);

    g.state.stack = [] as any;
    const enteringWorker = {
      id: 'worker_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'worker_1_card',
        name: 'Mishra\'s Factory (animated)',
        type_line: 'Artifact Creature — Assembly-Worker',
        oracle_text: '',
      },
      tapped: false,
    };
    (g.state.battlefield as any).push(enteringWorker);
    triggerETBEffectsForPermanent(g as any, enteringWorker, p1);
    expect(
      ((g.state.stack || []) as any[]).some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Assembly-Worker Watcher')
    ).toBe(true);
  });

  it('does not put other-permanent creature ETB trigger on the stack when intervening-if condition is false', () => {
    const g = createInitialGameState('t_intervening_if_other_perm_creature_etb_false');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const watcher = {
      id: 'watcher_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'watcher_card',
        name: 'Artifactless Watcher',
        type_line: 'Creature — Human',
        oracle_text:
          'Whenever another creature enters the battlefield under your control, if you control an artifact, draw a card.',
      },
      tapped: false,
    };

    const entering = {
      id: 'bear_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'bear_card',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
      },
      tapped: false,
    };

    // Battlefield contains the watcher and the entering creature, but NO artifacts.
    (g.state.battlefield as any).push(watcher);
    (g.state.battlefield as any).push(entering);

    // Trigger ETB processing for the entering creature (this should check other permanents' ETB triggers).
    triggerETBEffectsForPermanent(g as any, entering, p1);

    const stack = (g.state.stack || []) as any[];
    const trigger = stack.find((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Artifactless Watcher');
    expect(trigger).toBeUndefined();

    // If we gain an artifact later, the next qualifying ETB should trigger.
    const artifact = {
      id: 'artifact_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'artifact_card',
        name: 'Sol Ring',
        type_line: 'Artifact',
        oracle_text: '',
      },
      tapped: false,
    };
    (g.state.battlefield as any).push(artifact);

    const entering2 = {
      id: 'bear_2',
      controller: p1,
      owner: p1,
      card: {
        id: 'bear_card_2',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
      },
      tapped: false,
    };
    (g.state.battlefield as any).push(entering2);
    triggerETBEffectsForPermanent(g as any, entering2, p1);

    const stackAfterArtifact = (g.state.stack || []) as any[];
    expect(
      stackAfterArtifact.some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Artifactless Watcher')
    ).toBe(true);
  });

  it('does not put Acclaimed Contender ETB trigger on the stack when "another Knight" condition is false', () => {
    const g = createInitialGameState('t_intervening_if_contender_false');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const contender = {
      id: 'contender_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'contender_card',
        name: 'Acclaimed Contender',
        type_line: 'Creature — Human Knight',
        oracle_text:
          'When this creature enters, if you control another Knight, look at the top five cards of your library. You may reveal a Knight, Aura, Equipment, or legendary artifact card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.',
      },
      tapped: false,
    };

    // Put the creature on the battlefield (ETB triggers check after it has entered).
    (g.state.battlefield as any).push(contender);

    // Trigger ETB processing.
    triggerETBEffectsForPermanent(g as any, contender, p1);

    const stack = (g.state.stack || []) as any[];
    const trigger = stack.find((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Acclaimed Contender');
    expect(trigger).toBeUndefined();
  });

  it('does not retroactively trigger if the intervening-if condition becomes true after ETB', () => {
    const g = createInitialGameState('t_intervening_if_contender_false_then_true');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const contender = {
      id: 'contender_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'contender_card',
        name: 'Acclaimed Contender',
        type_line: 'Creature — Human Knight',
        oracle_text:
          'When this creature enters, if you control another Knight, look at the top five cards of your library.',
      },
      tapped: false,
    };

    // ETB with no "another Knight" => no trigger.
    (g.state.battlefield as any).push(contender);
    triggerETBEffectsForPermanent(g as any, contender, p1);

    const stackAfterEtb = (g.state.stack || []) as any[];
    expect(stackAfterEtb.some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Acclaimed Contender')).toBe(
      false
    );

    // If we gain "another Knight" later, the already-missed intervening-if trigger does not retroactively appear.
    const otherKnight = {
      id: 'knight_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'knight_card',
        name: 'Silver Knight',
        type_line: 'Creature — Human Knight',
        oracle_text: '',
      },
      tapped: false,
    };
    (g.state.battlefield as any).push(otherKnight);

    const stackAfterGainingKnight = (g.state.stack || []) as any[];
    expect(
      stackAfterGainingKnight.some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Acclaimed Contender')
    ).toBe(false);
  });

  it('puts Acclaimed Contender ETB trigger on the stack when "another Knight" condition is true', () => {
    const g = createInitialGameState('t_intervening_if_contender_true');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const otherKnight = {
      id: 'knight_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'knight_card',
        name: 'Silver Knight',
        type_line: 'Creature — Human Knight',
        oracle_text: '',
      },
      tapped: false,
    };

    const contender = {
      id: 'contender_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'contender_card',
        name: 'Acclaimed Contender',
        type_line: 'Creature — Human Knight',
        oracle_text:
          'When this creature enters, if you control another Knight, look at the top five cards of your library.',
      },
      tapped: false,
    };

    (g.state.battlefield as any).push(otherKnight);
    (g.state.battlefield as any).push(contender);

    triggerETBEffectsForPermanent(g as any, contender, p1);

    const stack = (g.state.stack || []) as any[];
    const trigger = stack.find((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Acclaimed Contender');
    expect(trigger).toBeDefined();
    expect(String(trigger?.description || '')).toMatch(/if you control another knight/i);
  });

  it("filters opponent-creature ETB triggers when 'that player' refers to the entering creature's controller", () => {
    const g = createInitialGameState('t_intervening_if_opponent_creature_etb_that_player');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // p2 is the entering creature's controller; we'll vary their handCount.
    (g.state as any).zones = (g.state as any).zones || {};
    (g.state as any).zones[p2] = (g.state as any).zones[p2] || {
      hand: [],
      handCount: 3,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
    };

    const watcher = {
      id: 'watcher_2',
      controller: p1,
      owner: p1,
      card: {
        id: 'watcher_2_card',
        name: 'That Player Suture Test',
        type_line: 'Enchantment',
        oracle_text:
          "Whenever a creature enters the battlefield under an opponent's control, if that player has two or fewer cards in hand, that player loses 1 life.",
      },
      tapped: false,
    };

    const entering = {
      id: 'bear_3',
      controller: p2,
      owner: p2,
      card: {
        id: 'bear_3_card',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
      },
      tapped: false,
    };

    (g.state.battlefield as any).push(watcher);
    (g.state.battlefield as any).push(entering);

    // p2 has 3 cards -> condition false -> should not queue trigger.
    (g.state as any).zones[p2].handCount = 3;
    triggerETBEffectsForPermanent(g as any, entering, p2);
    expect(
      ((g.state.stack || []) as any[]).some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'That Player Suture Test')
    ).toBe(false);

    // Now satisfy: p2 has 2 -> trigger should be queued.
    const entering2 = {
      id: 'bear_4',
      controller: p2,
      owner: p2,
      card: {
        id: 'bear_4_card',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
      },
      tapped: false,
    };
    (g.state.battlefield as any).push(entering2);
    (g.state as any).zones[p2].handCount = 2;
    triggerETBEffectsForPermanent(g as any, entering2, p2);
    expect(
      ((g.state.stack || []) as any[]).some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'That Player Suture Test')
    ).toBe(true);
  });

  it("initializes day/night to day when a daybound permanent enters", () => {
    const g = createInitialGameState('t_day_night_init_on_etb');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const dayboundCreature = {
      id: 'dw_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'dw_card',
        name: 'Daybound Test',
        type_line: 'Creature — Werewolf',
        oracle_text: 'Daybound (If a player casts no spells during their own turn, it becomes night next turn.)',
      },
      tapped: false,
    };

    (g.state.battlefield as any).push(dayboundCreature);
    expect((g.state as any).dayNight).toBeUndefined();
    triggerETBEffectsForPermanent(g as any, dayboundCreature, p1);
    expect((g.state as any).dayNight).toBe('day');

    // Should not override an existing day/night state.
    (g.state as any).dayNight = 'night';
    const nightboundCreature = {
      id: 'nb_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'nb_card',
        name: 'Nightbound Test',
        type_line: 'Creature — Werewolf',
        oracle_text: 'Nightbound (If a player casts at least two spells during their own turn, it becomes day next turn.)',
      },
      tapped: false,
    };
    (g.state.battlefield as any).push(nightboundCreature);
    triggerETBEffectsForPermanent(g as any, nightboundCreature, p1);
    expect((g.state as any).dayNight).toBe('night');
  });

  it("initializes day/night to night when only a nightbound permanent is present", () => {
    const g = createInitialGameState('t_day_night_init_on_etb_nightbound_only');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const nightboundCreature = {
      id: 'nb_only_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'nb_only_card',
        name: 'Nightbound Only Test',
        type_line: 'Creature — Werewolf',
        oracle_text: 'Nightbound (If a player casts at least two spells during their own turn, it becomes day next turn.)',
      },
      tapped: false,
    };

    (g.state.battlefield as any).push(nightboundCreature);
    expect((g.state as any).dayNight).toBeUndefined();
    triggerETBEffectsForPermanent(g as any, nightboundCreature, p1);
    expect((g.state as any).dayNight).toBe('night');
  });
});
