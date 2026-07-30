import type { PlayerID } from '../../../../shared/src/index.js';
import { canPayManaCostWithAvailableSources, parseManaCost } from './mana-check.js';

export function applyChosenXToManaCost(manaCost: string, xValue: number): string {
  const safeXValue = Math.max(0, Math.floor(Number(xValue) || 0));
  return String(manaCost || '')
    .replace(/\{X\}/gi, `{${safeXValue}}`)
    .replace(/\bX\b/g, `{${safeXValue}}`);
}

function findSpellCardForXSelection(game: any, playerId: PlayerID, step: any): any | null {
  const cardId = String(step?.spellCardId || step?.sourceId || '').trim();
  if (!cardId) return null;

  const requestedZone = String(step?.spellFromZone || '').trim();
  const zonesToSearch = [requestedZone, 'hand', 'exile', 'graveyard'].filter(
    (zoneName, index, entries) => zoneName && entries.indexOf(zoneName) === index,
  );

  for (const zoneName of zonesToSearch) {
    const zoneCards = (game?.state as any)?.zones?.[playerId]?.[zoneName];
    if (!Array.isArray(zoneCards)) continue;

    const found = zoneCards.find((card: any) => String(card?.id || '') === cardId);
    if (found) return found;
  }

  return null;
}

export function getMaxAffordableSpellX(
  game: any,
  playerId: PlayerID,
  manaCost: string,
  options?: {
    minValue?: number;
    maxValue?: number;
    excludedHandCardIds?: string[];
  },
): number {
  const minValue = Math.max(0, Math.floor(Number(options?.minValue ?? 0)));
  const maxValue = Math.max(
    minValue,
    Math.floor(Number(options?.maxValue ?? 20)),
  );
  const exactManaOptions = options?.excludedHandCardIds?.length
    ? { excludedHandCardIds: options.excludedHandCardIds }
    : undefined;

  if (!String(manaCost || '').includes('X')) {
    return minValue;
  }

  for (let candidate = maxValue; candidate >= minValue; candidate -= 1) {
    const expandedManaCost = applyChosenXToManaCost(manaCost, candidate);
    const parsedCost = parseManaCost(expandedManaCost);
    if (canPayManaCostWithAvailableSources(game.state, playerId, parsedCost, Infinity, exactManaOptions)) {
      return candidate;
    }
  }

  return minValue;
}

/**
 * Returns false when paying X=0 would waste the spell (e.g. Pest Infestation for {G}).
 * Mandatory effects like "destroy target creature" still return true at X=0.
 */
export function isSpellWorthCastingAtX(oracleText: string, xValue: number): boolean {
  const safeX = Math.max(0, Math.floor(Number(xValue) || 0));
  if (safeX > 0) return true;

  const text = String(oracleText || '').replace(/\s+/g, ' ').trim();
  if (!text) return true;

  const mandatoryEffectPatterns = [
    /\bdestroy\s+target\b/i,
    /\bcounter\s+target\b/i,
    /\bexile\s+target\b/i,
    /\breturn\s+target\b/i,
    /\bdraw\s+(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/i,
    /\bsearch\s+your\s+library\s+for\b/i,
    /\bgain\s+control\s+of\s+target\b/i,
    /\btap\s+target\b/i,
    /\buntap\s+target\b/i,
  ];
  if (mandatoryEffectPatterns.some((pattern) => pattern.test(text))) {
    return true;
  }

  const xOnlyEffectPatterns = [
    /\bup\s+to\s+X\b/i,
    /\btwice\s+X\b/i,
    /\bX\s+times\b/i,
    /\bdeals?\s+X\b/i,
    /\bdraw\s+X\b/i,
    /\bcreate[s]?\s+(?:twice\s+)?X\b/i,
    /\bput\s+(?:twice\s+)?X\b/i,
    /\bloses?\s+X\b/i,
    /\bgains?\s+X\s+life\b/i,
    /\bdistribute\s+X\b/i,
    /\binvestigate\s+X\b/i,
    /\bscry\s+X\b/i,
    /\bmill\s+X\b/i,
    /\bgets?\s+X\s+\+1\/\+1\b/i,
  ];

  if (xOnlyEffectPatterns.some((pattern) => pattern.test(text))) {
    return false;
  }

  return true;
}

export function chooseSpellXValueFromStep(game: any, playerId: PlayerID, step: any): number {
  const minValue = Number.isFinite(Number(step?.minValue))
    ? Math.max(0, Math.floor(Number(step.minValue)))
    : 0;
  const maxValue = Number.isFinite(Number(step?.maxValue))
    ? Math.max(minValue, Math.floor(Number(step.maxValue)))
    : minValue;

  if (step?.spellCastWithoutPayingManaCost === true) {
    return minValue;
  }

  if (step?.spellCastXSelection === true) {
    const spellCard = findSpellCardForXSelection(game, playerId, step);
    const manaCost = String(spellCard?.manaCost || spellCard?.mana_cost || '').trim();
    const exactManaOptions = spellCard?.id
      ? { excludedHandCardIds: [String(spellCard.id)] }
      : undefined;

    if (manaCost.includes('X')) {
      const chosenX = getMaxAffordableSpellX(game, playerId, manaCost, {
        minValue,
        maxValue,
        excludedHandCardIds: exactManaOptions?.excludedHandCardIds,
      });
      const oracleText = String(spellCard?.oracle_text || spellCard?.oracleText || '');
      if (isSpellWorthCastingAtX(oracleText, chosenX)) {
        return chosenX;
      }
      return minValue;
    }
  }

  return minValue;
}
