// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: targeting helpers (color names, source info, selected-target legality).
// Public entry symbols: getTargetingColorNames, getSourceTypeName, buildTargetingSourceInfo,
// isTargetCardPresentInState, evaluateSelectedTargetLegality, validateSelectedTargetsForSource,
// getAbilitySourceObject, getStackSourceTypeName, isStackTargetCurrentlyLegal,
// getLegalStackTargetIds.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import type { ActivatedAbility } from '../activatedAbilities';
import { getColorsFromObject } from '../oracleIRExecutorManaUtils';
import { canTargetPermanent } from '../permanentTargeting';
import { canTargetPlayer } from '../playerProtection';
import type { StackObject } from '../spellCasting';
import { getStackItems } from '../stackOperations';

type ActionValidation = {
  readonly legal: boolean;
  readonly reason?: string;
  readonly requirements?: string[];
};

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterTargetingHelpersHost = any;

export function getTargetingColorNames(colors: readonly string[] | undefined): readonly string[] {
    const out: string[] = [];

    for (const color of colors || []) {
      const normalized = String(color || '').trim().toUpperCase();
      const colorName = normalized === 'W'
        ? 'white'
        : normalized === 'U'
          ? 'blue'
          : normalized === 'B'
            ? 'black'
            : normalized === 'R'
              ? 'red'
              : normalized === 'G'
                ? 'green'
                : undefined;
      if (colorName) {
        out.push(colorName);
      }
    }

    return out;
  }

export function getSourceTypeName(sourceObject: any): string | undefined {
    const typeLine = String(
      sourceObject?.card?.type_line ||
      sourceObject?.card?.cardType ||
      sourceObject?.type_line ||
      sourceObject?.cardType ||
      ''
    ).toLowerCase();
    if (typeLine.includes('instant')) return 'instant';
    if (typeLine.includes('sorcery')) return 'sorcery';
    if (typeLine.includes('creature')) return 'creature';
    if (typeLine.includes('artifact')) return 'artifact';
    if (typeLine.includes('enchantment')) return 'enchantment';
    if (typeLine.includes('planeswalker')) return 'planeswalker';
    if (typeLine.includes('battle')) return 'battle';
    if (typeLine.includes('land')) return 'land';
    return undefined;
  }

export function buildTargetingSourceInfo(
    controllerId: string,
    sourceObject: any,
    objectType: 'spell' | 'ability',
  ): {
    readonly controllerId: string;
    readonly colors?: readonly string[];
    readonly objectType: 'spell' | 'ability';
    readonly typeName?: string;
  } {
    const colors = this.normalizeColorSymbols(getColorsFromObject(sourceObject));
    return {
      controllerId: String(controllerId || '').trim(),
      ...(colors && colors.length > 0 ? { colors } : {}),
      objectType,
      ...(this.getSourceTypeName(sourceObject) ? { typeName: this.getSourceTypeName(sourceObject) } : {}),
    };
  }

export function isTargetCardPresentInState(state: GameState, targetId: string): boolean {
    const normalizedTargetId = String(targetId || '').trim();
    if (!normalizedTargetId) return false;

    for (const entry of state.players || []) {
      for (const zoneName of ['hand', 'graveyard', 'exile', 'library', 'commandZone'] as const) {
        const zone = (entry as any)?.[zoneName];
        if (!Array.isArray(zone)) continue;
        if (zone.some((card: any) => String(card?.id || card?.cardId || '').trim() === normalizedTargetId)) {
          return true;
        }
      }
    }

    for (const zone of Object.values((state as any)?.commandZone || {})) {
      if (!Array.isArray(zone)) continue;
      if (zone.some((card: any) => String(card?.id || card?.cardId || '').trim() === normalizedTargetId)) {
        return true;
      }
    }

    return getStackItems((state as any)?.stack).some(
      (item: any) => String(item?.id || '').trim() === normalizedTargetId
    );
  }

export function evaluateSelectedTargetLegality(
    state: GameState,
    targetId: string,
    sourceInfo: {
      readonly controllerId: string;
      readonly colors?: readonly string[];
      readonly objectType: 'spell' | 'ability';
      readonly typeName?: string;
    }
  ): { readonly legal: boolean; readonly reason?: string } {
    const normalizedTargetId = String(targetId || '').trim();
    if (!normalizedTargetId) {
      return { legal: false, reason: 'target not found' };
    }

    const battlefield = Array.isArray(state.battlefield) ? (state.battlefield as any[]) : [];
    const permanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === normalizedTargetId);
    if (permanent) {
      const result = canTargetPermanent(permanent, {
        controllerId: sourceInfo.controllerId,
        colors: sourceInfo.colors,
        objectType: sourceInfo.objectType,
      });
      return {
        legal: result.canTarget,
        ...(result.reason ? { reason: result.reason } : {}),
      };
    }

    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === normalizedTargetId);
    if (player) {
      const unrestrictedResult = canTargetPlayer(
        state,
        normalizedTargetId,
        sourceInfo.controllerId,
        undefined,
        sourceInfo.typeName,
      );
      if (!unrestrictedResult.canTarget) {
        return {
          legal: false,
          ...(unrestrictedResult.reason ? { reason: unrestrictedResult.reason } : {}),
        };
      }

      for (const colorName of this.getTargetingColorNames(sourceInfo.colors)) {
        const colorResult = canTargetPlayer(
          state,
          normalizedTargetId,
          sourceInfo.controllerId,
          colorName,
          sourceInfo.typeName,
        );
        if (!colorResult.canTarget) {
          return {
            legal: false,
            ...(colorResult.reason ? { reason: colorResult.reason } : {}),
          };
        }
      }

      return { legal: true };
    }

    if (this.isTargetCardPresentInState(state, normalizedTargetId)) {
      return { legal: true };
    }

    return { legal: false, reason: 'target not found' };
  }

export function validateSelectedTargetsForSource(
    state: GameState,
    targetIds: readonly unknown[] | undefined,
    sourceInfo: {
      readonly controllerId: string;
      readonly colors?: readonly string[];
      readonly objectType: 'spell' | 'ability';
      readonly typeName?: string;
    }
  ): ActionValidation {
    const normalizedTargetIds = Array.from(
      new Set(
        (Array.isArray(targetIds) ? targetIds : [])
          .map((targetId: unknown) => String(targetId || '').trim())
          .filter(Boolean)
      )
    );

    for (const targetId of normalizedTargetIds) {
      const legality = this.evaluateSelectedTargetLegality(state, targetId, sourceInfo);
      if (!legality.legal) {
        return {
          legal: false,
          reason: legality.reason
            ? `Illegal target ${targetId}: ${legality.reason}`
            : `Illegal target ${targetId}`,
        };
      }
    }

    return { legal: true };
  }

export function getAbilitySourceObject(state: GameState, ability: ActivatedAbility, action: any): any {
    const sourceId = String(ability?.sourceId || action?.sourceId || '').trim();
    const battlefield = Array.isArray(state.battlefield) ? (state.battlefield as any[]) : [];
    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
    if (sourcePermanent) {
      return (sourcePermanent as any).card || sourcePermanent;
    }

    const sourceZone = String(ability?.sourceZone || action?.sourceZone || '').trim().toLowerCase();
    if (sourceId && (sourceZone === 'graveyard' || sourceZone === 'hand' || sourceZone === 'exile')) {
      for (const player of state.players || []) {
        const zone = (player as any)?.[sourceZone];
        if (!Array.isArray(zone)) continue;
        const sourceCard = zone.find((card: any) => String(card?.id || card?.cardId || '').trim() === sourceId);
        if (sourceCard) return sourceCard;
      }
    }

    return action?.source || ability;
  }

export function getStackSourceTypeName(stackObject: StackObject | any): string | undefined {
    return this.getSourceTypeName((stackObject as any)?.card || stackObject);
  }

export function isStackTargetCurrentlyLegal(state: GameState, stackObject: StackObject | any, targetId: string): boolean {
    return this.evaluateSelectedTargetLegality(
      state,
      targetId,
      {
        controllerId: String(stackObject.controllerId || '').trim(),
        ...(this.normalizeColorSymbols(getColorsFromObject((stackObject as any).card || stackObject))
          ? { colors: this.normalizeColorSymbols(getColorsFromObject((stackObject as any).card || stackObject)) }
          : {}),
        objectType: stackObject.type === 'ability' ? 'ability' : 'spell',
        ...(this.getStackSourceTypeName(stackObject) ? { typeName: this.getStackSourceTypeName(stackObject) } : {}),
      }
    ).legal;
  }

export function getLegalStackTargetIds(state: GameState, stackObject: StackObject | any): readonly string[] {
    return (Array.isArray(stackObject?.targets) ? stackObject.targets : [])
      .map((target: any) => String(target || '').trim())
      .filter((targetId: string) => targetId.length > 0)
      .filter((targetId: string) => this.isStackTargetCurrentlyLegal(state, stackObject, targetId));
  }
