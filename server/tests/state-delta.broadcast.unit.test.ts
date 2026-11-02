import { describe, it, expect, afterEach } from 'vitest';
import { diffStateViews, applyStateDelta } from '../../shared/src/stateDelta';
import {
  emitVersionedState,
  setStateDeltaEnabledOverride,
  resetStateDeltaForSocket,
  STATE_DELTA_MAX_RATIO,
} from '../src/socket/util-handlers/stateDeltaEmit';
import { createStateDeltaClient } from '../../client/src/utils/stateDeltaClient';

const json = (v: unknown) => JSON.parse(JSON.stringify(v));

function makeView(opts: { tokens: number; hand: string[]; life?: number; tapped?: Set<number>; extra?: Record<string, unknown> }) {
  const battlefield = Array.from({ length: opts.tokens }, (_, i) => ({
    id: `tok_${i}`,
    controller: 'p1',
    tapped: !!opts.tapped?.has(i),
    counters: i % 7 === 0 ? { '+1/+1': 1 } : undefined,
    card: { name: 'Sunborn Doubler', type_line: 'Token Creature', oracle_text: 'If one or more tokens would be created...' },
  }));
  return { id: 'g1', life: { p1: opts.life ?? 40, p2: 40 }, battlefield, zones: { p1: { hand: opts.hand.map((n, i) => ({ id: `h${i}`, name: n })), handCount: opts.hand.length } }, ...(opts.extra || {}) };
}

/** Wire one fake server socket to one client-side delta reconstructor. */
function makePair(playerId: string) {
  const serverSock: any = { id: `s_${playerId}`, handshake: { auth: { stateDelta: 1 } }, data: { playerId } };
  const received: any[] = [];
  const clientEmits: any[] = [];
  const stateListeners = [(p: any) => received.push(p)];
  const client = createStateDeltaClient({
    onAny: () => undefined,
    on: () => undefined,
    emit: (ev: string, p: any) => { clientEmits.push([ev, p]); },
    listeners: (ev: string) => (ev === 'state' ? stateListeners : []),
  });
  const wire: any[] = [];
  serverSock.emit = (ev: string, payload: any) => {
    const onWire = json(payload); // socket.io JSON round trip
    wire.push([ev, onWire, JSON.stringify(payload).length]);
    client.handleIncoming(ev, onWire);
    if (ev === 'state') for (const fn of stateListeners) fn(onWire);
  };
  return { serverSock, received, clientEmits, client, wire };
}

function makeIo(...socks: any[]) {
  const map = new Map(socks.map(s => [s.id, s]));
  return { sockets: { sockets: map, adapter: { rooms: new Map() } }, to: (id: string) => ({ emit: (ev: string, p: any) => map.get(id)?.emit(ev, p) }) } as any;
}

afterEach(() => setStateDeltaEnabledOverride(null));

describe('stateDelta diff/apply', () => {
  it('round-trips adds, removals, reorders, nested edits and key deletes', () => {
    const a = json(makeView({ tokens: 50, hand: ['Sol Ring', 'Island'], extra: { stack: [1, 2, 3], prompt: { x: 1 } } }));
    const bView = makeView({ tokens: 60, hand: ['Island'], life: 37, tapped: new Set([3, 9]), extra: { stack: [1] } });
    bView.battlefield.splice(5, 2);
    bView.battlefield.reverse();
    const b = json(bView);
    const ops = diffStateViews(a, b);
    expect(applyStateDelta(json(a), ops)).toEqual(b);
    expect(diffStateViews(b, json(b))).toEqual([]);
  });

  it('keys battlefield by id so one new token is a small patch', () => {
    const a = json(makeView({ tokens: 1000, hand: [] }));
    const b = json(makeView({ tokens: 1001, hand: [] }));
    const ops = diffStateViews(a, b);
    expect(JSON.stringify(ops).length).toBeLessThan(JSON.stringify(b).length * 0.1);
    expect(applyStateDelta(json(a), ops)).toEqual(b);
  });

  it('throws on a base that does not match the patch', () => {
    const ops = diffStateViews(json(makeView({ tokens: 3, hand: [] })), json(makeView({ tokens: 3, hand: [], tapped: new Set([1]) })));
    expect(() => applyStateDelta({ id: 'g1' }, ops)).toThrow();
  });
});

describe('emitVersionedState + client reconstruction', () => {
  it('first send is full, later sends are deltas, and every client view equals the full view', () => {
    const p = makePair('p1');
    const io = makeIo(p.serverSock);
    const views = [
      makeView({ tokens: 1000, hand: ['A', 'B'] }),
      makeView({ tokens: 1001, hand: ['A', 'B'] }),
      makeView({ tokens: 1001, hand: ['B'], tapped: new Set([0, 500]) }),
      makeView({ tokens: 1001, hand: ['B'], tapped: new Set([0, 500]) }),
    ];
    const kinds = views.map((view, i) => emitVersionedState(io, p.serverSock.id, { gameId: 'g1', view, seq: i + 1 }).kind);
    expect(kinds).toEqual(['full', 'delta', 'delta', 'delta']);
    expect(p.received).toHaveLength(4);
    p.received.forEach((payload, i) => {
      expect(payload.view).toEqual(json(views[i]));
      expect(payload.seq).toBe(i + 1);
    });
    expect(p.wire[1][2]).toBeLessThan(p.wire[0][2] * 0.1);
    // Fresh objects each time, like a full broadcast.
    expect(p.received[3].view).not.toBe(p.received[2].view);
    expect(p.received[3].view.battlefield[0]).not.toBe(p.received[2].view.battlefield[0]);
  });

  it('asks for a resync on a version gap and recovers with full state', () => {
    const p = makePair('p1');
    const io = makeIo(p.serverSock);
    emitVersionedState(io, p.serverSock.id, { gameId: 'g1', view: makeView({ tokens: 10, hand: [] }) });
    const realEmit = p.serverSock.emit;
    p.serverSock.emit = () => undefined; // lost packet
    emitVersionedState(io, p.serverSock.id, { gameId: 'g1', view: makeView({ tokens: 11, hand: [] }) });
    p.serverSock.emit = realEmit;
    emitVersionedState(io, p.serverSock.id, { gameId: 'g1', view: makeView({ tokens: 12, hand: [] }) });
    expect(p.received).toHaveLength(1);
    expect(p.clientEmits).toEqual([['requestState', { gameId: 'g1' }]]);
    expect(p.client.version()).toBeNull();
    resetStateDeltaForSocket(p.serverSock); // server requestState handler
    const last = makeView({ tokens: 13, hand: ['X'] });
    expect(emitVersionedState(io, p.serverSock.id, { gameId: 'g1', view: last }).kind).toBe('full');
    expect(p.received.at(-1).view).toEqual(json(last));
  });

  it('resyncs when a patch does not apply to the client base', () => {
    const p = makePair('p1');
    const io = makeIo(p.serverSock);
    emitVersionedState(io, p.serverSock.id, { gameId: 'g1', view: makeView({ tokens: 10, hand: [] }) });
    p.client.handleIncoming('stateDelta', { gameId: 'g1', baseVersion: 1, newVersion: 2, ops: [['r', ['nope', 'deeper']]] });
    expect(p.clientEmits[0][0]).toBe('requestState');
    expect(p.received).toHaveLength(1);
  });

  it('a reconnecting socket gets full state, never a delta against another socket', () => {
    const a = makePair('p1');
    const io = makeIo(a.serverSock);
    emitVersionedState(io, a.serverSock.id, { gameId: 'g1', view: makeView({ tokens: 10, hand: [] }) });
    const b = makePair('p1');
    b.serverSock.id = 's_p1_reconnected';
    io.sockets.sockets.set(b.serverSock.id, b.serverSock);
    const view = makeView({ tokens: 11, hand: [] });
    expect(emitVersionedState(io, b.serverSock.id, { gameId: 'g1', view }).kind).toBe('full');
    expect(b.received[0].view).toEqual(json(view));
  });

  it('keeps hidden information per viewer', () => {
    const p1 = makePair('p1');
    const p2 = makePair('p2');
    const io = makeIo(p1.serverSock, p2.serverSock);
    const viewFor = (who: string, hand1: string[], hand2: string[]) => ({
      id: 'g1',
      log: Array.from({ length: 40 }, (_, i) => ({ id: 'l' + i, text: 'public log line ' + i })),
      battlefield: [{ id: 'x', controller: 'p1', tapped: hand1.length > 1 }],
      zones: {
        p1: { handCount: hand1.length, hand: who === 'p1' ? hand1.map(n => ({ id: n, name: n })) : [] },
        p2: { handCount: hand2.length, hand: who === 'p2' ? hand2.map(n => ({ id: n, name: n })) : [] },
      },
    });
    for (const [h1, h2] of [[['Sol Ring'], ['Secret Tutor']], [['Sol Ring', 'Island'], ['Secret Tutor', 'Hidden Bomb']]]) {
      emitVersionedState(io, p1.serverSock.id, { gameId: 'g1', view: viewFor('p1', h1, h2) });
      emitVersionedState(io, p2.serverSock.id, { gameId: 'g1', view: viewFor('p2', h1, h2) });
    }
    expect(p1.wire[1][0]).toBe('stateDelta');
    const p1Wire = JSON.stringify(p1.wire);
    expect(p1Wire).not.toContain('Secret Tutor');
    expect(p1Wire).not.toContain('Hidden Bomb');
    expect(JSON.stringify(p2.wire)).not.toContain('Sol Ring');
    expect(p1.received.at(-1).view).toEqual(viewFor('p1', ['Sol Ring', 'Island'], ['Secret Tutor', 'Hidden Bomb']));
    expect(p2.received.at(-1).view).toEqual(viewFor('p2', ['Sol Ring', 'Island'], ['Secret Tutor', 'Hidden Bomb']));
  });

  it('falls back to full state when the patch is too large, and when the flag is off', () => {
    const p = makePair('p1');
    const io = makeIo(p.serverSock);
    emitVersionedState(io, p.serverSock.id, { gameId: 'g1', view: { id: 'g1', a: 'x'.repeat(100) } });
    expect(STATE_DELTA_MAX_RATIO).toBe(0.5);
    expect(emitVersionedState(io, p.serverSock.id, { gameId: 'g1', view: { id: 'g1', a: 'y'.repeat(100) } }).kind).toBe('full');
    expect(p.received.at(-1).view.a).toBe('y'.repeat(100));
    setStateDeltaEnabledOverride(false);
    expect(emitVersionedState(io, p.serverSock.id, { gameId: 'g1', view: { id: 'g1', a: 'z' } }).kind).toBe('plain');
    expect(p.wire.at(-1)[1].viewVersion).toBeUndefined();
    expect(p.client.version()).toBeNull();
  });

  it('sends plain state to clients that did not opt in', () => {
    const p = makePair('p1');
    delete p.serverSock.handshake.auth.stateDelta;
    const io = makeIo(p.serverSock);
    for (let i = 0; i < 2; i++) expect(emitVersionedState(io, p.serverSock.id, { gameId: 'g1', view: makeView({ tokens: 3 + i, hand: [] }) }).kind).toBe('plain');
    expect(p.wire.every(w => w[0] === 'state')).toBe(true);
  });
});