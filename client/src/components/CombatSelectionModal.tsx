/**
 * CombatSelectionModal.tsx
 * 
 * Modal for declaring attackers and blockers during combat phase.
 * Shows the player's available creatures and allows selection for combat.
 * Displays effective P/T and danger indicators for combat abilities.
 */

import React, { useState, useMemo } from 'react';
import type { BattlefieldPermanent, PlayerRef, PlayerID, KnownCardRef } from '../../../shared/src';

export interface CombatSelectionModalProps {
  open: boolean;
  mode: 'attackers' | 'blockers';
  availableCreatures: BattlefieldPermanent[];
  attackingCreatures?: BattlefieldPermanent[]; // For blocker mode: which creatures are attacking
  defenders?: PlayerRef[]; // For attacker mode: which players/planeswalkers can be attacked
  onConfirm: (selections: AttackerSelection[] | BlockerSelection[]) => void;
  onSkip: () => void;
  onCancel?: () => void;
  /** If true, the modal is view-only (for spectators or non-active players) */
  readOnly?: boolean;
  /** Whether it's the current player's turn (for attackers mode) */
  isYourTurn?: boolean;
}

export interface AttackerSelection {
  creatureId: string;
  targetPlayerId?: string;
  targetPermanentId?: string;
}

export interface BlockerSelection {
  blockerId: string;
  attackerId: string;
}

/**
 * Dangerous combat abilities that players should be warned about
 */
interface DangerIndicators {
  deathtouch: boolean;
  infect: boolean;
  toxic: number; // 0 if no toxic, otherwise the toxic value
  trample: boolean;
  menace: boolean;
  firstStrike: boolean;
  doubleStrike: boolean;
  lifelink: boolean;
  indestructible: boolean;
  goaded: boolean; // If creature is goaded and must attack
  goadedBy?: string[]; // Player IDs who goaded this creature
  lure: boolean; // If creature must be blocked by all able creatures (Lure effect)
}

/**
 * Get creature info from a permanent, including effective P/T and danger indicators
 */
function getCreatureInfo(perm: BattlefieldPermanent): { 
  name: string; 
  pt: string; 
  effectivePower: number | undefined;
  effectiveToughness: number | undefined;
  imageUrl?: string;
  dangers: DangerIndicators;
} {
  // Defensive check for undefined/null permanent
  if (!perm) {
    return { 
      name: 'Unknown', 
      pt: '?/?', 
      effectivePower: undefined, 
      effectiveToughness: undefined,
      imageUrl: undefined,
      dangers: { 
        deathtouch: false, 
        infect: false, 
        toxic: 0, 
        trample: false, 
        menace: false, 
        firstStrike: false, 
        doubleStrike: false, 
        lifelink: false, 
        indestructible: false,
        goaded: false,
        lure: false,
      }
    };
  }
  
  const card = perm.card as KnownCardRef | undefined;
  const name = card?.name || perm.id || 'Unknown';
  const oracleText = (card?.oracle_text || '').toLowerCase();
  
  // Check for Lure effect - from the creature itself or from attached auras
  // Lure: "All creatures able to block enchanted creature do so"
  // Also check grantedAbilities for lure effects
  const grantedAbilities = (perm as any).grantedAbilities || [];
  const hasLure = oracleText.includes('must be blocked') || 
                  oracleText.includes('all creatures able to block') ||
                  grantedAbilities.some((a: string) => 
                    a && (a.toLowerCase().includes('must be blocked') || 
                          a.toLowerCase().includes('all creatures able to block')));
  
  // Use pre-calculated effective P/T if available
  let effectivePower = perm.effectivePower;
  let effectiveToughness = perm.effectiveToughness;
  
  // Fallback to manual calculation if not pre-calculated
  if (effectivePower === undefined || effectiveToughness === undefined) {
    let baseP: number | undefined;
    let baseT: number | undefined;
    
    try {
      if (perm.basePower !== undefined && perm.basePower !== null) {
        baseP = typeof perm.basePower === 'number' ? perm.basePower : parseInt(String(perm.basePower), 10);
        if (isNaN(baseP)) baseP = undefined;
      } else if (card?.power) {
        baseP = parseInt(String(card.power), 10);
        if (isNaN(baseP)) baseP = undefined;
      }
      
      if (perm.baseToughness !== undefined && perm.baseToughness !== null) {
        baseT = typeof perm.baseToughness === 'number' ? perm.baseToughness : parseInt(String(perm.baseToughness), 10);
        if (isNaN(baseT)) baseT = undefined;
      } else if (card?.toughness) {
        baseT = parseInt(String(card.toughness), 10);
        if (isNaN(baseT)) baseT = undefined;
      }
    } catch {
      // Ignore parsing errors
    }
    
    const plusCounters = perm.counters?.['+1/+1'] ?? 0;
    const minusCounters = perm.counters?.['-1/-1'] ?? 0;
    const delta = plusCounters - minusCounters;
    
    effectivePower = typeof baseP === 'number' ? baseP + delta : undefined;
    effectiveToughness = typeof baseT === 'number' ? baseT + delta : undefined;
  }
  
  const p = effectivePower !== undefined ? effectivePower : '?';
  const t = effectiveToughness !== undefined ? effectiveToughness : '?';
  const pt = `${p}/${t}`;
  
  const imageUrl = card?.image_uris?.small || card?.image_uris?.normal;
  
  // Check for granted abilities and card text for danger indicators
  // Note: grantedAbilities was already declared above (line ~98), reuse it here
  const lowerGrantedAbilities = grantedAbilities.map((a: string) => (a || '').toLowerCase());
  const hasAbility = (keyword: string) => 
    lowerGrantedAbilities.some((a: string) => a.includes(keyword)) || 
    oracleText.includes(keyword);
  
  // Parse toxic value
  let toxicValue = 0;
  const toxicMatch = oracleText.match(/toxic\s+(\d+)/i);
  if (toxicMatch) {
    toxicValue = parseInt(toxicMatch[1], 10);
  }
  
  const dangers: DangerIndicators = {
    deathtouch: hasAbility('deathtouch'),
    infect: hasAbility('infect'),
    toxic: toxicValue,
    trample: hasAbility('trample'),
    menace: hasAbility('menace'),
    firstStrike: hasAbility('first strike') || hasAbility('first_strike'),
    doubleStrike: hasAbility('double strike') || hasAbility('double_strike'),
    lifelink: hasAbility('lifelink'),
    indestructible: hasAbility('indestructible'),
    goaded: (perm.goadedBy && Array.isArray(perm.goadedBy) && perm.goadedBy.length > 0) || false,
    goadedBy: perm.goadedBy,
    lure: hasLure,
  };
  
  return { name, pt, effectivePower, effectiveToughness, imageUrl, dangers };
}

/**
 * Danger badge component for displaying combat abilities
 */
function DangerBadge({ label, color, tooltip }: { label: string; color: string; tooltip: string }) {
  return (
    <span
      title={tooltip}
      style={{
        display: 'inline-block',
        padding: '2px 4px',
        fontSize: 8,
        fontWeight: 600,
        borderRadius: 3,
        backgroundColor: color,
        color: '#fff',
        marginRight: 2,
        marginBottom: 2,
        textShadow: '0 1px 1px rgba(0,0,0,0.5)',
      }}
    >
      {label}
    </span>
  );
}

/**
 * Render danger indicators for a creature
 */
function DangerIndicatorBadges({ dangers }: { dangers: DangerIndicators }) {
  const badges: React.ReactNode[] = [];
  
  // Goad indicator - show first as it affects combat requirements
  if (dangers.goaded) {
    const goadedByCount = dangers.goadedBy?.length || 1;
    const goadTooltip = goadedByCount > 1 
      ? `Goaded by ${goadedByCount} players - Must attack if able, cannot attack goaders unless only option`
      : 'Goaded - Must attack if able, cannot attack goader unless only option';
    badges.push(<DangerBadge key="goad" label="🎯GOAD" color="#d97706" tooltip={goadTooltip} />);
  }
  
  if (dangers.lure) {
    badges.push(<DangerBadge key="lure" label="🧲LURE" color="#f472b6" tooltip="Lure - All creatures able to block this creature must do so" />);
  }
  
  if (dangers.deathtouch) {
    badges.push(<DangerBadge key="dt" label="☠️DT" color="#10b981" tooltip="Deathtouch - Any damage destroys" />);
  }
  if (dangers.infect) {
    badges.push(<DangerBadge key="inf" label="☣️INF" color="#22c55e" tooltip="Infect - Deals damage as poison/−1/−1 counters" />);
  }
  if (dangers.toxic > 0) {
    badges.push(<DangerBadge key="tox" label={`☠️T${dangers.toxic}`} color="#84cc16" tooltip={`Toxic ${dangers.toxic} - Deals ${dangers.toxic} poison counter(s) on combat damage`} />);
  }
  if (dangers.trample) {
    badges.push(<DangerBadge key="trm" label="🦶TRM" color="#34d399" tooltip="Trample - Excess damage goes through" />);
  }
  if (dangers.menace) {
    badges.push(<DangerBadge key="men" label="👹MEN" color="#f87171" tooltip="Menace - Must be blocked by 2+ creatures" />);
  }
  if (dangers.firstStrike) {
    badges.push(<DangerBadge key="1st" label="⚡1ST" color="#ef4444" tooltip="First Strike - Deals damage first" />);
  }
  if (dangers.doubleStrike) {
    badges.push(<DangerBadge key="2x" label="⚡⚡2X" color="#dc2626" tooltip="Double Strike - Deals first strike and normal damage" />);
  }
  if (dangers.lifelink) {
    badges.push(<DangerBadge key="ll" label="❤️LL" color="#f0abfc" tooltip="Lifelink - Damage heals controller" />);
  }
  if (dangers.indestructible) {
    badges.push(<DangerBadge key="ind" label="🛡️IND" color="#eab308" tooltip="Indestructible - Cannot be destroyed" />);
  }
  
  if (badges.length === 0) return null;
  
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 4, justifyContent: 'center' }}>
      {badges}
    </div>
  );
}

/**
 * Check if a creature with menace can be legally blocked by the selected blockers
 */
function checkMenaceBlocking(
  attackerId: string, 
  attackerDangers: DangerIndicators, 
  selectedBlockers: Map<string, string>
): { isLegal: boolean; message?: string } {
  if (!attackerDangers.menace) {
    return { isLegal: true };
  }
  
  const blockersForAttacker = Array.from(selectedBlockers.entries())
    .filter(([_, aid]) => aid === attackerId)
    .length;
  
  if (blockersForAttacker === 0) {
    return { isLegal: true }; // Not blocking is legal
  }
  
  if (blockersForAttacker === 1) {
    return { isLegal: false, message: 'Menace requires 2+ blockers' };
  }
  
  return { isLegal: true };
}

/**
 * Group identical creatures (tokens) for easier selection
 */
interface CreatureGroup {
  key: string;
  name: string;
  pt: string;
  creatures: BattlefieldPermanent[];
  isToken: boolean;
  imageUrl?: string;
  dangers: DangerIndicators;
}

function groupCreatures(creatures: BattlefieldPermanent[]): CreatureGroup[] {
  const map = new Map<string, CreatureGroup>();
  
  for (const c of creatures) {
    const { name, pt, imageUrl, dangers } = getCreatureInfo(c);
    const isToken = !!(c as any).isToken;
    
    // Create a key based on name and P/T for grouping
    const key = `${name}|${pt}|${isToken ? 'token' : 'card'}`;
    
    // Handle server-side grouped tokens (optimization for games with many tokens)
    // If this is a grouped token, we need to expand it into virtual creatures
    if ((c as any).isGroupedTokens && (c as any).tokenCount && (c as any).groupedTokenIds) {
      const tokenCount = (c as any).tokenCount as number;
      const groupedIds = (c as any).groupedTokenIds as string[];
      const groupId = c.id; // The group's ID (e.g., "group_xxx")
      
      // Create virtual creatures for each token in the group
      const existing = map.get(key);
      if (existing) {
        // Add virtual creature references for each token in the group
        for (let i = 0; i < tokenCount; i++) {
          // Use actual ID from groupedIds if available, otherwise create a unique fallback
          const actualId = i < groupedIds.length ? groupedIds[i] : `${groupId}_virtual_${i}`;
          const virtualCreature = {
            ...c,
            id: actualId,
            isGroupedTokens: false, // Not grouped anymore at UI level
            tokenCount: undefined,
            groupedTokenIds: undefined,
            _virtualFromGroup: groupId, // Track which group this came from
            _virtualIndex: i,
          } as BattlefieldPermanent;
          existing.creatures.push(virtualCreature);
        }
      } else {
        const virtualCreatures: BattlefieldPermanent[] = [];
        for (let i = 0; i < tokenCount; i++) {
          // Use actual ID from groupedIds if available, otherwise create a unique fallback
          const actualId = i < groupedIds.length ? groupedIds[i] : `${groupId}_virtual_${i}`;
          const virtualCreature = {
            ...c,
            id: actualId,
            isGroupedTokens: false,
            tokenCount: undefined,
            groupedTokenIds: undefined,
            _virtualFromGroup: groupId,
            _virtualIndex: i,
          } as BattlefieldPermanent;
          virtualCreatures.push(virtualCreature);
        }
        map.set(key, {
          key,
          name,
          pt,
          creatures: virtualCreatures,
          isToken,
          imageUrl,
          dangers,
        });
      }
    } else {
      // Normal creature - add to group as before
      const existing = map.get(key);
      if (existing) {
        existing.creatures.push(c);
      } else {
        map.set(key, {
          key,
          name,
          pt,
          creatures: [c],
          isToken,
          imageUrl,
          dangers,
        });
      }
    }
  }
  
  return Array.from(map.values()).sort((a, b) => {
    // Sort tokens last, then by name
    if (a.isToken !== b.isToken) return a.isToken ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

export function CombatSelectionModal({
  open,
  mode,
  availableCreatures,
  attackingCreatures = [],
  defenders = [],
  onConfirm,
  onSkip,
  onCancel,
  readOnly = false,
  isYourTurn = true,
}: CombatSelectionModalProps) {
  // For attackers: selected creatures and their targets
  const [selectedAttackers, setSelectedAttackers] = useState<Map<string, string | undefined>>(new Map());
  
  // For blockers: which blockers block which attackers
  const [selectedBlockers, setSelectedBlockers] = useState<Map<string, string>>(new Map());
  
  // Bulk attack target selection
  const [bulkAttackTarget, setBulkAttackTarget] = useState<string>('');
  const [bulkAttackCount, setBulkAttackCount] = useState<number>(0);
  
  // Group target selection (for selecting target per token group)
  const [groupTargets, setGroupTargets] = useState<Map<string, string>>(new Map());
  
  // Determine if the modal should be interactive
  // For attackers mode, only the turn player can interact
  // For blockers mode, only the defending player can interact
  const isInteractive = !readOnly && (mode === 'blockers' || isYourTurn);
  
  // Reset selections when modal opens
  React.useEffect(() => {
    if (open) {
      setSelectedAttackers(new Map());
      setSelectedBlockers(new Map());
      setBulkAttackTarget(defenders[0]?.id || '');
      setBulkAttackCount(0);
      setGroupTargets(new Map());
    }
  }, [open, mode, defenders]);

  // Filter to only untapped creatures for attackers
  const availableForAttack = useMemo(() => {
    return availableCreatures.filter(c => !c.tapped);
  }, [availableCreatures]);

  // Filter to only untapped creatures for blocking
  const availableForBlock = useMemo(() => {
    return availableCreatures.filter(c => !c.tapped);
  }, [availableCreatures]);
  
  // Group creatures for display
  const creatureGroups = useMemo(() => {
    return groupCreatures(availableForAttack);
  }, [availableForAttack]);
  
  // Count of unselected attackers available
  const unselectedCount = useMemo(() => {
    return availableForAttack.filter(c => !selectedAttackers.has(c.id)).length;
  }, [availableForAttack, selectedAttackers]);
  
  // Handle "Attack All" - select all unselected creatures to attack a target
  const handleAttackAll = (targetId: string) => {
    if (!isInteractive) return;
    setSelectedAttackers(prev => {
      const next = new Map(prev);
      for (const creature of availableForAttack) {
        if (!next.has(creature.id)) {
          next.set(creature.id, targetId);
        }
      }
      return next;
    });
  };
  
  // Handle bulk attack - select X creatures to attack a target
  const handleBulkAttack = (count: number, targetId: string) => {
    if (!isInteractive || count <= 0) return;
    
    // Get unselected creatures
    const unselected = availableForAttack.filter(c => !selectedAttackers.has(c.id));
    const toSelect = unselected.slice(0, count);
    
    setSelectedAttackers(prev => {
      const next = new Map(prev);
      for (const creature of toSelect) {
        next.set(creature.id, targetId);
      }
      return next;
    });
    
    setBulkAttackCount(0); // Reset the bulk count
  };
  
  // Handle selecting/deselecting entire group
  const handleToggleGroup = (group: CreatureGroup, targetId: string) => {
    if (!isInteractive) return;
    
    const allSelected = group.creatures.every(c => selectedAttackers.has(c.id));
    
    setSelectedAttackers(prev => {
      const next = new Map(prev);
      if (allSelected) {
        // Deselect all in group
        for (const c of group.creatures) {
          next.delete(c.id);
        }
      } else {
        // Select all in group
        for (const c of group.creatures) {
          next.set(c.id, targetId);
        }
      }
      return next;
    });
  };
  
  // Handle selecting X from a group
  const handleSelectFromGroup = (group: CreatureGroup, count: number, targetId: string) => {
    if (!isInteractive || count <= 0) return;
    
    const unselectedInGroup = group.creatures.filter(c => !selectedAttackers.has(c.id));
    const toSelect = unselectedInGroup.slice(0, count);
    
    setSelectedAttackers(prev => {
      const next = new Map(prev);
      for (const creature of toSelect) {
        next.set(creature.id, targetId);
      }
      return next;
    });
  };
  
  // Clear all selections
  const handleClearAll = () => {
    if (!isInteractive) return;
    setSelectedAttackers(new Map());
  };

  // Check for menace violations
  const menaceViolations = useMemo(() => {
    const violations: Map<string, string> = new Map();
    for (const attacker of attackingCreatures) {
      const { dangers } = getCreatureInfo(attacker);
      const check = checkMenaceBlocking(attacker.id, dangers, selectedBlockers);
      if (!check.isLegal && check.message) {
        violations.set(attacker.id, check.message);
      }
    }
    return violations;
  }, [attackingCreatures, selectedBlockers]);
  
  // Check for Lure violations - all able blockers MUST block creatures with Lure
  const lureViolations = useMemo(() => {
    const violations: Map<string, string> = new Map();
    
    // Find attackers with Lure
    const attackersWithLure = attackingCreatures.filter(a => {
      const { dangers } = getCreatureInfo(a);
      return dangers.lure;
    });
    
    if (attackersWithLure.length === 0) return violations;
    
    // For each attacker with Lure, check if all able blockers are blocking it
    for (const attacker of attackersWithLure) {
      const { name } = getCreatureInfo(attacker);
      
      // Get blockers currently assigned to this attacker
      const blockersForThisAttacker = Array.from(selectedBlockers.entries())
        .filter(([_, aid]) => aid === attacker.id)
        .map(([bid]) => bid);
      
      // Check if any available blocker is NOT blocking this attacker
      // (In a full implementation, we'd also check for "can't block" effects)
      const unassignedBlockers = availableForBlock.filter(b => {
        // Blocker must not be assigned to another attacker
        const currentAssignment = selectedBlockers.get(b.id);
        return !currentAssignment || currentAssignment === attacker.id;
      });
      
      const notBlockingLure = unassignedBlockers.filter(b => !blockersForThisAttacker.includes(b.id));
      
      if (notBlockingLure.length > 0) {
        violations.set(attacker.id, `${name} has Lure - all ${notBlockingLure.length} able creature(s) must block it`);
      }
    }
    
    return violations;
  }, [attackingCreatures, selectedBlockers, availableForBlock]);
  
  // Auto-assign blockers to Lure creatures
  const handleAutoBlockLure = () => {
    if (!isInteractive) return;
    
    // Find all attackers with Lure
    const attackersWithLure = attackingCreatures.filter(a => {
      const { dangers } = getCreatureInfo(a);
      return dangers.lure;
    });
    
    if (attackersWithLure.length === 0) return;
    
    setSelectedBlockers(prev => {
      const next = new Map(prev);
      
      // For each Lure attacker, assign all able blockers
      for (const attacker of attackersWithLure) {
        for (const blocker of availableForBlock) {
          // Only assign if not already blocking something else
          if (!next.has(blocker.id)) {
            next.set(blocker.id, attacker.id);
          }
        }
      }
      
      return next;
    });
  };
  
  // Group blockers for display
  const blockerGroups = useMemo(() => {
    return groupCreatures(availableForBlock);
  }, [availableForBlock]);

  const handleToggleAttacker = (creatureId: string) => {
    if (!isInteractive) return; // Don't allow interaction if read-only
    setSelectedAttackers(prev => {
      const next = new Map(prev);
      if (next.has(creatureId)) {
        next.delete(creatureId);
      } else {
        // Default target is the first opponent
        const defaultTarget = defenders[0]?.id;
        next.set(creatureId, defaultTarget);
      }
      return next;
    });
  };

  const handleSetAttackTarget = (creatureId: string, targetId: string) => {
    setSelectedAttackers(prev => {
      const next = new Map(prev);
      next.set(creatureId, targetId);
      return next;
    });
  };

  const handleToggleBlocker = (blockerId: string, attackerId: string) => {
    if (!isInteractive) return; // Don't allow interaction if read-only
    setSelectedBlockers(prev => {
      const next = new Map(prev);
      if (next.get(blockerId) === attackerId) {
        next.delete(blockerId);
      } else {
        next.set(blockerId, attackerId);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    if (!isInteractive) return; // Don't allow if read-only
    
    // Menace violations are already displayed in the UI banner - just prevent confirmation
    if (menaceViolations.size > 0) {
      return;
    }
    
    if (mode === 'attackers') {
      const selections: AttackerSelection[] = Array.from(selectedAttackers.entries()).map(([creatureId, target]) => ({
        creatureId,
        targetPlayerId: target,
      }));
      onConfirm(selections);
    } else {
      const selections: BlockerSelection[] = Array.from(selectedBlockers.entries()).map(([blockerId, attackerId]) => ({
        blockerId,
        attackerId,
      }));
      onConfirm(selections);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 900,
          width: '95%',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            {mode === 'attackers' ? '⚔️ Declare Attackers' : '🛡️ Declare Blockers'}
          </h2>
          {onCancel && (
            <button
              onClick={onCancel}
              style={{
                background: 'none',
                border: 'none',
                color: '#888',
                fontSize: 24,
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          )}
        </div>

        <div style={{ fontSize: 13, color: '#aaa', marginBottom: 16 }}>
          {mode === 'attackers' 
            ? 'Click on creatures to select them as attackers. Choose a target for each attacker.'
            : 'Click on your creatures, then click an attacker to block it. Watch for dangerous abilities!'}
        </div>

        {/* Menace warning banner */}
        {mode === 'blockers' && menaceViolations.size > 0 && (
          <div style={{
            padding: '8px 12px',
            backgroundColor: 'rgba(239,68,68,0.2)',
            border: '1px solid #ef4444',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 12,
            color: '#fca5a5',
          }}>
            ⚠️ <strong>Illegal Blocking:</strong> {Array.from(menaceViolations.values()).join('. ')}
          </div>
        )}

        {/* Attacker Selection Mode */}
        {mode === 'attackers' && (
          <div>
            {/* Bulk Attack Controls */}
            {availableForAttack.length > 0 && defenders.length > 0 && (
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                marginBottom: 16,
                padding: '12px 16px',
                background: 'rgba(239,68,68,0.1)',
                borderRadius: 8,
                border: '1px solid rgba(239,68,68,0.3)',
              }}>
                <span style={{ fontWeight: 600, fontSize: 13, marginRight: 8 }}>Quick Attack:</span>
                
                {/* Attack All buttons - one per defender */}
                {defenders.map(d => (
                  <button
                    key={`attack-all-${d.id}`}
                    onClick={() => handleAttackAll(d.id)}
                    disabled={unselectedCount === 0}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: 'none',
                      background: unselectedCount === 0 ? '#555' : '#ef4444',
                      color: '#fff',
                      cursor: unselectedCount === 0 ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Attack All → {d.name} ({unselectedCount})
                  </button>
                ))}
                
                {/* Bulk count selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                  <input
                    type="number"
                    min="0"
                    max={unselectedCount}
                    value={bulkAttackCount}
                    onChange={(e) => setBulkAttackCount(Math.min(Math.max(0, parseInt(e.target.value) || 0), unselectedCount))}
                    style={{
                      width: 60,
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: '1px solid #555',
                      background: '#222',
                      color: '#fff',
                      fontSize: 12,
                    }}
                    placeholder="Count"
                  />
                  <select
                    value={bulkAttackTarget}
                    onChange={(e) => setBulkAttackTarget(e.target.value)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: '1px solid #555',
                      background: '#222',
                      color: '#fff',
                      fontSize: 12,
                    }}
                  >
                    {defenders.map(d => (
                      <option key={d.id} value={d.id}>→ {d.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleBulkAttack(bulkAttackCount, bulkAttackTarget)}
                    disabled={bulkAttackCount === 0 || !bulkAttackTarget}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 4,
                      border: 'none',
                      background: bulkAttackCount === 0 ? '#555' : '#dc2626',
                      color: '#fff',
                      cursor: bulkAttackCount === 0 ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                    }}
                  >
                    Add
                  </button>
                </div>
                
                {/* Clear all button */}
                {selectedAttackers.size > 0 && (
                  <button
                    onClick={handleClearAll}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '1px solid #666',
                      background: 'transparent',
                      color: '#aaa',
                      cursor: 'pointer',
                      fontSize: 12,
                      marginLeft: 'auto',
                    }}
                  >
                    Clear All ({selectedAttackers.size})
                  </button>
                )}
              </div>
            )}
            
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              Your Creatures ({availableForAttack.length} available, {selectedAttackers.size} selected)
            </div>
            
            {availableForAttack.length === 0 ? (
              <div style={{ color: '#666', padding: 12, textAlign: 'center' }}>
                No untapped creatures available to attack
              </div>
            ) : availableForAttack.length > 50 ? (
              /* Grouped view for many creatures */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                {creatureGroups.map(group => {
                  const selectedInGroup = group.creatures.filter(c => selectedAttackers.has(c.id)).length;
                  const allSelected = selectedInGroup === group.creatures.length;
                  // Get group-specific target or default to first defender
                  const groupTarget = groupTargets.get(group.key) || defenders[0]?.id || '';
                  
                  // Calculate per-defender breakdown for this group
                  const attackBreakdown = defenders.map(d => {
                    const count = group.creatures.filter(c => selectedAttackers.get(c.id) === d.id).length;
                    return { defender: d, count };
                  }).filter(b => b.count > 0);
                  
                  const unselectedInGroup = group.creatures.length - selectedInGroup;
                  
                  return (
                    <div
                      key={group.key}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        border: allSelected ? '2px solid #ef4444' : '2px solid #333',
                        background: allSelected ? 'rgba(239,68,68,0.2)' : selectedInGroup > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(0,0,0,0.3)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                        {/* Token image or placeholder */}
                        {group.imageUrl ? (
                          <img
                            src={group.imageUrl}
                            alt={group.name}
                            style={{ width: 50, height: 70, borderRadius: 4, objectFit: 'cover' }}
                          />
                        ) : (
                          <div style={{
                            width: 50,
                            height: 70,
                            background: '#222',
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 9,
                            textAlign: 'center',
                          }}>
                            {group.name}
                          </div>
                        )}
                        
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>
                            {group.name} {group.pt}
                            {group.isToken && <span style={{ color: '#888', fontSize: 11, marginLeft: 6 }}>(Token)</span>}
                          </div>
                          <div style={{ fontSize: 12, color: '#aaa' }}>
                            {group.creatures.length} total • {selectedInGroup} attacking • {unselectedInGroup} available
                          </div>
                          {/* Show breakdown of attacks by defender */}
                          {attackBreakdown.length > 0 && (
                            <div style={{ fontSize: 11, color: '#f87171', marginTop: 2 }}>
                              {attackBreakdown.map((b, i) => (
                                <span key={b.defender.id}>
                                  {i > 0 && ', '}
                                  {b.count}→{b.defender.name}
                                </span>
                              ))}
                            </div>
                          )}
                          <DangerIndicatorBadges dangers={group.dangers} />
                        </div>
                        
                        {/* Group controls */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {/* Target selector for group */}
                          {defenders.length > 1 && (
                            <select
                              value={groupTarget}
                              onChange={(e) => {
                                e.stopPropagation();
                                setGroupTargets(prev => {
                                  const next = new Map(prev);
                                  next.set(group.key, e.target.value);
                                  return next;
                                });
                              }}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                padding: '3px 6px',
                                borderRadius: 4,
                                border: '1px solid #555',
                                background: '#222',
                                color: '#fff',
                                fontSize: 10,
                                marginBottom: 4,
                              }}
                            >
                              {defenders.map(d => (
                                <option key={d.id} value={d.id}>
                                  → {d.name}
                                </option>
                              ))}
                            </select>
                          )}
                          
                          <button
                            onClick={() => handleToggleGroup(group, groupTarget)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 4,
                              border: 'none',
                              background: allSelected ? '#666' : '#ef4444',
                              color: '#fff',
                              cursor: 'pointer',
                              fontSize: 11,
                            }}
                          >
                            {allSelected ? 'Deselect All' : `Attack All (${group.creatures.length})`}
                          </button>
                          
                          {/* Allow adding more attackers if there are unselected creatures */}
                          {unselectedInGroup > 0 && (
                            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                              <input
                                type="number"
                                min="1"
                                max={unselectedInGroup}
                                placeholder={`1-${unselectedInGroup}`}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  width: 55,
                                  padding: '2px 4px',
                                  borderRadius: 3,
                                  border: '1px solid #555',
                                  background: '#222',
                                  color: '#fff',
                                  fontSize: 10,
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const input = e.target as HTMLInputElement;
                                    const count = Math.min(parseInt(input.value) || 0, unselectedInGroup);
                                    if (count > 0) {
                                      handleSelectFromGroup(group, count, groupTarget);
                                    }
                                    input.value = '';
                                  }
                                }}
                              />
                              <span style={{ fontSize: 9, color: '#888', alignSelf: 'center' }}>
                                /{unselectedInGroup} +↵
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Standard card view for smaller numbers */
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                {availableForAttack.map(creature => {
                  const { name, pt, effectivePower, imageUrl, dangers } = getCreatureInfo(creature);
                  const isSelected = selectedAttackers.has(creature.id);
                  const targetId = selectedAttackers.get(creature.id);
                  
                  return (
                    <div
                      key={creature.id}
                      style={{
                        width: 130,
                        padding: 8,
                        borderRadius: 8,
                        border: isSelected ? '2px solid #ef4444' : '2px solid #333',
                        background: isSelected ? 'rgba(239,68,68,0.2)' : 'rgba(0,0,0,0.3)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      onClick={() => handleToggleAttacker(creature.id)}
                    >
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={name}
                          style={{
                            width: '100%',
                            borderRadius: 4,
                            marginBottom: 4,
                          }}
                        />
                      ) : (
                        <div style={{
                          width: '100%',
                          height: 140,
                          background: '#222',
                          borderRadius: 4,
                          marginBottom: 4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                        }}>
                          {name}
                        </div>
                      )}
                      <div style={{ fontSize: 11, textAlign: 'center' }}>
                        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {name}
                        </div>
                        <div style={{ 
                          color: '#fff', 
                          fontWeight: 700,
                          fontSize: 14,
                          background: 'rgba(0,0,0,0.5)',
                          borderRadius: 4,
                          padding: '2px 6px',
                          marginTop: 2,
                          display: 'inline-block',
                        }}>
                          {pt}
                          {effectivePower !== undefined && (
                            <span style={{ fontSize: 10, color: '#22c55e', marginLeft: 4 }}>
                              ({effectivePower} dmg)
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* Danger indicators */}
                      <DangerIndicatorBadges dangers={dangers} />
                      
                      {/* Target selector for selected attackers */}
                      {isSelected && defenders.length > 0 && (
                        <select
                          value={targetId || ''}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleSetAttackTarget(creature.id, e.target.value);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            width: '100%',
                            marginTop: 4,
                            padding: '2px 4px',
                            fontSize: 10,
                            borderRadius: 4,
                            border: '1px solid #555',
                            background: '#222',
                            color: '#fff',
                          }}
                        >
                          {defenders.map(d => (
                            <option key={d.id} value={d.id}>
                              → {d.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Blocker Selection Mode */}
        {mode === 'blockers' && (
          <div>
            {/* Lure warning banner and auto-block button */}
            {lureViolations.size > 0 && (
              <div style={{
                padding: '12px 16px',
                backgroundColor: 'rgba(244,114,182,0.2)',
                border: '1px solid #f472b6',
                borderRadius: 8,
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}>
                <div style={{ fontSize: 12, color: '#fbcfe8' }}>
                  🧲 <strong>Lure Effect:</strong> {Array.from(lureViolations.values()).join('. ')}
                </div>
                <button
                  onClick={handleAutoBlockLure}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#f472b6',
                    color: '#000',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Auto-Block Lure
                </button>
              </div>
            )}
            
            {/* Quick blocking controls */}
            {availableForBlock.length > 0 && attackingCreatures.length > 0 && (
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                marginBottom: 16,
                padding: '12px 16px',
                background: 'rgba(16,185,129,0.1)',
                borderRadius: 8,
                border: '1px solid rgba(16,185,129,0.3)',
              }}>
                <span style={{ fontWeight: 600, fontSize: 13, marginRight: 8 }}>Quick Block:</span>
                
                {/* Clear all blockers button */}
                {selectedBlockers.size > 0 && (
                  <button
                    onClick={() => setSelectedBlockers(new Map())}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '1px solid #666',
                      background: 'transparent',
                      color: '#aaa',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    Clear All ({selectedBlockers.size})
                  </button>
                )}
              </div>
            )}
            
            {/* Show attacking creatures */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#ef4444' }}>
                ⚔️ Attacking Creatures ({attackingCreatures.length}) - WATCH FOR DANGER ABILITIES
              </div>
              
              {attackingCreatures.length === 0 ? (
                <div style={{ color: '#666', padding: 12, textAlign: 'center' }}>
                  No creatures are attacking
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {attackingCreatures.map(attacker => {
                    const { name, pt, effectivePower, imageUrl, dangers } = getCreatureInfo(attacker);
                    const blockersForThis = Array.from(selectedBlockers.entries())
                      .filter(([_, attackerId]) => attackerId === attacker.id)
                      .map(([blockerId]) => blockerId);
                    const menaceViolation = menaceViolations.get(attacker.id);
                    const lureViolation = lureViolations.get(attacker.id);
                    const hasViolation = menaceViolation || lureViolation;
                    
                    return (
                      <div
                        key={attacker.id}
                        style={{
                          width: 130,
                          padding: 8,
                          borderRadius: 8,
                          border: lureViolation ? '2px solid #f472b6' : menaceViolation ? '2px solid #f59e0b' : '2px solid #ef4444',
                          background: lureViolation ? 'rgba(244,114,182,0.2)' : menaceViolation ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.15)',
                        }}
                      >
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={name}
                            style={{
                              width: '100%',
                              borderRadius: 4,
                              marginBottom: 4,
                            }}
                          />
                        ) : (
                          <div style={{
                            width: '100%',
                            height: 140,
                            background: '#222',
                            borderRadius: 4,
                            marginBottom: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 11,
                          }}>
                            {name}
                          </div>
                        )}
                        <div style={{ fontSize: 11, textAlign: 'center' }}>
                          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {name}
                          </div>
                          <div style={{ 
                            color: '#fff', 
                            fontWeight: 700,
                            fontSize: 14,
                            background: 'rgba(239,68,68,0.5)',
                            borderRadius: 4,
                            padding: '2px 6px',
                            marginTop: 2,
                            display: 'inline-block',
                          }}>
                            {pt}
                            {effectivePower !== undefined && (
                              <span style={{ fontSize: 10, color: '#fca5a5', marginLeft: 4 }}>
                                ({effectivePower} dmg)
                              </span>
                            )}
                          </div>
                          
                          {/* Danger indicators - very important for blockers! */}
                          <DangerIndicatorBadges dangers={dangers} />
                          
                          {blockersForThis.length > 0 && (
                            <div style={{ color: '#10b981', marginTop: 4, fontSize: 10 }}>
                              Blocked by {blockersForThis.length}
                            </div>
                          )}
                          {menaceViolation && (
                            <div style={{ color: '#f59e0b', marginTop: 2, fontSize: 9 }}>
                              ⚠️ {menaceViolation}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Show available blockers */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#10b981' }}>
                🛡️ Your Creatures ({availableForBlock.length} can block)
              </div>
              
              {availableForBlock.length === 0 ? (
                <div style={{ color: '#666', padding: 12, textAlign: 'center' }}>
                  No untapped creatures available to block
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {availableForBlock.map(blocker => {
                    const { name, pt, effectivePower, effectiveToughness, imageUrl, dangers } = getCreatureInfo(blocker);
                    const blockedAttackerId = selectedBlockers.get(blocker.id);
                    const isBlocking = !!blockedAttackerId;
                    
                    return (
                      <div
                        key={blocker.id}
                        style={{
                          width: 130,
                          padding: 8,
                          borderRadius: 8,
                          border: isBlocking ? '2px solid #10b981' : '2px solid #333',
                          background: isBlocking ? 'rgba(16,185,129,0.2)' : 'rgba(0,0,0,0.3)',
                        }}
                      >
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={name}
                            style={{
                              width: '100%',
                              borderRadius: 4,
                              marginBottom: 4,
                            }}
                          />
                        ) : (
                          <div style={{
                            width: '100%',
                            height: 140,
                            background: '#222',
                            borderRadius: 4,
                            marginBottom: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 11,
                          }}>
                            {name}
                          </div>
                        )}
                        <div style={{ fontSize: 11, textAlign: 'center' }}>
                          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {name}
                          </div>
                          <div style={{ 
                            color: '#fff', 
                            fontWeight: 700,
                            fontSize: 14,
                            background: 'rgba(16,185,129,0.5)',
                            borderRadius: 4,
                            padding: '2px 6px',
                            marginTop: 2,
                            display: 'inline-block',
                          }}>
                            {pt}
                          </div>
                          {effectiveToughness !== undefined && effectiveToughness > 0 && (
                            <div style={{ fontSize: 9, color: '#86efac', marginTop: 2 }}>
                              Can survive {effectiveToughness - 1} damage
                            </div>
                          )}
                          {effectiveToughness !== undefined && effectiveToughness <= 0 && (
                            <div style={{ fontSize: 9, color: '#ef4444', marginTop: 2 }}>
                              ⚠️ Will die (0 toughness)
                            </div>
                          )}
                        </div>
                        
                        {/* Blocker's own abilities */}
                        <DangerIndicatorBadges dangers={dangers} />
                        
                        {/* Attacker selector */}
                        <select
                          value={blockedAttackerId || ''}
                          onChange={(e) => {
                            if (e.target.value) {
                              handleToggleBlocker(blocker.id, e.target.value);
                            } else {
                              // Remove the blocker assignment
                              setSelectedBlockers(prev => {
                                const next = new Map(prev);
                                next.delete(blocker.id);
                                return next;
                              });
                            }
                          }}
                          style={{
                            width: '100%',
                            marginTop: 4,
                            padding: '2px 4px',
                            fontSize: 10,
                            borderRadius: 4,
                            border: '1px solid #555',
                            background: '#222',
                            color: '#fff',
                          }}
                        >
                          <option value="">Don't block</option>
                          {attackingCreatures.map(attacker => {
                            const attackerInfo = getCreatureInfo(attacker);
                            const dangerText = [];
                            if (attackerInfo.dangers.deathtouch) dangerText.push('DT');
                            if (attackerInfo.dangers.infect) dangerText.push('INF');
                            if (attackerInfo.dangers.trample) dangerText.push('TRM');
                            if (attackerInfo.dangers.menace) dangerText.push('MEN');
                            const dangerStr = dangerText.length > 0 ? ` ⚠️${dangerText.join('/')}` : '';
                            return (
                              <option key={attacker.id} value={attacker.id}>
                                Block {attackerInfo.name} ({attackerInfo.pt}){dangerStr}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'flex-end',
            marginTop: 24,
            paddingTop: 16,
            borderTop: '1px solid #333',
          }}
        >
          <button
            onClick={onSkip}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: '1px solid #4a4a6a',
              backgroundColor: 'transparent',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {mode === 'attackers' ? "Don't Attack" : "Don't Block"}
          </button>
          <button
            onClick={handleConfirm}
            disabled={
              (mode === 'attackers' && selectedAttackers.size === 0) ||
              (mode === 'blockers' && menaceViolations.size > 0)
            }
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: mode === 'attackers' ? '#ef4444' : '#10b981',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              opacity: (
                (mode === 'attackers' && selectedAttackers.size === 0) ||
                (mode === 'blockers' && menaceViolations.size > 0)
              ) ? 0.5 : 1,
            }}
          >
            {mode === 'attackers' 
              ? `Attack with ${selectedAttackers.size} Creature${selectedAttackers.size !== 1 ? 's' : ''}`
              : `Confirm Blockers (${selectedBlockers.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CombatSelectionModal;
