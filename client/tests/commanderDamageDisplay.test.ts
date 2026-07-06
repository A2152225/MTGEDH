import { describe, expect, it } from 'vitest';

import {
  buildCommanderDamageRows,
  collectCommanderDeckEntries,
  commanderDamageRowColor,
  groupCommanderDamageRowsByOwner,
  isCommanderFormat,
} from '../src/utils/commanderDamageDisplay';

describe('commander damage display', () => {
  it('detects commander format case-insensitively', () => {
    expect(isCommanderFormat('commander')).toBe(true);
    expect(isCommanderFormat('Commander')).toBe(true);
    expect(isCommanderFormat('standard')).toBe(false);
  });

  it('returns null outside commander format', () => {
    expect(
      buildCommanderDamageRows(
        'p2',
        [{ id: 'p1', name: 'P1', seat: 0 }],
        { p2: { cmd1: 5 } },
        { p1: { commanderIds: ['cmd1'], commanderNames: ['Atraxa'] } },
        'standard',
      ),
    ).toBeNull();
  });

  it('lists every commander in the pod with zero damage included', () => {
    const rows = buildCommanderDamageRows(
      'p2',
      [
        { id: 'p1', name: 'Alice', seat: 0 },
        { id: 'p2', name: 'Bob', seat: 1 },
      ],
      { p2: { cmd_alice: 7 } },
      {
        p1: {
          commanderIds: ['cmd_alice'],
          commanderNames: ['Atraxa'],
          commanderCards: [{ id: 'cmd_alice', name: 'Atraxa, Praetors\' Voice' }],
        },
        p2: {
          commanderIds: ['cmd_bob'],
          commanderNames: ['Korvold'],
          commanderCards: [{ id: 'cmd_bob', name: 'Korvold, Fae-Cursed King' }],
        },
      },
      'commander',
    );

    expect(rows).toHaveLength(2);
    expect(rows?.[0]).toMatchObject({
      ownerName: 'Alice',
      commanderName: 'Atraxa, Praetors\' Voice',
      damage: 7,
      commanderIndex: 0,
    });
    expect(rows?.[1]).toMatchObject({
      ownerName: 'Bob',
      commanderName: 'Korvold, Fae-Cursed King',
      damage: 0,
      commanderIndex: 0,
    });
  });

  it('lists partner commanders separately with independent damage totals', () => {
    const rows = buildCommanderDamageRows(
      'p3',
      [{ id: 'p1', name: 'Alice', seat: 0 }],
      {
        p3: {
          cmd_tana: 14,
          cmd_thrasios: 21,
        },
      },
      {
        p1: {
          commanderIds: ['cmd_tana', 'cmd_thrasios'],
          commanderNames: ['Tana, the Bloodsower', 'Thrasios, Triton Hero'],
          commanderCards: [
            { id: 'cmd_tana', name: 'Tana, the Bloodsower' },
            { id: 'cmd_thrasios', name: 'Thrasios, Triton Hero' },
          ],
        },
      },
      'commander',
    );

    expect(rows).toHaveLength(2);
    expect(rows?.[0]).toMatchObject({
      commanderId: 'cmd_tana',
      commanderName: 'Tana, the Bloodsower',
      damage: 14,
      commanderIndex: 0,
    });
    expect(rows?.[1]).toMatchObject({
      commanderId: 'cmd_thrasios',
      commanderName: 'Thrasios, Triton Hero',
      damage: 21,
      commanderIndex: 1,
    });
  });

  it('collects partner and background command zone entries from ids and cards', () => {
    const entries = collectCommanderDeckEntries({
      commanderIds: ['cmd_legend', 'cmd_background'],
      commanderNames: ['Wilhelt, the Rotcleaver', 'Haunted One'],
      commanderCards: [
        { id: 'cmd_legend', name: 'Wilhelt, the Rotcleaver' },
        { id: 'cmd_background', name: 'Haunted One' },
      ],
    });

    expect(entries).toEqual([
      {
        commanderId: 'cmd_legend',
        commanderName: 'Wilhelt, the Rotcleaver',
        commanderIndex: 0,
      },
      {
        commanderId: 'cmd_background',
        commanderName: 'Haunted One',
        commanderIndex: 1,
      },
    ]);
  });

  it('groups rows by owner and preserves commander order within a partner pair', () => {
    const rows = buildCommanderDamageRows(
      'p3',
      [{ id: 'p1', name: 'Alice', seat: 0 }],
      { p3: { cmd_tana: 3, cmd_thrasios: 8 } },
      {
        p1: {
          commanderIds: ['cmd_tana', 'cmd_thrasios'],
          commanderNames: ['Tana, the Bloodsower', 'Thrasios, Triton Hero'],
        },
      },
      'commander',
    )!;

    const groups = groupCommanderDamageRowsByOwner(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].ownerName).toBe('Alice');
    expect(groups[0].commanders.map((row) => row.commanderName)).toEqual([
      'Tana, the Bloodsower',
      'Thrasios, Triton Hero',
    ]);
    expect(groups[0].commanders.map((row) => row.damage)).toEqual([3, 8]);
  });

  it('retains unknown commander damage entries not present in command zones', () => {
    const rows = buildCommanderDamageRows(
      'p2',
      [{ id: 'p1', name: 'Alice', seat: 0 }],
      { p2: { ghost_cmd: 12 } },
      { p1: { commanderIds: ['cmd_alice'], commanderNames: ['Atraxa'] } },
      'commander',
    );

    expect(rows).toHaveLength(2);
    expect(rows?.find((row) => row.commanderId === 'ghost_cmd')).toMatchObject({
      commanderName: 'Unknown commander',
      ownerName: 'Unknown',
      damage: 12,
    });
  });

  it('colors rows by damage threshold', () => {
    expect(commanderDamageRowColor(0)).toContain('209');
    expect(commanderDamageRowColor(7)).toBe('#fbbf24');
    expect(commanderDamageRowColor(21)).toBe('#ef4444');
  });
});
