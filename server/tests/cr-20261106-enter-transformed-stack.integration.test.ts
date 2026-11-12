import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { GamePhase } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createBattlefieldPermanentsFromCards, addBattlefieldPermanentsToState } from '../../rules-engine/src/oracleIRExecutorZoneOpsBattlefieldEntry.js';
import { applyDelayedCleanupTriggersFromMetadata } from '../src/state/modules/triggerDelayedCleanupUtils.js';
import { applyBoundGraveyardReturnFromTriggerMetadata } from '../src/state/modules/triggerBoundGraveyardReturnUtils.js';

const KYLEM_ORACLE =
  '(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it\'s defeated, exile it, then cast it transformed.)\nWhen this Siege enters, up to two target creatures each get +2/+0 and gain vigilance and haste until end of turn.';

const TAG_TEAM_ORACLE =
  'Create two 3/2 red and white Warrior creature tokens with "Whenever this token and at least one other creature token attack, put a +1/+1 counter on this token."';

const BIRD_ORACLE = 'Reach\nDaybound (If a player casts no spells during their own turn, it becomes night next turn.)';
const WING_ORACLE = 'Reach\nNightbound (If a player casts at least two spells during their own turn, it becomes day next turn.)';

const AZUSA_CHAPTER =
  'III \u2014 Exile this Saga, then return it to the battlefield transformed under your control.';

const CRAFT_REMINDER =
  'Craft with two that share a card type {6} ({6}, Exile this artifact, Exile the two from among other permanents you control and/or cards from your graveyard: Return this card transformed under its owner\'s control. Craft only as a sorcery.)';

function invasionCard(id = 'kylem1') {
  return {
    id,
    name: 'Invasion of Kylem',
    layout: 'transform',
    type_line: 'Battle \u2014 Siege',
    oracle_text: KYLEM_ORACLE,
    card_faces: [
      { name: 'Invasion of Kylem', type_line: 'Battle \u2014 Siege', oracle_text: KYLEM_ORACLE, mana_cost: '{2}{R}{W}' },
      { name: "Valor's Reach Tag Team", type_line: 'Sorcery', oracle_text: TAG_TEAM_ORACLE },
    ],
  };
}

function birdAdmirer(id = 'bird1') {
  return {
    id,
    name: 'Bird Admirer',
    layout: 'transform',
    type_line: 'Creature \u2014 Human Archer Werewolf',
    oracle_text: BIRD_ORACLE,
    power: '1',
    toughness: '4',
    card_faces: [
      { name: 'Bird Admirer', type_line: 'Creature \u2014 Human Archer Werewolf', oracle_text: BIRD_ORACLE, power: '1', toughness: '4' },
      { name: 'Wing Shredder', type_line: 'Creature \u2014 Werewolf', oracle_text: WING_ORACLE, power: '3', toughness: '5' },
    ],
  };
}

function azusaCard(id = 'azusa1') {
  return {
    id,
    name: "Azusa's Many Journeys",
    layout: 'transform',
    type_line: 'Enchantment \u2014 Saga',
    oracle_text: AZUSA_CHAPTER,
    card_faces: [
      { name: "Azusa's Many Journeys", type_line: 'Enchantment \u2014 Saga', oracle_text: AZUSA_CHAPTER },
      { name: 'Likeness of the Seeker', type_line: 'Enchantment Creature \u2014 Human Monk', oracle_text: 'Whenever this creature becomes blocked, untap up to three lands you control.', power: '3', toughness: '3' },
    ],
  };
}

function stonetree(id = 'stone1') {
  return {
    id,
    name: "Kaslem's Stonetree",
    layout: 'transform',
    type_line: 'Artifact',
    oracle_text: CRAFT_REMINDER,
    card_faces: [
      { name: "Kaslem's Stonetree", type_line: 'Artifact', oracle_text: CRAFT_REMINDER, mana_cost: '{2}{G}' },
      { name: "Kaslem's Strider", type_line: 'Artifact Creature \u2014 Golem', oracle_text: '', power: '5', toughness: '5' },
    ],
  };
}

function bruna(id = 'bruna1') {
  return {
    id,
    name: 'Bruna, the Fading Light',
    layout: 'meld',
    isMeldCard: true,
    type_line: 'Legendary Creature \u2014 Angel Horror',
    oracle_text: '(Melds with Gisela, the Broken Blade.)',
  };
}

function bears(id = 'bears1') {
  return { id, name: 'Grizzly Bears', layout: 'normal', type_line: 'Creature \u2014 Bear', power: '2', toughness: '2' };
}

function ensureZones(game: any, pid: PlayerID) {
  game.state.zones = game.state.zones || {};
  game.state.zones[pid] = game.state.zones[pid] || {
    hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0,
  };
}

function setupGame() {
  const game = createInitialGameState('t93u_enter_transformed');
  const p1 = 'p1' as PlayerID;
  game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
  game.applyEvent({ type: 'join', playerId: 'p2' as PlayerID, name: 'P2' });
  ensureZones(game, p1);
  ensureZones(game, 'p2' as PlayerID);
  (game.state as any).phase = GamePhase.PRECOMBAT_MAIN;
  (game.state as any).turnPlayer = p1;
  (game.state as any).priority = p1;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).dayNight = 'night';
  return { game, p1 };
}

describe('CR 20261106 enter-transformed stack and return paths', () => {
  it('sends Invasion of Kylem to the graveyard when it would enter transformed onto a sorcery back (701.27j)', () => {
    const { game, p1 } = setupGame();
    const card = invasionCard();
    (game.state as any).stack = [{
      id: 'stack_kylem',
      type: 'spell',
      controller: p1,
      card,
      entersBattlefieldTransformed: true,
    }];
    game.resolveTopOfStack();
    expect((game.state as any).battlefield || []).toHaveLength(0);
    const gy = (game.state as any).zones[p1].graveyard || [];
    expect(gy.some((entry: any) => String(entry?.id || entry?.name || '').includes('kylem') || entry?.name === 'Invasion of Kylem')).toBe(true);
  });

  it('sends a Mystic Reflection-style copy of a siege with a sorcery back to the graveyard at night', () => {
    const { game, p1 } = setupGame();
    const siege = invasionCard('kylem_copy');
    const bird = birdAdmirer();
    (game.state as any).stack = [{
      id: 'stack_reflect',
      type: 'spell',
      controller: p1,
      card: { ...siege, ...bird, name: 'Bird Admirer', type_line: bird.type_line, oracle_text: bird.oracle_text, card_faces: bird.card_faces, layout: 'transform' },
      entersBattlefieldTransformed: true,
      representingCard: siege,
      copyOfCard: bird,
    }];
    (game.state as any).dayNight = 'night';
    game.resolveTopOfStack();
    expect((game.state as any).battlefield || []).toHaveLength(0);
    const gy = (game.state as any).zones[p1].graveyard || [];
    expect(gy.length).toBeGreaterThan(0);
  });

  it('returns a delayed Craft card transformed onto its back face', () => {
    const { game, p1 } = setupGame();
    const card = stonetree();
    (game.state as any).zones[p1].graveyard = [{ ...card, zone: 'graveyard' }];
    (game.state as any).zones[p1].graveyardCount = 1;
    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    if (player) player.graveyard = [{ ...card, zone: 'graveyard' }];
    applyDelayedCleanupTriggersFromMetadata({
      ctx: game as any,
      controller: p1,
      sourceName: "Kaslem's Stonetree",
      triggerItem: {
        delayedAction: 'graveyard_return',
        delayedGraveyardReturnEntries: [{
          cardId: card.id,
          zoneOwnerId: p1,
          destination: 'battlefield',
          battlefieldTransformed: true,
        }],
        delayedSourceName: "Kaslem's Stonetree",
      },
      state: game.state,
    } as any);
    const permanents = (game.state as any).battlefield || [];
    expect(permanents).toHaveLength(1);
    expect(permanents[0].card.name).toBe("Kaslem's Strider");
    expect(permanents[0].transformed).toBe(true);
    expect(permanents[0].basePower).toBe(5);
    expect((game.state as any).zones[p1].graveyard || []).toHaveLength(0);
  });

  it('returns a player-chosen graveyard card transformed via bound trigger metadata', () => {
    const { game, p1 } = setupGame();
    const card = stonetree('stone_chosen');
    (game.state as any).zones[p1].graveyard = [{ ...card, zone: 'graveyard' }];
    (game.state as any).zones[p1].graveyardCount = 1;
    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    if (player) player.graveyard = [{ ...card, zone: 'graveyard' }];
    applyBoundGraveyardReturnFromTriggerMetadata({
      ctx: game as any,
      state: game.state,
      controller: p1,
      sourceName: 'Craft',
      triggerItem: {
        boundGraveyardCardId: card.id,
        boundGraveyardOwnerId: p1,
        targetZone: 'graveyard',
        targetDestination: 'battlefield',
        battlefieldTransformed: true,
      },
    });
    const permanents = (game.state as any).battlefield || [];
    expect(permanents).toHaveLength(1);
    expect(permanents[0].card.name).toBe("Kaslem's Strider");
    expect(permanents[0].transformed).toBe(true);
  });

  it('parses Azusa-style return-transformed IR and applies it to a TDFC, a non-DFC, and a meld card', () => {
    const ir = parseOracleTextToIR(
      'Exile this Saga, then return it to the battlefield transformed under your control.',
      "Azusa's Many Journeys",
    );
    const move = ir.abilities.flatMap((ability) => ability.steps as any[]).find((step) => step.kind === 'move_zone' && step.to === 'battlefield');
    expect(move?.entersTransformed).toBe(true);

    const { game, p1 } = setupGame();
    const tdfc = azusaCard();
    const createdTdfc = createBattlefieldPermanentsFromCards([tdfc], p1, p1, false, false, undefined, true, 'gy');
    const afterTdfc = addBattlefieldPermanentsToState(game.state, createdTdfc);
    expect(createdTdfc).toHaveLength(1);
    expect(createdTdfc[0].card.name).toBe('Likeness of the Seeker');

    const createdBears = createBattlefieldPermanentsFromCards([bears()], p1, p1, false, false, undefined, true, 'gy');
    const afterBears = addBattlefieldPermanentsToState(afterTdfc, createdBears);
    expect(createdBears).toHaveLength(0);
    expect((afterBears.players.find((entry: any) => entry.id === p1) as any).graveyard.some((entry: any) => entry.id === 'bears1')).toBe(true);

    const createdMeld = createBattlefieldPermanentsFromCards([bruna()], p1, p1, false, false, undefined, true, 'gy');
    const afterMeld = addBattlefieldPermanentsToState(afterBears, createdMeld);
    expect(createdMeld).toHaveLength(0);
    expect((afterMeld.players.find((entry: any) => entry.id === p1) as any).graveyard.some((entry: any) => entry.id === 'bruna1')).toBe(true);
  });
});
