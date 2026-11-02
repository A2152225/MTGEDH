// server/src/state/modules/damageEventSources.ts
// R34: one generic seam for "a source permanent dealt damage to a permanent". It marks the source with the
// persistent has-dealt-damage flag (damageDealtFlag.ts, owned by the control worker; called, not edited) and
// records the source on the recipient, so damage-received watchers can check what dealt the damage
// ("dealt damage by an attacking creature", Glyph of Life) instead of guessing from combat state.
// Records are consumed by the watcher pass for that damage event.
// Public entry symbols: recordPermanentDamageEvent, takeRecordedDamageSources, RecordedDamageSource.

import { markPermanentDealtDamage } from './damageDealtFlag.js';

export interface RecordedDamageSource {
  readonly sourceId: string;
  readonly sourceIsCreature: boolean;
  readonly sourceWasAttacking: boolean;
  readonly sourceWasBlocking: boolean;
  readonly turnNumber: number;
}

const isCreature = (perm: any): boolean => /\bcreature\b/i.test(String(perm?.card?.type_line || perm?.type_line || ''));
const isAttacking = (perm: any): boolean => Boolean(perm?.attacking || perm?.isAttacking === true);
const isBlocking = (perm: any): boolean => (Array.isArray(perm?.blocking) ? perm.blocking.length > 0 : Boolean(perm?.blocking));

export function recordPermanentDamageEvent(ctx: any, sourcePermanent: any, recipientPermanent: any): void {
  markPermanentDealtDamage(ctx, sourcePermanent);
  try {
    const state = ctx?.state;
    const recipientId = String(recipientPermanent?.id || '').trim();
    if (!state || !recipientId || !sourcePermanent || typeof sourcePermanent !== 'object') return;
    const turnNumber = Number(state.turnNumber || 0);
    const book = (state.damageSourcesByRecipient ||= {}) as Record<string, RecordedDamageSource[]>;
    const prior = (book[recipientId] || []).filter((entry) => entry.turnNumber === turnNumber);
    book[recipientId] = [...prior, {
      sourceId: String(sourcePermanent.id || ''),
      sourceIsCreature: isCreature(sourcePermanent),
      sourceWasAttacking: isAttacking(sourcePermanent),
      sourceWasBlocking: isBlocking(sourcePermanent),
      turnNumber,
    }];
  } catch {
    // best-effort only
  }
}

/** Returns and clears the sources recorded for this recipient this turn; null when none were recorded. */
export function takeRecordedDamageSources(state: any, recipientId: string): RecordedDamageSource[] | null {
  const book = state?.damageSourcesByRecipient as Record<string, RecordedDamageSource[]> | undefined;
  const id = String(recipientId || '').trim();
  if (!book || !id || !book[id]) return null;
  const turnNumber = Number(state.turnNumber || 0);
  const entries = book[id].filter((entry) => entry.turnNumber === turnNumber);
  delete book[id];
  return entries.length > 0 ? entries : null;
}
