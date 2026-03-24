import type { PlayerID } from '../../shared/src';
import { createModeSelectionEvent, type ModeSelectionEvent } from './choiceEvents';

export interface ModalTriggerMode {
  readonly id: string;
  readonly text: string;
  readonly cost?: string;
  readonly effect: string;
  readonly requiresTarget?: boolean;
  readonly targetType?: string;
}

export interface ModalTriggeredAbility {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: PlayerID;
  readonly triggerCondition: string;
  readonly modes: readonly ModalTriggerMode[];
  readonly minModes: number;
  readonly maxModes: number;
  readonly canRepeatModes: boolean;
}

export interface ModalTriggerSelection {
  readonly abilityId: string;
  readonly selectedModeIds: readonly string[];
  readonly totalCost: string;
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

export interface ParsedModalTrigger {
  readonly isModal: boolean;
  readonly triggerCondition?: string;
  readonly modes?: readonly ModalTriggerMode[];
  readonly minModes?: number;
  readonly maxModes?: number;
}

const MAX_MODAL_MODES = 10;
const MODAL_BULLET_TOKEN = '•';
const MODAL_DASH_TOKEN = '—';
const BLACK_MARKET_CONNECTIONS_PATTERN = /at the beginning of your pre-?combat main phase, choose up to three/i;
const MODAL_TRIGGER_PATTERN = /^(at|when|whenever)\s+(.+?),\s+choose\s+(one|two|three|up to one|up to two|up to three|one or more|any number)/i;
const MODE_BULLET_PATTERN = /[•+]\s*(?:([^—•+\n]+?)\s*—\s*)?([^•+\n]+?)(?=\s*[•+]|\n[•+]|$)/gi;

export function parseModalTriggeredAbility(
  oracleText: string,
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID
): ModalTriggeredAbility | null {
  const parsed = parseModalTriggerText(oracleText);

  if (!parsed.isModal || !parsed.modes || !parsed.triggerCondition) {
    return null;
  }

  return {
    id: `modal-trigger-${sourceId}-${Date.now()}`,
    sourceId,
    sourceName,
    controllerId,
    triggerCondition: parsed.triggerCondition,
    modes: parsed.modes,
    minModes: parsed.minModes || 1,
    maxModes: parsed.maxModes || parsed.modes.length,
    canRepeatModes: false,
  };
}

export function parseModalTriggerText(oracleText: string): ParsedModalTrigger {
  const normalizedText = normalizeModalOracleText(oracleText);
  const text = normalizedText.toLowerCase();

  const triggerMatch = text.match(MODAL_TRIGGER_PATTERN);
  if (!triggerMatch) {
    return { isModal: false };
  }

  const triggerCondition = triggerMatch[2].trim();
  const modeCount = triggerMatch[3].toLowerCase();

  let minModes = 1;
  let maxModes = 1;

  switch (modeCount) {
    case 'one':
      minModes = 1;
      maxModes = 1;
      break;
    case 'two':
      minModes = 2;
      maxModes = 2;
      break;
    case 'three':
      minModes = 3;
      maxModes = 3;
      break;
    case 'up to one':
      minModes = 0;
      maxModes = 1;
      break;
    case 'up to two':
      minModes = 0;
      maxModes = 2;
      break;
    case 'up to three':
      minModes = 0;
      maxModes = 3;
      break;
    case 'one or more':
      minModes = 1;
      maxModes = MAX_MODAL_MODES;
      break;
    case 'any number':
      minModes = 0;
      maxModes = MAX_MODAL_MODES;
      break;
  }

  const modes = extractModes(normalizedText);
  if (modes.length === 0) {
    return { isModal: false };
  }

  maxModes = Math.min(maxModes, modes.length);

  return {
    isModal: true,
    triggerCondition,
    modes,
    minModes,
    maxModes,
  };
}

function extractModes(oracleText: string): ModalTriggerMode[] {
  const modes: ModalTriggerMode[] = [];
  MODE_BULLET_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  let modeIndex = 0;

  while ((match = MODE_BULLET_PATTERN.exec(oracleText)) !== null) {
    const modeName = match[1]?.trim();
    const modeEffect = match[2]?.trim();

    if (!modeEffect) continue;

    const lifeCostMatch = modeEffect.match(/you lose (\d+) life/i);
    const cost = lifeCostMatch ? `Pay ${lifeCostMatch[1]} life` : undefined;

    const manaCostMatch = modeName?.match(/\{[WUBRGC0-9]+\}/i);
    const manaCost = manaCostMatch ? manaCostMatch[0] : undefined;

    modes.push({
      id: `mode-${modeIndex}`,
      text: modeName || `${modeEffect.substring(0, 30)}...`,
      cost: manaCost || cost,
      effect: modeEffect,
      requiresTarget: /target/i.test(modeEffect),
      targetType: extractTargetType(modeEffect),
    });

    modeIndex++;
  }

  return modes;
}

function normalizeModalOracleText(oracleText: string): string {
  return oracleText
    .replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢|Ã¢â‚¬Â¢|â€¢/g, MODAL_BULLET_TOKEN)
    .replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â|Ã¢â‚¬â€|â€”/g, MODAL_DASH_TOKEN);
}

export function extractTargetType(effectText: string): string | undefined {
  const targetMatch = effectText.match(/target\s+(\w+)/i);
  return targetMatch ? targetMatch[1] : undefined;
}

export function createModalTriggerSelectionEvent(
  ability: ModalTriggeredAbility,
  sourceImage?: string
): ModeSelectionEvent {
  return createModeSelectionEvent(
    ability.controllerId,
    ability.sourceId,
    ability.sourceName,
    ability.modes.map(m => ({
      id: m.id,
      text: m.cost ? `${m.text} (${m.cost})` : m.text,
    })),
    ability.minModes,
    ability.maxModes,
    sourceImage
  );
}

export function validateModalTriggerSelection(
  ability: ModalTriggeredAbility,
  selectedModeIds: readonly string[]
): ModalTriggerSelection {
  const errors: string[] = [];

  if (selectedModeIds.length < ability.minModes) {
    errors.push(`Must choose at least ${ability.minModes} mode(s)`);
  }

  if (selectedModeIds.length > ability.maxModes) {
    errors.push(`Can choose at most ${ability.maxModes} mode(s)`);
  }

  const validModeIds = new Set(ability.modes.map(m => m.id));
  for (const id of selectedModeIds) {
    if (!validModeIds.has(id)) {
      errors.push(`Invalid mode: ${id}`);
    }
  }

  if (!ability.canRepeatModes) {
    const seen = new Set<string>();
    for (const id of selectedModeIds) {
      if (seen.has(id)) {
        errors.push('Cannot choose the same mode twice');
      }
      seen.add(id);
    }
  }

  const selectedModes = selectedModeIds
    .map(id => ability.modes.find(m => m.id === id))
    .filter((m): m is ModalTriggerMode => m !== undefined);

  const costs = selectedModes.filter(m => m.cost).map(m => m.cost!);
  const totalCost = costs.length > 0 ? costs.join(', ') : 'None';

  return {
    abilityId: ability.id,
    selectedModeIds,
    totalCost,
    isValid: errors.length === 0,
    errors,
  };
}

export function getSelectedModeEffects(
  ability: ModalTriggeredAbility,
  selectedModeIds: readonly string[]
): readonly ModalTriggerMode[] {
  return selectedModeIds
    .map(id => ability.modes.find(m => m.id === id))
    .filter((m): m is ModalTriggerMode => m !== undefined);
}

export function isBlackMarketConnections(oracleText: string): boolean {
  return BLACK_MARKET_CONNECTIONS_PATTERN.test(normalizeModalOracleText(oracleText));
}

export function createBlackMarketConnectionsAbility(
  sourceId: string,
  controllerId: PlayerID
): ModalTriggeredAbility {
  return {
    id: `modal-trigger-${sourceId}-bmc`,
    sourceId,
    sourceName: 'Black Market Connections',
    controllerId,
    triggerCondition: 'At the beginning of your precombat main phase',
    modes: [
      {
        id: 'sell-contraband',
        text: 'Sell Contraband',
        cost: 'Pay 1 life',
        effect: 'You lose 1 life. Create a Treasure token.',
        requiresTarget: false,
      },
      {
        id: 'buy-information',
        text: 'Buy Information',
        cost: 'Pay 2 life',
        effect: 'You lose 2 life. Draw a card.',
        requiresTarget: false,
      },
      {
        id: 'hire-mercenary',
        text: 'Hire a Mercenary',
        cost: 'Pay 3 life',
        effect: 'You lose 3 life. Create a 3/2 colorless Shapeshifter creature token with changeling.',
        requiresTarget: false,
      },
    ],
    minModes: 0,
    maxModes: 3,
    canRepeatModes: false,
  };
}
