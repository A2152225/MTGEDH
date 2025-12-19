/**
 * Station Card Parser
 * 
 * Parses oracle text for Station cards to extract threshold-gated abilities.
 * 
 * Station cards have abilities organized by charge counter thresholds:
 * - Station ability itself (always available)
 * - N+ sections that activate at specific counter thresholds
 * 
 * Format:
 * Station (...)
 * 
 * N+ | Ability text
 * 
 * Additional ability text (still part of N+ threshold)
 * 
 * M+ | Different ability
 * 
 * More ability text (part of M+ threshold)
 */

export interface ParsedStationAbility {
  threshold: number;  // Charge counter threshold (0 = always available)
  abilities: string[]; // List of ability texts at this threshold
}

/**
 * Parse Station card oracle text to extract threshold-gated abilities
 * 
 * Rules:
 * 1. Abilities before any "N+ |" marker are always available (threshold 0)
 * 2. Abilities after "N+ |" belong to that threshold until next "M+ |"
 * 3. Multiple lines after a threshold marker belong to that threshold
 * 
 * @param oracleText - The card's oracle text
 * @returns Array of parsed station abilities sorted by threshold
 */
export function parseStationAbilities(oracleText: string): ParsedStationAbility[] {
  if (!oracleText) return [];
  
  const lines = oracleText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const abilities: ParsedStationAbility[] = [];
  
  let currentThreshold = 0;
  let currentAbilities: string[] = [];
  
  for (const line of lines) {
    // Check for threshold marker: "N+ |"
    const thresholdMatch = line.match(/^(\d+)\+\s*\|\s*(.+)$/);
    
    if (thresholdMatch) {
      // Save previous threshold abilities if any
      if (currentAbilities.length > 0) {
        abilities.push({
          threshold: currentThreshold,
          abilities: [...currentAbilities],
        });
        currentAbilities = [];
      }
      
      // Start new threshold
      currentThreshold = parseInt(thresholdMatch[1], 10);
      const abilityText = thresholdMatch[2].trim();
      if (abilityText) {
        currentAbilities.push(abilityText);
      }
    } else {
      // Not a threshold marker
      // Skip the Station reminder text line
      if (line.toLowerCase().includes('station') && line.includes('(') && line.includes(')')) {
        continue;
      }
      
      // Skip power/toughness line
      if (/^\d+\/\d+$/.test(line)) {
        continue;
      }
      
      // Add to current threshold's abilities
      currentAbilities.push(line);
    }
  }
  
  // Save final threshold abilities
  if (currentAbilities.length > 0) {
    abilities.push({
      threshold: currentThreshold,
      abilities: [...currentAbilities],
    });
  }
  
  // Sort by threshold
  return abilities.sort((a, b) => a.threshold - b.threshold);
}

/**
 * Get active abilities for a Station card based on current charge counters
 * 
 * @param chargeCounters - Current number of charge counters on the permanent
 * @param parsedAbilities - Parsed station abilities from oracle text
 * @returns Array of ability texts that are currently active
 */
export function getActiveStationAbilities(
  chargeCounters: number,
  parsedAbilities: ParsedStationAbility[]
): string[] {
  const activeAbilities: string[] = [];
  
  for (const stationAbility of parsedAbilities) {
    if (chargeCounters >= stationAbility.threshold) {
      activeAbilities.push(...stationAbility.abilities);
    }
  }
  
  return activeAbilities;
}

/**
 * Check if a Station card has a specific ability active at current charge counters
 * 
 * @param chargeCounters - Current charge counters
 * @param parsedAbilities - Parsed station abilities
 * @param searchText - Text to search for in abilities (case insensitive)
 * @returns true if the ability is active
 */
export function hasActiveStationAbility(
  chargeCounters: number,
  parsedAbilities: ParsedStationAbility[],
  searchText: string
): boolean {
  const activeAbilities = getActiveStationAbilities(chargeCounters, parsedAbilities);
  const lowerSearch = searchText.toLowerCase();
  return activeAbilities.some(ability => ability.toLowerCase().includes(lowerSearch));
}

/**
 * Get minimum threshold required for a specific ability
 * 
 * @param parsedAbilities - Parsed station abilities
 * @param searchText - Text to search for in abilities
 * @returns Minimum charge counters needed, or null if ability not found
 */
export function getRequiredThresholdForAbility(
  parsedAbilities: ParsedStationAbility[],
  searchText: string
): number | null {
  const lowerSearch = searchText.toLowerCase();
  
  for (const stationAbility of parsedAbilities) {
    if (stationAbility.abilities.some(ability => ability.toLowerCase().includes(lowerSearch))) {
      return stationAbility.threshold;
    }
  }
  
  return null;
}

/**
 * Check if Station card is a creature at current charge counters
 * 
 * Most Station cards become creatures at a specific threshold (usually stated in reminder text)
 * "It's an artifact creature at N+."
 * 
 * @param chargeCounters - Current charge counters
 * @param oracleText - Card's oracle text
 * @returns true if it's currently a creature
 */
export function isStationCreature(chargeCounters: number, oracleText: string): boolean {
  // Parse creature threshold from reminder text
  // Pattern: "It's an artifact creature at N+."
  const creatureMatch = oracleText.match(/it's an? (?:artifact )?creature at (\d+)\+/i);
  if (creatureMatch) {
    const threshold = parseInt(creatureMatch[1], 10);
    return chargeCounters >= threshold;
  }
  
  return false;
}
