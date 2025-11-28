/**
 * Protection keyword ability implementation
 * Rule 702.16
 * 
 * Protection is a static ability that encompasses several different effects.
 * "Protection from [quality]" prevents damage, enchanting/equipping,
 * blocking, and targeting (DEBT).
 */

/**
 * Protection quality - what the permanent is protected from
 */
export type ProtectionQuality = 
  | { type: 'color'; color: string }
  | { type: 'card_type'; cardType: string }
  | { type: 'quality'; quality: string } // "everything", "players", etc.
  | { type: 'mana_value'; comparison: 'cmc_less_than' | 'cmc_greater_than' | 'cmc_equal'; value: number }
  | { type: 'player'; player: 'opponents' | 'you' };

/**
 * Protection ability
 * Rule 702.16a
 * 
 * Protection from [quality] means:
 * D - Damage from sources with that quality is prevented
 * E - Enchantments/Equipment with that quality can't be attached
 * B - Creatures with that quality can't block this creature
 * T - This permanent can't be targeted by spells/abilities with that quality
 */
export interface ProtectionAbility {
  readonly type: 'protection';
  readonly source: string;
  readonly protectedFrom: ProtectionQuality;
}

/**
 * Result of checking if protection applies
 */
export interface ProtectionCheckResult {
  readonly isProtected: boolean;
  readonly preventsDamage: boolean;
  readonly preventsEnchantEquip: boolean;
  readonly preventsBlock: boolean;
  readonly preventsTargeting: boolean;
  readonly reason?: string;
}

/**
 * Creates a protection ability
 * Rule 702.16a
 * 
 * @param source - The permanent with protection
 * @param protectedFrom - What quality is protected against
 * @returns Protection ability
 */
export function protection(source: string, protectedFrom: ProtectionQuality): ProtectionAbility {
  return {
    type: 'protection',
    source,
    protectedFrom,
  };
}

/**
 * Creates protection from a color
 * 
 * @param source - The permanent with protection
 * @param color - The color protected against (W, U, B, R, G)
 * @returns Protection ability from that color
 */
export function protectionFromColor(source: string, color: string): ProtectionAbility {
  return protection(source, { type: 'color', color });
}

/**
 * Creates protection from everything
 * 
 * @param source - The permanent with protection
 * @returns Protection ability from everything
 */
export function protectionFromEverything(source: string): ProtectionAbility {
  return protection(source, { type: 'quality', quality: 'everything' });
}

/**
 * Creates protection from a card type (e.g., "protection from creatures")
 * 
 * @param source - The permanent with protection
 * @param cardType - The card type protected against
 * @returns Protection ability from that type
 */
export function protectionFromType(source: string, cardType: string): ProtectionAbility {
  return protection(source, { type: 'card_type', cardType });
}

/**
 * Checks if a source has a specific color
 * 
 * @param sourceColors - Colors of the source (as color codes W, U, B, R, G)
 * @param protectedColor - The color being checked
 * @returns Whether the source has that color
 */
function hasColor(sourceColors: readonly string[], protectedColor: string): boolean {
  const colorMap: Record<string, string[]> = {
    'W': ['W', 'white'],
    'U': ['U', 'blue'],
    'B': ['B', 'black'],
    'R': ['R', 'red'],
    'G': ['G', 'green'],
    'white': ['W', 'white'],
    'blue': ['U', 'blue'],
    'black': ['B', 'black'],
    'red': ['R', 'red'],
    'green': ['G', 'green'],
  };
  
  const validColors = colorMap[protectedColor] || [protectedColor];
  return sourceColors.some(c => validColors.includes(c));
}

/**
 * Checks if a source matches a protection quality
 * 
 * @param protectedFrom - The quality being protected against
 * @param sourceInfo - Information about the potential source
 * @returns Whether the source matches the protected quality
 */
export function matchesProtectionQuality(
  protectedFrom: ProtectionQuality,
  sourceInfo: {
    colors?: readonly string[];
    cardTypes?: readonly string[];
    manaValue?: number;
    controllerId?: string;
  }
): boolean {
  switch (protectedFrom.type) {
    case 'color':
      return sourceInfo.colors ? hasColor(sourceInfo.colors, protectedFrom.color) : false;
      
    case 'card_type':
      return sourceInfo.cardTypes?.some(
        t => t.toLowerCase() === protectedFrom.cardType.toLowerCase()
      ) ?? false;
      
    case 'quality':
      // "everything" matches everything
      if (protectedFrom.quality === 'everything') return true;
      // Other qualities would need specific implementation
      return false;
      
    case 'mana_value':
      if (sourceInfo.manaValue === undefined) return false;
      switch (protectedFrom.comparison) {
        case 'cmc_less_than': return sourceInfo.manaValue < protectedFrom.value;
        case 'cmc_greater_than': return sourceInfo.manaValue > protectedFrom.value;
        case 'cmc_equal': return sourceInfo.manaValue === protectedFrom.value;
      }
      return false;
      
    case 'player':
      // Would need the current player context to check
      return false;
  }
}

/**
 * Checks if protection prevents damage from a source
 * Rule 702.16b - "D" in DEBT
 * 
 * @param abilities - Protection abilities on the permanent
 * @param sourceInfo - Information about the damage source
 * @returns Whether damage is prevented
 */
export function preventsFromDamage(
  abilities: readonly ProtectionAbility[],
  sourceInfo: {
    colors?: readonly string[];
    cardTypes?: readonly string[];
    manaValue?: number;
  }
): boolean {
  return abilities.some(ability => 
    matchesProtectionQuality(ability.protectedFrom, sourceInfo)
  );
}

/**
 * Checks if protection prevents enchanting/equipping by a source
 * Rule 702.16b - "E" in DEBT
 * 
 * @param abilities - Protection abilities on the permanent
 * @param auraOrEquipmentInfo - Information about the aura/equipment
 * @returns Whether attaching is prevented
 */
export function preventsFromEnchantEquip(
  abilities: readonly ProtectionAbility[],
  auraOrEquipmentInfo: {
    colors?: readonly string[];
    cardTypes?: readonly string[];
    manaValue?: number;
  }
): boolean {
  return abilities.some(ability => 
    matchesProtectionQuality(ability.protectedFrom, auraOrEquipmentInfo)
  );
}

/**
 * Checks if protection prevents blocking by a creature
 * Rule 702.16b - "B" in DEBT
 * 
 * @param abilities - Protection abilities on the permanent
 * @param blockerInfo - Information about the blocking creature
 * @returns Whether blocking is prevented
 */
export function preventsFromBlocking(
  abilities: readonly ProtectionAbility[],
  blockerInfo: {
    colors?: readonly string[];
    cardTypes?: readonly string[];
    manaValue?: number;
  }
): boolean {
  return abilities.some(ability => 
    matchesProtectionQuality(ability.protectedFrom, blockerInfo)
  );
}

/**
 * Checks if protection prevents targeting by a spell/ability
 * Rule 702.16b - "T" in DEBT
 * 
 * @param abilities - Protection abilities on the permanent
 * @param sourceInfo - Information about the targeting spell/ability
 * @returns Whether targeting is prevented
 */
export function preventsFromTargeting(
  abilities: readonly ProtectionAbility[],
  sourceInfo: {
    colors?: readonly string[];
    cardTypes?: readonly string[];
    manaValue?: number;
  }
): boolean {
  return abilities.some(ability => 
    matchesProtectionQuality(ability.protectedFrom, sourceInfo)
  );
}

/**
 * Full DEBT check for protection
 * Rule 702.16b - Checks all four aspects of protection
 * 
 * @param abilities - Protection abilities on the permanent
 * @param sourceInfo - Information about the source
 * @returns Complete protection check result
 */
export function checkProtection(
  abilities: readonly ProtectionAbility[],
  sourceInfo: {
    colors?: readonly string[];
    cardTypes?: readonly string[];
    manaValue?: number;
    controllerId?: string;
  }
): ProtectionCheckResult {
  const matchingAbilities = abilities.filter(ability =>
    matchesProtectionQuality(ability.protectedFrom, sourceInfo)
  );
  
  const isProtected = matchingAbilities.length > 0;
  
  return {
    isProtected,
    preventsDamage: isProtected,
    preventsEnchantEquip: isProtected,
    preventsBlock: isProtected,
    preventsTargeting: isProtected,
    reason: isProtected 
      ? `Protected from source due to ${describeProtectionQuality(matchingAbilities[0].protectedFrom)}`
      : undefined,
  };
}

/**
 * Describes a protection quality for display
 * 
 * @param quality - The protection quality
 * @returns Human-readable description
 */
export function describeProtectionQuality(quality: ProtectionQuality): string {
  switch (quality.type) {
    case 'color':
      const colorNames: Record<string, string> = {
        'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green'
      };
      return colorNames[quality.color] || quality.color;
    case 'card_type':
      return quality.cardType;
    case 'quality':
      return quality.quality;
    case 'mana_value':
      return `mana value ${quality.comparison.replace('cmc_', '').replace('_', ' ')} ${quality.value}`;
    case 'player':
      return quality.player;
  }
}

/**
 * Parses protection text from oracle text
 * 
 * @param oracleText - The oracle text to parse
 * @param source - The source permanent ID
 * @returns Array of protection abilities found
 */
export function parseProtectionFromText(
  oracleText: string,
  source: string
): ProtectionAbility[] {
  const abilities: ProtectionAbility[] = [];
  const text = oracleText.toLowerCase();
  
  // Protection from colors
  const colorPatterns: [RegExp, string][] = [
    [/protection from white/gi, 'W'],
    [/protection from blue/gi, 'U'],
    [/protection from black/gi, 'B'],
    [/protection from red/gi, 'R'],
    [/protection from green/gi, 'G'],
  ];
  
  for (const [pattern, color] of colorPatterns) {
    if (pattern.test(text)) {
      abilities.push(protectionFromColor(source, color));
    }
  }
  
  // Protection from multicolored
  if (/protection from multicolored/i.test(text)) {
    abilities.push(protection(source, { type: 'quality', quality: 'multicolored' }));
  }
  
  // Protection from monocolored
  if (/protection from monocolored/i.test(text)) {
    abilities.push(protection(source, { type: 'quality', quality: 'monocolored' }));
  }
  
  // Protection from everything
  if (/protection from everything/i.test(text)) {
    abilities.push(protectionFromEverything(source));
  }
  
  // Protection from creatures
  if (/protection from creatures/i.test(text)) {
    abilities.push(protectionFromType(source, 'creature'));
  }
  
  // Protection from artifacts
  if (/protection from artifacts/i.test(text)) {
    abilities.push(protectionFromType(source, 'artifact'));
  }
  
  // Protection from enchantments
  if (/protection from enchantments/i.test(text)) {
    abilities.push(protectionFromType(source, 'enchantment'));
  }
  
  // Protection from instants
  if (/protection from instants/i.test(text)) {
    abilities.push(protectionFromType(source, 'instant'));
  }
  
  // Protection from sorceries
  if (/protection from sorceries/i.test(text)) {
    abilities.push(protectionFromType(source, 'sorcery'));
  }
  
  return abilities;
}

/**
 * Checks if multiple protection abilities are redundant
 * Rule 702.16c - Multiple instances are redundant only if they protect from the same quality
 * 
 * @param abilities - Array of protection abilities
 * @returns True if there are redundant protections
 */
export function hasRedundantProtection(abilities: readonly ProtectionAbility[]): boolean {
  const seen = new Set<string>();
  
  for (const ability of abilities) {
    const key = JSON.stringify(ability.protectedFrom);
    if (seen.has(key)) {
      return true;
    }
    seen.add(key);
  }
  
  return false;
}

/**
 * When an Aura/Equipment with a quality becomes attached, it falls off
 * Rule 702.16d
 * 
 * @param permanentId - The permanent with protection
 * @param abilities - Protection abilities
 * @param attachedPermanents - Auras/Equipment attached to the permanent
 * @returns IDs of permanents that should detach
 */
export function getAttachmentsThatMustDetach(
  permanentId: string,
  abilities: readonly ProtectionAbility[],
  attachedPermanents: readonly {
    id: string;
    colors?: readonly string[];
    cardTypes?: readonly string[];
    manaValue?: number;
  }[]
): string[] {
  return attachedPermanents
    .filter(attached => {
      return abilities.some(ability =>
        matchesProtectionQuality(ability.protectedFrom, attached)
      );
    })
    .map(attached => attached.id);
}
