// server/src/socket/crewGrantedVehicleCrew.ts
// Granted crew (CR 702.122): "Vehicles you control have crew N" (Kotori, Pilot Prodigy-style grants)
// and "Each Vehicle you control has crew N". A Vehicle may use its own crew or any granted crew;
// the cheapest available value is used.
// Public entry symbols: getGrantedVehicleCrewValue, resolveCrewPowerRequirement (re-exported from rules-engine).

export { getGrantedVehicleCrewValue, resolveCrewPowerRequirement } from "../../../rules-engine/src/grantedVehicleCrew.js";
