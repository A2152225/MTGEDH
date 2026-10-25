// Batch 19: shared writer for state.damageReplacementLog (client toasts new entries, capped at 50).
// Used by combat-damage paths that apply replacement/prevention outside calculateModifiedDamage:
// resolveCombatDamageToOpponent (prevent-and-mill / +1 counters / draw riders) and
// applyCombatDamagePreventionEffects (prevention shields: Fog-style, CoP, finite shields).
// Public entry symbols: recordDamageReplacementMessages, DamageReplacementLogEntry.

export interface DamageReplacementLogEntry {
  messages: string[];
  original: number;
  amount: number;
  timestamp: number;
}

export function recordDamageReplacementMessages(
  state: object | null | undefined,
  messages: readonly unknown[] | null | undefined,
  original: number,
  amount: number,
): void {
  if (!state || !Array.isArray(messages)) return;
  const msgs = messages.map((m) => String(m ?? '').trim()).filter(Boolean);
  if (msgs.length === 0) return;
  const existing: unknown = Reflect.get(state, 'damageReplacementLog');
  const log: unknown[] = Array.isArray(existing) ? existing : [];
  if (log !== existing) Reflect.set(state, 'damageReplacementLog', log);
  log.push({ messages: msgs, original: Math.max(0, Number(original) || 0), amount: Math.max(0, Number(amount) || 0), timestamp: Date.now() });
  if (log.length > 50) log.splice(0, log.length - 50);
}