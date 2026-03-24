import type { PlayerID } from '../../shared/src';
import type {
  ModalTriggeredAbility,
  ModalTriggerSelection,
} from './modalTriggeredAbilities';

type TargetTypeExtractor = (effectText: string) => string | undefined;

export interface EntwineAbilityConfig extends ModalTriggeredAbility {
  readonly entwineCost: string;
  readonly isEntwined: boolean;
}

export function createSpreeAbilityModes(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  modes: readonly { text: string; cost: string; effect: string }[],
  extractTargetType: TargetTypeExtractor
): ModalTriggeredAbility {
  return {
    id: `spree-${sourceId}`,
    sourceId,
    sourceName,
    controllerId,
    triggerCondition: 'When casting',
    modes: modes.map((m, i) => ({
      id: `spree-mode-${i}`,
      text: m.text,
      cost: m.cost,
      effect: m.effect,
      requiresTarget: /target/i.test(m.effect),
      targetType: extractTargetType(m.effect),
    })),
    minModes: 1,
    maxModes: modes.length,
    canRepeatModes: false,
  };
}

export function createTieredAbilityModes(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  modes: readonly { text: string; cost: string; effect: string }[],
  extractTargetType: TargetTypeExtractor
): ModalTriggeredAbility {
  return {
    id: `tiered-${sourceId}`,
    sourceId,
    sourceName,
    controllerId,
    triggerCondition: 'When casting',
    modes: modes.map((m, i) => ({
      id: `tiered-mode-${i}`,
      text: m.text,
      cost: m.cost,
      effect: m.effect,
      requiresTarget: /target/i.test(m.effect),
      targetType: extractTargetType(m.effect),
    })),
    minModes: 1,
    maxModes: 1,
    canRepeatModes: false,
  };
}

export function createEscalateAbilityModes(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  modes: readonly { text: string; effect: string }[],
  escalateCost: string,
  extractTargetType: TargetTypeExtractor
): ModalTriggeredAbility & { escalateCost: string } {
  return {
    id: `escalate-${sourceId}`,
    sourceId,
    sourceName,
    controllerId,
    triggerCondition: 'When casting',
    modes: modes.map((m, i) => ({
      id: `escalate-mode-${i}`,
      text: m.text,
      cost: i > 0 ? escalateCost : undefined,
      effect: m.effect,
      requiresTarget: /target/i.test(m.effect),
      targetType: extractTargetType(m.effect),
    })),
    minModes: 1,
    maxModes: modes.length,
    canRepeatModes: false,
    escalateCost,
  };
}

export function calculateEscalateCost(
  selectedModeCount: number,
  escalateCost: string
): { count: number; totalCost: string } {
  const additionalModes = Math.max(0, selectedModeCount - 1);
  return {
    count: additionalModes,
    totalCost: additionalModes > 0 ? `${additionalModes} × ${escalateCost}` : 'None',
  };
}

export function createCommandAbilityModes(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  modes: readonly { text: string; effect: string }[],
  extractTargetType: TargetTypeExtractor
): ModalTriggeredAbility {
  return {
    id: `command-${sourceId}`,
    sourceId,
    sourceName,
    controllerId,
    triggerCondition: 'When casting',
    modes: modes.map((m, i) => ({
      id: `command-mode-${i}`,
      text: m.text,
      effect: m.effect,
      requiresTarget: /target/i.test(m.effect),
      targetType: extractTargetType(m.effect),
    })),
    minModes: 2,
    maxModes: 2,
    canRepeatModes: false,
  };
}

export function createCrypticCommandModes(
  sourceId: string,
  controllerId: PlayerID,
  extractTargetType: TargetTypeExtractor
): ModalTriggeredAbility {
  return createCommandAbilityModes(sourceId, 'Cryptic Command', controllerId, [
    { text: 'Counter target spell', effect: 'Counter target spell.' },
    { text: 'Return target permanent to its owner\'s hand', effect: 'Return target permanent to its owner\'s hand.' },
    { text: 'Tap all creatures your opponents control', effect: 'Tap all creatures your opponents control.' },
    { text: 'Draw a card', effect: 'Draw a card.' },
  ], extractTargetType);
}

export function createKolaghansCommandModes(
  sourceId: string,
  controllerId: PlayerID,
  extractTargetType: TargetTypeExtractor
): ModalTriggeredAbility {
  return createCommandAbilityModes(sourceId, 'Kolaghan\'s Command', controllerId, [
    { text: 'Return target creature card from your graveyard to your hand', effect: 'Return target creature card from your graveyard to your hand.' },
    { text: 'Target player discards a card', effect: 'Target player discards a card.' },
    { text: 'Destroy target artifact', effect: 'Destroy target artifact.' },
    { text: 'Kolaghan\'s Command deals 2 damage to any target', effect: 'Kolaghan\'s Command deals 2 damage to any target.' },
  ], extractTargetType);
}

export function createEntwineAbilityModes(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  modes: readonly { text: string; effect: string }[],
  entwineCost: string,
  extractTargetType: TargetTypeExtractor
): EntwineAbilityConfig {
  return {
    id: `entwine-${sourceId}`,
    sourceId,
    sourceName,
    controllerId,
    triggerCondition: 'When casting',
    modes: modes.map((m, i) => ({
      id: `entwine-mode-${i}`,
      text: m.text,
      effect: m.effect,
      requiresTarget: /target/i.test(m.effect),
      targetType: extractTargetType(m.effect),
    })),
    minModes: 1,
    maxModes: 1,
    canRepeatModes: false,
    entwineCost,
    isEntwined: false,
  };
}

export function applyEntwine(
  config: EntwineAbilityConfig
): EntwineAbilityConfig {
  return {
    ...config,
    minModes: config.modes.length,
    maxModes: config.modes.length,
    isEntwined: true,
  };
}

export function validateEntwineSelection(
  config: EntwineAbilityConfig,
  selectedModeIds: readonly string[],
  isEntwined: boolean
): ModalTriggerSelection {
  if (isEntwined) {
    const allModeIds = config.modes.map(m => m.id);
    const hasAllModes = allModeIds.every(id => selectedModeIds.includes(id));

    if (!hasAllModes) {
      return {
        abilityId: config.id,
        selectedModeIds,
        totalCost: config.entwineCost,
        isValid: false,
        errors: ['When entwined, all modes must be selected'],
      };
    }

    return {
      abilityId: config.id,
      selectedModeIds,
      totalCost: config.entwineCost,
      isValid: true,
      errors: [],
    };
  }

  return {
    abilityId: config.id,
    selectedModeIds,
    totalCost: 'None',
    isValid: selectedModeIds.length === 1,
    errors: selectedModeIds.length === 1 ? [] : ['Must select exactly one mode'],
  };
}
