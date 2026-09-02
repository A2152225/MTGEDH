/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: working out what is actually being cast and for how much -
 * the effective base mana cost once a forced alternate cost applies, the
 * miracle check and its prompt, suspend cast info, and resolving which card
 * face (including adventure halves) a cast refers to.
 *
 * Public entry symbols: resolveEffectiveSpellBaseManaCost, checkMiracle,
 * checkAndPromptMiracle, getSuspendCastInfo, resolveSelectedSpellCard,
 * resolveAdventureAwareFaceIndex, WUBRG_ALTERNATE_MANA_COST.
 */
import type { Server, Socket } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import {
  parseKeywordAlternateManaCost,
  parseMadnessCost,
  parseMutateCost,
  parseRatherThanPayThisSpellManaCost,
  parseWarpCost,
} from "../../state/modules/alternate-costs.js";
import { getMiracleCastInfo } from "../../state/modules/casting-modifiers.js";
import { getMatchingGraveyardCastingPermission } from "../../state/modules/graveyard-permissions.js";
import { isCardOnAdventureForPlayer } from "../../state/modules/playable-from-exile.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";

export const WUBRG_ALTERNATE_MANA_COST = '{W}{U}{B}{R}{G}';
export function resolveEffectiveSpellBaseManaCost(pendingCast: any): string {
  const forcedAlternateCostId = String(pendingCast?.forcedAlternateCostId || '').trim().toLowerCase();
  const oracleText = String(pendingCast?.oracleText || pendingCast?.card?.oracle_text || '');
  const rawManaCost = String(pendingCast?.rawManaCost || '').trim();
  const manaCost = String(pendingCast?.manaCost || '').trim();
  const card = pendingCast?.card;

  if (forcedAlternateCostId === 'mutate') {
    return String(
      pendingCast?.mutateCost
      || parseMutateCost(oracleText)
      || rawManaCost
      || manaCost
      || '',
    ).trim();
  }

  if (forcedAlternateCostId === 'wubrg_self' || forcedAlternateCostId === 'wubrg_external') {
    return WUBRG_ALTERNATE_MANA_COST;
  }

  if (forcedAlternateCostId === 'warp') {
    return String(parseWarpCost(oracleText) || rawManaCost || manaCost || '').trim();
  }

  if (forcedAlternateCostId === 'madness') {
    return String(parseMadnessCost(oracleText) || rawManaCost || manaCost || '').trim();
  }

  if (forcedAlternateCostId === 'miracle' && card) {
    return String(checkMiracle(card).miracleCost || rawManaCost || manaCost || '').trim();
  }

  if (forcedAlternateCostId === 'free' || pendingCast?.castWithoutPayingManaCost === true) {
    return '{0}';
  }

  if (forcedAlternateCostId === 'alternate') {
    const ratherThanPayCost = parseRatherThanPayThisSpellManaCost(oracleText);
    if (ratherThanPayCost) return ratherThanPayCost;
  }

  if (forcedAlternateCostId && forcedAlternateCostId !== 'normal') {
    const keywordCost = parseKeywordAlternateManaCost(oracleText, forcedAlternateCostId);
    if (keywordCost) return keywordCost;
  }

  return rawManaCost || manaCost || String(card?.mana_cost || '').trim();
}

/**
 * Check if a card has the Miracle ability and extract the miracle cost
 * Rule 702.94 - Miracle allows casting a spell for its miracle cost if it's the first card drawn this turn
 * 
 * @param card The card to check
 * @returns Object with hasMiracle boolean and miracleCost string if applicable
 */
export function checkMiracle(
  card: any,
  game?: any,
  playerId?: string,
): { hasMiracle: boolean; miracleCost: string | null; source?: 'native' | 'granted' | null; sourceName?: string } {
  if (!card) return { hasMiracle: false, miracleCost: null, source: null };
  if (game?.state && playerId) {
    return getMiracleCastInfo(game.state, playerId as PlayerID, card);
  }

  const oracleText = (card.oracle_text || "").toLowerCase();
  if (!oracleText.includes('miracle')) {
    return { hasMiracle: false, miracleCost: null, source: null };
  }

  const miracleMatch = oracleText.match(/miracle[��\s]*(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (miracleMatch) {
    return { hasMiracle: true, miracleCost: miracleMatch[1], source: 'native', sourceName: String(card?.name || '') };
  }

  const altMatch = oracleText.match(/miracle\s+(\{(?:[wubrgcx]|[0-9]+|[wubrg]\/[wubrgp])\}(?:\{(?:[wubrgcx]|[0-9]+|[wubrg]\/[wubrgp])\})*)/i);
  if (altMatch) {
    return { hasMiracle: true, miracleCost: altMatch[1], source: 'native', sourceName: String(card?.name || '') };
  }

  return { hasMiracle: true, miracleCost: null, source: 'native', sourceName: String(card?.name || '') };
}

export function getSuspendCastInfo(card: any): { hasSuspend: boolean; suspendCost: string; timeCounters: number } {
  const oracleText = String(card?.oracle_text || card?.oracleText || '');
  const suspendMatch = oracleText.match(/\bsuspend\s+(\d+)\s*[-–—−]\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (!suspendMatch) {
    return {
      hasSuspend: /\bsuspend\b/i.test(oracleText),
      suspendCost: '',
      timeCounters: 0,
    };
  }

  return {
    hasSuspend: true,
    timeCounters: Math.max(0, Number.parseInt(String(suspendMatch[1] || '0'), 10) || 0),
    suspendCost: String(suspendMatch[2] || '').replace(/\s+/g, ''),
  };
}

/**
 * Check drawn cards for miracle ability and emit prompt to player
 * 
 * @param io Socket.io server
 * @param game Game instance
 * @param gameId Game ID
 * @param playerId Player who drew the cards
 * @param drawnCards Array of cards drawn
 */
export function checkAndPromptMiracle(
  io: Server, 
  game: any, 
  gameId: string, 
  playerId: string, 
  drawnCards: any[]
): void {
  if (!drawnCards || drawnCards.length === 0) return;
  
  // Only the first card drawn can trigger miracle
  const firstCard = drawnCards[0];
  if (!firstCard || !firstCard.isFirstDrawnThisTurn) return;
  
  const { hasMiracle, miracleCost, sourceName } = checkMiracle(firstCard, game, playerId);
  if (!hasMiracle || !miracleCost) return;
  
  // Emit miracle prompt to the player
  const cardName = firstCard.name || "Unknown Card";
  const grantSuffix = sourceName && sourceName !== cardName ? ` via ${sourceName}` : '';
  const cardImageUrl = firstCard.image_uris?.small || firstCard.image_uris?.normal;
  
  debug(2, `[miracle] ${cardName} was drawn as first card this turn - prompting for miracle cost ${miracleCost}`);

  const existing = ResolutionQueueManager
    .getStepsForPlayer(gameId, playerId as any)
    .find((s: any) => (s as any)?.miraclePrompt === true && String((s as any)?.miracleCardId || '') === String(firstCard.id));

  if (!existing) {
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: playerId as any,
      sourceId: String(firstCard.id),
      sourceName: cardName,
      sourceImage: cardImageUrl,
      description: `Miracle${grantSuffix}: You may cast ${cardName} for ${miracleCost || 'its miracle cost'}.`,
      mandatory: false,
      options: [
        { id: 'cast_miracle', label: `Cast for Miracle ${miracleCost ? `(${miracleCost})` : ''}`.trim() },
        { id: 'decline', label: "Don't cast" },
      ],
      minSelections: 1,
      maxSelections: 1,

      miraclePrompt: true,
      miracleCardId: String(firstCard.id),
      miracleCost: miracleCost || '',
      normalCost: firstCard.mana_cost || '',
    } as any);
  }
}

function buildSelectedSpellFace(card: any, face: any, faceIndex: number, extras?: Record<string, unknown>): any {
  const manaCost = face?.mana_cost ?? face?.manaCost ?? card?.mana_cost ?? card?.manaCost;
  return {
    ...card,
    ...(face || {}),
    name: face?.name || card?.name,
    type_line: face?.type_line || face?.typeLine || card?.type_line,
    oracle_text: face?.oracle_text || face?.oracleText || card?.oracle_text,
    mana_cost: manaCost,
    manaCost,
    colors: Array.isArray(face?.colors) ? face.colors : card?.colors,
    image_uris: face?.image_uris || card?.image_uris,
    faceIndex,
    ...(extras || {}),
  };
}

/**
 * Adventure cards: on-adventure exile casts must use the permanent face;
 * Mosswood-style GY permissions must use the Adventure face.
 */
export function resolveAdventureAwareFaceIndex(
  game: any,
  playerId: string,
  card: any,
  castSourceZone: SpellCastSourceZone,
  faceIndex: number | undefined,
): { faceIndex?: number; error?: { code: string; message: string } } {
  if (castSourceZone === 'exile' && isCardOnAdventureForPlayer(card, playerId as PlayerID)) {
    if (typeof faceIndex === 'number' && faceIndex !== 0) {
      return {
        error: {
          code: 'INVALID_FACE_INDEX',
          message: 'While on an adventure, only the permanent half can be cast from exile.',
        },
      };
    }
    return { faceIndex: 0 };
  }

  if (castSourceZone === 'graveyard') {
    const permission = getMatchingGraveyardCastingPermission(game?.state, playerId as PlayerID, card, 'cast');
    if (permission?.castAsAdventureOnly === true) {
      if (typeof faceIndex === 'number' && faceIndex !== 1) {
        return {
          error: {
            code: 'INVALID_FACE_INDEX',
            message: 'You may only cast that card from your graveyard as an Adventure.',
          },
        };
      }
      return { faceIndex: 1 };
    }
  }

  return { faceIndex };
}

export function resolveSelectedSpellCard(card: any, faceIndex?: number): { card: any; faceIndex?: number; castAsAdventure?: boolean } {
  if (!card || typeof card === 'string') {
    return { card, faceIndex };
  }

  const layout = String(card?.layout || '').toLowerCase();
  const cardFaces = Array.isArray(card?.card_faces) ? card.card_faces : [];

  if ((layout === 'transform' || layout === 'double_faced_token') && cardFaces.length >= 1) {
    return {
      card: buildSelectedSpellFace(card, cardFaces[0], 0),
      faceIndex: 0,
    };
  }

  if (layout === 'prepare' && cardFaces.length >= 1) {
    return {
      card: buildSelectedSpellFace(card, cardFaces[0], 0),
      faceIndex: 0,
    };
  }

  if (typeof faceIndex === 'number' && cardFaces[faceIndex]) {
    const castAsAdventure = layout === 'adventure' ? faceIndex === 1 : undefined;
    return {
      card: buildSelectedSpellFace(
        card,
        cardFaces[faceIndex],
        faceIndex,
        castAsAdventure === undefined ? undefined : { castAsAdventure }
      ),
      faceIndex,
      castAsAdventure,
    };
  }

  if (layout === 'adventure' && cardFaces.length >= 1) {
    return {
      card: buildSelectedSpellFace(card, cardFaces[0], 0, { castAsAdventure: false }),
      faceIndex: 0,
      castAsAdventure: false,
    };
  }

  return {
    card,
    faceIndex,
    castAsAdventure: layout === 'adventure' ? false : undefined,
  };
}
