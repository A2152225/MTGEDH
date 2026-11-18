import { describe, expect, it } from 'vitest';
import {
  applyCombatDamageToBattle,
} from '../src/state/modules/turn-handlers/turnCombatDamagePermanentApply.js';
import {
  applyBattleDefenseCountersOnEntry,
} from '../src/state/modules/battleSiegeEntry.js';
import {
  buildSiegeTransformedExileCard,
  isBattleDefeated,
  processBattleDefeatSBAs,
  readBattleDefense,
} from '../src/state/modules/battleSiegeDefeat.js';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const invasion = {
  id: 'invasion_card_1',
  name: 'Invasion of Zendikar // Awakened Skyclave',
  layout: 'transform',
  type_line: 'Battle — Siege // Creature — Elemental',
  oracle_text: 'When this Siege enters, search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.',
  card_faces: [
    {
      name: 'Invasion of Zendikar',
      mana_cost: '{3}{G}',
      type_line: 'Battle — Siege',
      oracle_text:
        "(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it's defeated, exile it, then cast it transformed.)\nWhen this Siege enters, search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.",
      defense: '3',
    },
    {
      name: 'Awakened Skyclave',
      mana_cost: '',
      type_line: 'Creature — Elemental',
      oracle_text: 'Vigilance, haste\nAs long as this creature is on the battlefield, it\'s a land in addition to its other types.',
      power: '4',
      toughness: '4',
    },
  ],
};

describe('battle combat damage and siege defeat', () => {
  it('removes defense counters from combat damage', () => {
    const permanent: any = {
      id: 'b1',
      controller: 'p1',
      card: { ...invasion },
      counters: {},
    };
    applyBattleDefenseCountersOnEntry(permanent, invasion);
    expect(readBattleDefense(permanent)).toBe(3);

    const ctx: any = { state: { battlefield: [permanent] } };
    const result = applyCombatDamageToBattle(
      ctx,
      permanent,
      2,
      { name: 'Bear' },
      { id: 'attacker_1', controller: 'p2' },
    );
    expect(result.prevented).toBe(false);
    expect(result.appliedAmount).toBe(2);
    expect(result.remainingDefense).toBe(1);
    expect(permanent.counters.defense).toBe(1);
    expect(isBattleDefeated(permanent)).toBe(false);
  });

  it('marks a battle defeated at 0 defense', () => {
    const permanent: any = {
      id: 'b1',
      controller: 'p1',
      card: { ...invasion },
      counters: { defense: 2 },
      defense: 2,
    };
    const ctx: any = { state: { battlefield: [permanent] } };
    applyCombatDamageToBattle(ctx, permanent, 5, { name: 'Giant' }, { id: 'a1' });
    expect(readBattleDefense(permanent)).toBe(0);
    expect(isBattleDefeated(permanent)).toBe(true);
  });

  it('builds a transformed exile card for siege defeat casts', () => {
    const stamped = buildSiegeTransformedExileCard(invasion, { id: invasion.id, zone: 'exile' });
    expect(stamped.castAsTransformed).toBe(true);
    expect(stamped.faceIndex).toBe(1);
    expect(stamped.name).toBe('Awakened Skyclave');
    expect(stamped.type_line).toMatch(/Creature/i);
    expect(stamped.castWithoutPayingManaCost).toBe(true);
  });

  it('exiles a defeated Siege and queues a mandatory cast-transformed prompt', () => {
    const gameId = 'siege_defeat_prompt';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game as any).gameId = gameId;

    const permanent: any = {
      id: 'battle_1',
      controller: p1,
      owner: p1,
      card: { ...invasion },
      counters: { defense: 0 },
      defense: 0,
      protector: p2,
    };
    (game.state as any).battlefield = [permanent];
    (game.state as any).zones = {
      [p1]: { hand: [], library: [], graveyard: [], exile: [] },
      [p2]: { hand: [], library: [], graveyard: [], exile: [] },
    };

    const ctx: any = { state: game.state, gameId, bumpSeq: () => {}, commandZone: {} };
    expect(processBattleDefeatSBAs(ctx)).toBe(true);
    expect((game.state as any).battlefield.some((p: any) => p.id === 'battle_1')).toBe(false);

    const exile = (game.state as any).zones[p1].exile;
    expect(exile.some((c: any) => c.id === invasion.id && c.castAsTransformed === true)).toBe(true);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = [...(queue?.steps || []), queue?.activeStep].find(
      (entry: any) => entry && entry.castFromExileAsTransformed === true,
    );
    expect(step).toBeTruthy();
    expect(step.mandatory).toBe(true);
    expect(step.castFromExileCastWithoutPayingManaCost).toBe(true);
  });
});
