/**
 * choiceEvents.ts
 *
 * Comprehensive choice event system for MTG Online-style gameplay.
 * This module centralizes all player choice events and their emission.
 *
 * Choice events are emitted when the game engine requires player input
 * for decisions that cannot be automated. The UI layer listens for these
 * events and displays appropriate modals/popups.
 */

import { ChoiceEventType } from './choiceEventsTypes';
import {
  createAttackerDeclarationEvent,
  createBlockerDeclarationEvent,
  createBlockerOrderEvent,
  createColorChoiceEvent,
  createCommanderZoneChoiceEvent,
  createCombatDamageAssignmentEvent,
  createCopyCeasesToExistEvent,
  createCreatureTypeChoiceEvent,
  createDiscardSelectionEvent,
  createMayAbilityEvent,
  createModeSelectionEvent,
  createNumberChoiceEvent,
  createOptionChoiceEvent,
  createPlayerChoiceEvent,
  createReplacementEffectChoiceEvent,
  createTargetSelectionEvent,
  createTokenCeasesToExistEvent,
  createTriggerOrderEvent,
  createWinEffectTriggeredEvent,
  createXValueSelectionEvent,
} from './choiceEventsFactories';

export {
  ChoiceEventType,
  type BaseChoiceEvent,
  type ChoiceEvent,
  type ChoiceEventEmitter,
  type ChoiceOption,
  type ChoiceResponse,
  type AttackerDeclarationEvent,
  type BlockerDeclarationEvent,
  type BlockerOrderEvent,
  type ColorChoiceEvent,
  type CommanderZoneChoiceEvent,
  type CombatDamageAssignmentEvent,
  type CopyCeasesToExistEvent,
  type CreatureTypeChoiceEvent,
  type DiscardSelectionEvent,
  type MayAbilityEvent,
  type ModeSelectionEvent,
  type NumberChoiceEvent,
  type OptionChoiceEvent,
  type PlayerChoiceEvent,
  type ReplacementEffectChoiceEvent,
  type TargetSelectionEvent,
  type TokenCeasesToExistEvent,
  type TriggerOrderEvent,
  type WinEffectTriggeredEvent,
  type XValueSelectionEvent,
} from './choiceEventsTypes';

export {
  createTargetSelectionEvent,
  createModeSelectionEvent,
  createXValueSelectionEvent,
  createAttackerDeclarationEvent,
  createBlockerDeclarationEvent,
  createMayAbilityEvent,
  createCombatDamageAssignmentEvent,
  createBlockerOrderEvent,
  createDiscardSelectionEvent,
  createTokenCeasesToExistEvent,
  createCopyCeasesToExistEvent,
  createCommanderZoneChoiceEvent,
  createTriggerOrderEvent,
  createReplacementEffectChoiceEvent,
  createWinEffectTriggeredEvent,
  createColorChoiceEvent,
  createCreatureTypeChoiceEvent,
  createNumberChoiceEvent,
  createPlayerChoiceEvent,
  createOptionChoiceEvent,
} from './choiceEventsFactories';

export default {
  ChoiceEventType,
  createTargetSelectionEvent,
  createModeSelectionEvent,
  createXValueSelectionEvent,
  createAttackerDeclarationEvent,
  createBlockerDeclarationEvent,
  createMayAbilityEvent,
  createCombatDamageAssignmentEvent,
  createBlockerOrderEvent,
  createDiscardSelectionEvent,
  createTokenCeasesToExistEvent,
  createCopyCeasesToExistEvent,
  createCommanderZoneChoiceEvent,
  createTriggerOrderEvent,
  createReplacementEffectChoiceEvent,
  createWinEffectTriggeredEvent,
  createColorChoiceEvent,
  createCreatureTypeChoiceEvent,
  createNumberChoiceEvent,
  createPlayerChoiceEvent,
  createOptionChoiceEvent,
};
