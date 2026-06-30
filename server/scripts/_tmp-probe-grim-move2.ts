import { parseMoveZoneTypedCardFromYourGraveyard, moveTargetedCardFromGraveyard } from '../../rules-engine/src/oracleIRExecutorZoneOps.js';
import { buildAuditFixtureState } from './executor-coverage-audit.js';

const criteria = parseMoveZoneTypedCardFromYourGraveyard({ kind: 'raw', text: 'a Pirate card from your graveyard' })!;
const state = buildAuditFixtureState("Grim Captain's Call");
const result = moveTargetedCardFromGraveyard(state, 'p1', 'gy-pirate-1', criteria, 'hand');
console.log(result);
