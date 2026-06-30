import { beforeEach, describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import {
  resetCompiledOracleIROverlayTableForTests,
  upsertCompiledOracleIROverlaySync,
} from '../src/services/oracleIrCompiledOverlayStore.js';
import { resetLocalCardLookupForTests } from '../src/services/localCardLookup.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

const CARD_ID = '00000000-0000-4000-8000-000000000003';
const CARD_NAME = 'Overlay Rod';
const UNPARSED_EFFECT = 'Zorplexify the rodent engine.';
const ACTIVATED_ORACLE = `{1}, {T}: ${UNPARSED_EFFECT}`;

describe('oracle ir compiled overlay activated abilities', () => {
  beforeEach(() => {
    resetLocalCardLookupForTests();
    resetCompiledOracleIROverlayTableForTests();
    upsertCompiledOracleIROverlaySync({
      cardId: CARD_ID,
      name: CARD_NAME,
      envelope: {
        card_id: CARD_ID,
        abilities: [{
          ability_type: 'ACTIVATED',
          cost: '{1}, {T}',
          effect_text: 'Draw a card.',
          steps: [{
            kind: 'draw',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 1 },
            raw: 'Draw a card.',
          }],
        }],
      },
    });
  });

  it('parser alone leaves unknown for unparsed activated effect text', () => {
    const ir = parseOracleTextToIR(UNPARSED_EFFECT, CARD_NAME);
    const kinds = ir.abilities.flatMap((ability) => ability.steps.map((step) => step.kind));
    expect(kinds).toContain('unknown');
  });

  it('applies stored overlay through tryApplyOracleIRToActivatedAbility', () => {
    upsertCompiledOracleIROverlaySync({
      cardId: CARD_ID,
      name: CARD_NAME,
      envelope: {
        card_id: CARD_ID,
        abilities: [{
          ability_type: 'ACTIVATED',
          cost: '{1}, {T}',
          effect_text: 'Draw a card.',
          steps: [{
            kind: 'draw',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 1 },
            raw: 'Draw a card.',
          }],
        }],
      },
    });

    const gameId = 'overlay_activated_draw';
    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId, name: 'P1' } as any);

    const library = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Plains', zone: 'library' },
    ];
    const player = (game.state as any).players.find((entry: any) => entry.id === playerId);
    player.library = library.map((card) => ({ ...card }));
    player.hand = [];
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game as any).gameId = gameId;
    (game as any).libraries = new Map([[playerId, player.library.map((card: any) => ({ ...card }))]]);
    ResolutionQueueManager.removeQueue(gameId);

    const result = tryApplyOracleIRToActivatedAbility(game as any, {
      controller: playerId,
      sourceName: CARD_NAME,
      oracleText: ACTIVATED_ORACLE,
      sourcePermanentId: 'rod_1',
      stackItemId: 'rod_stack_1',
      cardId: CARD_ID,
      card: {
        name: CARD_NAME,
        oracle_id: CARD_ID,
        type_line: 'Artifact',
      },
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThan(0);
    expect(player.hand).toHaveLength(1);
  });
});
