import { parseMoveZoneTypedCardFromYourGraveyard, cardMatchesMoveZoneSingleTargetCriteria } from '../../rules-engine/src/oracleIRExecutorZoneOps.js';
import { buildAuditFixtureState } from './executor-coverage-audit.js';

const criteria = parseMoveZoneTypedCardFromYourGraveyard({ kind: 'raw', text: 'a Pirate card from your graveyard' });
const state = buildAuditFixtureState("Grim Captain's Call");
const pirate = state.players[0].graveyard.find((c: any) => c.id === 'gy-pirate-1');
console.log('criteria', criteria);
console.log('match', cardMatchesMoveZoneSingleTargetCriteria(pirate, criteria!));
