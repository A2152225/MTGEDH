import { describe, it, expect } from 'vitest';
import { installStateDeltaClient } from './stateDeltaClient';
import { diffStateViews } from '../../../shared/src/stateDelta';

/** Minimal socket.io-client-like emitter: onAny runs first, then per-event listeners. */
function fakeSocket() {
  const any: Array<(ev: string, ...a: any[]) => void> = [];
  const map = new Map<string, Array<(...a: any[]) => void>>();
  const sent: any[] = [];
  return {
    sent,
    onAny: (fn: any) => { any.push(fn); },
    on: (ev: string, fn: any) => { map.set(ev, [...(map.get(ev) || []), fn]); },
    off: (ev: string) => { map.delete(ev); },
    emit: (ev: string, p: any) => { sent.push([ev, p]); },
    listeners: (ev: string) => map.get(ev) || [],
    receive(ev: string, p: any) {
      const wire = JSON.parse(JSON.stringify(p));
      for (const fn of any) fn(ev, wire);
      for (const fn of map.get(ev) || []) fn(wire);
    },
  };
}

describe('installStateDeltaClient', () => {
  it('turns deltas into ordinary full "state" payloads for existing listeners', () => {
    const s = fakeSocket();
    installStateDeltaClient(s);
    s.off('state'); // useGameSocket cleanup must not break delta tracking
    const got: any[] = [];
    s.on('state', (p: any) => got.push(p));
    const v1 = { id: 'g1', battlefield: [{ id: 'a', tapped: false }], life: { p1: 40 } };
    const v2 = { id: 'g1', battlefield: [{ id: 'a', tapped: true }, { id: 'b', tapped: false }], life: { p1: 38 } };
    s.receive('state', { gameId: 'g1', view: v1, seq: 1, viewVersion: 1 });
    s.receive('stateDelta', { gameId: 'g1', baseVersion: 1, newVersion: 2, seq: 2, ops: diffStateViews(v1, v2) });
    expect(got).toHaveLength(2);
    expect(got[1]).toEqual({ gameId: 'g1', view: v2, seq: 2, viewVersion: 2 });
    expect(s.sent).toEqual([]);
  });

  it('requests state on a gap or after an unversioned full state', () => {
    const s = fakeSocket();
    installStateDeltaClient(s);
    const got: any[] = [];
    s.on('state', (p: any) => got.push(p));
    s.receive('state', { gameId: 'g1', view: { id: 'g1' } });
    s.receive('stateDelta', { gameId: 'g1', baseVersion: 4, newVersion: 5, ops: [] });
    expect(s.sent).toEqual([['requestState', { gameId: 'g1' }]]);
    expect(got).toHaveLength(1);
  });
});