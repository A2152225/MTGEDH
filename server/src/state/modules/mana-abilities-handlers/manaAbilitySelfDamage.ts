// Origin parent: server/src/state/modules/mana-abilities.ts
// Cluster moved: tap-for-mana self-damage (Ancient Tomb, pain lands/talismans).
// Public entry symbols: parseManaAbilityLineSelfDamage, damageEffectFromAbilityText,
//   appendTapAddMultiManaAbility, resolveManaAbilityLifeEffect,
//   applyManaAbilityLifeEffectToState.
// Leaf must not import mana-abilities.ts or mana-abilities-handlers/index.ts.

import type { ManaAbility } from './manaAbilityLandTypeModifiers.js';

export type ManaAbilityLifeEffect = {
  amount: number;
  isDamage: boolean;
};

const EMPTY_LIFE_EFFECT: ManaAbilityLifeEffect = { amount: 0, isDamage: false };

/** Self-damage on the same tap-add ability, not a separate "whenever" trigger. */
export function parseManaAbilityLineSelfDamage(abilityText: string): number {
  const text = String(abilityText || '')
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase();
  if (!text.trim()) return 0;

  const effect = text.includes(':') ? text.split(':').slice(1).join(':') : text;
  const manaEffect = String(effect.split(/\bwhenever\b/i)[0] || '');
  const match = manaEffect.match(/\bdeals\s+(\d+)\s+damage\s+to\s+you\b/);
  const amount = match ? parseInt(match[1], 10) : 0;
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export function damageEffectFromAbilityText(abilityText: string): ManaAbility['damageEffect'] | undefined {
  const amount = parseManaAbilityLineSelfDamage(abilityText);
  if (amount <= 0) return undefined;
  return { type: 'damage_self', amount };
}

/** `{T}: Add {C}{C}` / `{T}: Add {G}{U}` including optional same-ability self-damage. */
export function appendTapAddMultiManaAbility(abilities: ManaAbility[], oracleText: string): boolean {
  const match = String(oracleText || '').match(/\{t\}:\s*add\s+((?:\{[wubrgc]\}){2,})/i);
  if (!match) return false;

  const manaSymbols = match[1].match(/\{([wubrgc])\}/gi) || [];
  const colors: string[] = [];
  for (const symbol of manaSymbols) {
    const color = symbol.replace(/[{}]/g, '').toUpperCase();
    if (!colors.includes(color)) colors.push(color);
  }
  if (colors.length === 0) return false;

  const matchStart = Number(match.index || 0);
  const rest = String(oracleText || '').slice(matchStart);
  const tapAddLine = rest.split(/(?=\{t\}:)/i)[0] || rest;
  const damageEffect = damageEffectFromAbilityText(tapAddLine);

  if (colors.length > 1) {
    abilities.push({
      id: 'native_multi',
      cost: '{T}',
      produces: colors,
      producesAllAtOnce: true,
      ...(damageEffect ? { damageEffect } : {}),
    });
  } else {
    abilities.push({
      id: 'native_multi_same',
      cost: '{T}',
      produces: colors,
      amount: manaSymbols.length,
      ...(damageEffect ? { damageEffect } : {}),
    });
  }
  return true;
}

function splitTapAddClauses(oracleText: string): string[] {
  return String(oracleText || '')
    .replace(/[\u2018\u2019]/g, "'")
    .split(/(?=\{t\}:)/i)
    .map((part) => part.trim())
    .filter((part) => /\{t\}(?:[,:]|[^\n]*:)\s*add\b/i.test(part));
}

function inferManaAbilityLifeEffectFromCard(card: any, producesColoredMana: boolean): ManaAbilityLifeEffect {
  const oracleText = String(card?.oracle_text || '');
  const clauses = splitTapAddClauses(oracleText);
  const damaging = clauses
    .map((clause) => ({ clause, amount: parseManaAbilityLineSelfDamage(clause) }))
    .filter((entry) => entry.amount > 0);

  if (clauses.length === 1 && damaging.length === 1) {
    return { amount: damaging[0].amount, isDamage: true };
  }

  if (producesColoredMana && damaging.length > 0) {
    const coloredDamage = damaging.find((entry) => /\{[wubrg]\}/i.test(entry.clause));
    if (coloredDamage) return { amount: coloredDamage.amount, isDamage: true };
    return { amount: damaging[0].amount, isDamage: true };
  }

  const lower = oracleText.toLowerCase();
  if (producesColoredMana) {
    const wheneverDamage = lower.match(/\bdeals\s+(\d+)\s+damage\s+to\s+you\b/);
    const wheneverAmount = wheneverDamage ? parseInt(wheneverDamage[1], 10) : 0;
    if (Number.isFinite(wheneverAmount) && wheneverAmount > 0) {
      return { amount: wheneverAmount, isDamage: true };
    }
  }

  if (producesColoredMana && lower.includes('{t},') && lower.includes('pay 1 life')) {
    return { amount: 1, isDamage: false };
  }

  return EMPTY_LIFE_EFFECT;
}

export function resolveManaAbilityLifeEffect(params: {
  card: any;
  ability?: { damageEffect?: { type?: string; amount?: number } } | null;
  abilityText?: string;
  producesColoredMana: boolean;
}): ManaAbilityLifeEffect {
  const damageFromAbility = params.ability?.damageEffect;
  if (damageFromAbility?.type === 'damage_self') {
    const amount = Math.max(0, Number(damageFromAbility.amount || 0));
    if (amount > 0) return { amount, isDamage: true };
  }

  const lineText = String(params.abilityText || '').trim();
  if (lineText) {
    const amount = parseManaAbilityLineSelfDamage(lineText);
    if (amount > 0) return { amount, isDamage: true };
  }

  return inferManaAbilityLifeEffectFromCard(params.card, params.producesColoredMana);
}

export function applyManaAbilityLifeEffectToState(
  state: any,
  playerId: string,
  effect: ManaAbilityLifeEffect,
): void {
  const finalAmount = Number(effect.amount || 0);
  if (!playerId || finalAmount <= 0) return;

  const stateAny = state as any;
  stateAny.life = stateAny.life || {};
  const startingLife = Number(stateAny.startingLife || 40);
  const currentLife = Number(stateAny.life?.[playerId] ?? startingLife);
  stateAny.life[playerId] = Math.max(0, currentLife - finalAmount);

  try {
    if (effect.isDamage) {
      stateAny.damageTakenThisTurnByPlayer = stateAny.damageTakenThisTurnByPlayer || {};
      stateAny.damageTakenThisTurnByPlayer[String(playerId)] =
        Number(stateAny.damageTakenThisTurnByPlayer[String(playerId)] || 0) + finalAmount;
    }

    stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
    stateAny.lifeLostThisTurn[String(playerId)] =
      Number(stateAny.lifeLostThisTurn[String(playerId)] || 0) + finalAmount;
  } catch {
    // best-effort only
  }

  const player = (stateAny.players || []).find((entry: any) => entry?.id === playerId);
  if (player) {
    player.life = stateAny.life[playerId];
  }
}
