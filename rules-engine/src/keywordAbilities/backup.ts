/**
 * Backup keyword ability (Rule 702.165)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.165. Backup
 * 702.165a Backup is a triggered ability. "Backup N" means "When this creature enters, put N 
 * +1/+1 counters on target creature. If that's another creature, it also gains the non-backup 
 * abilities of this creature printed below this one until end of turn."
 * 702.165b If a permanent enters the battlefield as a copy of a permanent with a backup ability 
 * or a token is created that is a copy of that permanent, the order of abilities printed on it 
 * is maintained.
 * 702.165c Only abilities printed on the object with backup are granted by its backup ability.
 * 702.165d The abilities that a backup ability grants are determined as the ability is put on 
 * the stack. They won't change if the permanent with backup loses any abilities after the ability 
 * is put on the stack but before it resolves.
 */

export interface BackupAbility {
  readonly type: 'backup';
  readonly source: string;
  readonly backupValue: number;
  readonly targetCreature?: string;
  readonly abilitiesToGrant: readonly string[];
}

/**
 * Create a backup ability
 * Rule 702.165a
 * @param source - The creature with backup
 * @param backupValue - Number of +1/+1 counters to put
 * @param abilitiesToGrant - Non-backup abilities printed below backup
 * @returns Backup ability object
 */
export function backup(source: string, backupValue: number, abilitiesToGrant: readonly string[]): BackupAbility {
  return {
    type: 'backup',
    source,
    backupValue,
    abilitiesToGrant,
  };
}

/**
 * Trigger backup when creature enters
 * Rule 702.165a - Put counters, grant abilities if another creature
 * @param ability - Backup ability
 * @param targetCreature - ID of target creature
 * @returns Updated ability
 */
export function triggerBackup(ability: BackupAbility, targetCreature: string): BackupAbility {
  return {
    ...ability,
    targetCreature,
  };
}

/**
 * Check if abilities should be granted
 * Rule 702.165a - Only if target is another creature
 * @param ability - Backup ability
 * @param isSelf - Whether target is self
 * @returns True if should grant abilities
 */
export function shouldGrantAbilities(ability: BackupAbility, isSelf: boolean): boolean {
  return !isSelf;
}

/**
 * Get backup value (counters to put)
 * @param ability - Backup ability
 * @returns Backup value
 */
export function getBackupValue(ability: BackupAbility): number {
  return ability.backupValue;
}

/**
 * Get abilities to grant
 * Rule 702.165c - Only printed abilities
 * @param ability - Backup ability
 * @returns Abilities to grant
 */
export function getBackupAbilities(ability: BackupAbility): readonly string[] {
  return ability.abilitiesToGrant;
}

/**
 * Multiple instances of backup are not redundant
 * @param abilities - Array of backup abilities
 * @returns False
 */
export function hasRedundantBackup(abilities: readonly BackupAbility[]): boolean {
  return false;
}
