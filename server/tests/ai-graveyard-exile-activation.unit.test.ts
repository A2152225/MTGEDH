import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import {
  classifySingleCardGraveyardExile,
  scoreGraveyardExileTarget,
} from '../../rules-engine/src/aiGraveyardExileActivation.js';
import { canAIActivateBattlefieldAbilityNow } from '../src/socket/ai-handlers/aiActionCandidateHandlers.js';
import { chooseAITargetSelectionsForChoiceStep } from '../src/socket/ai-handlers/aiTargetChoiceHandlers.js';

const PALEONTOLOGIST_ORACLE =
  '{T}: Add one mana of any color.\n{2}: Exile target card from a graveyard.\nYou may cast Dinosaur creature spells from among cards you own exiled with this creature. If you cast a spell this way, that creature enters with a finality counter on it.';

const terrain = {
  id: 'terrain',
  name: 'Treacherous Terrain',
  type_line: 'Sorcery',
  cmc: 8,
  oracle_text: 'Treacherous Terrain deals damage to each opponent equal to the number of lands that player controls.\nBasic landcycling {2}',
};
const conduit = {
  id: 'conduit',
  name: 'Soul Conduit',
  type_line: 'Artifact',
  cmc: 6,
  oracle_text: '{6}, {T}: Two target players exchange life totals.',
};
const looting = {
  id: 'looting',
  name: 'Faithless Looting',
  type_line: 'Sorcery',
  cmc: 1,
  oracle_text: 'Draw two cards, then discard two cards.\nFlashback {2}{R}',
};
const dinosaur = {
  id: 'regisaur',
  name: 'Regisaur Alpha',
  type_line: 'Creature — Dinosaur',
  cmc: 5,
  oracle_text: 'Other Dinosaurs you control have haste.\nWhenever a Dinosaur you control enters, it deals 1 damage to target opponent.',
};

function paleontologistGame(zones: Record<string, { graveyard: any[] }>) {
  return {
    state: {
      turnPlayer: 'ai',
      phase: 'beginning',
      step: 'DRAW',
      stack: [],
      players: [{ id: 'ai', name: 'Roar' }, { id: 'king', name: 'King' }],
      manaPool: { ai: { white: 0, blue: 0, black: 0, red: 0, green: 4, colorless: 0 } },
      commandZone: { ai: { inCommandZone: ['pantlaza'] } },
      zones,
      battlefield: [{
        id: 'paleo',
        controller: 'ai',
        tapped: false,
        activatedThisTurn: false,
        card: {
          name: 'Intrepid Paleontologist',
          type_line: 'Creature — Human Druid',
          oracle_text: PALEONTOLOGIST_ORACLE,
        },
      }],
    },
  };
}

const action = {
  activate: true,
  permanentId: 'paleo',
  cardName: 'Intrepid Paleontologist',
  abilityText: '{2}: Exile target card from a graveyard.',
};

describe('single-card graveyard exile activation', () => {
  it('does not spend mana exiling a graveyard with nothing to recover or cast', () => {
    const game = paleontologistGame({
      king: { graveyard: [terrain, conduit] },
    });
    expect(classifySingleCardGraveyardExile(game.state, 'ai', game.state.battlefield[0], action.abilityText)).toBe('none');
    expect(canAIActivateBattlefieldAbilityNow(game, 'ai' as PlayerID, action, 'response')).toBe(false);
    expect(canAIActivateBattlefieldAbilityNow(game, 'ai' as PlayerID, action, 'main')).toBe(false);
  });

  it('exiles an opponent flashback card even in a response window', () => {
    const game = paleontologistGame({
      king: { graveyard: [terrain, looting] },
    });
    expect(classifySingleCardGraveyardExile(game.state, 'ai', game.state.battlefield[0], action.abilityText)).toBe('deny-recovery');
    expect(canAIActivateBattlefieldAbilityNow(game, 'ai' as PlayerID, action, 'response')).toBe(true);
  });

  it('sets up an owned dinosaur on the main phase and not during the draw step', () => {
    const game = paleontologistGame({
      ai: { graveyard: [dinosaur] },
      king: { graveyard: [terrain] },
    });
    expect(classifySingleCardGraveyardExile(game.state, 'ai', game.state.battlefield[0], action.abilityText)).toBe('setup');
    expect(canAIActivateBattlefieldAbilityNow(game, 'ai' as PlayerID, action, 'response')).toBe(false);
    expect(canAIActivateBattlefieldAbilityNow({
      state: { ...game.state, phase: 'precombatMain', step: 'MAIN1' },
    }, 'ai' as PlayerID, action, 'main')).toBe(true);
  });

  it('denies a creature an opponent can reanimate', () => {
    const creature = {
      id: 'bird',
      name: 'Birds of Paradise',
      type_line: 'Creature — Bird',
      cmc: 1,
      oracle_text: 'Flying\n{T}: Add one mana of any color.',
    };
    const game = paleontologistGame({ king: { graveyard: [creature, terrain] } });
    game.state.battlefield.push({
      id: 'reanimate',
      controller: 'king',
      tapped: false,
      card: {
        name: 'Reanimate',
        type_line: 'Sorcery',
        oracle_text: 'Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value.',
      },
    } as any);
    expect(classifySingleCardGraveyardExile(game.state, 'ai', game.state.battlefield[0], action.abilityText)).toBe('deny-recovery');
    expect(scoreGraveyardExileTarget(game.state, 'ai', game.state.battlefield[0].card, creature, 'king'))
      .toBeGreaterThan(scoreGraveyardExileTarget(game.state, 'ai', game.state.battlefield[0].card, terrain, 'king'));
  });

  it('targets the recoverable card instead of the highest mana value', () => {
    const game = paleontologistGame({
      king: { graveyard: [terrain, looting] },
      ai: { graveyard: [dinosaur] },
    });
    const chosen = chooseAITargetSelectionsForChoiceStep(game, 'ai' as PlayerID, {
      sourceId: 'paleo',
      sourceName: 'Intrepid Paleontologist',
      minTargets: 1,
      maxTargets: 1,
      validTargets: [
        { id: 'terrain', name: 'Treacherous Terrain', type: 'graveyard_card' },
        { id: 'looting', name: 'Faithless Looting', type: 'graveyard_card' },
        { id: 'regisaur', name: 'Regisaur Alpha', type: 'graveyard_card' },
      ],
    });
    expect(chosen).toEqual(['looting']);
  });
});
