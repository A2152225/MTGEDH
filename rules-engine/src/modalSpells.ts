/**
 * Modal Spell Support
 * Rule 700.2
 * 
 * Modal spells and abilities have multiple modes to choose from during casting.
 * This module provides support for mode selection, validation, and resolution.
 */

/**
 * A single mode option for a modal spell or ability
 */
export interface Mode {
  readonly id: string;
  readonly text: string;
  readonly targets?: readonly {
    readonly type: string;
    readonly description: string;
    readonly required: boolean;
  }[];
  readonly cost?: string; // Additional cost for this mode (e.g., with escalate)
}

/**
 * Modal spell or ability configuration
 * Rule 700.2a - Modal effects list modes using bullet points
 */
export interface ModalConfiguration {
  readonly id: string;
  readonly sourceId: string;
  readonly modes: readonly Mode[];
  readonly minModes: number; // "Choose one" = 1, "Choose two" = 2
  readonly maxModes: number; // "Choose one or more" = modes.length
  readonly canRepeatModes: boolean; // Some effects allow choosing the same mode multiple times
  readonly requiresDifferentTargets: boolean; // Some modes require different targets if chosen multiple times
  readonly escalateCost?: string; // Escalate allows choosing more modes for additional cost
  readonly spreeCost?: string; // Spree requires paying for each mode
}

/**
 * Mode selection result
 */
export interface ModeSelection {
  readonly configId: string;
  readonly selectedModeIds: readonly string[];
  readonly selectedModeCount: number;
  readonly isValid: boolean;
  readonly validationErrors: readonly string[];
  readonly additionalCostToPay?: string;
}

/**
 * Creates a modal configuration
 * Rule 700.2
 * 
 * @param sourceId - The spell/ability source ID
 * @param modes - Available modes
 * @param minModes - Minimum modes to choose (default 1)
 * @param maxModes - Maximum modes to choose (default 1)
 * @param options - Additional options
 * @returns Modal configuration
 */
export function createModalConfiguration(
  sourceId: string,
  modes: readonly Mode[],
  minModes: number = 1,
  maxModes: number = 1,
  options: {
    canRepeatModes?: boolean;
    requiresDifferentTargets?: boolean;
    escalateCost?: string;
    spreeCost?: string;
  } = {}
): ModalConfiguration {
  return {
    id: `modal-${sourceId}-${Date.now()}`,
    sourceId,
    modes,
    minModes,
    maxModes,
    canRepeatModes: options.canRepeatModes ?? false,
    requiresDifferentTargets: options.requiresDifferentTargets ?? false,
    escalateCost: options.escalateCost,
    spreeCost: options.spreeCost,
  };
}

/**
 * Creates a "Choose one" modal configuration
 * Rule 700.2a - The most common modal format
 * 
 * @param sourceId - Source ID
 * @param modes - Available modes
 * @returns Modal configuration for choosing exactly one mode
 */
export function createChooseOneModal(
  sourceId: string,
  modes: readonly Mode[]
): ModalConfiguration {
  return createModalConfiguration(sourceId, modes, 1, 1);
}

/**
 * Creates a "Choose two" modal configuration
 * 
 * @param sourceId - Source ID
 * @param modes - Available modes
 * @param canRepeat - Whether the same mode can be chosen twice
 * @returns Modal configuration for choosing exactly two modes
 */
export function createChooseTwoModal(
  sourceId: string,
  modes: readonly Mode[],
  canRepeat: boolean = false
): ModalConfiguration {
  return createModalConfiguration(sourceId, modes, 2, 2, { canRepeatModes: canRepeat });
}

/**
 * Creates a "Choose one or more" modal configuration
 * 
 * @param sourceId - Source ID
 * @param modes - Available modes
 * @returns Modal configuration for choosing one or more modes
 */
export function createChooseOneOrMoreModal(
  sourceId: string,
  modes: readonly Mode[]
): ModalConfiguration {
  return createModalConfiguration(sourceId, modes, 1, modes.length);
}

/**
 * Creates a "Choose any number" modal configuration
 * 
 * @param sourceId - Source ID
 * @param modes - Available modes
 * @returns Modal configuration for choosing any number (including zero)
 */
export function createChooseAnyNumberModal(
  sourceId: string,
  modes: readonly Mode[]
): ModalConfiguration {
  return createModalConfiguration(sourceId, modes, 0, modes.length);
}

/**
 * Creates an escalate modal configuration
 * Rule 702.120 - Escalate allows choosing more modes for additional cost
 * 
 * @param sourceId - Source ID
 * @param modes - Available modes
 * @param escalateCost - Cost per additional mode
 * @returns Modal configuration with escalate
 */
export function createEscalateModal(
  sourceId: string,
  modes: readonly Mode[],
  escalateCost: string
): ModalConfiguration {
  return createModalConfiguration(sourceId, modes, 1, modes.length, {
    escalateCost,
  });
}

/**
 * Creates a spree modal configuration
 * Rule 702.172 - Spree requires paying for each mode chosen
 * 
 * @param sourceId - Source ID
 * @param modes - Available modes with their costs
 * @returns Modal configuration with spree
 */
export function createSpreeModal(
  sourceId: string,
  modes: readonly Mode[]
): ModalConfiguration {
  return createModalConfiguration(sourceId, modes, 1, modes.length, {
    spreeCost: 'per_mode',
  });
}

/**
 * Validates mode selection
 * Rule 700.2b - Player must choose modes as part of casting/activating
 * 
 * @param config - Modal configuration
 * @param selectedModeIds - IDs of selected modes
 * @returns Validation result
 */
export function validateModeSelection(
  config: ModalConfiguration,
  selectedModeIds: readonly string[]
): ModeSelection {
  const errors: string[] = [];
  
  // Check mode count
  if (selectedModeIds.length < config.minModes) {
    errors.push(`Must choose at least ${config.minModes} mode(s), but only ${selectedModeIds.length} selected`);
  }
  
  if (selectedModeIds.length > config.maxModes) {
    errors.push(`Can choose at most ${config.maxModes} mode(s), but ${selectedModeIds.length} selected`);
  }
  
  // Check that all selected modes exist
  const validModeIds = new Set(config.modes.map(m => m.id));
  for (const id of selectedModeIds) {
    if (!validModeIds.has(id)) {
      errors.push(`Mode '${id}' is not a valid mode`);
    }
  }
  
  // Check for duplicate modes if not allowed
  if (!config.canRepeatModes) {
    const seen = new Set<string>();
    for (const id of selectedModeIds) {
      if (seen.has(id)) {
        errors.push(`Cannot choose the same mode '${id}' more than once`);
      }
      seen.add(id);
    }
  }
  
  // Calculate additional cost for escalate
  let additionalCost: string | undefined;
  if (config.escalateCost && selectedModeIds.length > 1) {
    const extraModes = selectedModeIds.length - 1;
    additionalCost = `${extraModes} x (${config.escalateCost})`;
  }
  
  // Calculate cost for spree
  if (config.spreeCost) {
    const modesWithCosts = selectedModeIds
      .map(id => config.modes.find(m => m.id === id))
      .filter((m): m is Mode => m !== undefined && m.cost !== undefined);
    
    if (modesWithCosts.length > 0) {
      additionalCost = modesWithCosts.map(m => m.cost).join(' + ');
    }
  }
  
  return {
    configId: config.id,
    selectedModeIds,
    selectedModeCount: selectedModeIds.length,
    isValid: errors.length === 0,
    validationErrors: errors,
    additionalCostToPay: additionalCost,
  };
}

/**
 * Selects modes for a modal spell or ability
 * Rule 700.2b - Mode selection is part of casting/activating
 * 
 * @param config - Modal configuration
 * @param modeIds - IDs of modes to select
 * @returns Mode selection result
 */
export function selectModes(
  config: ModalConfiguration,
  modeIds: readonly string[]
): ModeSelection {
  return validateModeSelection(config, modeIds);
}

/**
 * Gets the selected modes for resolution
 * Rule 700.2c - Selected modes are locked in when spell/ability is put on stack
 * 
 * @param config - Modal configuration
 * @param selection - Mode selection
 * @returns The selected mode objects in order
 */
export function getSelectedModes(
  config: ModalConfiguration,
  selection: ModeSelection
): Mode[] {
  return selection.selectedModeIds
    .map(id => config.modes.find(m => m.id === id))
    .filter((m): m is Mode => m !== undefined);
}

/**
 * Gets targets required for selected modes
 * Rule 601.2c - Targets are chosen after modes
 * 
 * @param config - Modal configuration
 * @param selection - Mode selection
 * @returns All targets required for the selected modes
 */
export function getRequiredTargets(
  config: ModalConfiguration,
  selection: ModeSelection
): Array<{
  modeId: string;
  targetType: string;
  description: string;
  required: boolean;
}> {
  const targets: Array<{
    modeId: string;
    targetType: string;
    description: string;
    required: boolean;
  }> = [];
  
  for (const modeId of selection.selectedModeIds) {
    const mode = config.modes.find(m => m.id === modeId);
    if (mode?.targets) {
      for (const target of mode.targets) {
        targets.push({
          modeId,
          targetType: target.type,
          description: target.description,
          required: target.required,
        });
      }
    }
  }
  
  return targets;
}

/**
 * Parses modal text from oracle text
 * Rule 700.2a - Modes are listed with bullet points
 * 
 * @param oracleText - Oracle text of the card
 * @param sourceId - Source ID
 * @returns Modal configuration if card is modal, undefined otherwise
 */
export function parseModalFromText(
  oracleText: string,
  sourceId: string
): ModalConfiguration | undefined {
  const text = oracleText.toLowerCase();
  
  // Check for modal indicators
  const chooseOneMatch = text.match(/choose one\s*[—-]/i);
  const chooseTwoMatch = text.match(/choose two\s*[—-]/i);
  const chooseThreeMatch = text.match(/choose three\s*[—-]/i);
  const chooseOneOrMoreMatch = text.match(/choose one or more\s*[—-]/i);
  const chooseAnyNumberMatch = text.match(/choose any number\s*[—-]/i);
  const chooseTwoYouMayMatch = text.match(/choose two\.\s*you may choose the same mode more than once/i);
  
  if (!chooseOneMatch && !chooseTwoMatch && !chooseThreeMatch && 
      !chooseOneOrMoreMatch && !chooseAnyNumberMatch && !chooseTwoYouMayMatch) {
    return undefined;
  }
  
  // Extract modes (bullet points typically use • or -)
  const modePattern = /[•\-]\s*([^•\-]+?)(?=[•\-]|$)/gi;
  const modes: Mode[] = [];
  let match;
  let modeIndex = 0;
  
  while ((match = modePattern.exec(oracleText)) !== null) {
    const modeText = match[1].trim();
    if (modeText.length > 0) {
      // Check for targets in mode text
      const hasTarget = modeText.toLowerCase().includes('target');
      const targets = hasTarget ? [{
        type: 'any',
        description: extractTargetDescription(modeText),
        required: true,
      }] : undefined;
      
      modes.push({
        id: `mode-${modeIndex}`,
        text: modeText,
        targets,
      });
      modeIndex++;
    }
  }
  
  if (modes.length === 0) {
    return undefined;
  }
  
  // Determine mode count requirements
  let minModes = 1;
  let maxModes = 1;
  let canRepeat = false;
  
  if (chooseTwoMatch) {
    minModes = 2;
    maxModes = 2;
  } else if (chooseThreeMatch) {
    minModes = 3;
    maxModes = 3;
  } else if (chooseOneOrMoreMatch) {
    minModes = 1;
    maxModes = modes.length;
  } else if (chooseAnyNumberMatch) {
    minModes = 0;
    maxModes = modes.length;
  } else if (chooseTwoYouMayMatch) {
    minModes = 2;
    maxModes = 2;
    canRepeat = true;
  }
  
  // Check for escalate
  const escalateMatch = text.match(/escalate\s*\{([^}]+)\}/i);
  const escalateCost = escalateMatch ? `{${escalateMatch[1]}}` : undefined;
  
  if (escalateCost) {
    maxModes = modes.length;
  }
  
  return createModalConfiguration(sourceId, modes, minModes, maxModes, {
    canRepeatModes: canRepeat,
    escalateCost,
  });
}

/**
 * Extracts target description from mode text
 * 
 * @param modeText - The mode text
 * @returns Target description
 */
function extractTargetDescription(modeText: string): string {
  const targetMatch = modeText.match(/target\s+([^.]+)/i);
  return targetMatch ? targetMatch[1].trim() : 'target';
}

/**
 * Checks if a spell or ability is modal
 * 
 * @param oracleText - Oracle text
 * @returns Whether the spell is modal
 */
export function isModal(oracleText: string): boolean {
  const text = oracleText.toLowerCase();
  return /choose (one|two|three|one or more|any number)/i.test(text);
}
