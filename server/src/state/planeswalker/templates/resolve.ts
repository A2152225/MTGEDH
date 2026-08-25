import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/types.js";
import { getPlaneswalkerTemplateMatch } from "./registry.js";
import { normalizeOracleEffectText } from "./utils.js";
import { tryLoyaltyTemplateManualDraft } from "./resolve-handlers/loyaltyTemplateManualDraft.js";
import { tryLoyaltyTemplatePerpetualLookReturn } from "./resolve-handlers/loyaltyTemplatePerpetualLookReturn.js";
import { tryLoyaltyTemplateDiscardExileDraw } from "./resolve-handlers/loyaltyTemplateDiscardExileDraw.js";
import { tryLoyaltyTemplateGyCopyUntapLook } from "./resolve-handlers/loyaltyTemplateGyCopyUntapLook.js";
import { tryLoyaltyTemplateLookDrawLifeDiscard } from "./resolve-handlers/loyaltyTemplateLookDrawLifeDiscard.js";
import { tryLoyaltyTemplateLifeManaDamageDestroy } from "./resolve-handlers/loyaltyTemplateLifeManaDamageDestroy.js";
import { tryLoyaltyTemplateCreateTokens } from "./resolve-handlers/loyaltyTemplateCreateTokens.js";
import { tryLoyaltyTemplateLoyaltyCountersMill } from "./resolve-handlers/loyaltyTemplateLoyaltyCountersMill.js";
import { tryLoyaltyTemplateP1P1FightDamage } from "./resolve-handlers/loyaltyTemplateP1P1FightDamage.js";
import { tryLoyaltyTemplateDamageRestartSearch } from "./resolve-handlers/loyaltyTemplateDamageRestartSearch.js";
import { tryLoyaltyTemplateSearchEmblemHandPut } from "./resolve-handlers/loyaltyTemplateSearchEmblemHandPut.js";
import { tryLoyaltyTemplateHandPutPumpControl } from "./resolve-handlers/loyaltyTemplateHandPutPumpControl.js";
import { tryLoyaltyTemplateControlExtraTurnGy } from "./resolve-handlers/loyaltyTemplateControlExtraTurnGy.js";
import { tryLoyaltyTemplateNamedDamageFinale } from "./resolve-handlers/loyaltyTemplateNamedDamageFinale.js";

export function tryResolvePlaneswalkerLoyaltyTemplate(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  effectText: string,
  triggerItem: any
): boolean {
  const match = getPlaneswalkerTemplateMatch(effectText);
  if (!match) return false;

  const state = (ctx as any).state;
  const text = normalizeOracleEffectText(effectText);

  const handledManualDraft = tryLoyaltyTemplateManualDraft(ctx, controller, sourceName, triggerItem, match, state, text);
  if (handledManualDraft !== undefined) return handledManualDraft;
  const handledPerpetualLookReturn = tryLoyaltyTemplatePerpetualLookReturn(ctx, controller, sourceName, triggerItem, match, state, text);
  if (handledPerpetualLookReturn !== undefined) return handledPerpetualLookReturn;
  const handledDiscardExileDraw = tryLoyaltyTemplateDiscardExileDraw(ctx, controller, sourceName, triggerItem, match, state, text);
  if (handledDiscardExileDraw !== undefined) return handledDiscardExileDraw;
  const handledGyCopyUntapLook = tryLoyaltyTemplateGyCopyUntapLook(ctx, controller, sourceName, triggerItem, match, state, text);
  if (handledGyCopyUntapLook !== undefined) return handledGyCopyUntapLook;
  const handledLookDrawLifeDiscard = tryLoyaltyTemplateLookDrawLifeDiscard(ctx, controller, sourceName, triggerItem, match, state, text);
  if (handledLookDrawLifeDiscard !== undefined) return handledLookDrawLifeDiscard;
  const handledLifeManaDamageDestroy = tryLoyaltyTemplateLifeManaDamageDestroy(ctx, controller, sourceName, triggerItem, match, state, text);
  if (handledLifeManaDamageDestroy !== undefined) return handledLifeManaDamageDestroy;
  const handledCreateTokens = tryLoyaltyTemplateCreateTokens(ctx, controller, sourceName, triggerItem, match, state, text);
  if (handledCreateTokens !== undefined) return handledCreateTokens;
  const handledLoyaltyCountersMill = tryLoyaltyTemplateLoyaltyCountersMill(ctx, controller, sourceName, triggerItem, match, state, text);
  if (handledLoyaltyCountersMill !== undefined) return handledLoyaltyCountersMill;
  const handledP1P1FightDamage = tryLoyaltyTemplateP1P1FightDamage(ctx, controller, sourceName, triggerItem, match, state, text);
  if (handledP1P1FightDamage !== undefined) return handledP1P1FightDamage;
  const handledDamageRestartSearch = tryLoyaltyTemplateDamageRestartSearch(ctx, controller, sourceName, triggerItem, match, state, text);
  if (handledDamageRestartSearch !== undefined) return handledDamageRestartSearch;
  const handledSearchEmblemHandPut = tryLoyaltyTemplateSearchEmblemHandPut(ctx, controller, sourceName, triggerItem, match, state, text);
  if (handledSearchEmblemHandPut !== undefined) return handledSearchEmblemHandPut;
  const handledHandPutPumpControl = tryLoyaltyTemplateHandPutPumpControl(ctx, controller, sourceName, triggerItem, match, state, text);
  if (handledHandPutPumpControl !== undefined) return handledHandPutPumpControl;
  const handledControlExtraTurnGy = tryLoyaltyTemplateControlExtraTurnGy(ctx, controller, sourceName, triggerItem, match, state, text);
  if (handledControlExtraTurnGy !== undefined) return handledControlExtraTurnGy;
  const handledNamedDamageFinale = tryLoyaltyTemplateNamedDamageFinale(ctx, controller, sourceName, triggerItem, match, state, text);
  if (handledNamedDamageFinale !== undefined) return handledNamedDamageFinale;

  switch (match.id) {
    default:
      return false;
  }
}
