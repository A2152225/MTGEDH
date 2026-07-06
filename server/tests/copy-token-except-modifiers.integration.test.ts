import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState';
import { createCopyTokensOfCard } from '../src/state/modules/counters_tokens.js';
import { detectBeginningOfCombatTriggers } from '../src/state/modules/triggered-abilities.js';
import { ensureLocalCardLookupIndexSync, lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';
import {
  parseCopyTokenOverridesFromEffect,
} from '../../shared/src/copyTokenOverrides.js';
import type { PlayerID } from '../../shared/src';

describe('copy-token except modifiers (Scryfall corpus integration)', () => {
  beforeAll(async () => {
    await initDb();
    ensureLocalCardLookupIndexSync();
  });

  it('detects God-Pharaoh\'s Gift begin-combat trigger from oracle without KNOWN shorthand', () => {
    const gift = lookupLocalCardByNameSync("God-Pharaoh's Gift");
    expect(gift?.oracle_text).toBeTruthy();

    const triggers = detectBeginningOfCombatTriggers(gift, { id: 'gift_1', controller: 'p1' });
    expect(triggers).toHaveLength(1);
    expect(triggers[0].effect.toLowerCase()).toContain('exile a creature card from your graveyard');
    expect(triggers[0].effect.toLowerCase()).toContain('4/4 black zombie');
    expect(triggers[0].requiresChoice).toBe(true);
  });

  it('does not treat misclassified cards as begin-combat via removed KNOWN rows', () => {
    const misclassified = [
      'Krenko, Tin Street Kingpin',
      "Tilonalli's Summoner",
      'Tendershoot Dryad',
      'Blade of Selves',
    ];
    for (const name of misclassified) {
      const card = lookupLocalCardByNameSync(name);
      expect(card?.oracle_text).toBeTruthy();
      const triggers = detectBeginningOfCombatTriggers(card, { id: 'perm', controller: 'p1' });
      expect(triggers, name).toHaveLength(0);
    }
  });

  it('applies God-Pharaoh\'s Gift 4/4 black Zombie overrides on printed-card copies', () => {
    const game = createInitialGameState('gift_copy_token_overrides');
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const gift = lookupLocalCardByNameSync("God-Pharaoh's Gift");
    const effect =
      gift?.oracle_text?.match(/if you do,\s*(create a token.+)$/i)?.[1] ||
      "create a token that's a copy of that card, except it's a 4/4 black Zombie. It gains haste until end of turn.";
    const overrides = parseCopyTokenOverridesFromEffect(effect);

    const sourceCard = {
      id: 'grizzly_source',
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
      colors: ['G'],
      mana_cost: '{1}{G}',
    };

    createCopyTokensOfCard(game as any, p1, sourceCard, 1, true, overrides);

    const copy = ((game.state as any).battlefield || []).find(
      (perm: any) => perm?.isCopyToken && perm?.card?.name === 'Grizzly Bears',
    );
    expect(copy).toBeDefined();
    expect(copy.basePower).toBe(4);
    expect(copy.baseToughness).toBe(4);
    expect(copy.card.colors).toEqual(['B']);
    expect(String(copy.card.type_line || '').toLowerCase()).toContain('zombie');
    expect(copy.summoningSickness).toBe(false);
    expect(copy.copyTokenOverrides?.power).toBe(4);
    expect(copy.copyTokenOverrides?.colors).toEqual(['B']);
  });

  it('applies Feldon artifact + haste overrides on graveyard-card copies', () => {
    const game = createInitialGameState('feldon_copy_token_overrides');
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const feldon = lookupLocalCardByNameSync('Feldon of the Third Path');
    const activated = String(feldon?.oracle_text || '').split('\n').find((line) => /create a token/i.test(line)) || '';
    const overrides = parseCopyTokenOverridesFromEffect(activated);

    const sourceCard = {
      id: 'zombie_source',
      name: 'Gravecrawler',
      type_line: 'Creature — Zombie',
      oracle_text: 'You may cast this card from your graveyard.',
      power: '2',
      toughness: '1',
      colors: ['B'],
      mana_cost: '{B}',
    };

    createCopyTokensOfCard(game as any, p1, sourceCard, 1, true, overrides);

    const copy = ((game.state as any).battlefield || []).find(
      (perm: any) => perm?.isCopyToken && perm?.card?.name === 'Gravecrawler',
    );
    expect(copy).toBeDefined();
    expect(String(copy.card.type_line || '').toLowerCase()).toContain('artifact');
    expect(String(copy.card.type_line || '').toLowerCase()).toContain('creature');
    expect(copy.summoningSickness).toBe(false);
    expect(copy.copyTokenOverrides?.addCardTypes).toEqual(['Artifact']);
  });
});

describe('Heidegger begin-combat (dynamic oracle detection)', () => {
  it('detects +X/+0 buff from oracle, not stale KNOWN soldier-token shorthand', () => {
    const heidegger = lookupLocalCardByNameSync('Heidegger, Shinra Executive');
    expect(heidegger?.oracle_text).toBeTruthy();

    const triggers = detectBeginningOfCombatTriggers(heidegger, { id: 'heidegger_1', controller: 'p1' });
    expect(triggers).toHaveLength(1);
    expect(triggers[0].effect.toLowerCase()).toContain('+x/+0');
    expect(triggers[0].effect.toLowerCase()).not.toContain('create a');
  });
});
