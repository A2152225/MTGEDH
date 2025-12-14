import type { GameState, BattlefieldPermanent } from '../../../shared/src';

/**
 * Parse power/toughness value from string or number
 * Handles: "2", "3", "*", "1+*", etc.
 * Returns undefined for * or complex values
 */
function parsePT(raw?: string | number): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number') return raw;
  const s = String(raw).trim();
  if (s === '*' || s.includes('*')) return undefined;
  const n = parseInt(s, 10);
  return isNaN(n) ? undefined : n;
}

// Engine effects (counter updates computed by SBA)
export type EngineCounterUpdate = {
  readonly permanentId: string;
  readonly counters: Readonly<Record<string, number>>;
};

export type EngineSBAResult = {
  readonly counterUpdates: readonly EngineCounterUpdate[];
  readonly destroys: readonly string[];
};

// Normalize counters: positives only; +1/+1 and -1/-1 cancel pairwise
function normalizeCounters(input?: Readonly<Record<string, number>>): Record<string, number> {
  if (!input) return {};
  const out: Record<string, number> = {};
  for (const [k, vRaw] of Object.entries(input)) {
    const v = Math.floor(Number(vRaw) || 0);
    if (v > 0) out[k] = v;
  }
  const plus = out['+1/+1'] ?? 0;
  const minus = out['-1/-1'] ?? 0;
  if (plus > 0 && minus > 0) {
    const cancel = Math.min(plus, minus);
    const pRem = plus - cancel;
    const mRem = minus - cancel;
    if (pRem > 0) out['+1/+1'] = pRem; else delete out['+1/+1'];
    if (mRem > 0) out['-1/-1'] = mRem; else delete out['-1/-1'];
  }
  return out;
}

function countersEqual(a?: Readonly<Record<string, number>>, b?: Readonly<Record<string, number>>): boolean {
  const ak = a ? Object.keys(a) : [];
  const bk = b ? Object.keys(b) : [];
  if (ak.length !== bk.length) return false;
  for (const k of ak) if ((a?.[k] ?? 0) !== (b?.[k] ?? 0)) return false;
  return true;
}

function isNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function derivedToughness(perm: BattlefieldPermanent): number | undefined {
  // First check if it's a creature by type line
  const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) return undefined;
  
  // Get base toughness - first try baseToughness property, then parse from card data
  let baseToughness: number | undefined;
  if (isNumber(perm.baseToughness)) {
    baseToughness = perm.baseToughness;
  } else {
    // Parse from card toughness (e.g., "2" or "1+*" or "*")
    const cardToughness = (perm.card as any)?.toughness;
    if (cardToughness !== undefined && cardToughness !== null) {
      const parsed = parseInt(String(cardToughness), 10);
      if (isNumber(parsed)) {
        baseToughness = parsed;
      }
    }
  }
  
  // If we still don't have a valid toughness, return undefined (non-creature or invalid data)
  if (!isNumber(baseToughness)) return undefined;
  
  const plus = perm.counters?.['+1/+1'] ?? 0;
  const minus = perm.counters?.['-1/-1'] ?? 0;
  const net = plus - minus;
  const totalToughness = baseToughness + net;
  // Damage reduces effective toughness for SBA purposes
  // Check 'damage', 'markedDamage', and 'damageMarked' for all damage tracking patterns
  // - 'damage' is used by spell effects (Lightning Bolt, etc.)
  // - 'markedDamage' is used by combat damage
  // - 'damageMarked' is used by triggered ability damage
  const damage = (perm as any).damage ?? (perm as any).markedDamage ?? (perm as any).damageMarked ?? 0;
  return totalToughness - damage;
}

/**
 * Check if a permanent has the indestructible ability
 * Rule 702.12: A permanent with indestructible can't be destroyed.
 */
function hasIndestructible(perm: BattlefieldPermanent): boolean {
  const oracleText = ((perm.card as any)?.oracle_text || '').toLowerCase();
  const grantedAbilities = (perm as any).grantedAbilities || [];
  const keywords = (perm.card as any)?.keywords || [];
  
  // Check oracle text
  if (oracleText.includes('indestructible')) {
    return true;
  }
  
  // Check granted abilities
  for (const ability of grantedAbilities) {
    if (typeof ability === 'string' && ability.toLowerCase().includes('indestructible')) {
      return true;
    }
  }
  
  // Check Scryfall keywords
  for (const keyword of keywords) {
    if (typeof keyword === 'string' && keyword.toLowerCase() === 'indestructible') {
      return true;
    }
  }
  
  // Check for equipment that grants indestructible (e.g., Darksteel Plate)
  const attachedEquipment = (perm as any).attachedEquipment || [];
  const attachments = (perm as any).attachments || [];
  const allAttachments = [...attachedEquipment, ...attachments];
  
  // We need to check the battlefield for these attachments
  // This will be done in the main function where we have access to state
  
  return false;
}

/**
 * Check if any attached permanents grant indestructible
 * Used for Equipment like Darksteel Plate
 */
function attachmentGrantsIndestructible(
  state: Readonly<GameState>, 
  perm: BattlefieldPermanent
): boolean {
  const attachedEquipment = (perm as any).attachedEquipment || [];
  const attachments = (perm as any).attachments || [];
  const allAttachments = [...attachedEquipment, ...attachments];
  
  for (const attachId of allAttachments) {
    const attachment = (state.battlefield as readonly BattlefieldPermanent[]).find(
      p => p.id === attachId
    );
    if (attachment) {
      const attachOracleText = ((attachment.card as any)?.oracle_text || '').toLowerCase();
      // Pattern: "Equipped creature has indestructible" or "Equipped creature is indestructible"
      if (attachOracleText.includes('equipped creature') && 
          (attachOracleText.includes('has indestructible') || 
           attachOracleText.includes('is indestructible') ||
           attachOracleText.includes('indestructible'))) {
        return true;
      }
    }
  }
  
  return false;
}

// Pure SBA pass
export function applyStateBasedActions(state: Readonly<GameState>): EngineSBAResult {
  const updates: EngineCounterUpdate[] = [];

  for (const perm of state.battlefield as readonly BattlefieldPermanent[]) {
    const normalized = normalizeCounters(perm.counters);
    if (!countersEqual(perm.counters, normalized)) {
      updates.push({ permanentId: perm.id, counters: normalized });
    }
  }

  const destroys: string[] = [];
  
  // CR 704.5m: If an Aura is attached to an illegal object or player,
  // or is not attached to an object or player, that Aura is put into
  // its owner's graveyard.
  // CR 704.5n: If an Aura is on the battlefield and isn't enchanting
  // an object or player, that Aura is put into its owner's graveyard.
  for (const perm of state.battlefield as readonly BattlefieldPermanent[]) {
    const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
    const isAura = typeLine.includes('enchantment') && typeLine.includes('aura');
    
    if (isAura) {
      // Check if the aura is an enchantment creature (Bestow, Reconfigure, etc.)
      // These can exist on the battlefield without being attached
      const isEnchantmentCreature = typeLine.includes('creature');
      
      // If it's NOT an enchantment creature and has no attachedTo, destroy it
      if (!isEnchantmentCreature && !(perm as any).attachedTo) {
        destroys.push(perm.id);
      }
      // If it IS attached, verify the target still exists
      else if ((perm as any).attachedTo && !isEnchantmentCreature) {
        const targetExists = (state.battlefield as readonly BattlefieldPermanent[])
          .some(p => p.id === (perm as any).attachedTo);
        if (!targetExists) {
          destroys.push(perm.id);
        }
      }
      // Note: Enchantment creatures (bestow/reconfigure) are handled in runSBA
      // before applyStateBasedActions is called, so they get their stats restored
      // before the toughness check below
    }
  }
  
  // CR 704.5f: If a creature has toughness 0 or less, it's put into its owner's graveyard.
  // This is NOT destruction (Rule 702.12b) - it happens regardless of indestructible
  // CR 704.5g: If a creature has toughness greater than 0, and it has been dealt damage equal to
  // or greater than its toughness, that creature has been dealt lethal damage and is destroyed.
  // Rule 702.12b: Indestructible creatures are NOT destroyed by lethal damage.
  for (const perm of state.battlefield as readonly BattlefieldPermanent[]) {
    const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    
    // Get base toughness
    let baseToughness: number | undefined;
    if (isNumber(perm.baseToughness)) {
      baseToughness = perm.baseToughness;
    } else {
      const cardToughness = (perm.card as any)?.toughness;
      if (cardToughness !== undefined && cardToughness !== null) {
        const parsed = parseInt(String(cardToughness), 10);
        if (isNumber(parsed)) {
          baseToughness = parsed;
        }
      }
    }
    
    if (!isNumber(baseToughness)) continue;
    
    // Apply counters
    const plus = perm.counters?.['+1/+1'] ?? 0;
    const minus = perm.counters?.['-1/-1'] ?? 0;
    const net = plus - minus;
    const totalToughness = baseToughness + net;
    
    // Get damage
    const damage = (perm as any).damage ?? (perm as any).markedDamage ?? (perm as any).damageMarked ?? 0;
    
    // CR 704.5f: 0 or less toughness - NOT destruction, ignores indestructible
    if (totalToughness <= 0) {
      destroys.push(perm.id);
      continue;
    }
    
    // CR 704.5g: Lethal damage - IS destruction, respects indestructible
    if (damage >= totalToughness) {
      // Check for indestructible
      const isIndestructible = hasIndestructible(perm) || attachmentGrantsIndestructible(state, perm);
      if (!isIndestructible) {
        destroys.push(perm.id);
      }
    }
  }

  return { counterUpdates: updates, destroys };
}

// Damage evaluation (wither/infect → -1/-1 counters)
export type EngineAction =
  | { type: 'DEAL_DAMAGE'; targetPermanentId: string; amount: number; wither?: boolean; infect?: boolean };

export type EngineEffect =
  | { kind: 'AddCounters'; permanentId: string; counter: string; amount: number }
  | { kind: 'DestroyPermanent'; permanentId: string };

export function evaluateAction(_state: Readonly<GameState>, action: EngineAction): readonly EngineEffect[] {
  switch (action.type) {
    case 'DEAL_DAMAGE': {
      const { amount, wither, infect, targetPermanentId } = action;
      if ((wither || infect) && amount > 0) {
        return [{ kind: 'AddCounters', permanentId: targetPermanentId, counter: '-1/-1', amount }];
      }
      return [];
    }
    default:
      return [];
  }
}