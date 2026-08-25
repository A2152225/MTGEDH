/**
 * Extracted from loopShortcuts.ts: prompt-valid battlefield target ids.
 * Cluster moved: getPermanentTypeLine, permanentMatchesType, getPromptValidTargetIds.
 * Public: getPromptValidTargetIds
 *
 * Leaf must not import loopShortcuts.ts or loopShortcuts-handlers/index.ts.
 */

import type { ClientGameView } from '../../../../shared/src';
import { normalizeText } from './loopShortcutsTextUtils';

function getPermanentTypeLine(permanent: any): string {
  return normalizeText(permanent?.type_line || permanent?.cardType || permanent?.card?.type_line);
}

function permanentMatchesType(permanent: any, type: string): boolean {
  if (type === 'permanent') return true;
  return getPermanentTypeLine(permanent).includes(normalizeText(type));
}

export function getPromptValidTargetIds(
  step: any,
  view: ClientGameView | null | undefined,
  playerId: string | null | undefined
): string[] {
  const validTargets = Array.isArray(step?.validTargets) ? step.validTargets : [];
  if (validTargets.length > 0) {
    return validTargets.map((target: any) => String(target?.id || '')).filter(Boolean);
  }

  if (step?.type === 'tap_untap_target') {
    const battlefield = Array.isArray(view?.battlefield) ? view.battlefield : [];
    const types = Array.isArray(step?.targetFilter?.types)
      ? step.targetFilter.types.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
      : [];
    const controllerFilter = normalizeText(step?.targetFilter?.controller || 'any');
    const tapStatus = normalizeText(step?.targetFilter?.tapStatus || 'any');
    const excludeSource = step?.targetFilter?.excludeSource === true;
    const sourceId = String(step?.sourceId || '');

    return battlefield
      .filter((permanent: any) => {
        if (!permanent?.id) return false;
        if (excludeSource && String(permanent.id) === sourceId) return false;
        if (types.length > 0 && !types.every((type: string) => permanentMatchesType(permanent, type))) return false;

        if (controllerFilter === 'you' && String(permanent?.controller || '') !== String(playerId || '')) {
          return false;
        }

        if (controllerFilter === 'opponent' && String(permanent?.controller || '') === String(playerId || '')) {
          return false;
        }

        if (tapStatus === 'tapped' && !permanent?.tapped) {
          return false;
        }

        if (tapStatus === 'untapped' && permanent?.tapped) {
          return false;
        }

        return true;
      })
      .map((permanent: any) => String(permanent.id));
  }

  return [];
}

