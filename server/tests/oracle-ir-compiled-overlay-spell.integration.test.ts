import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  isOracleIrSpellPrimaryEnabled,
  tryResolveSpellViaOracleIR,
} from '../src/state/modules/oracleIrSpellExecution.js';
import { tryResolveInstantSorceryOracleIrSpell } from '../src/state/modules/stackResolveSpellOracleIrUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import {
  resetCompiledOracleIROverlayTableForTests,
  upsertCompiledOracleIROverlaySync,
} from '../src/services/oracleIrCompiledOverlayStore.js';
import { resetLocalCardLookupForTests } from '../src/services/localCardLookup.js';

const OVERLAY_CARD_ID = '00000000-0000-4000-8000-000000000002';
const OVERLAY_CARD_NAME = 'Overlay Novel Spell';
const UNPARSED_ORACLE_TEXT = 'Zorplexify the gibberwump.';

describe('oracle ir compiled overlay spell resolution', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  beforeEach(() => {
    resetLocalCardLookupForTests();
    resetCompiledOracleIROverlayTableForTests();
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    upsertCompiledOracleIROverlaySync({
      cardId: OVERLAY_CARD_ID,
      name: OVERLAY_CARD_NAME,
      envelope: {
        card_id: OVERLAY_CARD_ID,
        abilities: [{
          ability_type: 'SPELL_EFFECT',
          effect_text: 'Draw two cards.',
          steps: [{
            kind: 'draw',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 2 },
            raw: 'Draw two cards.',
          }],
        }],
      },
    });
  });

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  function seedSpellGame(gameId: string, playerId: PlayerID) {
    const game = createInitialGameState(gameId);
    game.applyEvent!({ type: 'join', playerId, name: 'P1' } as any);

    const library = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Mountain', zone: 'library' },
      { id: 'lib-3', name: 'Forest', zone: 'library' },
    ];
    const player = (game.state as any).players.find((entry: any) => entry.id === playerId);
    player.library = library.map((card) => ({ ...card }));
    player.hand = [];

    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[playerId, player.library.map((card: any) => ({ ...card }))]]);
    ResolutionQueueManager.removeQueue(gameId);
    return { game, ctx, player, playerId };
  }

  it('resolves unparsed spell text via stored overlay in primary mode', () => {
    const { ctx, player, playerId } = seedSpellGame('overlay_spell_direct', 'p1' as PlayerID);

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: playerId,
      spellName: OVERLAY_CARD_NAME,
      oracleText: UNPARSED_ORACLE_TEXT,
      sourceId: 'overlay-spell-stack-1',
      cardId: OVERLAY_CARD_ID,
      effectiveCard: {
        name: OVERLAY_CARD_NAME,
        oracle_id: OVERLAY_CARD_ID,
        oracle_text: UNPARSED_ORACLE_TEXT,
      },
      card: {
        name: OVERLAY_CARD_NAME,
        oracle_id: OVERLAY_CARD_ID,
      },
      sourceItem: {
        id: 'overlay-spell-stack-1',
        card: {
          name: OVERLAY_CARD_NAME,
          oracle_id: OVERLAY_CARD_ID,
        },
      },
    });

    expect(isOracleIrSpellPrimaryEnabled()).toBe(true);
    expect(outcome.handled).toBe(true);
    expect(player.hand).toHaveLength(2);
  });

  it('resolves through stack instant/sorcery oracle IR entrypoint', () => {
    const { ctx, player, playerId } = seedSpellGame('overlay_spell_stack', 'p1' as PlayerID);
    const effectiveCard = {
      name: OVERLAY_CARD_NAME,
      oracle_id: OVERLAY_CARD_ID,
      oracle_text: UNPARSED_ORACLE_TEXT,
    };
    const card = { ...effectiveCard };
    const item = {
      id: 'overlay-spell-stack-2',
      card,
    };

    const outcome = tryResolveInstantSorceryOracleIrSpell(ctx, {
      controller: playerId,
      card,
      effectiveCard,
      item,
      oracleText: UNPARSED_ORACLE_TEXT,
      targets: [],
      selectedModes: [],
      skipLegacySpellCategorization: false,
    });

    expect(outcome.oracleIrSpellHandled).toBe(true);
    expect(player.hand).toHaveLength(2);
  });
});
