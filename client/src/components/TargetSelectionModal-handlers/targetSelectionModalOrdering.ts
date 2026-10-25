// client/src/components/TargetSelectionModal-handlers/targetSelectionModalOrdering.ts
// Pure target ordering/grouping for TargetSelectionModal: mode-preferred target inference and grouping
// by type or controller (viewer's group first). Extracted from TargetSelectionModal.tsx (size limit).
// Public entry symbols: modePreferredTypesFor, isModePreferredTargetFor, groupTargetsForModal.

import type { TargetType, TargetOption } from './targetSelectionModalSupport';
import { formatControllerGroupLabel } from './targetSelectionModalSupport';

type Mode = { name?: string; description?: string } | undefined;

export function modePreferredTypesFor(selectedMode: Mode): Set<TargetType> {
  const text = `${selectedMode?.name || ''} ${selectedMode?.description || ''}`.toLowerCase();
  if (!text.trim()) return new Set<TargetType>();

  const prefers = new Set<TargetType>();
  if (text.includes('target player') || text.includes('target opponent') || text.includes('target yourself')) {
    prefers.add('player');
  }
  if (
    text.includes('target creature') ||
    text.includes('target permanent') ||
    text.includes('target artifact') ||
    text.includes('target enchantment') ||
    text.includes('target planeswalker')
  ) {
    prefers.add('permanent');
  }
  if (text.includes('target card') || text.includes('target spell') || text.includes('target instant') || text.includes('target sorcery')) {
    prefers.add('card');
  }
  return prefers;
}

export function isModePreferredTargetFor(target: TargetOption, selectedMode: Mode, viewerPlayerId: string | undefined, modePreferredTypes: Set<TargetType>): boolean {
  if (!selectedMode?.name && !selectedMode?.description) return true;

  const text = `${selectedMode?.name || ''} ${selectedMode?.description || ''}`.toLowerCase();
  if (!text.trim()) return true;

  // If we can't infer anything from the mode text, don't penalize anything.
  const inferredTypes = modePreferredTypes;
  if (inferredTypes.size === 0) return true;

  if (target.type === 'player') {
    if (!inferredTypes.has('player')) return false;

    // Handle opponent/self constraints when possible.
    if (viewerPlayerId) {
      if (text.includes('target opponent')) return target.id !== viewerPlayerId;
      if (text.includes('target yourself') || text.includes('target you')) return target.id === viewerPlayerId;
    }

    return true;
  }

  const targetTypeLine = (
    target.typeLine ||
    (target.card && (target.card as any).type_line) ||
    ''
  ).toLowerCase();

  if (target.type === 'card') {
    // If mode references cards/spells, prefer card targets.
    // If we have a type line, use it to be a bit more precise.
    if (!inferredTypes.has('card')) return false;
    if (!targetTypeLine) return true;

    if (text.includes('instant') && !targetTypeLine.includes('instant')) return false;
    if (text.includes('sorcery') && !targetTypeLine.includes('sorcery')) return false;
    if (text.includes('creature card') && !targetTypeLine.includes('creature')) return false;
    return true;
  }

  // Permanent targets: use the type line where possible.
  if (!inferredTypes.has('permanent')) return false;
  if (!targetTypeLine) return true;

  const wantsCreature = text.includes('target creature');
  const wantsArtifact = text.includes('target artifact');
  const wantsEnchantment = text.includes('target enchantment');
  const wantsPlaneswalker = text.includes('target planeswalker');
  const wantsLand = text.includes('target land');
  const wantsPermanent = text.includes('target permanent');
  const wantsAnyTarget = text.includes('any target');

  // Controller constraints when we have controller info.
  if (viewerPlayerId && target.controller) {
    if (text.includes('you control') && target.controller !== viewerPlayerId) return false;
    if ((text.includes("an opponent controls") || text.includes("opponent controls")) && target.controller === viewerPlayerId) return false;
  }

  // "Any target" typically means creature/planeswalker/player.
  if (wantsAnyTarget) {
    if (targetTypeLine.includes('creature') || targetTypeLine.includes('planeswalker')) return true;
    return false;
  }

  if (wantsAnyTarget || wantsPermanent) return true;

  // If mode specifies a concrete permanent type, require it.
  if (wantsCreature && !targetTypeLine.includes('creature')) return false;
  if (wantsArtifact && !targetTypeLine.includes('artifact')) return false;
  if (wantsEnchantment && !targetTypeLine.includes('enchantment')) return false;
  if (wantsPlaneswalker && !targetTypeLine.includes('planeswalker')) return false;
  if (wantsLand && !targetTypeLine.includes('land')) return false;

  // If mode doesn't specify a particular permanent type, allow.
  return true;
}

export function groupTargetsForModal(targets: TargetOption[], groupByType: boolean, groupByController: boolean, viewerPlayerId: string | undefined): Record<string, TargetOption[]> {
  const permanentControllers = new Set(
    targets
      .filter((target) => target.type === 'permanent' && target.controller)
      .map((target) => String(target.controller)),
  );
  const autoGroupByController = permanentControllers.size > 1;
  const useControllerGroups = groupByController || autoGroupByController;

  if (!groupByType && !useControllerGroups) {
    return { 'All Targets': targets };
  }

  const groups: Record<string, TargetOption[]> = {};
  const groupOrder: string[] = [];

  const pushGroup = (groupKey: string, target: TargetOption) => {
    if (!groups[groupKey]) {
      groups[groupKey] = [];
      groupOrder.push(groupKey);
    }
    groups[groupKey].push(target);
  };

  for (const target of targets) {
    let groupKey: string;

    if (useControllerGroups && target.controller && target.type === 'permanent') {
      groupKey = formatControllerGroupLabel(target.controller, target.controllerName, viewerPlayerId);
    } else if (useControllerGroups && target.controller) {
      if (target.type === 'stack') {
        groupKey = 'Spells & abilities on the stack';
      } else {
        groupKey = formatControllerGroupLabel(target.controller, target.controllerName, viewerPlayerId)
          .replace('permanents', target.type === 'card' ? 'cards' : 'targets');
      }
    } else if (groupByType) {
      switch (target.type) {
        case 'player':
          groupKey = 'Players';
          break;
        case 'permanent':
          groupKey = 'Permanents';
          break;
        case 'stack':
          groupKey = String(target.typeLine || '').toLowerCase().includes('ability')
            ? 'Abilities on the stack'
            : 'Spells on the stack';
          break;
        case 'card':
          groupKey = target.zone === 'stack'
            ? 'Spells on the stack'
            : (target.zone ? `Cards in ${target.zone}` : 'Cards');
          break;
        default:
          groupKey = 'Other';
      }
    } else {
      groupKey = 'All Targets';
    }

    pushGroup(groupKey, target);
  }

  // Keep the viewer's group first when controller-grouped.
  const ordered: Record<string, TargetOption[]> = {};
  const yoursKey = viewerPlayerId
    ? formatControllerGroupLabel(
        viewerPlayerId,
        targets.find((t) => t.controller === viewerPlayerId)?.controllerName,
        viewerPlayerId,
      )
    : null;
  if (yoursKey && groups[yoursKey]) ordered[yoursKey] = groups[yoursKey];
  for (const key of groupOrder) {
    if (yoursKey && key === yoursKey) continue;
    ordered[key] = groups[key];
  }
  return ordered;
}
