import { describe, expect, it } from 'vitest';
import {
  buildGameStateLogEntries,
  dedupeGameLogEntries,
  mergeGameLogEntries,
} from '../src/utils/gameStateLog';
import {
  combatDamageLifeKey,
  formatDeclareAttackersMessage,
  formatDeclareBlockersMessage,
  formatCombatDamageMessages,
  formatCombatDeathMessage,
  formatCommanderDamageMessage,
  formatDiscardMessage,
  formatDrawMessage,
  formatExileFromZoneMessage,
  formatGameOverVictoryMessage,
  formatLifeChangeMessage,
  formatMillMessage,
  formatPermanentLeftMessage,
  formatPlayerEliminatedMessage,
  formatTokenCreatedMessage,
  spellDamageLifeKey,
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

  it('dedupes life changes already covered by combat damage chat', () => {
    const merged = dedupeGameLogEntries([
      {
        id: 'chat_1',
        ts: 1000,
        kind: 'chat',
        message: 'Bob takes 4 combat damage (32 → 28)',
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
    expect(combatDamageLifeKey('Bob takes 4 combat damage (32 → 28)')).toBe('bob|4');
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

  it('logs draw and discard from zone count changes', () => {
    const base = {
      id: 'g1',
      life: { p1: 40 },
      battlefield: [],
      stack: [],
      turnPlayer: 'p1',
    };
    const prev = {
      ...base,
      zones: {
        p1: { handCount: 6, libraryCount: 93, graveyard: [] },
      },
    };
    const nextDraw = {
      ...base,
      zones: {
        p1: { handCount: 7, libraryCount: 92, graveyard: [] },
      },
    };
    const drawEntries = buildGameStateLogEntries(prev, nextDraw, name);
    expect(drawEntries.some((entry) => entry.message === 'Alice draws 1 card')).toBe(true);

    const nextDiscard = {
      ...base,
      zones: {
        p1: {
          handCount: 5,
          libraryCount: 92,
          graveyard: [{ id: 'c1', name: 'Forest' }, { id: 'c2', name: 'Island' }],
        },
      },
    };
    const discardEntries = buildGameStateLogEntries(nextDraw, nextDiscard, name);
    expect(discardEntries.some((entry) => entry.message === 'Alice discards Forest and Island')).toBe(true);
  });

  it('logs mill from library to graveyard without hand change', () => {
    const base = {
      id: 'g1',
      life: { p2: 40 },
      battlefield: [],
      stack: [],
      turnPlayer: 'p2',
    };
    const prev = {
      ...base,
      zones: {
        p2: { handCount: 7, libraryCount: 50, graveyard: [] },
      },
    };
    const next = {
      ...base,
      zones: {
        p2: {
          handCount: 7,
          libraryCount: 48,
          graveyard: [{ id: 'c1', name: 'Forest' }, { id: 'c2', name: 'Island' }],
        },
      },
    };
    const entries = buildGameStateLogEntries(prev, next, name);
    expect(entries.some((entry) => entry.message === 'Bob mills 2 cards: Forest and Island')).toBe(true);
  });

  it('dedupes life changes covered by spell damage chat', () => {
    const merged = dedupeGameLogEntries([
      {
        id: 'chat_1',
        ts: 1000,
        kind: 'chat',
        message: 'Lightning Bolt deals 3 damage to Bob (40 → 37).',
      },
      {
        id: 'state_1',
        ts: 1001,
        kind: 'state',
        message: formatLifeChangeMessage('Bob', 40, 37),
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe('chat');
    expect(spellDamageLifeKey('Lightning Bolt deals 3 damage to Bob (40 → 37).')).toBe('bob|3');
  });

  it('dedupes mill lines already covered by system chat', () => {
    const merged = dedupeGameLogEntries([
      {
        id: 'chat_1',
        ts: 1000,
        kind: 'chat',
        message: 'Bob milled 2 cards: Forest, Island.',
      },
      {
        id: 'state_1',
        ts: 1001,
        kind: 'state',
        message: formatMillMessage('Bob', 2, ['Forest', 'Island']),
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe('chat');
  });

  it('dedupes battlefield leave lines covered by combat death chat', () => {
    const merged = dedupeGameLogEntries([
      {
        id: 'chat_1',
        ts: 1000,
        kind: 'chat',
        message: 'Grizzly Bears dies in combat',
      },
      {
        id: 'state_1',
        ts: 1001,
        kind: 'state',
        message: formatPermanentLeftMessage('Grizzly Bears', 'graveyard'),
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe('chat');
  });

  it('logs commander damage and permanent zone destinations', () => {
    const prev = {
      id: 'g1',
      life: { p1: 40, p2: 40 },
      battlefield: [{ id: 'perm1', controller: 'p1', card: { name: 'Sol Ring', type_line: 'Artifact' } }],
      stack: [],
      zones: { p2: { graveyard: [], handCount: 7, libraryCount: 90 } },
      commanderDamage: { p2: { cmd_atraxa: 4 } },
      commandZone: {
        p1: {
          commanderIds: ['cmd_atraxa'],
          commanderNames: ["Atraxa, Praetors' Voice"],
        },
      },
    };
    const next = {
      ...prev,
      battlefield: [],
      zones: {
        p2: {
          graveyard: [],
          handCount: 7,
          libraryCount: 90,
        },
        p1: {
          graveyard: [{ id: 'perm1', name: 'Sol Ring' }],
          handCount: 6,
          libraryCount: 94,
        },
      },
      commanderDamage: { p2: { cmd_atraxa: 8 } },
    };

    const entries = buildGameStateLogEntries(prev, next, name);
    expect(entries.some((entry) => entry.message === 'Sol Ring was destroyed')).toBe(true);
    expect(entries.some((entry) => entry.message.includes('Bob takes 4 commander damage from Alice\'s Atraxa, Praetors\' Voice (4 → 8/21)'))).toBe(true);
  });

  it('dedupes destroyed lines covered by effect chat', () => {
    const merged = dedupeGameLogEntries([
      {
        id: 'chat_1',
        ts: 1000,
        kind: 'chat',
        message: 'Lightning Bolt: Sol Ring was destroyed.',
      },
      {
        id: 'state_1',
        ts: 1001,
        kind: 'state',
        message: formatPermanentLeftMessage('Sol Ring', 'graveyard'),
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe('chat');
  });

  it('logs player elimination, game over, and exile from hand', () => {
    const prev = {
      id: 'g1',
      life: { p1: 40, p2: 0 },
      battlefield: [],
      stack: [],
      players: [
        { id: 'p1', name: 'Alice', inactive: false },
        { id: 'p2', name: 'Bob', inactive: false },
      ],
      zones: {
        p2: { handCount: 1, libraryCount: 90, hand: [{ id: 'c1', name: 'Mind Stone' }], exile: [] },
      },
      gameOver: false,
    };
    const next = {
      ...prev,
      players: [
        { id: 'p1', name: 'Alice', inactive: false },
        { id: 'p2', name: 'Bob', inactive: true },
      ],
      zones: {
        p2: {
          handCount: 0,
          libraryCount: 90,
          hand: [],
          exile: [{ id: 'c1', name: 'Mind Stone' }],
        },
      },
      gameOver: true,
      winner: 'p1',
    };

    const entries = buildGameStateLogEntries(prev, next, name);
    expect(entries.some((entry) => entry.message === 'Bob has been eliminated')).toBe(true);
    expect(entries.some((entry) => entry.message === 'Alice wins!')).toBe(true);
    expect(entries.some((entry) => entry.message === 'Mind Stone was exiled from Bob\'s hand')).toBe(true);
  });

  it('dedupes elimination and victory lines covered by system chat', () => {
    const merged = dedupeGameLogEntries([
      {
        id: 'chat_1',
        ts: 1000,
        kind: 'chat',
        message: formatPlayerEliminatedMessage('Bob', 'Life total is 0 or less'),
      },
      {
        id: 'chat_2',
        ts: 1001,
        kind: 'chat',
        message: formatGameOverVictoryMessage('Alice'),
      },
      {
        id: 'state_1',
        ts: 1002,
        kind: 'state',
        message: formatPlayerEliminatedMessage('Bob'),
      },
      {
        id: 'state_2',
        ts: 1003,
        kind: 'state',
        message: formatGameOverVictoryMessage('Alice'),
      },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.every((entry) => entry.kind === 'chat')).toBe(true);
  });

  it('logs token creation in batches and dedupes destroyed lines for sacrifices', () => {
    const prev = {
      id: 'g1',
      life: { p1: 40, p2: 40 },
      battlefield: [{ id: 'perm1', controller: 'p1', card: { name: 'Ashnod\'s Altar', type_line: 'Artifact' } }],
      stack: [],
      zones: { p1: { graveyard: [], handCount: 5, libraryCount: 90 } },
    };
    const next = {
      ...prev,
      battlefield: [
        { id: 't1', controller: 'p1', isToken: true, card: { name: 'Soldier', type_line: 'Token Creature — Soldier' } },
        { id: 't2', controller: 'p1', isToken: true, card: { name: 'Soldier', type_line: 'Token Creature — Soldier' } },
      ],
      zones: {
        p1: {
          graveyard: [{ id: 'perm1', name: 'Ashnod\'s Altar' }],
          handCount: 5,
          libraryCount: 90,
        },
      },
    };

    const tokenEntries = buildGameStateLogEntries(prev, {
      ...prev,
      battlefield: next.battlefield,
    }, name);
    expect(tokenEntries.some((entry) => entry.message === 'Alice creates 2 Soldier tokens')).toBe(true);

    const sacrificeEntries = buildGameStateLogEntries(prev, next, name);
    expect(sacrificeEntries.some((entry) => entry.message === 'Ashnod\'s Altar was destroyed')).toBe(true);

    const merged = dedupeGameLogEntries([
      {
        id: 'chat_1',
        ts: 1000,
        kind: 'chat',
        message: 'Alice sacrifices Ashnod\'s Altar (Ashnod\'s Altar).',
      },
      {
        id: 'state_1',
        ts: 1001,
        kind: 'state',
        message: formatPermanentLeftMessage('Ashnod\'s Altar', 'graveyard'),
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe('chat');
  });

  it('logs bounce to hand distinctly from destroy', () => {
    const prev = {
      id: 'g1',
      life: { p1: 40 },
      battlefield: [{ id: 'perm1', controller: 'p2', card: { name: 'Man-o\'-War', type_line: 'Creature' } }],
      stack: [],
      zones: { p2: { hand: [], handCount: 4, libraryCount: 90, graveyard: [] } },
    };
    const next = {
      ...prev,
      battlefield: [],
      zones: {
        p2: {
          hand: [{ id: 'perm1', name: 'Man-o\'-War' }],
          handCount: 5,
          libraryCount: 90,
          graveyard: [],
        },
      },
    };

    const entries = buildGameStateLogEntries(prev, next, name);
    expect(entries.some((entry) => entry.message === 'Man-o\'-War returned to Bob\'s hand')).toBe(true);
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

  it('formats combat damage with attacker breakdown', () => {
    const messages = formatCombatDamageMessages(
      { p2: 7 },
      (id) => (id === 'p2' ? 'Bob' : id),
      { p2: 40 },
      {
        attackerDamageToPlayers: { p2: { a1: 3, a2: 4 } },
        resolveAttackerName: (id) => (id === 'a1' ? 'Grizzly Bears' : 'Elf Warrior'),
      },
    );
    expect(messages[0]).toBe('Bob takes 7 combat damage (47 → 40) from Grizzly Bears (3), Elf Warrior (4)');
  });

  it('formats draw, discard, mill, and combat death messages', () => {
    expect(formatDrawMessage('Alice', 1)).toBe('Alice draws 1 card');
    expect(formatDrawMessage('Alice', 3)).toBe('Alice draws 3 cards');
    expect(formatDiscardMessage('Bob', ['Forest', 'Island'])).toBe('Bob discards Forest and Island');
    expect(formatMillMessage('Bob', 2, ['Forest', 'Island'])).toBe('Bob mills 2 cards: Forest and Island');
    expect(formatPermanentLeftMessage('Sol Ring', 'graveyard')).toBe('Sol Ring was destroyed');
    expect(formatPermanentLeftMessage('Teferi', 'exile')).toBe('Teferi was exiled');
    expect(formatCommanderDamageMessage('Bob', "Atraxa, Praetors' Voice", 'Alice', 4, 8))
      .toBe('Bob takes 4 commander damage from Alice\'s Atraxa, Praetors\' Voice (4 → 8/21)');
    expect(formatPlayerEliminatedMessage('Bob', 'Life total is 0 or less'))
      .toBe('Bob has been eliminated (Life total is 0 or less)');
    expect(formatExileFromZoneMessage('Mind Stone', 'hand', 'Bob')).toBe('Mind Stone was exiled from Bob\'s hand');
    expect(formatGameOverVictoryMessage('Alice')).toBe('Alice wins!');
    expect(formatTokenCreatedMessage('Alice', 1, 'Soldier')).toBe('Alice creates a Soldier token');
    expect(formatTokenCreatedMessage('Alice', 3, 'Soldier')).toBe('Alice creates 3 Soldier tokens');
    expect(formatCombatDeathMessage('Spirit', { firstStrike: true })).toBe('First strike: Spirit dies in combat');
  });
});

describe('stack item log wording', () => {
  const base = { life: { p1: 40, p2: 40 }, battlefield: [], stack: [] as any[], turnPlayer: 'p1' };

  it('names the source of a triggered ability instead of logging "casts Permanent"', () => {
    const next = {
      ...base,
      stack: [{
        id: 'trig_1',
        type: 'triggered_ability',
        controller: 'p1',
        source: 'jace',
        sourceName: 'Jace, Multiverse Architect',
        description: "they may pay {2}. If they don't, ...",
      }],
    };
    const added = buildGameStateLogEntries(base, next, name).map((entry) => entry.message);
    expect(added).toContain('Jace, Multiverse Architect triggers (Alice)');
    expect(added.some((message) => /Permanent/.test(message) || /casts/.test(message))).toBe(false);

    const resolved = buildGameStateLogEntries(next, { ...next, stack: [] }, name).map((entry) => entry.message);
    expect(resolved).toContain('Jace, Multiverse Architect ability resolves');
  });

  it('logs activated abilities as activations of the real source', () => {
    const next = {
      ...base,
      stack: [{
        id: 'act_1',
        type: 'ability',
        controller: 'p2',
        source: 'perm_1',
        sourceName: 'Evolving Wilds',
        card: { id: 'perm_1', name: 'Evolving Wilds (ability)' },
        targetDetails: [{ id: 'p1', type: 'player', name: 'Alice' }],
      }],
    };
    const added = buildGameStateLogEntries(base, next, name).map((entry) => entry.message);
    expect(added).toContain('Bob activates Evolving Wilds targeting Alice');
  });

  it('names a graveyard card targeted by an activated ability', () => {
    const next = {
      ...base,
      stack: [{
        id: 'act_gy',
        type: 'ability',
        controller: 'p2',
        source: 'paleo',
        sourceName: 'Intrepid Paleontologist',
        card: { id: 'paleo', name: 'Intrepid Paleontologist (ability)' },
        targetDetails: [{
          id: 'terrain',
          type: 'card',
          name: 'Treacherous Terrain',
          controllerId: 'p1',
          zone: 'graveyard',
        }],
      }],
    };
    const added = buildGameStateLogEntries(base, next, name).map((entry) => entry.message);
    expect(added).toContain("Bob activates Intrepid Paleontologist targeting Treacherous Terrain in Alice's graveyard");
  });

  it('uses the front-face name for an unnamed multi-face spell card', () => {
    const next = {
      ...base,
      stack: [{
        id: 'spell_1',
        type: 'spell',
        controller: 'p1',
        card: { card_faces: [{ name: 'Fable of the Mirror-Breaker' }, { name: 'Reflection of Kiki-Jiki' }] },
      }],
    };
    const added = buildGameStateLogEntries(base, next, name).map((entry) => entry.message);
    expect(added).toContain('Alice casts Fable of the Mirror-Breaker');
  });
});
