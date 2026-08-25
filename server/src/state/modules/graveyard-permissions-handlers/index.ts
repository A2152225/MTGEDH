// server/src/state/modules/graveyard-permissions-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/graveyard-permissions.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/graveyard-permissions.ts.
// Leaves must not import graveyard-permissions.ts or this index.

// Public graveyard-permission interfaces and type aliases.
export type {
  GrantedFlashbackInfo,
  GrantedUnearthInfo,
  GrantedGraveyardKeywordInfo,
  PrintedSelfCastPermissionInfo,
  TemporaryGraveyardKeywordGrant,
  TemporaryPlayableFromGraveyardPermission,
  GraveyardCastingPermissionKind,
  GraveyardCastingPermissionDuration,
  GraveyardCastingPermissionCostMode,
  GraveyardCastingPermissionCardFilter,
  GraveyardCastingPermissionUsageLimit,
  GraveyardCastingPermissionReplacement,
  GraveyardCastingPermissionAdditionalCost,
  GraveyardCastingPermission,
  GraveyardGrantKeyword,
} from "./graveyardPermissionsTypes.js";

// Shared card/text helpers used by graveyard permission matching.
export {
  escapeRegExp,
  getCardId,
  getCardManaValue,
  getCurrentTurn,
  getGenericManaValueCost,
  getManaCost,
  getTypeLine,
  isInstantOrSorcery,
  isLesson,
  isPlayersTurn,
  normalizeText,
  parseSmallNumber,
  sanitizePermissionIdPart,
} from "./graveyardPermissionsCardUtils.js";

// Qualifier matching for graveyard-cast permission card filters.
export { getCardColors, qualifierMatchesCard, splitTypeWordList } from "./graveyardPermissionsQualifierMatch.js";

// Duration and cost-mode normalizers.
export {
  normalizeGraveyardPermissionCostMode,
  normalizeGraveyardPermissionDuration,
} from "./graveyardPermissionsNormalize.js";

// Player graveyard collection lookup and snapshot helpers.
export {
  ensureCardSnapshotInPlayerGraveyard,
  findCardInPlayerGraveyard,
  getPlayerGraveyardCollections,
} from "./graveyardPermissionsZoneAccess.js";

// Mark a specific graveyard card playable this turn and record the permission.
export { markSourceCardPlayableFromGraveyardThisTurn } from "./graveyardPermissionsMarkSourcePlayable.js";

// Temporary play-from-graveyard permission grant.
export {
  addTemporaryPlayableFromGraveyardPermission,
  getTemporaryPlayableFromGraveyardPermissions,
} from "./graveyardPermissionsTemporaryPlayable.js";

// Apply oracle-text play/cast-from-graveyard permissions.
export { applyPlayableFromGraveyardPermissionFromText } from "./graveyardPermissionsPlayableFromText.js";

// Granted-keyword cost and escape-counter extraction.
export {
  extractAdditionalEscapeExileCount,
  extractEscapeEntryCounterCount,
  extractGrantedKeywordCost,
} from "./graveyardPermissionsKeywordCost.js";

// Temporary keyword-grant lookup and target-card selection.
export {
  extractKeywordGrantFromAbilityText,
  findTemporaryGrantedKeywordInfo,
  getGraveyardCardsForTemporaryGrant,
  getTemporaryGraveyardKeywordGrants,
  normalizeGrantKeyword,
} from "./graveyardPermissionsKeywordGrantHelpers.js";

// Strip companion generic GY-cast permission when escape is granted.
export { stripGenericGraveyardCastPermissionForCard } from "./graveyardPermissionsStripGenericCast.js";

// Temporary flashback/unearth/escape-style keyword grant.
export { addTemporaryGraveyardKeywordGrant } from "./graveyardPermissionsTemporaryKeywordGrant.js";

// Apply oracle-text temporary graveyard keyword grants.
export { applyTemporaryGraveyardKeywordGrantFromText } from "./graveyardPermissionsKeywordGrantFromText.js";
