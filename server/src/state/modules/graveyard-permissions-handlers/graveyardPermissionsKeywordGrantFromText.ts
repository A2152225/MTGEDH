// Origin parent: server/src/state/modules/graveyard-permissions.ts
// Cluster moved: applyTemporaryGraveyardKeywordGrantFromText.
// Public entry symbols: applyTemporaryGraveyardKeywordGrantFromText.
// Leaf must not import graveyard-permissions.ts or graveyard-permissions-handlers/index.ts.

import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/index.js";
import {
  extractAdditionalEscapeExileCount,
  extractGrantedKeywordCost,
} from "./graveyardPermissionsKeywordCost.js";
import {
  extractKeywordGrantFromAbilityText,
  getGraveyardCardsForTemporaryGrant,
  normalizeGrantKeyword,
} from "./graveyardPermissionsKeywordGrantHelpers.js";
import { addTemporaryGraveyardKeywordGrant } from "./graveyardPermissionsTemporaryKeywordGrant.js";

export function applyTemporaryGraveyardKeywordGrantFromText(
  ctx: GameContext,
  playerId: PlayerID,
  sourceName: string,
  description: string,
  triggerItem?: any,
): number {
  try {
    const state = (ctx as any)?.state;
    if (!state || !playerId) return 0;

    const text = String(description || '').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
    if (!text || !/\bgraveyard\b/i.test(text) || !/\bgains?\b/i.test(text)) return 0;

    // Reflexive delayed triggers such as Filigree Racer's "When you do" need their own payment bridge.
    if (/\bwhen you do\b/i.test(text)) return 0;

    const sourceId = String(
      triggerItem?.sourceId || triggerItem?.source || triggerItem?.permanentId || triggerItem?.id || ''
    ).trim();
    const targetIds = Array.isArray(triggerItem?.targets)
      ? triggerItem.targets.map((id: any) => String(id || '').trim()).filter(Boolean)
      : [];

    const grantPatterns = [
      { targetMode: 'each', pattern: /(?:^|[.,:]\s*)(?:until end of turn,\s*)?each\s+(.+?)\s+cards?\s+in\s+your\s+graveyard(?:\s+that(?:'s| is)\s+[^.]+?)?\s+gains?\s+(?:"([^"]+)"|([a-z][a-z-]*)(?:\s+((?:\{[^}]+\}\s*)+))?)(?:\s+until end of turn)?/gi },
      { targetMode: 'target', pattern: /(?:^|[.,:]\s*)target\s+(.+?)\s+cards?\s+in\s+your\s+graveyard(?:\s+that(?:'s| is)\s+[^.]+?)?\s+gains?\s+(?:"([^"]+)"|([a-z][a-z-]*)(?:\s+((?:\{[^}]+\}\s*)+))?)(?:\s+until end of turn)?/gi },
    ];

    let applied = 0;
    for (const { targetMode, pattern } of grantPatterns) {
      for (const match of text.matchAll(pattern)) {
        const qualifier = String(match[1] || '').trim();
        const quotedAbilityText = String(match[2] || '').trim();
        const unquotedKeywordText = String(match[3] || '').trim();
        const explicitCostText = String(match[4] || '').trim();
        const extracted = quotedAbilityText
          ? extractKeywordGrantFromAbilityText(quotedAbilityText)
          : { keyword: normalizeGrantKeyword(unquotedKeywordText), remainder: explicitCostText };
        const keyword = extracted.keyword;
        if (!keyword || !qualifier) continue;

        const cards = getGraveyardCardsForTemporaryGrant(
          state,
          playerId,
          qualifier,
          targetMode === 'target' ? targetIds : undefined,
        );
        if (targetMode === 'target' && targetIds.length === 0) continue;

        for (const card of cards) {
          const cost = extractGrantedKeywordCost(keyword, extracted.remainder || explicitCostText, text, card);
          if (!cost) continue;
          const added = addTemporaryGraveyardKeywordGrant(state, playerId, card, {
            keyword,
            cost,
            ...(keyword === 'escape' ? { additionalExileCount: extractAdditionalEscapeExileCount(`${quotedAbilityText} ${text}`) } : {}),
            sourceId,
            sourceName,
          });
          if (added) applied += 1;
        }
      }
    }

    return applied;
  } catch {
    return 0;
  }
}


