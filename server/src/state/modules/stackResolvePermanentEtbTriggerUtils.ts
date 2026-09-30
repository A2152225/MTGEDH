import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { getETBTriggersForPermanent } from './triggered-abilities.js';
import { triggerETBEffectsForToken } from './triggerEtbEntryEffects.js';
import { triggerETBEffectsForPermanent } from './triggerEtbPermanentEffects.js';
import { stampPermanentEntryTimestamp } from '../../../../rules-engine/src/permanentTimestamps.js';

export function matchesColorRestriction(restriction: string, cardColors: string[]): boolean {
  const lowerRestriction = restriction.toLowerCase();
  const colors = cardColors || [];

  if (lowerRestriction.startsWith('non')) {
    const excludedColor = lowerRestriction.slice(3);
    const colorMap: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
    const excludedColorCode = colorMap[excludedColor];
    return excludedColorCode ? !colors.includes(excludedColorCode) : true;
  }

  let matchesColor = false;
  if (lowerRestriction.includes('white') && (colors.includes('W') || colors.includes('white'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('black') && (colors.includes('B') || colors.includes('black'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('blue') && (colors.includes('U') || colors.includes('blue'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('red') && (colors.includes('R') || colors.includes('red'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('green') && (colors.includes('G') || colors.includes('green'))) {
    matchesColor = true;
  }

  return matchesColor;
}

export function queuePermanentEntersBattlefieldTriggerStackItems(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    newPermanent: any;
    newPermId: string;
    isCreature: boolean;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const newPermanent = options.newPermanent;
  const newPermId = options.newPermId;

  try {
    const allTriggers = getETBTriggersForPermanent(effectiveCard, newPermanent, state);
    for (const trigger of allTriggers) {
      if (trigger.triggerType !== 'job_select' && trigger.triggerType !== 'living_weapon') {
        continue;
      }
      const tokenInfo = (trigger as any).tokenInfo;
      if (!tokenInfo) continue;

      const tokenId = uid('token');
      const tokenCard = {
        id: `card_${tokenId}`,
        name: tokenInfo.name || (trigger.triggerType === 'job_select' ? 'Hero' : 'Phyrexian Germ'),
        type_line: `Token Creature — ${tokenInfo.subtypes?.join(' ') || (trigger.triggerType === 'job_select' ? 'Hero' : 'Phyrexian Germ')}`,
        colors: tokenInfo.colors || [],
        isToken: true,
      };
      const tokenPermanent = {
        id: tokenId,
        controller,
        owner: controller,
        tapped: false,
        counters: {},
        basePower: tokenInfo.power ?? (trigger.triggerType === 'job_select' ? 1 : 0),
        baseToughness: tokenInfo.toughness ?? (trigger.triggerType === 'job_select' ? 1 : 0),
        summoningSickness: true,
        isToken: true,
        card: { ...tokenCard, zone: 'battlefield' },
      } as any;

      state.battlefield.push(tokenPermanent);
      stampPermanentEntryTimestamp(state, state.battlefield[state.battlefield.length - 1]);

      const equipment = state.battlefield.find((p: any) => p.id === newPermId);
      const isEquipment = equipment && (equipment.card?.type_line || '').toLowerCase().includes('equipment');
      if (equipment && isEquipment) {
        (equipment as any).attachedTo = tokenId;
        (tokenPermanent as any).attachedEquipment = (tokenPermanent as any).attachedEquipment || [];
        (tokenPermanent as any).attachedEquipment.push(newPermId);
        debug(2, `[resolveTopOfStack] ${trigger.triggerType === 'job_select' ? 'Job Select' : 'Living Weapon'}: Created ${tokenCard.name} token and attached ${card.name}`);
      }

      triggerETBEffectsForToken(ctx, tokenPermanent, controller);
    }

    triggerETBEffectsForPermanent(ctx, newPermanent, controller, true);
  } catch (err) {
    debugWarn(1, '[resolveTopOfStack] Failed to detect ETB triggers:', err);
  }
}
