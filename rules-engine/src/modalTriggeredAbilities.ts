/**
 * modalTriggeredAbilities.ts
 *
 * Support for modal triggered abilities like Black Market Connections.
 */

import type { PlayerID } from '../../shared/src';
import type { EntwineAbilityConfig } from './modalTriggeredAbilitiesModeFactories';
import type {
  CipherEncodedSpell,
  CipherEncodingChoice,
  CipherEncodingTarget,
  CipherRegistry,
} from './modalTriggeredAbilitiesCipher';
import {
  checkCipherTriggers,
  createCipherCastEvent,
  createCipherEncodingChoice,
  createCipherRegistry,
  encodeSpellOntoCreature,
  getEncodedSpells,
  getValidCipherTargets,
  removeEncodedSpells,
  validateCipherEncodingTarget,
} from './modalTriggeredAbilitiesCipher';
import type {
  NinjutsuActivationChoice,
  NinjutsuActivationResult,
  NinjutsuTarget,
} from './modalTriggeredAbilitiesNinjutsu';
import {
  canActivateNinjutsu,
  createNinjutsuActivationChoice,
  getValidNinjutsuTargets,
  processNinjutsuActivation,
  validateNinjutsuTarget,
} from './modalTriggeredAbilitiesNinjutsu';
import {
  applyEntwine as applyEntwineImpl,
  calculateEscalateCost,
  createCommandAbilityModes as createCommandAbilityModesImpl,
  createCrypticCommandModes as createCrypticCommandModesImpl,
  createEntwineAbilityModes as createEntwineAbilityModesImpl,
  createEscalateAbilityModes as createEscalateAbilityModesImpl,
  createKolaghansCommandModes as createKolaghansCommandModesImpl,
  createSpreeAbilityModes as createSpreeAbilityModesImpl,
  createTieredAbilityModes as createTieredAbilityModesImpl,
  validateEntwineSelection as validateEntwineSelectionImpl,
} from './modalTriggeredAbilitiesModeFactories';
import {
  createBlackMarketConnectionsAbility,
  createModalTriggerSelectionEvent,
  extractTargetType,
  getSelectedModeEffects,
  isBlackMarketConnections,
  parseModalTriggeredAbility,
  parseModalTriggerText,
  validateModalTriggerSelection,
  type ModalTriggeredAbility,
  type ModalTriggerMode,
  type ModalTriggerSelection,
  type ParsedModalTrigger,
} from './modalTriggeredAbilitiesCore';

export type {
  ModalTriggeredAbility,
  ModalTriggerMode,
  ModalTriggerSelection,
  ParsedModalTrigger,
} from './modalTriggeredAbilitiesCore';
export {
  parseModalTriggeredAbility,
  parseModalTriggerText,
  createModalTriggerSelectionEvent,
  validateModalTriggerSelection,
  getSelectedModeEffects,
  isBlackMarketConnections,
  createBlackMarketConnectionsAbility,
} from './modalTriggeredAbilitiesCore';

export type {
  CipherEncodedSpell,
  CipherEncodingChoice,
  CipherEncodingTarget,
  CipherRegistry,
} from './modalTriggeredAbilitiesCipher';
export {
  checkCipherTriggers,
  createCipherCastEvent,
  createCipherEncodingChoice,
  createCipherRegistry,
  encodeSpellOntoCreature,
  getEncodedSpells,
  getValidCipherTargets,
  removeEncodedSpells,
  validateCipherEncodingTarget,
} from './modalTriggeredAbilitiesCipher';
export type {
  NinjutsuActivationChoice,
  NinjutsuActivationResult,
  NinjutsuTarget,
} from './modalTriggeredAbilitiesNinjutsu';
export {
  canActivateNinjutsu,
  createNinjutsuActivationChoice,
  getValidNinjutsuTargets,
  processNinjutsuActivation,
  validateNinjutsuTarget,
} from './modalTriggeredAbilitiesNinjutsu';
export type { EntwineAbilityConfig } from './modalTriggeredAbilitiesModeFactories';
export { calculateEscalateCost } from './modalTriggeredAbilitiesModeFactories';

export function createSpreeAbilityModes(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  modes: readonly { text: string; cost: string; effect: string }[]
): ModalTriggeredAbility {
  return createSpreeAbilityModesImpl(
    sourceId,
    sourceName,
    controllerId,
    modes,
    extractTargetType
  );
}

export function createTieredAbilityModes(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  modes: readonly { text: string; cost: string; effect: string }[]
): ModalTriggeredAbility {
  return createTieredAbilityModesImpl(
    sourceId,
    sourceName,
    controllerId,
    modes,
    extractTargetType
  );
}

export function createEscalateAbilityModes(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  modes: readonly { text: string; effect: string }[],
  escalateCost: string
): ModalTriggeredAbility & { escalateCost: string } {
  return createEscalateAbilityModesImpl(
    sourceId,
    sourceName,
    controllerId,
    modes,
    escalateCost,
    extractTargetType
  );
}

export function createCommandAbilityModes(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  modes: readonly { text: string; effect: string }[]
): ModalTriggeredAbility {
  return createCommandAbilityModesImpl(
    sourceId,
    sourceName,
    controllerId,
    modes,
    extractTargetType
  );
}

export function createCrypticCommandModes(
  sourceId: string,
  controllerId: PlayerID
): ModalTriggeredAbility {
  return createCrypticCommandModesImpl(sourceId, controllerId, extractTargetType);
}

export function createKolaghansCommandModes(
  sourceId: string,
  controllerId: PlayerID
): ModalTriggeredAbility {
  return createKolaghansCommandModesImpl(sourceId, controllerId, extractTargetType);
}

export function createEntwineAbilityModes(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  modes: readonly { text: string; effect: string }[],
  entwineCost: string
): EntwineAbilityConfig {
  return createEntwineAbilityModesImpl(
    sourceId,
    sourceName,
    controllerId,
    modes,
    entwineCost,
    extractTargetType
  );
}

export function applyEntwine(
  config: EntwineAbilityConfig
): EntwineAbilityConfig {
  return applyEntwineImpl(config);
}

export function validateEntwineSelection(
  config: EntwineAbilityConfig,
  selectedModeIds: readonly string[],
  isEntwined: boolean
): ModalTriggerSelection {
  return validateEntwineSelectionImpl(config, selectedModeIds, isEntwined);
}

export default {
  parseModalTriggeredAbility,
  parseModalTriggerText,
  createModalTriggerSelectionEvent,
  validateModalTriggerSelection,
  getSelectedModeEffects,
  isBlackMarketConnections,
  createBlackMarketConnectionsAbility,
  createSpreeAbilityModes,
  createTieredAbilityModes,
  createEscalateAbilityModes,
  calculateEscalateCost,
  createCommandAbilityModes,
  createCrypticCommandModes,
  createKolaghansCommandModes,
  createEntwineAbilityModes,
  applyEntwine,
  validateEntwineSelection,
  createCipherRegistry,
  getValidCipherTargets,
  createCipherEncodingChoice,
  validateCipherEncodingTarget,
  encodeSpellOntoCreature,
  getEncodedSpells,
  removeEncodedSpells,
  checkCipherTriggers,
  createCipherCastEvent,
  getValidNinjutsuTargets,
  canActivateNinjutsu,
  createNinjutsuActivationChoice,
  validateNinjutsuTarget,
  processNinjutsuActivation,
};
