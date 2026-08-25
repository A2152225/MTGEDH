/**
 * socket/resolution-handlers/modeSelectionTargetOptionBuilders.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse, MODE_SELECTION case).
 * Cluster moved: the three local closures the generic mode-selection branch used to recompute a
 * follow-up TARGET_SELECTION step from the chosen mode's oracle text - target-ref to choice-option
 * mapping, a best-effort SpellSpec built from parsed target requirements, and the mode-text
 * restriction overlay (another/attacking/tapped/keyword/power-toughness).
 * Public entry symbols: buildModeChoiceOptionsFromTargetRefs,
 * buildModeSpellSpecFromTargetRequirements, applyModeRestrictionsToSpec.
 *
 * Split out of modeSelectionGenericChoiceHandlers.ts so neither file approaches the 40KB ceiling.
 * Must not import resolution.ts.
 */

import type { SpellSpec } from "../../rules-engine/targeting";

/** Map engine target refs to the client-facing choice options a TARGET_SELECTION step carries. */
export function buildModeChoiceOptionsFromTargetRefs(game: any, pid: string, refs: any[]): any[] {
  return refs
    .map((t: any) => {
      if (t?.kind === 'permanent') {
        const perm = (game.state.battlefield || []).find((p: any) => p.id === t.id);
        if (!perm) return null;
        return {
          id: t.id,
          label: perm?.card?.name || 'Unknown',
          description: 'permanent',
          imageUrl: perm?.card?.image_uris?.small || perm?.card?.image_uris?.normal,
          type: 'permanent',
          controller: perm?.controller,
          tapped: perm?.tapped === true,
          typeLine: perm?.card?.type_line,
          keywords: Array.isArray((perm?.card as any)?.keywords) ? (perm?.card as any).keywords : undefined,
          oracleText: (perm?.card as any)?.oracle_text,
          colors: (perm?.card as any)?.colors,
          colorIdentity: (perm?.card as any)?.color_identity,
          cmc: Number((perm?.card as any)?.cmc ?? 0),
          isToken: perm?.isToken === true,
          isOpponent: perm?.controller !== pid,
        };
      }

      if (t?.kind === 'stack') {
        const stackItem = ((game.state as any).stack || []).find((s: any) => s.id === t.id);
        if (!stackItem) return null;
        return {
          id: t.id,
          label: stackItem?.card?.name || 'Unknown',
          description: stackItem?.type || 'spell',
          imageUrl: stackItem?.card?.image_uris?.small || stackItem?.card?.image_uris?.normal,
          // Client treats stack targets best as 'card' for mode heuristics.
          type: 'card',
          controller: stackItem?.controller,
          typeLine: stackItem?.card?.type_line,
          keywords: Array.isArray((stackItem?.card as any)?.keywords) ? (stackItem?.card as any).keywords : undefined,
          oracleText: (stackItem?.card as any)?.oracle_text,
          colors: (stackItem?.card as any)?.colors,
          colorIdentity: (stackItem?.card as any)?.color_identity,
          cmc: Number((stackItem?.card as any)?.cmc ?? 0),
          isOpponent: stackItem?.controller !== pid,
        };
      }

      if (t?.kind === 'player') {
        const player = (game.state.players || []).find((p: any) => p.id === t.id);
        return {
          id: t.id,
          label: player?.name || t.id,
          description: 'player',
          type: 'player',
          life: player?.life,
          isOpponent: t.id !== pid,
        };
      }

      return null;
    })
    .filter(Boolean);
}

/** Best-effort SpellSpec for a chosen mode when categorizeSpell produced nothing usable. */
export function buildModeSpellSpecFromTargetRequirements(
  oracle: string,
  reqs: any,
  minTargets: number,
  maxTargets: number,
): SpellSpec | null {
  if (!reqs?.needsTargets) return null;

  const targetTypes = Array.isArray(reqs.targetTypes) ? reqs.targetTypes.map((x: any) => String(x).toLowerCase()) : [];
  const text = String(oracle || '').toLowerCase();

  // Stack-targeting.
  if (targetTypes.includes('spell')) {
    let spellTypeFilter: any = 'ANY_SPELL';
    if (/counter target noncreature spell/.test(text)) spellTypeFilter = 'NONCREATURE';
    else if (/counter target creature spell/.test(text)) spellTypeFilter = 'CREATURE_SPELL';
    else if (/counter target instant or sorcery/.test(text) || /counter target instant or sorcery spell/.test(text)) spellTypeFilter = 'INSTANT_SORCERY';
    return {
      op: 'COUNTER_TARGET_SPELL',
      filter: 'ANY',
      minTargets,
      maxTargets,
      targetDescription: reqs.targetDescription || 'target spell',
      spellTypeFilter,
    };
  }
  if (targetTypes.includes('ability')) {
    return {
      op: 'COUNTER_TARGET_ABILITY',
      filter: 'ANY',
      minTargets,
      maxTargets,
      targetDescription: reqs.targetDescription || 'target ability',
    };
  }

  // "Any target".
  if (targetTypes.includes('any') || /\bany\s+target\b/.test(text)) {
    return {
      op: 'ANY_TARGET_DAMAGE',
      filter: 'ANY',
      minTargets,
      maxTargets,
      targetDescription: reqs.targetDescription || 'any target',
    };
  }

  // Multi-type permanent targets.
  // Atraxa's Fall style: "artifact, battle, enchantment, or creature with flying"
  if (/artifact,?\s+battle,?\s+enchantment,?\s+or\s+creature\s+with\s+flying/.test(text)) {
    return {
      op: 'TARGET_PERMANENT',
      filter: 'ARTIFACT',
      minTargets,
      maxTargets,
      targetDescription: reqs.targetDescription || 'target artifact, battle, enchantment, or creature with flying',
      multiFilter: ['ARTIFACT', 'PERMANENT', 'ENCHANTMENT', 'CREATURE'],
      creatureRestriction: { type: 'has_keyword', description: 'with flying', keyword: 'flying' },
    };
  }

  if (/(\bartifact\b\s+or\s+\benchantment\b)/.test(text)) {
    return {
      op: 'TARGET_PERMANENT',
      filter: 'PERMANENT',
      minTargets,
      maxTargets,
      targetDescription: reqs.targetDescription || 'target artifact or enchantment',
      multiFilter: ['ARTIFACT', 'ENCHANTMENT'],
    };
  }

  // Generic comma-list OR patterns (best-effort).
  // Examples: "target artifact, enchantment, or planeswalker"; "target artifact, battle, or creature".
  if (/\btarget\b/.test(text) && /,\s*.*\bor\b/.test(text) && /\b(artifact|enchantment|battle|creature|planeswalker|land|permanent)\b/.test(text)) {
    const filters: any[] = [];
    if (text.includes('artifact')) filters.push('ARTIFACT');
    if (text.includes('enchantment')) filters.push('ENCHANTMENT');
    if (text.includes('planeswalker')) filters.push('PLANESWALKER');
    if (text.includes('land')) filters.push('LAND');
    if (text.includes('battle')) filters.push('PERMANENT');
    if (text.includes('creature')) filters.push('CREATURE');
    if (text.includes('permanent')) filters.push('PERMANENT');

    const unique = Array.from(new Set(filters));
    if (unique.length >= 2) {
      // If mode text includes "creature with <keyword>", apply restriction only to creatures.
      const creatureKeywordMatch = text.match(/creature\s+with\s+(flying|reach|trample)/);
      const creatureRestriction = creatureKeywordMatch
        ? ({ type: 'has_keyword', description: `with ${creatureKeywordMatch[1]}`, keyword: creatureKeywordMatch[1] } as any)
        : undefined;
      return {
        op: 'TARGET_PERMANENT',
        filter: unique[0] || 'PERMANENT',
        minTargets,
        maxTargets,
        targetDescription: reqs.targetDescription || 'target permanent',
        multiFilter: unique as any,
        ...(creatureRestriction ? { creatureRestriction } : {}),
      };
    }
  }

  // Single-type permanent targets.
  if (targetTypes.some((t: string) => t.includes('creature'))) {
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target creature' };
  }
  if (targetTypes.some((t: string) => t.includes('planeswalker'))) {
    return { op: 'TARGET_PERMANENT', filter: 'PLANESWALKER', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target planeswalker' };
  }
  if (targetTypes.some((t: string) => t.includes('artifact'))) {
    return { op: 'TARGET_PERMANENT', filter: 'ARTIFACT', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target artifact' };
  }
  if (targetTypes.some((t: string) => t.includes('enchantment'))) {
    return { op: 'TARGET_PERMANENT', filter: 'ENCHANTMENT', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target enchantment' };
  }
  if (targetTypes.some((t: string) => t.includes('land'))) {
    return { op: 'TARGET_PERMANENT', filter: 'LAND', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target land' };
  }
  if (targetTypes.some((t: string) => t.includes('nonland'))) {
    // Engine doesn't have a dedicated nonland filter; we'll post-filter by typeLine.
    return { op: 'TARGET_PERMANENT', filter: 'PERMANENT', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target nonland permanent' };
  }
  if (targetTypes.some((t: string) => t.includes('noncreature'))) {
    // Engine doesn't have a dedicated noncreature permanent filter; we'll post-filter by typeLine.
    return { op: 'TARGET_PERMANENT', filter: 'PERMANENT', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target noncreature permanent' };
  }
  if (targetTypes.some((t: string) => t.includes('permanent'))) {
    return { op: 'TARGET_PERMANENT', filter: 'PERMANENT', minTargets, maxTargets, targetDescription: reqs.targetDescription || 'target permanent' };
  }

  return null;
}

/** Overlay the chosen mode's wording onto a SpellSpec (another/attacking/tapped/keyword/stats). */
export function applyModeRestrictionsToSpec(spec: SpellSpec, modeTextRaw: string): SpellSpec {
  const text = String(modeTextRaw || '').toLowerCase();
  let next: SpellSpec = { ...spec };

  // "Another target" patterns: this mostly matters for permanent-sourced abilities.
  // In engine terms, excludeSource means the source permanent itself can't be chosen as a target.
  if (!next.excludeSource && /\banother\s+target\s+(?:creature|permanent|artifact|enchantment|land|planeswalker)\b/.test(text)) {
    next = { ...next, excludeSource: true };
  }
  // Also catch "other than" phrasing when it clearly refers to the source.
  if (!next.excludeSource && /\btarget\s+.*\bother\s+than\s+(?:this|that)\b/.test(text)) {
    next = { ...next, excludeSource: true };
  }

  // Attacking/blocking/tapped/untapped constraints (creatures only).
  if (/attacking or blocking creature/.test(text)) {
    next = {
      ...next,
      targetRestriction: { type: 'attacked_or_blocked_this_turn', description: 'that is attacking or blocking' },
      targetDescription: next.targetDescription || 'attacking or blocking creature',
    };
  } else if (/attacking creature/.test(text)) {
    next = {
      ...next,
      targetRestriction: { type: 'attacked_this_turn', description: 'that is attacking' },
      targetDescription: next.targetDescription || 'attacking creature',
    };
  } else if (/blocking creature/.test(text)) {
    next = {
      ...next,
      targetRestriction: { type: 'blocked_this_turn', description: 'that is blocking' },
      targetDescription: next.targetDescription || 'blocking creature',
    };
  } else if (/tapped creature/.test(text)) {
    next = {
      ...next,
      targetRestriction: { type: 'tapped', description: 'tapped' },
      targetDescription: next.targetDescription || 'tapped creature',
    };
  } else if (/untapped creature/.test(text)) {
    next = {
      ...next,
      targetRestriction: { type: 'untapped', description: 'untapped' },
      targetDescription: next.targetDescription || 'untapped creature',
    };
  }

  // Creature keyword constraints (engine supports these via has_keyword).
  // Keep this list aligned with what the engine can reasonably detect in keywords/oracle text.
  const keywordAbilities = [
    'flying',
    'reach',
    'trample',
    'deathtouch',
    'lifelink',
    'vigilance',
    'haste',
    'menace',
    'hexproof',
    'indestructible',
    'first strike',
    'double strike',
    'ward',
    'defender',
  ];
  const keywordGroup = keywordAbilities
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const keywordMatch = text.match(new RegExp(`\\b(?:creature\\s+)?(?:with|that\\s+has)\\s+(${keywordGroup})\\b`));
  if (keywordMatch) {
    const keyword = keywordMatch[1];
    // If spec is creature-only, apply as a targetRestriction.
    if (next.filter === 'CREATURE' && !next.multiFilter) {
      next = {
        ...next,
        targetRestriction: { type: 'has_keyword', description: `with ${keyword}`, keyword },
        targetDescription: next.targetDescription || `creature with ${keyword}`,
      };
    }
    // If spec is multi-type including creatures, apply creatureRestriction.
    if (Array.isArray(next.multiFilter) && (next.multiFilter as any[]).includes('CREATURE')) {
      next = {
        ...next,
        creatureRestriction: { type: 'has_keyword', description: `with ${keyword}`, keyword },
      };
    }
  }

  // Power/toughness constraints (engine supports these via statRequirement).
  // Examples: "target creature with toughness 4 or greater", "target creature with power 2 or less".
  if (!next.statRequirement) {
    const statMatch = text.match(/target\s+(?:attacking or blocking\s+)?creature\s+with\s+(power|toughness)\s+(\d+)\s+or\s+(greater|less)/);
    if (statMatch) {
      const stat = statMatch[1] as 'power' | 'toughness';
      const value = parseInt(statMatch[2], 10);
      const comparison = statMatch[3] === 'greater' ? '>=' : '<=';
      if (Number.isFinite(value)) {
        next = {
          ...next,
          statRequirement: { stat, comparison: comparison as any, value },
          targetDescription: next.targetDescription || `creature with ${stat} ${comparison} ${value}`,
        };
      }
    }
  }

  return next;
}
