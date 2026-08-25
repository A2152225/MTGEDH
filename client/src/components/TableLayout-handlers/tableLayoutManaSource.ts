// Origin parent: client/src/components/TableLayout.tsx
// Cluster moved: isManaSource + stripCreateTokenTypeReminders.
// Public entry symbols: isManaSource.

import type { BattlefieldPermanent } from '../../../../shared/src';
import { stripCreateTokenGrantedAbilities } from '../../../../rules-engine/src/oracleReminderText';

/**
 * Identifies mana sources (mana rocks and mana dorks).
 * Mana rocks: Artifacts that produce mana (e.g., Sol Ring, Mana Crypt, signets)
 * Mana dorks: Creatures that produce mana (e.g., Llanowar Elves, Birds of Paradise)
 */
function stripCreateTokenTypeReminders(oracleText: string): string {
  // Prefer shared create-token strip so Vibranium/Treasure reminders never look like mana abilities.
  return stripCreateTokenGrantedAbilities(String(oracleText || ''));
}

function isManaSource(perm: BattlefieldPermanent): boolean {
  const card = perm.card as any;
  if (!card) return false;
  const typeLine = (card.type_line || '').toLowerCase();
  const name = (card.name || '').toLowerCase();
  const oracleText = stripCreateTokenTypeReminders(card.oracle_text || '').toLowerCase();
  
  // Don't classify lands as mana sources here - they're handled separately
  if (typeLine.includes('land')) return false;
  
  // Common mana rock patterns
  const manaArtifacts = [
    'sol ring', 'mana crypt', 'mana vault', 'grim monolith', 'lotus petal',
    'chrome mox', 'mox diamond', 'mox opal', 'mox amber', 'lion\'s eye diamond',
    'jeweled lotus', 'arcane signet', 'signet', 'talisman', 'fellwar stone',
    'mind stone', 'thought vessel', 'commander\'s sphere', 'gilded lotus',
    'thran dynamo', 'basalt monolith', 'worn powerstone', 'hedron archive',
    'everflowing chalice', 'astral cornucopia', 'coalition relic',
  ];
  
  // Common mana dork patterns
  const manaDorks = [
    'llanowar elves', 'elvish mystic', 'fyndhorn elves', 'birds of paradise',
    'noble hierarch', 'bloom tender', 'priest of titania', 'elvish archdruid',
    'deathrite shaman', 'sylvan caryatid', 'paradise druid', 'incubation druid',
  ];
  
  // Cards that are NOT mana sources even though they mention mana/tokens
  // These create tokens or have triggered abilities, not tap abilities
  const notManaSources = [
    "t'challa",             // Creates Vibranium tokens; reminder text has {T}: Add
    'shuri',                // Creates Vibranium tokens / related
    'skullport merchant',   // Creates treasure on ETB, has sacrifice ability
    'tireless provisioner', // Landfall creates food/treasure tokens
    'feldon of the third path', // Creates token copies, not mana
    'treasure nabber',      // Steals treasures, doesn't produce mana itself
    'dockside extortionist', // ETB creates treasures, not a tap ability
    'smothering tithe',     // Creates treasures on opponent draw
    'pitiless plunderer',   // Creates treasures when creatures die
    'revel in riches',      // Creates treasures when opponents' creatures die
    'goldspan dragon',      // Creates treasures on attack/targeting
    'professional face-breaker', // Creates treasures on combat damage
    'monologue tax',        // Creates treasures when opponent casts 2nd spell
    'ruthless technomancer', // ETB creates treasures
    'storm-kiln artist',    // Creates treasures on casting spells
    'academy manufactor',   // Multiplies food/clue/treasure creation
    'westvale abbey',       // Land that transforms, not a mana source
    'chitterspitter',       // Creates tokens, has activated ability
  ];
  
  // Check if this is in the exclusion list
  for (const excluded of notManaSources) {
    if (name.includes(excluded)) return false;
  }
  
  // Check by name
  for (const pattern of manaArtifacts) {
    if (name.includes(pattern)) return true;
  }
  for (const pattern of manaDorks) {
    if (name.includes(pattern)) return true;
  }
  
  // Check oracle text for mana production abilities (only for artifacts and creatures)
  if ((typeLine.includes('artifact') || typeLine.includes('creature'))) {
    // Look for "{T}: Add" mana ability patterns - the key pattern for mana abilities
    // This must be a direct tap ability, not a triggered or activated ability with other costs
    if (oracleText.match(/\{t\}:\s*add\s*\{/i) || oracleText.match(/\{t\}:\s*add\s+one\s+mana/i)) {
      // Exclude equipment and vehicles
      if (!typeLine.includes('equipment') && !typeLine.includes('vehicle')) {
        // Also exclude if the text mentions "sacrifice" before "add" (e.g., Ashnod's Altar)
        // Those require sacrifice as a cost, making them different from pure mana sources
        if (!oracleText.match(/sacrifice.*:\s*add/i)) {
          return true;
        }
      }
    }
    
    // Specifically check for "{T}, Sacrifice": patterns that add mana
    // These are altar-style cards that sacrifice for mana
    // While technically mana sources, they behave differently
    // Include them only if explicitly tap and sacrifice
    if (oracleText.includes('{t}, sacrifice') && oracleText.match(/:\s*add\s*\{/i)) {
      // Include as mana source - these are like Chromatic Sphere
      if (!typeLine.includes('equipment') && !typeLine.includes('vehicle')) {
        return true;
      }
    }
  }
  
  return false;
}


export { isManaSource };
