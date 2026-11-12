import { describe, expect, it } from 'vitest';

import { parseOracleTextToIR } from '../src/oracleIRParser';
import { oracleTextInstructsEnterTransformedOrConverted } from '../src/oracleIREnterTransformedPattern';
import {
  addBattlefieldPermanentsToState,
  createBattlefieldPermanentsFromCards,
} from '../src/oracleIRExecutorZoneOpsBattlefieldEntry';
import type { GameState, PlayerID } from '../../shared/src';

const AZUSA_ORACLE =
  '(As this Saga enters and after your draw step, add a lore counter.)\n' +
  'I \u2014 You may play an additional land this turn.\n' +
  'II \u2014 You gain 3 life.\n' +
  'III \u2014 Exile this Saga, then return it to the battlefield transformed under your control.';

const CRAFT_ORACLE =
  '{T}: Add one mana of any color.\n' +
  'Craft with two that share a card type {6} ({6}, Exile this artifact, Exile the two from among other permanents you control and/or cards from your graveyard: Return this card transformed under its owner\'s control. Craft only as a sorcery.)';

const DISTURB_ORACLE = 'Disturb {3}{W} (You may cast this card transformed from your graveyard for its disturb cost.)';

function azusaCard(id = 'azusa1') {
  return {
    id,
    name: "Azusa's Many Journeys",
    layout: 'transform',
    type_line: 'Enchantment \u2014 Saga',
    oracle_text: AZUSA_ORACLE,
    card_faces: [
      {
        name: "Azusa's Many Journeys",
        type_line: 'Enchantment \u2014 Saga',
        oracle_text: AZUSA_ORACLE,
        mana_cost: '{1}{G}',
      },
      {
        name: 'Likeness of the Seeker',
        type_line: 'Enchantment Creature \u2014 Human Monk',
        oracle_text: 'Whenever this creature becomes blocked, untap up to three lands you control.',
        power: '3',
        toughness: '3',
      },
    ],
  };
}

function bears(id = 'bears1') {
  return {
    id,
    name: 'Grizzly Bears',
    layout: 'normal',
    type_line: 'Creature \u2014 Bear',
    oracle_text: '',
    power: '2',
    toughness: '2',
  };
}

function bruna(id = 'bruna1') {
  return {
    id,
    name: 'Bruna, the Fading Light',
    layout: 'meld',
    isMeldCard: true,
    type_line: 'Legendary Creature \u2014 Angel Horror',
    oracle_text:
      'When you cast this spell, you may return target Angel or Human creature card from your graveyard to the battlefield.\nFlying, vigilance\n(Melds with Gisela, the Broken Blade.)',
  };
}

function emptyState(playerId: PlayerID, graveyard: any[] = []): GameState {
  return {
    players: [{ id: playerId, graveyard: [...graveyard], hand: [], exile: [], library: [], life: 40 } as any],
    battlefield: [],
  } as any;
}

function battlefieldMoveSteps(ir: ReturnType<typeof parseOracleTextToIR>) {
  const steps: any[] = [];
  const walk = (list: readonly any[] | undefined) => {
    for (const step of list || []) {
      if (step?.kind === 'move_zone' && step.to === 'battlefield') steps.push(step);
      if (Array.isArray(step?.steps)) walk(step.steps);
      if (Array.isArray(step?.modes)) for (const mode of step.modes) walk(mode.steps);
    }
  };
  for (const ability of ir.abilities) walk(ability.steps);
  return steps;
}

describe('CR 20261106 IR enter-transformed parse and restore', () => {
  it('detects saga and craft return-transformed wording', () => {
    expect(oracleTextInstructsEnterTransformedOrConverted(AZUSA_ORACLE)).toBe(true);
    expect(oracleTextInstructsEnterTransformedOrConverted(CRAFT_ORACLE)).toBe(true);
    expect(oracleTextInstructsEnterTransformedOrConverted(DISTURB_ORACLE)).toBe(false);
  });

  it('stamps entersTransformed on a saga that returns itself transformed', () => {
    const ir = parseOracleTextToIR(AZUSA_ORACLE, "Azusa's Many Journeys");
    const moves = battlefieldMoveSteps(ir);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((step) => step.entersTransformed === true)).toBe(true);
  });

  it('stamps entersTransformed on Craft reminder return text', () => {
    const ir = parseOracleTextToIR(CRAFT_ORACLE, 'Eye of Ojer Taq');
    const moves = battlefieldMoveSteps(ir);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.some((step) => step.entersTransformed === true)).toBe(true);
  });

  it('does not stamp a disturb-only cast-transformed permission as a battlefield move', () => {
    const ir = parseOracleTextToIR(DISTURB_ORACLE, 'Beloved Beggar');
    const moves = battlefieldMoveSteps(ir);
    expect(moves.every((step) => step.entersTransformed !== true)).toBe(true);
  });

  it('puts a transforming DFC onto the battlefield back face up', () => {
    const created = createBattlefieldPermanentsFromCards(
      [azusaCard()],
      'p1',
      'p1',
      false,
      false,
      undefined,
      true,
      'gy',
    );
    expect(created).toHaveLength(1);
    expect(created.rejected).toHaveLength(0);
    expect(created[0].card.name).toBe('Likeness of the Seeker');
    expect(created[0].transformed).toBe(true);
    expect(created[0].basePower).toBe(3);
    expect(created[0].baseToughness).toBe(3);
  });

  it('keeps a non-DFC in its graveyard when instructed to enter transformed', () => {
    const card = bears();
    let state = emptyState('p1', []);
    const created = createBattlefieldPermanentsFromCards([card], 'p1', 'p1', false, false, undefined, true, 'gy');
    expect(created).toHaveLength(0);
    expect(created.rejected).toHaveLength(1);
    expect(created.rejected[0].outcome).toBe('stay_in_zone');
    state = addBattlefieldPermanentsToState(state, created);
    const gy = (state.players.find((p) => p.id === 'p1') as any).graveyard as any[];
    expect(gy.some((entry) => entry.id === 'bears1')).toBe(true);
    expect(state.battlefield).toHaveLength(0);
    expect(gy.filter((entry) => entry.id === 'bears1')).toHaveLength(1);
  });

  it('keeps a meld card in its graveyard when instructed to enter transformed (713.1c)', () => {
    const card = bruna();
    let state = emptyState('p1', []);
    const created = createBattlefieldPermanentsFromCards([card], 'p1', 'p1', false, false, undefined, true, 'gy');
    expect(created).toHaveLength(0);
    expect(created.rejected[0].outcome).toBe('stay_in_zone');
    state = addBattlefieldPermanentsToState(state, created);
    const gy = (state.players.find((p) => p.id === 'p1') as any).graveyard as any[];
    expect(gy.some((entry) => entry.id === 'bruna1')).toBe(true);
    expect(state.battlefield).toHaveLength(0);
  });

  it('restores a rejected library card to its original mid-library index instead of the top', () => {
    const top = bears('top');
    const mid = { ...bears('mid'), sourceZone: 'library', sourceIndex: 1 };
    const bottom = bears('bottom');
    const libraryMap = new Map<string, any[]>([['p1', [top, bottom]]]);
    let state: any = {
      players: [{ id: 'p1', library: [top, bottom], graveyard: [], hand: [], exile: [], life: 40 }],
      battlefield: [],
      libraries: libraryMap,
    };
    const created = createBattlefieldPermanentsFromCards([mid], 'p1', 'p1', false, false, undefined, true, 'library');
    expect(created).toHaveLength(0);
    expect(created.rejected[0].sourceIndex).toBe(1);
    state = addBattlefieldPermanentsToState(state, created);
    expect((state.players[0] as any).library.map((entry: any) => entry.id)).toEqual(['top', 'mid', 'bottom']);
    expect(libraryMap.get('p1')!.map((entry: any) => entry.id)).toEqual(['top', 'mid', 'bottom']);
    expect(state.battlefield).toHaveLength(0);
  });
});
