// server/src/state/modules/asEntersPayAnyLife.ts
// Minion of the Wastes / Nameless Race: "As this creature enters, pay any amount of life." and
// "~'s power and toughness are each equal to the life paid as it entered." The amount is asked with
// a NUMBER_CHOICE step flagged asEntersPayAnyLife and stored on the permanent as lifePaidOnEntry.
// Public entry symbols: hasAsEntersPayAnyLife, getAsEntersPayAnyLifeMax, isAsEntersPayAnyLifeStep,
// applyAsEntersPayAnyLifeChoice, getLifePaidOnEntryPT.

import { applyOracleIrOptionalLifePayment } from './oracleIrServerZoneSync-handlers/oracleIrServerOptionalStepChoicePrompts.js';

function lower(card: any): string {
  return String(card?.oracle_text || '').toLowerCase().replace(/\u2019/g, "'");
}

export function hasAsEntersPayAnyLife(card: any): boolean {
  return /\bas (?:this creature|this permanent|~|[^.\n]+?) enters(?: the battlefield)?, pay any amount of life\b/.test(lower(card));
}

function isWhite(card: any): boolean {
  const colors = Array.isArray(card?.colors) ? card.colors : [];
  return colors.includes('W') || colors.includes('white');
}

/** Life total cap, further capped by the Nameless Race white-permanent/graveyard clause. */
export function getAsEntersPayAnyLifeMax(state: any, playerId: string, card: any): number {
  const life = Number(state?.life?.[playerId] ?? state?.startingLife ?? 40);
  let max = Math.max(0, Number.isFinite(life) ? Math.floor(life) : 0);
  if (/can't be more than the total number of white nontoken permanents your opponents control plus the total number of white cards in their graveyards/.test(lower(card))) {
    const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
    let cap = battlefield.filter((p: any) => p && String(p.controller) !== String(playerId) && !p.isToken && isWhite(p.card)).length;
    for (const [pid, zone] of Object.entries<any>(state?.zones || {})) {
      if (String(pid) === String(playerId)) continue;
      cap += (Array.isArray(zone?.graveyard) ? zone.graveyard : []).filter(isWhite).length;
    }
    max = Math.min(max, cap);
  }
  return max;
}

export function isAsEntersPayAnyLifeStep(step: any): boolean {
  return step?.asEntersPayAnyLife === true;
}

/** Pays the chosen life (clamped to the step bounds) and records it on the permanent. Returns the amount paid. */
export function applyAsEntersPayAnyLifeChoice(state: any, step: any, playerId: string, value: number | null): number {
  const maxValue = Math.max(0, Math.floor(Number(step?.maxValue ?? 0)));
  const amount = Math.max(0, Math.min(maxValue, Math.floor(Number(value ?? 0)) || 0));
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const perm = battlefield.find((p: any) => String(p?.id) === String(step?.permanentId || step?.sourceId));
  if (amount > 0) applyOracleIrOptionalLifePayment(state, String(playerId), amount);
  if (perm) {
    perm.lifePaidOnEntry = amount;
    delete perm.asEntersLifePaymentPending;
  }
  return amount;
}

/** P/T for "each equal to the life paid as it entered"; a pending payment holds 0/1 so the creature survives the prompt. */
export function getLifePaidOnEntryPT(perm: any): { power: number; toughness: number } | undefined {
  if (!perm) return undefined;
  if (typeof perm.lifePaidOnEntry === 'number') return { power: perm.lifePaidOnEntry, toughness: perm.lifePaidOnEntry };
  if (perm.asEntersLifePaymentPending === true) return { power: 0, toughness: 1 };
  return { power: 0, toughness: 0 };
}
