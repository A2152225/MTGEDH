import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { queueSelfETBTriggersForPermanent } from '../src/state/modules/triggerEtbEntryEffects.js';
import { detectETBTriggers } from '../src/state/modules/triggered-abilities.js';

const BOJUKA_ORACLE =
  "This land enters tapped.\nWhen this land enters, exile target player's graveyard.\n{T}: Add {B}.";
const BOJUKA_NAMED_ORACLE =
  "Bojuka Bog enters the battlefield tapped.\nWhen Bojuka Bog enters the battlefield, exile all cards from target player's graveyard.\n{T}: Add {B}.";

function findSelfEtb(card: { name: string; oracle_text: string }) {
  return detectETBTriggers(card, { id: 'bog_1' }).find((trigger) => trigger.triggerType === 'etb');
}

describe('Bojuka Bog ETB graveyard exile', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  beforeEach(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  afterEach(() => {
    if (previousPrimary === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    else process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
  });

  it('detects a mandatory player-target self-ETB from the current this-land template', () => {
    const trigger = findSelfEtb({
      name: 'Bojuka Bog',
      oracle_text: BOJUKA_ORACLE,
    });
    expect(trigger).toBeDefined();
    expect(trigger?.mandatory).toBe(true);
    expect(trigger?.requiresTarget).toBe(true);
    expect(trigger?.targetType).toBe('player');
    expect(String(trigger?.effect || '')).toMatch(/exile target player's graveyard/i);
  });

  it('detects the same targeting metadata from a synthetic name (no known-table match)', () => {
    const trigger = findSelfEtb({
      name: 'Synthetic Marsh Exile Probe',
      oracle_text: BOJUKA_ORACLE,
    });
    expect(trigger).toBeDefined();
    expect(trigger?.requiresTarget).toBe(true);
    expect(trigger?.targetType).toBe('player');
  });

  it('detects the same targeting metadata from the legacy named template', () => {
    const trigger = findSelfEtb({
      name: 'Bojuka Bog',
      oracle_text: BOJUKA_NAMED_ORACLE,
    });
    expect(trigger).toBeDefined();
    expect(trigger?.requiresTarget).toBe(true);
    expect(trigger?.targetType).toBe('player');
  });

  it('queues the ETB with needsTargetSelection so the controller is prompted for a player', () => {
    const game = createInitialGameState('bojuka_bog_etb_queue');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const bog = {
      id: 'bog_1',
      controller: p1,
      owner: p1,
      tapped: true,
      counters: {},
      card: {
        id: 'bog_card',
        name: 'Bojuka Bog',
        type_line: 'Land',
        oracle_text: BOJUKA_ORACLE,
      },
    };
    (game.state as any).battlefield = [bog];
    (game as any).gameId = 'bojuka_bog_etb_queue';

    queueSelfETBTriggersForPermanent(game as any, bog, p1);
    const stacked = ((game.state as any).stack || []).find(
      (entry: any) => entry?.sourceName === 'Bojuka Bog' && entry?.triggerType === 'etb',
    );
    expect(stacked).toBeTruthy();
    expect(stacked?.requiresTarget).toBe(true);
    expect(stacked?.targetType).toBe('player');
    expect(stacked?.needsTargetSelection).toBe(true);
  });

  it("parses 'exile target player's graveyard' as move_zone of all cards from that graveyard", () => {
    const ir = parseOracleTextToIR("Exile target player's graveyard.", 'Bojuka Bog');
    const steps = (ir.abilities || []).flatMap((ability: any) => ability?.steps || []);
    const move = steps.find((step: any) => step?.kind === 'move_zone');
    expect(move).toBeDefined();
    expect(String((move as any)?.to || '')).toBe('exile');
    expect(String((move as any)?.what?.text || '')).toMatch(/all cards from target player's graveyard/i);
  });

  it("exiles the targeted player's graveyard from the current effect text", () => {
    const gameId = 'bojuka_bog_etb_exile';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      [p2]: {
        hand: [],
        handCount: 0,
        graveyard: [{ id: 'dead-1', name: 'Dead Card', zone: 'graveyard' }],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game as any).gameId = gameId;

    executeTriggerEffect(
      game as any,
      p1,
      'Bojuka Bog',
      "exile target player's graveyard",
      {
        id: 'trigger-1',
        source: 'bog_1',
        targets: [p2],
      },
    );

    expect(((game.state as any).zones?.[p2]?.graveyard || []).length).toBe(0);
    expect(((game.state as any).zones?.[p2]?.exile || []).some((card: any) => card?.id === 'dead-1')).toBe(true);
  });
});
