import { describe, expect, it } from 'vitest';
import { runSBA } from '../src/state/modules/counters_tokens.js';
import { queueBecomesUnattachedTriggers, becomesUnattachedEffect } from '../src/state/modules/triggerBecomesUnattached.js';

// Scryfall oracle: Grafted Exoskeleton (NPH).
const EXO = 'Equipped creature gets +2/+2 and has infect. (It deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)\nWhenever Grafted Exoskeleton becomes unattached from a permanent, sacrifice that permanent.\nEquip {2}';

const creature = (id: string, name: string) => ({ id, controller: 'p1', owner: 'p1', card: { id: `${id}_c`, name, type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' } });
const exo = (attachedTo?: string) => ({ id: 'exo', controller: 'p1', owner: 'p1', attachedTo, card: { id: 'exo_c', name: 'Grafted Exoskeleton', type_line: 'Artifact - Equipment', oracle_text: EXO } });

function makeCtx(battlefield: any[], isReplaying = false) {
  return {
    gameId: 'unknown',
    isReplaying,
    state: {
      battlefield, stack: [], players: [{ id: 'p1', life: 40 }], life: { p1: 40 },
      zones: { p1: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0 } },
      commandZone: {}, emblems: [], conspiracies: [], manaPool: {},
    },
    bumpSeq: () => {},
  } as any;
}

const unattachedTriggers = (ctx: any) => ctx.state.stack.filter((s: any) => /sacrifice that permanent/i.test(String(s.description || s.effect || '')));

describe('becomes-unattached triggers (Grafted Exoskeleton)', () => {
  it('parses the named self-reference', () => {
    expect(becomesUnattachedEffect(exo().card)).toBe('sacrifice that permanent');
    expect(becomesUnattachedEffect({ name: 'X', oracle_text: 'Equip {1}' })).toBeNull();
  });

  it('does not fire on first sight or while attached', () => {
    const ctx = makeCtx([creature('a', 'Bear A'), exo('a')]);
    runSBA(ctx);
    runSBA(ctx);
    expect(unattachedTriggers(ctx)).toHaveLength(0);
  });

  it('fires for the old host when re-equipped to another creature', () => {
    const ctx = makeCtx([creature('a', 'Bear A'), creature('b', 'Bear B'), exo('a')]);
    runSBA(ctx);
    ctx.state.battlefield.find((p: any) => p.id === 'exo').attachedTo = 'b';
    expect(queueBecomesUnattachedTriggers(ctx)).toBe(1);
    const [item] = unattachedTriggers(ctx);
    expect(item.permanentId || item.source).toBe('exo');
    expect(JSON.stringify(item)).toContain('"a"');
    expect(queueBecomesUnattachedTriggers(ctx)).toBe(0);
  });

  it('fires when unattached, when the host leaves, and when the equipment leaves', () => {
    const unattach = makeCtx([creature('a', 'Bear A'), exo('a')]);
    queueBecomesUnattachedTriggers(unattach);
    delete unattach.state.battlefield[1].attachedTo;
    expect(queueBecomesUnattachedTriggers(unattach)).toBe(1);

    const hostLeaves = makeCtx([creature('a', 'Bear A'), exo('a')]);
    queueBecomesUnattachedTriggers(hostLeaves);
    hostLeaves.state.battlefield.splice(0, 1);
    expect(queueBecomesUnattachedTriggers(hostLeaves)).toBe(1);

    const equipLeaves = makeCtx([creature('a', 'Bear A'), exo('a')]);
    queueBecomesUnattachedTriggers(equipLeaves);
    equipLeaves.state.battlefield.splice(1, 1);
    expect(queueBecomesUnattachedTriggers(equipLeaves)).toBe(1);
    expect(JSON.stringify(unattachedTriggers(equipLeaves)[0])).toContain('"a"');
  });

  it('tracks but does not queue during replay', () => {
    const ctx = makeCtx([creature('a', 'Bear A'), creature('b', 'Bear B'), exo('a')], true);
    queueBecomesUnattachedTriggers(ctx);
    ctx.state.battlefield[2].attachedTo = 'b';
    expect(queueBecomesUnattachedTriggers(ctx)).toBe(0);
    ctx.isReplaying = false;
    expect(queueBecomesUnattachedTriggers(ctx)).toBe(0);
    expect(ctx.state._attachmentHostWatch.exo.hostId).toBe('b');
  });
});
import { createInitialGameState } from '../src/state/gameState.js';

describe('becomes-unattached resolution', () => {
  it('re-equipping Grafted Exoskeleton sacrifices the former host only', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1'; // production default
    const game: any = createInitialGameState('unknown' as any);
    const s = game.state;
    s.players = [{ id: 'p1', name: 'P1', life: 40 }];
    s.life = { p1: 40 };
    s.zones = { p1: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 } };
    s.turnPlayer = 'p1'; s.priority = 'p1'; s.phase = 'main1'; s.step = 'MAIN1';
    s.battlefield = [creature('a', 'Bear A'), creature('b', 'Bear B'), exo('a')];
    runSBA(game);
    s.battlefield.find((p: any) => p.id === 'exo').attachedTo = 'b';
    runSBA(game);
    expect(unattachedTriggers(game)).toHaveLength(1);
    game.applyEvent({ type: 'resolveTopOfStack' } as any);
    const ids = s.battlefield.map((p: any) => p.id).sort();
    expect(ids).toEqual(['b', 'exo']);
    expect(s.zones.p1.graveyard.map((c: any) => c.name)).toContain('Bear A');
  });
});
