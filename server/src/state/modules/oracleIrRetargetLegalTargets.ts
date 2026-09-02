/**
 * Origin: Grip of Chaos / Chef's Kiss random change_target.
 * Cluster: collect live legal retargets for a stack spell/ability when
 *   copyRetargetValidTargets was never stamped.
 * Public: collectLegalRetargetCandidatesForStackItem.
 */
import { parseTargetRequirements } from '../../rules-engine/targeting-handlers/targetingParseTargetRequirements.js';
import { buildSpellTargetListFromRequirements } from '../../socket/game-actions-handlers/gameActionsSpellTargetSelection.js';

export function collectLegalRetargetCandidatesForStackItem(
  state: any,
  spell: any,
  targetingPlayerId: string,
): Array<{ id: string; type?: string; name?: string }> {
  const caster = String(spell?.controller || targetingPlayerId || '').trim();
  const oracle = String(
    spell?.card?.oracle_text
    || spell?.oracle_text
    || spell?.activatedAbilityText
    || spell?.description
    || '',
  );
  if (!caster || !oracle) return [];
  const reqs = parseTargetRequirements(oracle);
  if (!reqs?.needsTargets) return [];
  try {
    const gameLike = { state };
    return buildSpellTargetListFromRequirements(gameLike, caster, reqs)
      .map((target: any) => {
        const id = String(target?.id || '').trim();
        if (!id) return null;
        const kind = String(target?.kind || '').trim().toLowerCase();
        const type = kind === 'player' ? 'player' : kind === 'stack' ? 'stack' : 'permanent';
        return {
          id,
          type,
          name: String(target?.name || target?.label || id),
        };
      })
      .filter((entry): entry is { id: string; type: string; name: string } => Boolean(entry?.id));
  } catch {
    return [];
  }
}
