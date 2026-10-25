// client/src/utils/stateEventToasts.ts
// Toasts for state-carried events that have no socket event of their own: die rolls (with advantage:
// every die, dropped ones marked), skipped extra turns and regeneration. Entries already in the
// first state seen for a game are seeded silently (no toast flood on join / reconnect).
// Public entry symbols: installStateEventToasts, describeDieRoll, collectStateEventToasts, createStateEventTracker.

import { toast } from '../components/ToastHost';
import { describeAmplifyRevealed } from './batch24ChoicePresentation';

type Named = { id?: string; name?: string };

function playerName(view: any, id: unknown): string {
  const p = (Array.isArray(view?.players) ? view.players : []).find((x: Named) => String(x?.id) === String(id));
  return p?.name || String(id || 'A player');
}

/** "Alice rolled 2d20: 17, 4 (dropped) \u2192 17". Dropped dice are matched by value, once each. */
export function describeDieRoll(roll: any, name: string): string {
  const sides = Number(roll?.sides) || 6;
  const rolls: number[] = Array.isArray(roll?.rolls) ? roll.rolls.map(Number) : [];
  if (rolls.length <= 1) return `${name} rolled a d${sides}: ${roll?.result}`;
  const drop = (Array.isArray(roll?.ignored) ? roll.ignored.map(Number) : []).slice();
  const parts = rolls.map((v) => {
    const i = drop.indexOf(v);
    if (i >= 0) { drop.splice(i, 1); return `${v} (dropped)`; }
    return String(v);
  });
  return `${name} rolled ${rolls.length}d${sides}: ${parts.join(', ')} \u2192 ${roll?.result}`;
}

export interface StateEventTracker { gameId: string; seeded: boolean; seen: Set<string> }

export function createStateEventTracker(): StateEventTracker {
  return { gameId: '', seeded: false, seen: new Set() };
}

/** Returns toast texts for new entries in this view; mutates the tracker. */
export function collectStateEventToasts(tr: StateEventTracker, view: any, gameId?: string): string[] {
  const gid = String(gameId || view?.id || '');
  if (gid && gid !== tr.gameId) { tr.gameId = gid; tr.seeded = false; tr.seen.clear(); }
  const out: string[] = [];
  const add = (key: string, text: () => string) => {
    if (tr.seen.has(key)) return;
    tr.seen.add(key);
    if (tr.seeded) out.push(text());
  };
  const roll = view?.lastDieRoll;
  if (roll && roll.timestamp) add(`die:${roll.timestamp}:${roll.playerId}`, () => describeDieRoll(roll, playerName(view, roll.playerId)));
  (Array.isArray(view?.skippedExtraTurns) ? view.skippedExtraTurns : []).forEach((e: any, i: number) => {
    add(`skip:${e?.timestamp ?? i}:${e?.playerId}:${i}`, () => `${playerName(view, e?.playerId)}'s extra turn was skipped${e?.sourceName ? ` (${e.sourceName})` : ''}.`);
  });
  (Array.isArray(view?.regenerationLog) ? view.regenerationLog : []).forEach((e: any, i: number) => {
    add(`regen:${e?.timestamp ?? i}:${e?.permanentId}:${i}`, () => `${e?.cardName || 'A permanent'} regenerated (tapped, removed from combat).`);
  });
  (Array.isArray(view?.batch18DrawReplacements) ? view.batch18DrawReplacements : []).forEach((e: any, i: number) => {
    // Player ids inside the effect text (Notion Thief: "<id> draws instead") are shown as names.
    const effect = (Array.isArray(view?.players) ? view.players : []).reduce((s: string, p: Named) =>
      (p?.id && p?.name ? s.split(String(p.id)).join(p.name) : s), String(e?.effect || '').trim());
    add(`drawrep:${e?.timestamp ?? i}:${e?.playerId}:${i}`, () => `${playerName(view, e?.playerId)}${e?.sourceName ? ` (${e.sourceName})` : ''}: ${effect || 'replaced a draw'}.`);
  });
  (Array.isArray(view?.damageReplacementLog) ? view.damageReplacementLog : []).forEach((e: any, i: number) => {
    const msgs = Array.isArray(e?.messages) ? e.messages.map(String).filter(Boolean) : [];
    if (msgs.length) add(`dmgrep:${e?.timestamp ?? i}:${i}`, () => `${msgs.every((m: string) => /\bprevent/i.test(m)) ? 'Damage prevented' : 'Damage replaced'} \u2014 ${msgs.map((m: string) => m.replace(/\s*\(prevent all combat damage dealt to it this turn\)/i, ' (prevention shield this turn)')).join('; ')}`);
  });
  (Array.isArray(view?.battlefield) ? view.battlefield : []).forEach((p: any) => {
    const text = describeAmplifyRevealed(p);
    if (text) add(`amp:${p?.id}:${(p.amplifyRevealed || []).join('|')}`, () => text);
  });
  tr.seeded = true;
  return out;
}

let installedOn: unknown = null;
export function installStateEventToasts(sock: { on: (ev: string, fn: (p: any) => void) => unknown }): void {
  if (installedOn === sock) return;
  installedOn = sock;
  const tr = createStateEventTracker();
  sock.on('state', (p: any) => {
    const wrapped = p && typeof p === 'object' && 'view' in p;
    const view = wrapped ? p.view : p;
    for (const t of collectStateEventToasts(tr, view, wrapped ? p.gameId : undefined)) toast.info(t);
  });
}
