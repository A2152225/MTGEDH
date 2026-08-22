import { describe, it, expect } from 'vitest';
import { getCommandZoneCommanderCandidates } from '../src/state/modules/can-respond.js';

describe('command zone candidates with undo BF/stack ghosts', () => {
  const playerId = 'p1';
  const commanderId = 'cmd_1';
  const commanderCard = {
    id: commanderId,
    name: "T'Challa, the Pride's Hope",
    type_line: 'Legendary Creature — Human Warrior',
    mana_cost: '{1}{G}{W}',
  };

  function makeCtx(overrides: any = {}) {
    return {
      state: {
        phase: 'main',
        step: 'MAIN1',
        stack: [],
        battlefield: [],
        commandZone: {
          [playerId]: {
            commanderIds: [commanderId],
            commanderCards: [{ ...commanderCard }],
            inCommandZone: [commanderId],
            tax: 0,
            taxById: { [commanderId]: 0 },
          },
        },
        zones: { [playerId]: { hand: [], manaPool: {} } },
        ...overrides,
      },
      libraries: new Map(),
    } as any;
  }

  it('allows CZ cast when commander id is inCommandZone even if same card id still on BF', () => {
    const ctx = makeCtx({
      battlefield: [
        {
          id: 'perm_ghost',
          controller: playerId,
          isCommander: true,
          card: { ...commanderCard },
        },
      ],
    });

    const candidates = getCommandZoneCommanderCandidates(ctx, playerId as any);
    expect(candidates.map((c) => c.commanderId)).toContain(commanderId);
  });

  it('does not treat trigger sourceCard on stack as blocking CZ cast', () => {
    const ctx = makeCtx({
      stack: [
        {
          type: 'ability',
          id: 'trig_1',
          sourceCard: { ...commanderCard },
          sourceName: commanderCard.name,
        },
      ],
    });

    const candidates = getCommandZoneCommanderCandidates(ctx, playerId as any);
    expect(candidates.map((c) => c.commanderId)).toContain(commanderId);
  });

  it('still allows CZ cast when a differently-id same-named non-commander permanent is on BF', () => {
    const ctx = makeCtx({
      battlefield: [
        {
          id: 'bast_1',
          controller: playerId,
          isCommander: false,
          card: { id: 'bast_card', name: 'Bast, Panther Goddess', type_line: 'Legendary Creature' },
        },
      ],
    });

    const candidates = getCommandZoneCommanderCandidates(ctx, playerId as any);
    expect(candidates.map((c) => c.commanderId)).toContain(commanderId);
  });
});
