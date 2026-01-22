import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { triggerETBEffectsForPermanent } from '../src/state/modules/stack';

describe('Intervening-if ETB triggers', () => {
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
