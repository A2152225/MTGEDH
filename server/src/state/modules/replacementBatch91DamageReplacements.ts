// server/src/state/modules/replacementBatch91DamageReplacements.ts
// B91: Battletide Alchemist (optional prevent X to a player, X = Clerics you
// control) and Gloom Surgeon (prevent combat damage to ~, exile that many
// cards from the top of your library).
// Public: parseBatch91DamageSentence, collectBatch91DamageReplacementSpecs,
// collectBatch91DamageReplacementSpecsFromState, applyBatch91DamageSideEffects,
// countControlledClerics.

import type { GameContext } from '../context.js';
import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const BATTLETIDE_RE =
  /^if a source would deal damage to a player, you may prevent x of that damage, where x is the number of clerics you control$/;
const GLOOM_RE =
  /^if combat damage would be dealt to (this creature|~), prevent that damage and exile that many cards from the top of your library$/;

export function countControlledClerics(state: any, playerId: string): number {
  const pid = String(playerId || '').trim();
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.filter((p) => {
    if (!p || p.phasedOut === true) return false;
    if (String(p.controller || '') !== pid) return false;
    return /\bcleric\b/i.test(String(p.card?.type_line || p.type_line || ''));
  }).length;
}

export function parseBatch91DamageSentence(sentence: string): Array<{ kind: 'battletide' | 'gloom' }> {
  const s = normalizeOraclePatternText(String(sentence || '')).toLowerCase().replace(/\u2019/g, "'").replace(/\.$/, '');
  const out: Array<{ kind: 'battletide' | 'gloom' }> = [];
  if (BATTLETIDE_RE.test(s)) out.push({ kind: 'battletide' });
  if (GLOOM_RE.test(s)) out.push({ kind: 'gloom' });
  return out;
}

export function collectBatch91DamageReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const specs: ReplacementEffectSpec[] = [];
  for (const raw of text.split(/\n+/)) {
    const s = raw.replace(/\([^)]*\)/g, '').trim().replace(/\.$/, '');
    if (BATTLETIDE_RE.test(s)) {
      specs.push({
        id: `${source.sourcePermanentId}:prevent-x-to-player-clerics`,
        event: 'damage-prevention-cost',
        sourcePermanentId: source.sourcePermanentId,
        sourceController: source.sourceController,
        sourceName: source.sourceName,
        match: { receivingIsPlayer: true },
        instead: {},
        effectId: 'prevent-x-damage-to-player-equal-to-clerics',
        reason: 'prevent_x_damage_to_player_equal_to_clerics',
        metadata: { preventCountBasis: 'controller_clerics', optional: true },
      } as ReplacementEffectSpec);
    }
    if (GLOOM_RE.test(s)) {
      specs.push({
        id: `${source.sourcePermanentId}:prevent-combat-exile-library-top`,
        event: 'damage-prevention-cost',
        sourcePermanentId: source.sourcePermanentId,
        sourceController: source.sourceController,
        sourceName: source.sourceName,
        match: { combatDamageOnly: true, receivingPermanentIsSource: true },
        instead: {},
        effectId: 'prevent-combat-damage-to-source-exile-library-top',
        reason: 'prevent_combat_damage_to_source_exile_library_top',
        metadata: { exileLibraryTopEqualToPrevented: true, combatOnly: true, onSource: true },
      } as ReplacementEffectSpec);
    }
  }
  return specs;
}

export function collectBatch91DamageReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string; oracle_text?: string; oracleText?: string } };
    if (rec.phasedOut === true || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch91DamageReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId,
      sourceController,
      sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

function exileTopOfLibrary(state: any, playerId: string, count: number): number {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n <= 0) return 0;
  state.zones = state.zones || {};
  state.zones[playerId] = state.zones[playerId] || {};
  const library: any[] = Array.isArray(state.zones[playerId].library) ? state.zones[playerId].library : [];
  const moved = library.splice(0, n);
  const exile: any[] = Array.isArray(state.zones[playerId].exile) ? state.zones[playerId].exile : [];
  for (const card of moved) exile.push({ ...(card?.card || card), zone: 'exile', owner: card?.owner || playerId });
  state.zones[playerId].library = library;
  state.zones[playerId].exile = exile;
  return moved.length;
}

export function applyBatch91DamageSideEffects(
  ctx: GameContext,
  damageAmount: number,
  damageDealer: string,
  damageReceiver: string,
  damageSourcePermanentId?: string,
  targetPermanentId?: string,
  isCombatDamage?: boolean,
): { amount: number; modifiers: string[] } | null {
  void damageDealer;
  void damageSourcePermanentId;
  if (!(Number(damageAmount) > 0)) return null;
  const state = (ctx as any)?.state || ctx;
  const specs = collectBatch91DamageReplacementSpecsFromState(state);
  if (!specs.length) return null;
  const amount = Math.max(0, Math.floor(Number(damageAmount) || 0));
  const targetId = String(targetPermanentId || '').trim();

  if (targetId && isCombatDamage === true) {
    for (const spec of specs) {
      const md = (spec.metadata || {}) as Record<string, unknown>;
      if (md.exileLibraryTopEqualToPrevented !== true) continue;
      if (String(spec.sourcePermanentId || '') !== targetId) continue;
      const pid = String(spec.sourceController || '').trim();
      const exiled = exileTopOfLibrary(state, pid, amount);
      return {
        amount: 0,
        modifiers: [`${spec.sourceName}: prevented ${amount} combat damage and exiled ${exiled} card(s)`],
      };
    }
  }

  if (!targetId && String(damageReceiver || '').trim()) {
    for (const spec of specs) {
      const md = (spec.metadata || {}) as Record<string, unknown>;
      if (md.preventCountBasis !== 'controller_clerics') continue;
      const controller = String(spec.sourceController || '').trim();
      if (!controller) continue;
      // Optional "you may": apply the prevention (the typical choice) when X > 0.
      const x = countControlledClerics(state, controller);
      if (!(x > 0)) continue;
      const prevented = Math.min(amount, x);
      return {
        amount: amount - prevented,
        modifiers: [`${spec.sourceName}: prevented ${prevented} of ${amount} damage to a player`],
      };
    }
  }
  return null;
}
