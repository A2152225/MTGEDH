/**
 * CombatSelectionModal.tsx
 * 
 * Modal for declaring attackers and blockers during combat phase.
 * Unique creatures always use the card grid; identical creatures/tokens always
 * use grouped rows with bulk assignment. Do not switch the whole modal based
 * on total creature count.
 */

import React, { useState, useMemo } from 'react';
import type { BattlefieldPermanent } from '../../../shared/src';
import { getLandwalkUnblockableReason } from '../../../shared/src/combatLandwalk';
import { getBlockerCapacity } from '../utils/blockerCapacity';
import { canBlockAttacker } from '../utils/combatBlocking';
import {
  permanentMustAttackIfAble,
  preferredForcedAttackTarget,
} from '../utils/combatGoad';
import { canCreatureAttackNow } from '../utils/creatureUtils';
import { playerIsLegalAttackTarget } from '../../../rules-engine/src/playerInGameStatus';
import { getCreatureInfo } from './CombatSelectionModal-handlers/combatSelectionModalCreatureInfo';
import { groupCreatures } from './CombatSelectionModal-handlers/combatSelectionModalGroupCreatures';
import type { CreatureGroup } from './CombatSelectionModal-handlers/combatSelectionModalGroupCreatures';
import {
  checkMenaceBlocking,
  cloneSelectedBlockers,
  countTotalBlockAssignments,
  splitCreatureGroups,
  buildAttackerSelections,
} from './CombatSelectionModal-handlers/combatSelectionModalSelectionSupport';
import { CombatBlockerSelectionPanel } from './CombatSelectionModal-handlers/combatSelectionModalBlockerPanel';
import { CombatAttackerSelectionPanel } from './CombatSelectionModal-handlers/combatSelectionModalAttackerPanel';

import type {
  CombatSelectionModalProps,
  AttackerSelection,
  BlockerSelection,
} from './CombatSelectionModal-handlers/combatSelectionModalTypes';
export type {
  DefenderAttackInfo,
  CombatSelectionModalProps,
  AttackerSelection,
  BlockerSelection,
} from './CombatSelectionModal-handlers/combatSelectionModalTypes';





export function CombatSelectionModal({
  open,
  mode,
  availableCreatures,
  attackingCreatures = [],
  battlefield = [],
  players = [],
  defenders: defendersProp = [],
  defenderInfoMap,
  initialAttackTargets,
  onAttackTargetsChange,
  onConfirm,
  onSkip,
  onCancel,
  minimized = false,
  onMinimize,
  onRestore,
  errorMessage,
  readOnly = false,
  isYourTurn = true,
}: CombatSelectionModalProps) {
  // For attackers: selected creatures and their targets
  const [selectedAttackers, setSelectedAttackers] = useState<Map<string, string | undefined>>(new Map());
  
  // For blockers: which blockers block which attackers
  const [selectedBlockers, setSelectedBlockers] = useState<Map<string, Set<string>>>(new Map());
  
  // Bulk attack target selection
  const [bulkAttackTarget, setBulkAttackTarget] = useState<string>('');
  const [bulkAttackCount, setBulkAttackCount] = useState<number>(0);
  
  // Group target selection (for selecting target per token group)
  const [groupTargets, setGroupTargets] = useState<Map<string, string>>(new Map());
  
  // Determine if the modal should be interactive
  // For attackers mode, only the turn player can interact
  // For blockers mode, only the defending player can interact
  const isInteractive = !readOnly && (mode === 'blockers' || isYourTurn);
  const isReadOnlyAttackerView = readOnly && mode === 'attackers';
  const isReadOnlyBlockerView = readOnly && mode === 'blockers';
  const defenders = useMemo(
    () => defendersProp.filter((player) => playerIsLegalAttackTarget(player)),
    [defendersProp],
  );
  
  // Reset selections when the modal opens or switches mode — not when defender
  // list identity churns from game-state broadcasts (that wiped in-progress
  // token-group +/- assignments during declare blockers).
  React.useEffect(() => {
    if (!open) return;
    const nextAttackers = new Map<string, string | undefined>();
    if (mode === 'attackers' && !readOnly && isYourTurn) {
      const defenderIdList = defenders.map((defender) => String(defender.id || '').trim()).filter(Boolean);
      for (const creature of availableCreatures) {
        if (creature.tapped || !permanentMustAttackIfAble(creature)) continue;
        if (!canCreatureAttackNow(creature, battlefield)) continue;
        nextAttackers.set(creature.id, preferredForcedAttackTarget(creature, defenderIdList));
      }
    }
    setSelectedAttackers(nextAttackers);
    setSelectedBlockers(new Map());
    setBulkAttackTarget(defenders[0]?.id || '');
    setBulkAttackCount(0);
    setGroupTargets(new Map());
    // intentionally omit defenders / initialAttackTargets — see below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  // Seed bulk attack target once defenders are available without clearing selections.
  React.useEffect(() => {
    if (!open || mode !== 'attackers') return;
    const legalIds = new Set(
      defenders.map((defender) => String(defender.id || '').trim()).filter(Boolean),
    );
    const firstDefenderId = defenders[0]?.id || '';
    setBulkAttackTarget((prev) => {
      const current = String(prev || '').trim();
      if (current && legalIds.has(current)) return prev;
      return firstDefenderId;
    });
  }, [open, mode, defenders]);

  // In read-only attackers mode, keep selections synced to the provided targets (live preview).
  React.useEffect(() => {
    if (!open) return;
    if (mode !== 'attackers') return;
    if (!readOnly) return;
    if (!initialAttackTargets) return;

    setSelectedAttackers(new Map(Object.entries(initialAttackTargets)));
  }, [open, mode, readOnly, initialAttackTargets]);

  // Notify parent when interactive attacker targets change (for live preview broadcast).
  React.useEffect(() => {
    if (!open) return;
    if (mode !== 'attackers') return;
    if (!isInteractive) return;
    if (!onAttackTargetsChange) return;

    const targets: Record<string, string> = {};
    for (const [creatureId, targetId] of selectedAttackers.entries()) {
      if (!targetId) continue;
      targets[String(creatureId)] = String(targetId);
    }
    onAttackTargetsChange(targets);
  }, [open, mode, isInteractive, onAttackTargetsChange, selectedAttackers]);

  // Filter to only untapped creatures for attackers (interactive only)
  const availableForAttack = useMemo(() => {
    return readOnly ? availableCreatures : availableCreatures.filter(c => !c.tapped);
  }, [availableCreatures, readOnly]);

  const forcedAttackerIds = useMemo(() => {
    const ids = new Set<string>();
    if (mode !== 'attackers' || !isInteractive) return ids;
    for (const creature of availableForAttack) {
      if (!permanentMustAttackIfAble(creature)) continue;
      if (!canCreatureAttackNow(creature, battlefield)) continue;
      ids.add(creature.id);
    }
    return ids;
  }, [mode, isInteractive, availableForAttack, battlefield]);

  const defenderIds = useMemo(
    () => defenders.map((defender) => String(defender.id || '').trim()).filter(Boolean),
    [defenders],
  );

  // Goaded / must-attack creatures cannot be left out of the declaration (Rule 701.15b).
  React.useEffect(() => {
    if (!open || !isInteractive || mode !== 'attackers') return;
    if (forcedAttackerIds.size === 0) return;
    setSelectedAttackers((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const creature of availableForAttack) {
        if (!forcedAttackerIds.has(creature.id) || next.has(creature.id)) continue;
        next.set(creature.id, preferredForcedAttackTarget(creature, defenderIds));
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [open, isInteractive, mode, availableForAttack, forcedAttackerIds, defenderIds]);

  const defenderNameById = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const defender of defenders) {
      lookup.set(String(defender.id), defender.name);
    }
    return lookup;
  }, [defenders]);

  const playerNameById = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const player of players) {
      lookup.set(String(player.id), player.name);
    }
    for (const [id, name] of defenderNameById.entries()) {
      if (!lookup.has(id)) lookup.set(id, name);
    }
    return lookup;
  }, [players, defenderNameById]);

  // Filter to only untapped creatures for blocking
  const availableForBlock = useMemo(() => {
    return availableCreatures.filter(c => !c.tapped);
  }, [availableCreatures]);

  const battlefieldForBlocking = useMemo(() => {
    if (battlefield.length > 0) return battlefield;
    const byId = new Map<string, BattlefieldPermanent>();
    for (const perm of [...availableForBlock, ...attackingCreatures]) {
      if (perm?.id) byId.set(perm.id, perm);
    }
    return Array.from(byId.values());
  }, [battlefield, availableForBlock, attackingCreatures]);

  const unblockableAttackers = useMemo(() => {
    const reasons = new Map<string, string>();
    const defendingPlayerId = availableForBlock[0]?.controller;
    for (const attacker of attackingCreatures) {
      const reason = getLandwalkUnblockableReason(attacker, defendingPlayerId, battlefieldForBlocking);
      if (reason) reasons.set(attacker.id, reason);
    }
    return reasons;
  }, [attackingCreatures, availableForBlock, battlefieldForBlocking]);
  
  // Group creatures for display
  const creatureGroups = useMemo(() => {
    return groupCreatures(availableForAttack);
  }, [availableForAttack]);

  const { unique: uniqueAttackerGroups, stacks: stackAttackerGroups } = useMemo(
    () => splitCreatureGroups(creatureGroups),
    [creatureGroups],
  );
  
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
        // Deselect voluntary attackers; goaded / must-attack creatures stay selected.
        for (const c of group.creatures) {
          if (forcedAttackerIds.has(c.id)) continue;
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

  const handleAdjustGroupSelection = (group: CreatureGroup, delta: number, targetId: string) => {
    if (!isInteractive || delta === 0) return;
    setSelectedAttackers(prev => {
      const next = new Map(prev);
      if (delta > 0) {
        const unselected = group.creatures.filter(c => !next.has(c.id));
        for (const creature of unselected.slice(0, delta)) {
          next.set(creature.id, targetId);
        }
      } else {
        const selected = group.creatures.filter(c => next.has(c.id) && !forcedAttackerIds.has(c.id));
        for (const creature of selected.slice(0, -delta)) {
          next.delete(creature.id);
        }
      }
      return next;
    });
  };
  
  // Clear all selections
  const handleClearAll = () => {
    if (!isInteractive) return;
    const next = new Map<string, string | undefined>();
    for (const creature of availableForAttack) {
      if (!forcedAttackerIds.has(creature.id)) continue;
      next.set(creature.id, preferredForcedAttackTarget(creature, defenderIds));
    }
    setSelectedAttackers(next);
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
        .filter(([_, attackerIds]) => attackerIds.has(attacker.id))
        .map(([bid]) => bid);
      
      // Check if any available blocker is NOT blocking this attacker
      // (In a full implementation, we'd also check for "can't block" effects)
      const unassignedBlockers = availableForBlock.filter(b => {
        if (!canBlockAttacker(b, attacker, battlefieldForBlocking).canBlock) return false;
        const currentAssignments = selectedBlockers.get(b.id);
        if (!currentAssignments || currentAssignments.has(attacker.id)) {
          return true;
        }
        return currentAssignments.size < getBlockerCapacity(b);
      });
      
      const notBlockingLure = unassignedBlockers.filter(b => !blockersForThisAttacker.includes(b.id));
      
      if (notBlockingLure.length > 0) {
        violations.set(attacker.id, `${name} has Lure - all ${notBlockingLure.length} able creature(s) must block it`);
      }
    }
    
    return violations;
  }, [attackingCreatures, selectedBlockers, availableForBlock, battlefieldForBlocking]);
  
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
      const next = cloneSelectedBlockers(prev);
      
      // For each Lure attacker, assign all able blockers
      for (const attacker of attackersWithLure) {
        for (const blocker of availableForBlock) {
          if (!canBlockAttacker(blocker, attacker, battlefieldForBlocking).canBlock) continue;
          const currentAssignments = next.get(blocker.id) || new Set<string>();
          if (currentAssignments.has(attacker.id)) continue;
          if (currentAssignments.size < getBlockerCapacity(blocker)) {
            currentAssignments.add(attacker.id);
            next.set(blocker.id, currentAssignments);
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

  const { unique: uniqueBlockerGroups, stacks: stackBlockerGroups } = useMemo(
    () => splitCreatureGroups(blockerGroups),
    [blockerGroups],
  );

  const handleToggleAttacker = (creatureId: string) => {
    if (!isInteractive) return; // Don't allow interaction if read-only
    setSelectedAttackers(prev => {
      const next = new Map(prev);
      if (next.has(creatureId)) {
        if (forcedAttackerIds.has(creatureId)) return prev;
        next.delete(creatureId);
      } else {
        const creature = availableForAttack.find((perm) => perm.id === creatureId);
        next.set(creatureId, preferredForcedAttackTarget(creature, defenderIds) || defenders[0]?.id);
      }
      return next;
    });
  };

  const handleSetAttackTarget = (creatureId: string, targetId: string) => {
    if (!isInteractive) return;
    setSelectedAttackers(prev => {
      const next = new Map(prev);
      next.set(creatureId, targetId);
      return next;
    });
  };

  const handleSkip = () => {
    if (!isInteractive) return;
    if (mode === 'attackers' && forcedAttackerIds.size > 0) return;
    onSkip();
  };

  const handleToggleBlocker = (blocker: BattlefieldPermanent, attackerId: string) => {
    if (!isInteractive) return;
    const attacker = attackingCreatures.find((perm) => perm.id === attackerId);
    if (!attacker) return;

    setSelectedBlockers(prev => {
      const next = cloneSelectedBlockers(prev);
      const blockerId = blocker.id;
      const assignments = next.get(blockerId) || new Set<string>();
      if (assignments.has(attackerId)) {
        assignments.delete(attackerId);
        if (assignments.size === 0) {
          next.delete(blockerId);
        } else {
          next.set(blockerId, assignments);
        }
      } else {
        const { canBlock } = canBlockAttacker(blocker, attacker, battlefieldForBlocking);
        if (!canBlock) return prev;
        if (assignments.size < getBlockerCapacity(blocker)) {
          assignments.add(attackerId);
          next.set(blockerId, assignments);
        }
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
      const missingForced = availableForAttack.filter(
        (creature) => forcedAttackerIds.has(creature.id) && !selectedAttackers.has(creature.id),
      );
      if (missingForced.length > 0) return;
      const selections = buildAttackerSelections(selectedAttackers, availableForAttack);
      onConfirm(selections);
    } else {
      const selections: BlockerSelection[] = [];
      selectedBlockers.forEach((attackerIds, blockerId) => {
        attackerIds.forEach(attackerId => {
          selections.push({ blockerId, attackerId });
        });
      });
      onConfirm(selections);
    }
  };

  if (!open) return null;

  const modalTitle = isReadOnlyAttackerView
    ? '⚔️ Incoming Attacks'
    : isReadOnlyBlockerView
      ? '🛡️ Combat Snapshot'
      : mode === 'attackers'
        ? '⚔️ Declare Attackers'
        : '🛡️ Declare Blockers';

  if (minimized) {
    const blockCount = countTotalBlockAssignments(selectedBlockers);
    const summary =
      mode === 'attackers'
        ? `${selectedAttackers.size} attacker${selectedAttackers.size !== 1 ? 's' : ''}`
        : `${blockCount} block${blockCount !== 1 ? 's' : ''}`;

    return (
      <div
        onClick={onRestore}
        style={{
          position: 'fixed',
          bottom: 16,
          left: 16,
          background:
            mode === 'attackers'
              ? 'linear-gradient(135deg, rgba(239,68,68,0.92), rgba(185,28,28,0.92))'
              : 'linear-gradient(135deg, rgba(16,185,129,0.92), rgba(5,150,105,0.92))',
          border: mode === 'attackers' ? '2px solid #f87171' : '2px solid #34d399',
          borderRadius: 8,
          padding: '10px 14px',
          cursor: onRestore ? 'pointer' : 'default',
          zIndex: 10001,
          boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
        title="Click to expand combat declaration"
      >
        <span style={{ color: 'white', fontWeight: 600, fontSize: 13 }}>{modalTitle}</span>
        {isInteractive && (
          <span
            style={{
              background: 'rgba(255,255,255,0.2)',
              borderRadius: 10,
              padding: '2px 8px',
              fontSize: 11,
              color: 'white',
            }}
          >
            {summary}
          </span>
        )}
        <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11 }}>▸ Expand</span>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: readOnly ? 16 : 0,
        left: readOnly ? 16 : 0,
        right: readOnly ? 'auto' : 0,
        bottom: readOnly ? 'auto' : 0,
        backgroundColor: readOnly ? 'transparent' : 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: readOnly ? 'flex-start' : 'center',
        justifyContent: readOnly ? 'flex-start' : 'center',
        zIndex: 10001,
        pointerEvents: readOnly ? 'none' : 'auto',
      }}
    >
      <div
        style={{
          backgroundColor: readOnly ? 'rgba(26, 26, 46, 0.96)' : '#1a1a2e',
          borderRadius: 12,
          padding: readOnly ? 18 : 24,
          maxWidth: readOnly ? 420 : 900,
          width: readOnly ? 'min(420px, calc(100vw - 32px))' : '95%',
          maxHeight: readOnly ? '70vh' : '85vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
          border: readOnly ? '1px solid rgba(148, 163, 184, 0.35)' : 'none',
          pointerEvents: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{modalTitle}</h2>
          {(onMinimize || onCancel) && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {onMinimize && (
                <button
                  onClick={onMinimize}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#9ca3af',
                    cursor: 'pointer',
                    fontSize: 14,
                    padding: '2px 8px',
                  }}
                  title="Minimize"
                >
                  ─
                </button>
              )}
              {(onCancel || onMinimize) && (
                <button
                  onClick={onCancel ?? onMinimize}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#888',
                    fontSize: 24,
                    cursor: 'pointer',
                    lineHeight: 1,
                    padding: '0 4px',
                  }}
                  title="Minimize"
                >
                  ×
                </button>
              )}
            </div>
          )}
        </div>

        <div style={{ fontSize: 13, color: '#aaa', marginBottom: 16 }}>
          {isReadOnlyAttackerView
            ? 'Live preview of the active player\'s attack allocations. This panel is informational and does not block your priority actions.'
            : isReadOnlyBlockerView
              ? 'Read-only combat view for watching attackers and blockers as combat develops.'
              : mode === 'attackers'
                ? 'Click unique creatures to select them. Identical tokens stay grouped so you can assign them in bulk. Choose a target for each attacker.'
                : 'Click unique creatures to assign blockers, or use +/- on identical tokens. Watch for dangerous abilities!'}
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
                {errorMessage && (
                  <div style={{ marginTop: 8, color: '#fca5a5', fontSize: 13 }}>
                    {errorMessage}
                  </div>
                )}
        {mode === 'attackers' && isInteractive && forcedAttackerIds.size > 0 && (
          <div style={{
            padding: '8px 12px',
            backgroundColor: 'rgba(217,119,6,0.2)',
            border: '1px solid #d97706',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 12,
            color: '#fbbf24',
          }}>
            Goaded creatures must attack if able. Don't Attack is unavailable until they are declared.
          </div>
        )}

        <CombatAttackerSelectionPanel
          mode={mode}
          isInteractive={isInteractive}
          availableForAttack={availableForAttack}
          defenders={defenders}
          defenderInfoMap={defenderInfoMap}
          selectedAttackers={selectedAttackers}
          unselectedCount={unselectedCount}
          handleAttackAll={handleAttackAll}
          bulkAttackCount={bulkAttackCount}
          setBulkAttackCount={setBulkAttackCount}
          bulkAttackTarget={bulkAttackTarget}
          setBulkAttackTarget={setBulkAttackTarget}
          handleBulkAttack={handleBulkAttack}
          handleClearAll={handleClearAll}
          isReadOnlyAttackerView={isReadOnlyAttackerView}
          stackAttackerGroups={stackAttackerGroups}
          uniqueAttackerGroups={uniqueAttackerGroups}
          groupTargets={groupTargets}
          setGroupTargets={setGroupTargets}
          handleAdjustGroupSelection={handleAdjustGroupSelection}
          handleToggleGroup={handleToggleGroup}
          handleToggleAttacker={handleToggleAttacker}
          handleSetAttackTarget={handleSetAttackTarget}
          battlefieldForBlocking={battlefieldForBlocking}
          playerNameById={playerNameById}
        />

        <CombatBlockerSelectionPanel
          mode={mode}
          lureViolations={lureViolations}
          handleAutoBlockLure={handleAutoBlockLure}
          availableForBlock={availableForBlock}
          attackingCreatures={attackingCreatures}
          selectedBlockers={selectedBlockers}
          setSelectedBlockers={setSelectedBlockers}
          battlefieldForBlocking={battlefieldForBlocking}
          playerNameById={playerNameById}
          menaceViolations={menaceViolations}
          unblockableAttackers={unblockableAttackers}
          stackBlockerGroups={stackBlockerGroups}
          uniqueBlockerGroups={uniqueBlockerGroups}
          handleToggleBlocker={handleToggleBlocker}
        />

        {/* Action buttons */}
        {isInteractive && (
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
              onClick={handleSkip}
              disabled={!isInteractive || (mode === 'attackers' && forcedAttackerIds.size > 0)}
              title={
                mode === 'attackers' && forcedAttackerIds.size > 0
                  ? 'Goaded creatures must attack if able'
                  : undefined
              }
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: '1px solid #4a4a6a',
                backgroundColor: 'transparent',
                color: '#fff',
                cursor: (!isInteractive || (mode === 'attackers' && forcedAttackerIds.size > 0))
                  ? 'not-allowed'
                  : 'pointer',
                fontSize: 14,
                opacity: (!isInteractive || (mode === 'attackers' && forcedAttackerIds.size > 0)) ? 0.5 : 1,
              }}
            >
              {mode === 'attackers' ? "Don't Attack" : "Don't Block"}
            </button>
            <button
              onClick={handleConfirm}
              disabled={
                !isInteractive ||
                (mode === 'attackers' && selectedAttackers.size === 0) ||
                (mode === 'blockers' && menaceViolations.size > 0)
              }
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: mode === 'attackers' ? '#ef4444' : '#10b981',
                color: '#fff',
                cursor: (!isInteractive ||
                  (mode === 'attackers' && selectedAttackers.size === 0) ||
                  (mode === 'blockers' && menaceViolations.size > 0)) ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 600,
                opacity: (
                  !isInteractive ||
                  (mode === 'attackers' && selectedAttackers.size === 0) ||
                  (mode === 'blockers' && menaceViolations.size > 0)
                ) ? 0.5 : 1,
              }}
            >
              {mode === 'attackers' 
                ? `Attack with ${selectedAttackers.size} Creature${selectedAttackers.size !== 1 ? 's' : ''}`
                : `Confirm Blockers (${countTotalBlockAssignments(selectedBlockers)})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default CombatSelectionModal;
