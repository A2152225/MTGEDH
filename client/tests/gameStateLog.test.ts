import { describe, expect, it } from 'vitest';
import {
  buildGameStateLogEntries,
  dedupeGameLogEntries,
  mergeGameLogEntries,
} from '../src/utils/gameStateLog';
import {
  formatDeclareAttackersMessage,
  formatDeclareBlockersMessage,
  formatLifeChangeMessage,
} from '../../shared/src/gameLogFormat';

const name = (id: string) => (id === 'p1' ? 'Alice' : id === 'p2' ? 'Bob' : id);

describe('buildGameStateLogEntries', () => {
  it('logs life and battlefield changes in plain language', () => {
    const prev = {
      id: 'g1',
      life: { p1: 40, p2: 30 },
      battlefield: [],
      phase: 'main1',
      step: 'main',
      turnPlayer: 'p1',
      stack: [],
    };
    const next = {
      ...prev,
      life: { p1: 20, p2: 50 },
      battlefield: [{
        id: 'perm1',
        controller: 'p1',
        card: { name: 'Sol Ring', type_line: 'Artifact' },
      }],
    };

    const entries = buildGameStateLogEntries(prev, next, name);
    expect(entries.some((entry) => entry.message.includes('Alice loses 20 life (40 → 20)'))).toBe(true);
    expect(entries.some((entry) => entry.message.includes('Bob gains 20 life (30 → 50)'))).toBe(true);
    expect(entries.some((entry) => entry.message.includes('Sol Ring entered the battlefield (Alice)'))).toBe(true);
  });

  it('logs stack casts and resolves with targets', () => {
    const prev = {
      life: { p1: 40, p2: 40 },
      battlefield: [],
      stack: [],
      turnPlayer: 'p1',
    };
    const next = {
      ...prev,
      stack: [{
        id: 'stack_1',
        controller: 'p1',
        card: { name: 'Lightning Bolt' },
        targetDetails: [{ id: 'p2', type: 'player', name: 'Bob' }],
      }],
    };

    const withCast = buildGameStateLogEntries(prev, next, name);
    expect(withCast.some((entry) => entry.message === 'Alice casts Lightning Bolt targeting Bob')).toBe(true);

    const afterResolve = buildGameStateLogEntries(next, { ...next, stack: [] }, name);
    expect(afterResolve.some((entry) => entry.message === 'Lightning Bolt resolves')).toBe(true);
  });

  it('dedupes life changes already covered by system chat', () => {
    const merged = dedupeGameLogEntries([
      {
        id: 'chat_1',
        ts: 1000,
        kind: 'chat',
        message: 'Bob lost 4 life. (32 → 28)',
      },
      {
        id: 'state_1',
        ts: 1001,
        kind: 'state',
        message: formatLifeChangeMessage('Bob', 32, 28),
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe('chat');
  });

  it('mergeGameLogEntries keeps deduped history bounded', () => {
    const merged = mergeGameLogEntries([], [{
      id: 'state_1',
      ts: 1000,
      kind: 'state',
      message: 'Alice gains 1 energy counter (0 → 1)',
    }]);
    expect(merged).toHaveLength(1);
  });
});

describe('gameLogFormat combat messages', () => {
  it('formats attackers and blockers readably', () => {
    const attackMsg = formatDeclareAttackersMessage(
      'Alice',
      [
        { creatureId: 'a1', targetPlayerId: 'p2' },
        { creatureId: 'a2', targetPlayerId: 'p2' },
      ],
      (id) => (id === 'a1' ? 'Grizzly Bears' : 'Elf Warrior'),
      (playerId) => (playerId === 'p2' ? 'Bob' : 'unknown'),
    );
    expect(attackMsg).toBe('Alice attacks Bob with Grizzly Bears and Elf Warrior');

    const blockMsg = formatDeclareBlockersMessage(
      'Bob',
      [{ blockerId: 'b1', attackerId: 'a1' }],
      (id) => (id === 'b1' ? 'Spirit' : 'Grizzly Bears'),
    );
    expect(blockMsg).toBe('Bob: Spirit blocks Grizzly Bears');
  });
});
