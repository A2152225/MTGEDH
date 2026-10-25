// rules-engine/src/controlEffectRegistry.ts
// Timestamped layer-2 control effects (CR 613.1b / 613.7). A permanent's controller is DERIVED, not edited:
//   controller = the controller of the latest-timestamp active control effect on it, else its control base
//   (the controller it had before its first control effect, normally the owner).
// Control effect sources:
//   - state.controlChangeEffects: temporary steals (Threaten / Act of Treason, duration 'eot'); kept in that
//     array because cleanup, replay and several rules-engine paths already read it.
//   - state.permanentControlEffects: indefinite steals resolved by spells/abilities ("gain control of target ...").
//   - Control Auras attached to the permanent (Control Magic), timestamp = attachment timestamp (CR 613.7e).
// Entries carry `ceTimestamp`; entries written by older paths without one are stamped lazily in array order.
// Layer-6 ability grant/loss stamps live in rules-engine abilityEffectTimestamps.ts and are synced from here.
// Direct controller writes: a permanent under an active control effect remembers the controller the registry
// derived for it (`derivedController`, at counter value `derivedTs`). A later direct `controller` write by a path
// that did not register an effect is recorded as a new indefinite effect stamped at the next sync, so it wins over
// older effects instead of being overwritten.
// Server re-exports everything from server/src/state/modules/continuousEffectRegistry.ts.
// Public entry symbols: oracleGrantsAuraControl, registerControlEffect, syncControlFromRegistry,
//   removeControlEffects, ControlEffectEntry, ControlChange.

import { allocateTimestamp, readAttachmentTimestamp, readPermanentTimestamp, TIMESTAMP_BASE } from './permanentTimestamps';

const CONTROL_AURA_RE = /\byou control enchanted (?:creature|permanent|artifact|land|planeswalker)\b/i;

export function oracleGrantsAuraControl(oracle: string): boolean {
  return CONTROL_AURA_RE.test(String(oracle || '').replace(/\([^)]*\)/g, ' '));
}

export interface ControlEffectEntry {
  permanentId: string;
  originalController: string;
  newController: string;
  duration: string;
  appliedAt?: number;
  ceTimestamp?: number;
  sourceId?: string;
}

export interface ControlChange { permanent: any; previousController: string; }

const TEMPORARY = new Set(['eot', 'turn', 'until_end_of_turn', 'this_turn']);

function list(state: any, field: 'controlChangeEffects' | 'permanentControlEffects'): any[] {
  return Array.isArray(state?.[field]) ? state[field] : [];
}

function validTs(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > TIMESTAMP_BASE ? n : undefined;
}

/** Adds a new control effect with a fresh timestamp. Does not change the controller; call syncControlFromRegistry. */
export function registerControlEffect(
  state: any,
  effect: Omit<ControlEffectEntry, 'ceTimestamp'>,
  opts?: { ceTimestamp?: number },
): ControlEffectEntry {
  const duration = String(effect.duration || 'eot').trim().toLowerCase();
  const field = TEMPORARY.has(duration) ? 'controlChangeEffects' : 'permanentControlEffects';
  if (!Array.isArray(state[field])) state[field] = [];
  const entry: ControlEffectEntry = { appliedAt: Date.now(), ...effect, duration, ceTimestamp: validTs(opts?.ceTimestamp) ?? allocateTimestamp(state) };
  state[field].push(entry);
  const perm = (Array.isArray(state.battlefield) ? state.battlefield : [])
    .find((p: any) => p && String(p.id || '') === String(effect.permanentId));
  if (perm && !perm.controlBase && effect.originalController) perm.controlBase = String(effect.originalController);
  return entry;
}

/** Removes control effects matching `predicate` from both stores. Returns how many were removed. */
export function removeControlEffects(state: any, predicate: (entry: any) => boolean): number {
  let removed = 0;
  for (const field of ['controlChangeEffects', 'permanentControlEffects'] as const) {
    const entries = list(state, field);
    if (entries.length === 0) continue;
    const kept = entries.filter((entry) => !predicate(entry));
    // An ending effect still tells us the controller from before it; keep it as the base to derive back to.
    for (const entry of entries) {
      if (kept.includes(entry)) continue;
      const perm = (Array.isArray(state.battlefield) ? state.battlefield : [])
        .find((p: any) => p && String(p.id || '') === String(entry?.permanentId || ''));
      const original = String(entry?.originalController || '').trim();
      if (perm && !perm.controlBase && original) perm.controlBase = original;
    }
    removed += entries.length - kept.length;
    if (kept.length > 0) state[field] = kept; else delete state[field];
  }
  return removed;
}

/** One timestamp shared by every half of an exchange (CR 701.12: both controller changes are one effect). */
export function registerExchangeControlEffects(
  state: any,
  halves: Array<Omit<ControlEffectEntry, 'ceTimestamp'>>,
): ControlEffectEntry[] {
  const ceTimestamp = allocateTimestamp(state);
  return halves.map((half) => registerControlEffect(state, half, { ceTimestamp }));
}

/** Registers an indefinite effect for each controller write made outside the registry since the last sync. */
function recordDirectControllerWrites(state: any, battlefield: any[]): void {
  for (const perm of battlefield) {
    const derived = String(perm?.derivedController || '').trim();
    const current = String(perm?.controller || '').trim();
    if (!derived || !current || derived === current) continue;
    const id = String(perm.id || '');
    const since = Number(perm.derivedTs) || 0;
    // A writer that also registered (or pushed) an entry for this new controller is not a direct write.
    const explained = [...list(state, 'controlChangeEffects'), ...list(state, 'permanentControlEffects')].some((entry) =>
      entry && String(entry.permanentId || '') === id && String(entry.newController || '').trim() === current
      && (validTs(entry.ceTimestamp) === undefined || entry.ceTimestamp > since));
    if (explained) continue;
    registerControlEffect(state, { permanentId: id, originalController: derived, newController: current, duration: 'permanent', sourceId: 'direct_controller_write' });
  }
}

/**
 * Recomputes every permanent's controller from the registry (latest timestamp wins). Prunes effects whose
 * permanent left the battlefield. Returns the permanents whose controller changed.
 */
export function syncControlFromRegistry(state: any): ControlChange[] {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  if (battlefield.length === 0) return [];
  const byId = new Map<string, any>(battlefield.filter(Boolean).map((perm) => [String(perm.id || ''), perm]));
  if (list(state, 'permanentControlEffects').length > 0) {
    removeControlEffects(state, (entry) => entry?.duration !== undefined && !TEMPORARY.has(String(entry.duration))
      && !byId.has(String(entry?.permanentId || '')));
  }
  // Indefinite entries are only ever written alongside a controlBase. A permanent with no base is a new object
  // reusing an id (state rebuilt or replaced wholesale), so those entries no longer describe it.
  if (list(state, 'permanentControlEffects').length > 0) {
    removeControlEffects(state, (entry) => entry?.duration !== undefined && !TEMPORARY.has(String(entry.duration))
      && !byId.get(String(entry?.permanentId || ''))?.controlBase);
  }
  recordDirectControllerWrites(state, battlefield);
  const candidates = new Map<string, Array<{ controller: string; ts: number; base?: string }>>();
  const add = (id: string, controller: string, ts: number, base?: string) => {
    if (!id || !controller || !byId.has(id)) return;
    const arr = candidates.get(id) ?? [];
    arr.push({ controller, ts, base });
    candidates.set(id, arr);
  };
  for (const field of ['controlChangeEffects', 'permanentControlEffects'] as const) {
    for (const entry of list(state, field)) {
      if (!entry || typeof entry !== 'object') continue;
      if (validTs(entry.ceTimestamp) === undefined) entry.ceTimestamp = allocateTimestamp(state);
      add(String(entry.permanentId || '').trim(), String(entry.newController || '').trim(), entry.ceTimestamp,
        String(entry.originalController || '').trim() || undefined);
    }
  }
  for (const aura of battlefield) {
    const hostId = String(aura?.attachedTo || '').trim();
    if (!hostId || !aura?.controller || aura.phasedOut) continue;
    if (!oracleGrantsAuraControl(String(aura?.card?.oracle_text || ''))) continue;
    add(hostId, String(aura.controller), readAttachmentTimestamp(aura) ?? readPermanentTimestamp(aura) ?? TIMESTAMP_BASE);
  }

  const changes: ControlChange[] = [];
  for (const perm of battlefield) {
    if (!perm) continue;
    if ('auraControl' in perm) delete perm.auraControl; // legacy revert mark: control is derived now
    const id = String(perm.id || '');
    const effects = candidates.get(id);
    const before = String(perm.controller || '');
    let target: string | undefined;
    if (effects && effects.length > 0) {
      if (!perm.controlBase) {
        const earliest = effects.filter((e) => e.base).sort((a, b) => a.ts - b.ts)[0];
        perm.controlBase = earliest?.base || before || String(perm.owner || '');
      }
      target = effects.reduce((best, e) => (e.ts > best.ts ? e : best)).controller;
    } else if (perm.controlBase) {
      target = String(perm.controlBase);
      delete perm.controlBase;
    }
    if (effects && effects.length > 0) {
      perm.derivedController = target || before;
      perm.derivedTs = Number(state.timestampCounter) || 0;
    } else if ('derivedController' in perm) {
      delete perm.derivedController;
      delete perm.derivedTs;
    }
    if (target && target !== before) {
      perm.controller = target;
      // CR 302.6: a creature must be continuously controlled since the turn began to attack / {T}.
      perm.summoningSickness = true;
      changes.push({ permanent: perm, previousController: before });
    }
  }
  return changes;
}
