import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { ResolutionStepType } from '../resolution/index.js';
import {
  parseChosenTypeCounterEachCreatureEffect,
  parseChosenTypeDrawPerCreatureEffect,
} from './chosen-creature-type.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { resolveChosenTypeCounterEachCreature } from './triggerChosenTypeCounterUtils.js';
import { resolveChosenTypeDrawPerCreature } from './triggerChosenTypeSpellUtils.js';

export function tryResolveTriggeredAbilityChosenTypeEffects(
  ctx: GameContext,
  item: any,
  state: any,
  options: {
    triggerController: PlayerID;
    sourceName: string;
    sourceId: string;
    effectText: string;
    description: string;
    bumpSeq: () => void;
  },
): boolean {
  const effectForChosenTypeChoice = options.effectText || options.description;

  if (parseChosenTypeCounterEachCreatureEffect(effectForChosenTypeChoice)) {
    const sourcePermanentId = String((item as any).source || (item as any).permanentId || '');
    const sourcePermanent = (state.battlefield || []).find((perm: any) => perm && String(perm.id) === sourcePermanentId);
    const chosenType = String(
      (item as any)?.chosenCreatureType || (sourcePermanent as any)?.chosenCreatureType || '',
    ).trim();
    const isReplayingTrigger = !!(ctx as any).isReplaying;

    if (!chosenType && !isReplayingTrigger) {
      queueResolveTopOfStackPrompt(ctx, {
        type: ResolutionStepType.CREATURE_TYPE_CHOICE,
        playerId: options.triggerController,
        description: `Choose a creature type for ${options.sourceName}`,
        mandatory: true,
        sourceId: sourcePermanentId || String(options.sourceId || ''),
        sourceName: options.sourceName,
        permanentId: sourcePermanentId,
        pendingChosenTypeEffect: 'counter_per_creature',
      } as any);

      state.stack = state.stack || [];
      state.stack.push(item as any);
      options.bumpSeq();
      return true;
    }

    if (chosenType) {
      resolveChosenTypeCounterEachCreature(ctx, options.triggerController, chosenType, options.sourceName);
      options.bumpSeq();
      return true;
    }
  }

  if (parseChosenTypeDrawPerCreatureEffect(effectForChosenTypeChoice)) {
    const sourcePermanentId = String((item as any).source || (item as any).permanentId || '');
    const sourcePermanent = (state.battlefield || []).find((perm: any) => perm && String(perm.id) === sourcePermanentId);
    const chosenType = String(
      (item as any)?.chosenCreatureType || (sourcePermanent as any)?.chosenCreatureType || '',
    ).trim();
    const isReplayingTrigger = !!(ctx as any).isReplaying;

    if (!chosenType && !isReplayingTrigger) {
      queueResolveTopOfStackPrompt(ctx, {
        type: ResolutionStepType.CREATURE_TYPE_CHOICE,
        playerId: options.triggerController,
        description: `Choose a creature type for ${options.sourceName}`,
        mandatory: true,
        sourceId: sourcePermanentId || String(options.sourceId || ''),
        sourceName: options.sourceName,
        permanentId: sourcePermanentId,
        pendingChosenTypeEffect: 'draw_per_creature',
      } as any);

      state.stack = state.stack || [];
      state.stack.push(item as any);
      options.bumpSeq();
      return true;
    }

    if (chosenType) {
      resolveChosenTypeDrawPerCreature(ctx, options.triggerController, chosenType, options.sourceName);
      options.bumpSeq();
      return true;
    }
  }

  return false;
}
