import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { triggerETBEffectsForPermanent } from './triggerEtbPermanentEffects.js';
import { stampPermanentEntryTimestamp } from '../../../../rules-engine/src/permanentTimestamps.js';

export function manifestCard(ctx: GameContext, card: any, controller: string): string | null {
  try {
    const state = (ctx as any).state;
    if (!state) return null;

    const battlefield = (state.battlefield = state.battlefield || []);
    const newPermId = uid('perm');

    const actualTypeLine = (card.type_line || '').toLowerCase();
    const isActuallyCreature = actualTypeLine.includes('creature');

    const newPermanent: any = {
      id: newPermId,
      controller,
      owner: controller,
      tapped: false,
      basePower: 2,
      baseToughness: 2,
      summoningSickness: true,
      card: {
        name: 'Face-down Creature',
        type_line: 'Creature',
        zone: 'battlefield',
        power: '2',
        toughness: '2',
      },
      isFaceDown: true,
      faceDownType: 'manifest',
      faceUpCard: card,
      canTurnFaceUp: isActuallyCreature,
    };

    battlefield.push(newPermanent);
    stampPermanentEntryTimestamp(state, battlefield[battlefield.length - 1]);

    debug(
      2,
      `[manifestCard] Manifested ${card.name} as face-down 2/2 creature (${isActuallyCreature ? 'can turn face-up' : 'cannot turn face-up'})`,
    );

    triggerETBEffectsForPermanent(ctx, newPermanent, controller);

    return newPermId;
  } catch (err) {
    debugWarn(1, '[manifestCard] Failed to manifest card:', err);
    return null;
  }
}
