/**
 * socket/resolutionJoinForcesTemptingZoneChoiceResponseHandlers.ts
 *
 * Thin re-export barrel after the JOIN_FORCES / TEMPTING_OFFER /
 * RETURN_CONTROLLED_PERMANENT_CHOICE / HIDEAWAY_CHOICE / REPEATED_ZONE_DRAFT
 * cluster was split under the ~40KB TypeScript module ceiling.
 *
 * Prefer importing from the descriptive modules directly:
 *   - resolutionJoinForcesTemptingOfferResponseHandlers.ts
 *   - resolutionHideawayZoneDraftPermanentChoiceResponseHandlers.ts
 */

export {
  handleJoinForcesResponse,
  applyJoinForcesEffect,
  handleTemptingOfferResponse,
  applyTemptingOfferEffect,
} from "./resolutionJoinForcesTemptingOfferResponseHandlers.js";

export {
  handleReturnControlledPermanentChoiceResponse,
  handleHideawayChoiceResponse,
  handleRepeatedZoneDraftResponse,
} from "./resolutionHideawayZoneDraftPermanentChoiceResponseHandlers.js";
