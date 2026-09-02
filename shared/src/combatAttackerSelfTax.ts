/**
 * Attacker/blocker self-tax from granted text (Whipgrass Entangler) and from
 * attached auras (Cowed by Wisdom / Brainwash / Oppressive Rays):
 * "Enchanted creature can't attack or block unless its controller pays {1}
 * for each card in your hand." / "…pays {3}."
 *
 * Not defender pillowfort. Idle printed "{1}{W}: Until end of turn, target
 * creature gains …" must not tax the Entangler itself.
 */

import { permanentHasCreatureType } from './creatureTypes.js';

export interface AttackerSelfAttackTax {
  cost: number;
  sources: string[];
}

export interface CombatSelfTaxPlayerHand {
  id?: string;
  hand?: readonly unknown[];
  handCount?: number;
}

export function countCountersOnPermanent(permanent: unknown): number {
  const counters = (permanent as { counters?: Record<string, unknown> } | null | undefined)?.counters;
  if (!counters || typeof counters !== 'object') return 0;
  let total = 0;
  for (const [key, value] of Object.entries(counters)) {
    if (key === 'damage') continue;
    const n = Math.max(0, Math.floor(Number(value) || 0));
    if (n > 0) total += n;
  }
  return total;
}

const SELF_TAX_RE =
  /can(?:not|'t|’t)\s+attack(?:\s+or\s+block)?\s+unless\s+(?:its|their)\s+controller\s+pays\s+\{(\d+)\}\s+for\s+each\s+([a-z][a-z']*)\s+on\s+the\s+battlefield/i;

const HOST_TAX_RE =
  /enchanted creature can(?:not|'t|’t)\s+attack(?:\s+or\s+block)?\s+unless\s+(?:its|their)\s+controller\s+pays\s+\{(\d+)\}(?:\s+for each card in your hand)?/i;

function grantedTexts(permanent: unknown): string[] {
  const perm = permanent as {
    temporaryEffects?: unknown;
    temporaryAbilities?: unknown;
    grantedAbilities?: unknown;
  } | null | undefined;
  if (!perm) return [];
  const texts: string[] = [];

  if (Array.isArray(perm.temporaryEffects)) {
    for (const effect of perm.temporaryEffects) {
      const description = String((effect as { description?: unknown })?.description || '').trim();
      if (description) texts.push(description);
    }
  }

  if (Array.isArray(perm.temporaryAbilities)) {
    for (const entry of perm.temporaryAbilities) {
      if (typeof entry === 'string') {
        const text = entry.trim();
        if (text) texts.push(text);
        continue;
      }
      const ability = String((entry as { ability?: unknown })?.ability || '').trim();
      if (ability) texts.push(ability);
    }
  }

  return texts;
}

function oracleOf(permanent: unknown): string {
  const perm = permanent as { card?: { oracle_text?: string }; oracle_text?: string } | null | undefined;
  return String(perm?.card?.oracle_text || perm?.oracle_text || '');
}

function nameOf(permanent: unknown): string {
  const perm = permanent as { card?: { name?: string }; name?: string } | null | undefined;
  return String(perm?.card?.name || perm?.name || 'an effect');
}

function countCreatureTypeOnBattlefield(
  battlefield: readonly unknown[],
  creatureType: string,
): number {
  let count = 0;
  for (const permanent of battlefield) {
    if (!permanent) continue;
    if (permanentHasCreatureType(permanent as any, creatureType)) count += 1;
  }
  return count;
}

function playerHandCount(
  players: readonly CombatSelfTaxPlayerHand[] | undefined,
  playerId: string,
): number {
  const id = String(playerId || '').trim();
  if (!id || !Array.isArray(players)) return 0;
  const player = players.find((entry) => String(entry?.id || '').trim() === id);
  if (!player) return 0;
  if (typeof player.handCount === 'number' && Number.isFinite(player.handCount)) {
    return Math.max(0, Math.floor(player.handCount));
  }
  return Array.isArray(player.hand) ? player.hand.length : 0;
}

export function parseAttackerSelfAttackTaxFromText(text: string): {
  amountPer: number;
  creatureType: string;
} | null {
  const match = String(text || '').match(SELF_TAX_RE);
  if (!match) return null;
  const amountPer = parseInt(String(match[1] || ''), 10);
  const creatureType = String(match[2] || '').trim();
  if (!Number.isFinite(amountPer) || amountPer <= 0 || !creatureType) return null;
  if (creatureType.toLowerCase() === 'creature') return null;
  return { amountPer, creatureType };
}

function parseHostAuraTaxFromText(text: string): { amount: number; perHandCard: boolean } | null {
  const match = String(text || '').match(HOST_TAX_RE);
  if (!match) return null;
  const amount = parseInt(String(match[1] || ''), 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const perHandCard = /for each card in your hand/i.test(String(match[0] || ''));
  return { amount, perHandCard };
}

function attachedAuras(attacker: unknown, battlefield: readonly unknown[]): unknown[] {
  const attackerId = String((attacker as { id?: string } | null | undefined)?.id || '').trim();
  if (!attackerId) return [];
  return (Array.isArray(battlefield) ? battlefield : []).filter((permanent) => {
    const attachedTo = String((permanent as { attachedTo?: string } | null | undefined)?.attachedTo || '').trim();
    return attachedTo === attackerId;
  });
}

export function collectAttackerSelfAttackTax(
  attacker: unknown,
  battlefield: readonly unknown[],
  options?: {
    readonly players?: readonly CombatSelfTaxPlayerHand[];
  },
): AttackerSelfAttackTax {
  const sources: string[] = [];
  let cost = 0;
  const field = Array.isArray(battlefield) ? battlefield : [];
  const sourceName = nameOf(attacker);

  for (const text of grantedTexts(attacker)) {
    const parsed = parseAttackerSelfAttackTaxFromText(text);
    if (!parsed) continue;
    const amount = parsed.amountPer * countCreatureTypeOnBattlefield(field, parsed.creatureType);
    if (amount <= 0) continue;
    cost += amount;
    if (!sources.includes(sourceName)) sources.push(sourceName);
  }

  for (const aura of attachedAuras(attacker, field)) {
    const parsed = parseHostAuraTaxFromText(oracleOf(aura));
    if (!parsed) continue;
    const auraController = String((aura as { controller?: string } | null | undefined)?.controller || '').trim();
    const multiplier = parsed.perHandCard
      ? playerHandCount(options?.players, auraController)
      : 1;
    const amount = parsed.amount * multiplier;
    if (amount <= 0) continue;
    cost += amount;
    const auraName = nameOf(aura);
    if (!sources.includes(auraName)) sources.push(auraName);
  }

  return { cost, sources };
}

/** Alias: Cowed-style tax also applies when the host blocks. */
export const collectBlockerSelfTax = collectAttackerSelfAttackTax;
