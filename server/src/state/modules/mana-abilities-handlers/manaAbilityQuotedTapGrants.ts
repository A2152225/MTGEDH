// server/src/state/modules/mana-abilities-handlers/manaAbilityQuotedTapGrants.ts
// Quoted tap-for-mana grants kept verbatim by the spec system (Lands you control have "{T}: Add {C}{C}.",
// Tectonic Split "three mana of any one color", Resonating Lute "two mana ... Spend this mana only to ...",
// Imprisoned in the Moon "{T}: Add {C}"). "One mana of any color" stays with manaAbilitiesFromContinuousTapGrants.
// Public entry symbols: manaAbilitiesFromQuotedTapGrants.

import type { ManaAbility } from './manaAbilityLandTypeModifiers.js';

const WORD_AMOUNTS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function amountOf(word: string): number {
  return WORD_AMOUNTS[word] ?? (parseInt(word, 10) || 0);
}

export function manaAbilitiesFromQuotedTapGrants(
  grantedAbilities: readonly string[],
  sourceKey: string,
  parseSpendRestriction?: (text: string) => ManaAbility['spendRestriction'] | null | undefined,
): ManaAbility[] {
  const out: ManaAbility[] = [];
  grantedAbilities.forEach((raw, index) => {
    const text = String(raw || '').trim().toLowerCase();
    const m = text.match(/^\{t\}:\s*add\s+([^.]+?)\s*(?:\.|$)/);
    if (!m) return;
    const what = m[1].trim();
    let ability: ManaAbility | null = null;
    const anyOne = what.match(/^(\w+) mana of any one color$/);
    const symbols = what.match(/^((?:\{[wubrgc]\})+)$/);
    const choice = what.match(/^\{([wubrgc])\}(?:, \{[wubrgc]\})*,? or \{([wubrgc])\}$/);
    if (anyOne && amountOf(anyOne[1]) > 0) {
      ability = { id: `quoted_any_${sourceKey}_${index}`, cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'], amount: amountOf(anyOne[1]) };
    } else if (symbols) {
      const list = [...symbols[1].matchAll(/\{([wubrgc])\}/g)].map((s) => s[1].toUpperCase());
      const unique = [...new Set(list)];
      ability = unique.length === 1
        ? { id: `quoted_${unique[0].toLowerCase()}_${sourceKey}_${index}`, cost: '{T}', produces: unique, amount: list.length }
        : list.length === unique.length
          ? { id: `quoted_multi_${sourceKey}_${index}`, cost: '{T}', produces: unique, producesAllAtOnce: true }
          : null;
    } else if (choice) {
      const list = [...what.matchAll(/\{([wubrgc])\}/g)].map((s) => s[1].toUpperCase());
      ability = { id: `quoted_choice_${sourceKey}_${index}`, cost: '{T}', produces: [...new Set(list)], producesAllAtOnce: false };
    }
    if (!ability) return;
    ability.isGranted = true;
    if (ability.amount === 1) delete ability.amount;
    const restriction = /spend this mana only/.test(text) && parseSpendRestriction ? parseSpendRestriction(text) : null;
    if (restriction) ability.spendRestriction = restriction;
    out.push(ability);
  });
  return out;
}
