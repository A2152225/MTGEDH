/**
 * CR 602.3 exception: some activated abilities say
 * "Any player may activate this ability."
 */

export function textAllowsAnyPlayerActivation(text: string | null | undefined): boolean {
  return /\bany player may activate this ability\b/i.test(String(text || ''));
}

function abilityCostPrefix(scopedAbilityText: string): string {
  const beforeColon = String(scopedAbilityText || '').split(':')[0] || '';
  const symbols = beforeColon.match(/\{[^}]+\}/g);
  if (symbols && symbols.length > 0) {
    return symbols.join('').toLowerCase();
  }
  return beforeColon.trim().toLowerCase();
}

/**
 * Whether this specific activated ability (not every ability on the card)
 * can be activated by a non-controller.
 *
 * Scoped extractors sometimes stop at the first period and drop the reminder,
 * so a truthy truncated line must not hide the card's actual oracle paragraph.
 */
export function abilityAllowsAnyPlayerActivation(params: {
  scopedAbilityText?: string | null;
  cardOracleText?: string | null;
}): boolean {
  const scoped = String(params.scopedAbilityText || '').trim();
  const oracle = String(params.cardOracleText || '').trim();
  if (textAllowsAnyPlayerActivation(scoped)) return true;
  if (!textAllowsAnyPlayerActivation(oracle)) return false;

  const paragraphs = oracle
    .split(/\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const costPrefix = abilityCostPrefix(scoped);
  if (costPrefix) {
    const idx = paragraphs.findIndex((paragraph) => {
      const lower = paragraph.toLowerCase();
      if (lower.includes(costPrefix)) return true;
      const compact = lower.replace(/\s+/g, '');
      return compact.includes(costPrefix.replace(/\s+/g, ''));
    });
    if (idx >= 0) {
      if (textAllowsAnyPlayerActivation(paragraphs[idx])) return true;
      const next = paragraphs[idx + 1] || '';
      const nextIsAnotherActivatedAbility = /\{[^}]+\}/.test(next) && next.includes(':');
      if (textAllowsAnyPlayerActivation(next) && !nextIsAnotherActivatedAbility) return true;
    }
  }

  const activatedParagraphs = paragraphs.filter((paragraph) =>
    /\{[^}]+\}/.test(paragraph) && paragraph.includes(':'),
  );
  return activatedParagraphs.length <= 1;
}
