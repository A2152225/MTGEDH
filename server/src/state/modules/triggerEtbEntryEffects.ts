import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { persistTriggeredAbilityPush } from './triggerEtbEntryEffects-handlers/triggerEtbPersistTriggeredAbility.js';
import {
  isNamedOrAnotherTypedEtbTrigger,
  isTypedPermanentEtbTrigger,
  matchesRequiredTypePhrase,
  resolveEnteringCreatureDiscoverXValue,
  shouldQueueChosenTypeCreatureEtbTrigger,
  shouldQueueNamedOrAnotherTypedEtbTrigger,
  shouldQueueTypedPermanentEtbTrigger,
  tryBuildTypedPermanentEtbStackItem,
  TYPED_PERMANENT_ETB_REQUIRED_TYPE,
} from './triggerEtbEntryEffects-handlers/triggerEtbTypedPermanentMatch.js';
import { recordBattlefieldEntryTurnTracking } from './triggerEtbEntryEffects-handlers/triggerEtbBattlefieldEntryTracking.js';
import {
  addTemporaryEtbTrigger,
  clearTemporaryEtbTriggers,
  queueTemporaryEtbTriggersForEntry,
} from './triggerEtbEntryEffects-handlers/triggerEtbTemporaryEntryTriggers.js';
import { triggerETBEffectsForToken } from './triggerEtbEntryEffects-handlers/triggerEtbTokenEntryEffects.js';
import { queueSelfETBTriggersForPermanent } from './triggerEtbEntryEffects-handlers/triggerEtbQueueSelfTriggers.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { uid, getActualPowerToughness } from '../utils.js';
import { queueSelfEtbGraveyardTargetPrompt } from './triggerEtbGraveyardTargetPrompt.js';
import { getETBTriggersForPermanent } from './triggered-abilities.js';
import { isFaceUpTriggerType } from './triggerEmissionFamilyUtils.js';
import { isInterveningIfSatisfied } from './triggers/intervening-if.js';
import { orderTriggersByAPNAP } from './triggers/ordering.js';
import { stampPermanentControlEntryForEcho } from './upkeep-triggers.js';
import { permanentHasCreatureTypeNow } from '../creatureTypeNow.js';
import {
  buildInterveningIfSubjectSnapshot,
  buildTriggerSourcePermanentSnapshot,
} from './triggerSourceUtils.js';
import { inferTriggeredAbilityTargetMetadata, isModalChooseModesEffectText } from './inferTriggeredAbilityTargetMetadata.js';
import { handleRoomDoorStateOnEnter } from './triggers/room.js';
import { pushTriggerDoublerCopies } from './triggers/combat.js';
import {
  recordTurnLimitedEtbTriggerQueued,
  shouldSkipTurnLimitedEtbTrigger,
} from './triggerDoThisOnlyOnceEachTurn.js';

export {
  persistTriggeredAbilityPush,
  recordBattlefieldEntryTurnTracking,
  addTemporaryEtbTrigger,
  clearTemporaryEtbTriggers,
  queueTemporaryEtbTriggersForEntry,
  isNamedOrAnotherTypedEtbTrigger,
  isTypedPermanentEtbTrigger,
  matchesRequiredTypePhrase,
  resolveEnteringCreatureDiscoverXValue,
  shouldQueueChosenTypeCreatureEtbTrigger,
  shouldQueueNamedOrAnotherTypedEtbTrigger,
  shouldQueueTypedPermanentEtbTrigger,
  tryBuildTypedPermanentEtbStackItem,
  TYPED_PERMANENT_ETB_REQUIRED_TYPE,
  triggerETBEffectsForToken,
  queueSelfETBTriggersForPermanent,
};






