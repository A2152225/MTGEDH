// Batch 18: noncombat damage prevention replacements (CR 615).
//  - "If noncombat damage would be dealt to you, prevent that damage[. You gain life equal to the damage
//    prevented this way]" (Purity)
//  - "If noncombat damage would be dealt to ~, prevent that damage[. Put a +1/+1 counter on ~ for each
//    1 damage prevented this way]" (Stormwild Capridor)
// Called from applyDamageSideEffectReplacements with the isCombatDamage flag; noncombat = isCombatDamage !== true.
// Public entry symbols: collectBatch18NoncombatPreventionRules, applyBatch18NoncombatPrevention.

import { readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { selfReferenceSentences } from './replacementEffectSpec-handlers/replacementEffectSpecDamagePreventionOracleTemplates.js';

interface B18Card { name?: string; oracle_text?: string }
interface B18Permanent { id?: string; controller?: string; phasedOut?: boolean; card?: B18Card; counters?: Record<string, number> }
interface B18Player { id?: string; life?: number }
export interface B18DamageState { battlefield?: B18Permanent[]; players?: B18Player[]; life?: Record<string, number> }

export interface Batch18NoncombatRule {
  sourcePermanentId: string;
  sourceName: string;
  controller: string;
  recipient: 'you' | 'self';
  followUp: 'none' | 'gain-life' | 'plus-one-counters';
}

const SELF = '(?:~|this creature|this enchantment|this artifact)';
const MAIN = new RegExp(`^if noncombat damage would be dealt to (you|${SELF}), prevent that damage$`);
const GAIN = /^you gain life equal to the damage prevented this way$/;
const COUNTERS = new RegExp(`^put a \\+1/\\+1 counter on (?:it|${SELF}) for each 1 damage prevented this way$`);

export function collectBatch18NoncombatPreventionRules(state: B18DamageState | undefined): Batch18NoncombatRule[] {
  const out: Batch18NoncombatRule[] = [];
  for (const perm of Array.isArray(state?.battlefield) ? state!.battlefield : []) {
    if (!perm?.card || perm.phasedOut === true) continue;
    const id = String(perm.id || '').trim();
    const oracle = readCardOracleText(perm.card);
    if (!id || !oracle || !/noncombat damage would be dealt/i.test(oracle)) continue;
    const sourceName = String(perm.card.name || 'Unknown').trim();
    const sentences = selfReferenceSentences(oracle, sourceName);
    sentences.forEach((s, i) => {
      const m = s.match(MAIN);
      if (!m) return;
      const next = sentences[i + 1] || '';
      const recipient = m[1] === 'you' ? 'you' : 'self';
      const followUp = recipient === 'you' && GAIN.test(next) ? 'gain-life'
        : recipient === 'self' && COUNTERS.test(next) ? 'plus-one-counters' : 'none';
      out.push({ sourcePermanentId: id, sourceName, controller: String(perm.controller || '').trim(), recipient, followUp });
    });
  }
  return out;
}

function gainLife(state: B18DamageState, playerId: string, amount: number): void {
  const player = (state.players || []).find((p) => String(p?.id) === playerId);
  state.life = state.life || {};
  const current = Number(state.life[playerId] ?? player?.life ?? 40);
  state.life[playerId] = current + amount;
  if (player) player.life = state.life[playerId];
}

/** Returns a replaced damage result (amount 0) or null when no Batch 18 noncombat rule applies. */
export function applyBatch18NoncombatPrevention(
  state: B18DamageState | undefined, damageAmount: number, damageReceiver: string,
  targetPermanentId: string | undefined, isCombatDamage: boolean | undefined,
): { amount: number; modifiers: string[] } | null {
  if (isCombatDamage === true || !(Number(damageAmount) > 0) || !state) return null;
  const targetId = String(targetPermanentId || '').trim();
  for (const rule of collectBatch18NoncombatPreventionRules(state)) {
    if (rule.recipient === 'you' && (targetId || String(damageReceiver || '') !== rule.controller)) continue;
    if (rule.recipient === 'self' && targetId !== rule.sourcePermanentId) continue;
    const mods = [`${rule.sourceName}: prevented ${damageAmount} noncombat damage`];
    if (rule.followUp === 'gain-life') {
      gainLife(state, rule.controller, damageAmount);
      mods.push(`gained ${damageAmount} life`);
    } else if (rule.followUp === 'plus-one-counters') {
      const src = (state.battlefield || []).find((p) => String(p?.id) === rule.sourcePermanentId);
      if (src) {
        src.counters = src.counters || {};
        src.counters['+1/+1'] = (Number(src.counters['+1/+1']) || 0) + damageAmount;
        mods.push(`put ${damageAmount} +1/+1 counter(s)`);
      }
    }
    return { amount: 0, modifiers: mods };
  }
  return null;
}