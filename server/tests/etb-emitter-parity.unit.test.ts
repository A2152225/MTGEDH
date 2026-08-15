import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { queuePermanentEntersBattlefieldTriggerStackItems } from '../src/state/modules/stackResolvePermanentEtbTriggerUtils.js';

type StackFingerprint = {
  triggerType: string;
  sourceName: string;
  controller: string;
  source: string;
  xValue: number | null;
};

function fingerprintTriggeredAbilities(stack: any[]): StackFingerprint[] {
  return (stack || [])
    .filter((entry) => entry?.type === 'triggered_ability')
    .map((entry) => ({
      triggerType: String(entry.triggerType || ''),
      sourceName: String(entry.sourceName || ''),
      controller: String(entry.controller || ''),
      source: String(entry.source || ''),
      xValue: typeof entry.xValue === 'number' ? entry.xValue : null,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function seedTwoPlayerGame(gameId: string) {
  const game = createInitialGameState(gameId);
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
  game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
  (game.state as any).stack = [];
  return { game, p1, p2 };
}

function permanent(id: string, controller: string, card: Record<string, unknown>) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: { id: `${id}_card`, ...card },
  };
}

function collectFromSharedEmitter(game: any, entering: any, controller: PlayerID) {
  (game.state as any).stack = [];
  triggerETBEffectsForPermanent(game as any, entering, controller, true);
  return fingerprintTriggeredAbilities((game.state as any).stack || []);
}

function collectFromSpellEntryWrapper(game: any, entering: any, controller: PlayerID) {
  (game.state as any).stack = [];
  queuePermanentEntersBattlefieldTriggerStackItems(game as any, {
    controller,
    card: entering.card,
    effectiveCard: entering.card,
    newPermanent: entering,
    newPermId: entering.id,
    isCreature: String(entering.card?.type_line || '').toLowerCase().includes('creature'),
  });
  return fingerprintTriggeredAbilities((game.state as any).stack || []);
}

describe('ETB emitter parity — spell wrapper vs shared land/token path', () => {
  it('queues the same self-ETB for a generic "when this enters, draw" creature', () => {
    const { game, p1 } = seedTwoPlayerGame('etb_parity_self_draw');
    const visionary = permanent('visionary_1', p1, {
      name: 'Sample Visionary',
      type_line: 'Creature — Elf Shaman',
      oracle_text: 'When this creature enters, draw a card.',
      power: '1',
      toughness: '1',
    });
    (game.state as any).battlefield = [visionary];

    const shared = collectFromSharedEmitter(game, visionary, p1);
    const spell = collectFromSpellEntryWrapper(game, visionary, p1);

    expect(shared.some((entry) => entry.triggerType === 'etb' && entry.source === visionary.id)).toBe(true);
    expect(spell).toEqual(shared);
  });

  it('queues hideaway_etb from both entry wrappers', () => {
    const { game, p1 } = seedTwoPlayerGame('etb_parity_hideaway');
    const hideawayLand = permanent('hideaway_1', p1, {
      name: 'Sample Hideaway',
      type_line: 'Land',
      oracle_text:
        'Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)\nThis land enters tapped.\n{T}: Add {G}.',
      keywords: ['Hideaway'],
    });
    (game.state as any).battlefield = [hideawayLand];

    const shared = collectFromSharedEmitter(game, hideawayLand, p1);
    const spell = collectFromSpellEntryWrapper(game, hideawayLand, p1);

    expect(shared.some((entry) => entry.triggerType === 'hideaway_etb' && entry.source === hideawayLand.id)).toBe(true);
    expect(spell).toEqual(shared);
  });

  it('queues the same creature_etb watcher when another creature enters', () => {
    const { game, p1 } = seedTwoPlayerGame('etb_parity_creature_etb');
    const warden = permanent('warden_1', p1, {
      name: 'Sample Warden',
      type_line: 'Creature — Human Cleric',
      oracle_text: 'Whenever a creature enters, you gain 1 life.',
      power: '1',
      toughness: '1',
    });
    const bear = permanent('bear_1', p1, {
      name: 'Sample Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    });
    (game.state as any).battlefield = [warden, bear];

    const shared = collectFromSharedEmitter(game, bear, p1);
    const spell = collectFromSpellEntryWrapper(game, bear, p1);

    expect(shared.some((entry) => entry.triggerType === 'creature_etb' && entry.source === warden.id)).toBe(true);
    expect(spell).toEqual(shared);
  });

  it('queues the same named-or-another typed ETB watcher and binds X', () => {
    const { game, p1 } = seedTwoPlayerGame('etb_parity_named_or_another');
    const watcher = permanent('dino_watcher_1', p1, {
      name: 'Sample Dino Watcher',
      type_line: 'Legendary Creature — Dinosaur',
      oracle_text:
        "Whenever Sample Dino Watcher or another Dinosaur you control enters, you may discover X, where X is that creature's toughness. Do this only once each turn.",
      power: '4',
      toughness: '4',
    });
    const otherDino = permanent('other_dino_1', p1, {
      name: 'Sample Temple',
      type_line: 'Creature — Dinosaur',
      oracle_text: '',
      power: '3',
      toughness: '7',
    });
    (game.state as any).battlefield = [watcher, otherDino];

    const shared = collectFromSharedEmitter(game, otherDino, p1);
    const spell = collectFromSpellEntryWrapper(game, otherDino, p1);

    const sharedNamed = shared.find((entry) => entry.triggerType === 'named_or_another_typed_etb');
    expect(sharedNamed).toMatchObject({
      source: watcher.id,
      xValue: 7,
    });
    expect(spell).toEqual(shared);
  });

  it('does not treat a land-path-only self type as missing on the spell wrapper', () => {
    const { game, p1 } = seedTwoPlayerGame('etb_parity_self_search');
    const solemn = permanent('solemn_1', p1, {
      name: 'Sample Solemn',
      type_line: 'Artifact Creature — Golem',
      oracle_text: 'When this creature enters, you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
      power: '2',
      toughness: '4',
    });
    (game.state as any).battlefield = [solemn];

    const shared = collectFromSharedEmitter(game, solemn, p1);
    const spell = collectFromSpellEntryWrapper(game, solemn, p1);

    expect(shared.some((entry) => entry.source === solemn.id && /etb/i.test(entry.triggerType))).toBe(true);
    expect(spell).toEqual(shared);
  });
});
