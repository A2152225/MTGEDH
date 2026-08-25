/**
 * Extracted from loopShortcuts.ts: buildResolutionResponsePayload.
 * Cluster moved: buildResolutionResponsePayload.
 * Public: buildResolutionResponsePayload
 *
 * Leaf must not import loopShortcuts.ts or loopShortcuts-handlers/index.ts.
 */

import type { ClientGameView } from '../../../../shared/src';
import type { LoopShortcutPromptTemplate } from './loopShortcutsTypes';
import { clonePayload } from './loopShortcutsTextUtils';
import { buildIdSelectionsPayload } from './loopShortcutsIdSelectionsPayload';
import { rebindPaymentPermanentId, rebindProfileIds } from './loopShortcutsPaymentRebind';

export function buildResolutionResponsePayload(
  template: LoopShortcutPromptTemplate,
  step: any,
  view: ClientGameView | null | undefined,
  playerId: string | null | undefined
): { selections: unknown } | null {
  if (template.kind === 'option_choice') {
    return { selections: [...template.optionIds] };
  }

  if (template.kind === 'literal_selection') {
    return { selections: clonePayload(template.selection) };
  }

  if (template.kind === 'payment_selection') {
    const usedIds = new Set<string>();
    const payment: Record<string, unknown>[] = [];

    for (const item of template.payment || []) {
      const needsPermanent = Boolean(item.permanentProfile || item.permanentId);
      let permanentId: string | undefined;
      if (needsPermanent) {
        const rebound = rebindPaymentPermanentId(
          item.permanentProfile,
          item.permanentId,
          view,
          playerId,
          usedIds
        );
        if (!rebound) return null;
        permanentId = rebound;
      }

      const sacrificedPermanentIds = item.sacrificedProfiles
        ? rebindProfileIds(item.sacrificedProfiles, item.sacrificedPermanentIds, view, playerId, usedIds)
        : (item.sacrificedPermanentIds || []);
      if (item.sacrificedProfiles && sacrificedPermanentIds.length !== item.sacrificedProfiles.length) {
        return null;
      }

      const entry: Record<string, unknown> = {
        mana: item.mana,
        ...(permanentId ? { permanentId } : {}),
      };
      if (item.abilityId) entry.abilityId = item.abilityId;
      if (item.paymentSourceId) entry.paymentSourceId = item.paymentSourceId;
      if (typeof item.count === 'number') entry.count = item.count;
      if (item.producedColors) entry.producedColors = [...item.producedColors];
      if (item.fromRestrictedPool === true) entry.fromRestrictedPool = true;
      if (typeof item.restrictedIndex === 'number') entry.restrictedIndex = item.restrictedIndex;
      if (sacrificedPermanentIds.length > 0) entry.sacrificedPermanentIds = sacrificedPermanentIds;
      payment.push(entry);
    }

    const selections: Record<string, unknown> = {
      ...(clonePayload(template.otherLiteralFields || {}) as Record<string, unknown>),
    };

    if (payment.length > 0) {
      selections.payment = payment;
    }
    if (template.alternateCostId) {
      selections.alternateCostId = template.alternateCostId;
    }
    if (typeof template.xValue === 'number') {
      selections.xValue = template.xValue;
    }

    if (template.convokeCreatureProfiles && template.convokeCreatureProfiles.length > 0) {
      const convokeIds = rebindProfileIds(
        template.convokeCreatureProfiles,
        undefined,
        view,
        playerId,
        usedIds
      );
      if (convokeIds.length !== template.convokeCreatureProfiles.length) return null;
      selections.convokeTappedCreatures = convokeIds;
    }

    if (template.sneakCreatureProfile) {
      const sneakIds = rebindProfileIds(
        [template.sneakCreatureProfile],
        undefined,
        view,
        playerId,
        usedIds
      );
      if (sneakIds.length !== 1) return null;
      selections.sneakReturnedCreatureId = sneakIds[0];
    }

    return { selections };
  }

  if (template.kind === 'selection_object') {
    const selections: Record<string, unknown> = clonePayload(template.literalFields || {});

    if (template.targetId) {
      const targetIds = buildIdSelectionsPayload(template.targetId, step, view, playerId);
      if (!targetIds || targetIds.length === 0) return null;
      selections.targetId = targetIds[0];
    }

    if (template.targetIds) {
      const targetIds = buildIdSelectionsPayload(template.targetIds, step, view, playerId);
      if (!targetIds) return null;
      selections.targetIds = targetIds;
    }

    return { selections };
  }

  const selectedIds = buildIdSelectionsPayload(template, step, view, playerId);
  if (!selectedIds) {
    return null;
  }

  return { selections: selectedIds };
}

