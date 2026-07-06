import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState';
import { createCopyTokensOfCard } from '../src/state/modules/counters_tokens.js';
import { parseCopyTokenOverridesFromEffect } from '../../shared/src/copyTokenOverrides.js';
import { detectBeginningOfCombatTriggers } from '../src/state/modules/triggered-abilities.js';
import { ensureLocalCardLookupIndexSync, lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';
import type { PlayerID } from '../../shared/src';

function setupToMain1(g: ReturnType<typeof createInitialGameState>, p1: PlayerID, p2: PlayerID) {
  g.applyEvent({ type: 'nextTurn' });
  const sampleDeck = Array.from({ length: 20 }, (_, i) => ({
    id: `card_${i}`,
    name: `Test Card ${i}`,
    type_line: 'Creature',
    oracle_text: '',
  }));
  g.importDeckResolved(p1, sampleDeck);
  g.importDeckResolved(p2, sampleDeck.map((card) => ({ ...card, id: `p2_${card.id}` })));
  g.applyEvent({ type: 'nextStep' });
  g.applyEvent({ type: 'nextStep' });
  g.applyEvent({ type: 'nextStep' });
}

describe("God-Pharaoh's Gift beginning-of-combat copy token", () => {
  let previousTriggerPrimary: string | undefined;

  beforeAll(async () => {
    await initDb();
    ensureLocalCardLookupIndexSync();
  });

  beforeEach(() => {
    previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  afterEach(() => {
    if (previousTriggerPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
    }
  });

  it('queues begin-combat trigger when a creature card is in graveyard', () => {
    const g = createInitialGameState('god_pharaohs_gift_begin_combat');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    setupToMain1(g, p1, p2);

    const activePlayer = g.state.turnPlayer as PlayerID;
    const gift = lookupLocalCardByNameSync("God-Pharaoh's Gift");
    expect(gift?.oracle_text).toBeTruthy();

    const grizzly = {
      id: 'gy_grizzly',
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      power: '2',
      toughness: '2',
      colors: ['G'],
      mana_cost: '{1}{G}',
    };

    (g.state as any).zones = {
      [activePlayer]: {
        hand: [],
        graveyard: [grizzly],
        handCount: 0,
        graveyardCount: 1,
      },
      [activePlayer === p1 ? p2 : p1]: {
        hand: [],
        graveyard: [],
        handCount: 0,
        graveyardCount: 0,
      },
    };

    (g.state.battlefield as any[]).push({
      id: 'gift_perm',
      controller: activePlayer,
      owner: activePlayer,
      tapped: false,
      card: {
        id: 'gift_card',
        name: "God-Pharaoh's Gift",
        type_line: 'Artifact',
        oracle_text: gift?.oracle_text,
      },
    });

    g.applyEvent({ type: 'nextStep' });

    const stack = (g.state as any).stack || [];
    expect(stack.some((item: any) => item.type === 'triggered_ability' && item.source === 'gift_perm')).toBe(true);

    const triggers = detectBeginningOfCombatTriggers(gift, { id: 'gift_perm', controller: activePlayer });
    expect(triggers[0]?.effect.toLowerCase()).toContain('exile a creature card from your graveyard');
  });

  it('creates a 4/4 black Zombie copy from Gift oracle via copy-token overrides', () => {
    const g = createInitialGameState('god_pharaohs_gift_copy_resolve');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const gift = lookupLocalCardByNameSync("God-Pharaoh's Gift");
    const effect =
      gift?.oracle_text?.match(/if you do,\s*(create a token.+)$/i)?.[1] ||
      "create a token that's a copy of that card, except it's a 4/4 black Zombie. It gains haste until end of turn.";
    const overrides = parseCopyTokenOverridesFromEffect(effect);

    const grizzly = {
      id: 'gy_grizzly_resolve',
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      power: '2',
      toughness: '2',
      colors: ['G'],
      mana_cost: '{1}{G}',
    };

    createCopyTokensOfCard(g as any, p1, grizzly, 1, true, overrides);

    const copy = ((g.state.battlefield as any[]) || []).find(
      (perm: any) => perm?.isCopyToken && perm?.card?.name === 'Grizzly Bears',
    );
    expect(copy).toBeDefined();
    expect(copy.basePower).toBe(4);
    expect(copy.baseToughness).toBe(4);
    expect(copy.card.colors).toEqual(['B']);
    expect(String(copy.card.type_line || '').toLowerCase()).toContain('zombie');
    expect(copy.summoningSickness).toBe(false);
  });
});
