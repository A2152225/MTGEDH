import type { PlaneswalkerTemplateMatch } from "./types.js";
import { normalizeOracleEffectText } from "./utils.js";
import { tryMatchPlaneswalkerTemplateDrawExileSearch } from "./registry-handlers/planeswalkerTemplateMatchDrawExileSearch.js";
import { tryMatchPlaneswalkerTemplateLookDraftPerpetual } from "./registry-handlers/planeswalkerTemplateMatchLookDraftPerpetual.js";
import { tryMatchPlaneswalkerTemplatePumpLifeCreate } from "./registry-handlers/planeswalkerTemplateMatchPumpLifeCreate.js";
import { tryMatchPlaneswalkerTemplateControlFightNamedDamage } from "./registry-handlers/planeswalkerTemplateMatchControlFightNamedDamage.js";

export function getPlaneswalkerTemplateMatch(
  effectText: string,
  options?: {
    /**
     * When true, return a catch-all match for any remaining loyalty line.
     * Keep this disabled for gameplay to avoid shadowing legacy handlers.
     */
    allowFallback?: boolean;
  }
): PlaneswalkerTemplateMatch | null {
  const text = normalizeOracleEffectText(effectText);

  const matchedPlaneswalkerTemplateDrawExileSearch = tryMatchPlaneswalkerTemplateDrawExileSearch(text);
  if (matchedPlaneswalkerTemplateDrawExileSearch) return matchedPlaneswalkerTemplateDrawExileSearch;


  const matchedPlaneswalkerTemplateLookDraftPerpetual = tryMatchPlaneswalkerTemplateLookDraftPerpetual(text);
  if (matchedPlaneswalkerTemplateLookDraftPerpetual) return matchedPlaneswalkerTemplateLookDraftPerpetual;


  const matchedPlaneswalkerTemplatePumpLifeCreate = tryMatchPlaneswalkerTemplatePumpLifeCreate(text);
  if (matchedPlaneswalkerTemplatePumpLifeCreate) return matchedPlaneswalkerTemplatePumpLifeCreate;


  const matchedPlaneswalkerTemplateControlFightNamedDamage = tryMatchPlaneswalkerTemplateControlFightNamedDamage(text);
  if (matchedPlaneswalkerTemplateControlFightNamedDamage) return matchedPlaneswalkerTemplateControlFightNamedDamage;


  // Fallback: only enabled explicitly (used by coverage tooling).
  if (options?.allowFallback && text.trim().length > 0) {
    return { id: "FALLBACK_MANUAL_RESOLUTION", matchedText: text };
  }

  return null;
}
