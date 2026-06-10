import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn, debugError } from '../../utils/debug.js';
import { ResolutionStepType } from '../resolution/index.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { listLocalCardNamesForChoiceSyncIfReady, parseCardNameChoiceCriteriaFromOracleText } from '../../services/localCardLookup.js';
import {
  detectControlChangeEffects,
  mustAttackEachCombat,
  cantAttackOwner,
} from './triggered-abilities.js';

export function queuePermanentAsEntersBattlefieldChoiceSteps(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    effectiveCard: any;
    newPermanent: any;
    newPermId: string;
    isCreature: boolean;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const effectiveCard = options.effectiveCard;
  const newPermanent = options.newPermanent;
  const newPermId = options.newPermId;
  const isCreature = options.isCreature;
  const oracleText = (effectiveCard.oracle_text || '').toLowerCase();
  const isReplaying = !!(ctx as any).isReplaying;

  const colorChoicePattern = /as .+? enters(?: the battlefield)?,?\s+(?:you may\s+)?choose a colou?r/i;
  if (colorChoicePattern.test(oracleText) && !isReplaying) {
    if (!newPermanent.chosenColor) {
      queueResolveTopOfStackPrompt(ctx, {
        type: ResolutionStepType.COLOR_CHOICE,
        playerId: controller,
        description: `Choose a color for ${effectiveCard.name}`,
        mandatory: !oracleText.includes('you may'),
        sourceId: newPermId,
        sourceName: effectiveCard.name || 'Permanent',
        sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
        colors: ['white', 'blue', 'black', 'red', 'green'],
        permanentId: newPermId,
      } as any);
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} requires color choice, added resolution step`);
    }
  }

  const creatureTypePattern = /as .+? enters(?: the battlefield)?,?\s+choose a creature type/i;
  if (creatureTypePattern.test(oracleText) && !isReplaying) {
    if (!newPermanent.chosenCreatureType) {
      queueResolveTopOfStackPrompt(ctx, {
        type: ResolutionStepType.CREATURE_TYPE_CHOICE,
        playerId: controller,
        description: `Choose a creature type for ${effectiveCard.name}`,
        mandatory: true,
        sourceId: newPermId,
        sourceName: effectiveCard.name || 'Permanent',
        sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
        permanentId: newPermId,
      } as any);
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} requires creature type choice, added resolution step`);
    }
  }

  const cardNamePattern = /as .+? enters(?: the battlefield)?,?\s+(?:you may\s+)?(?:name|choose) a[n]? (?:[^.;,\n]+? )?card(?: name)?/i;
  if (cardNamePattern.test(oracleText) && !isReplaying) {
    if (!newPermanent.chosenCardName) {
      const cardNameChoiceCriteria = parseCardNameChoiceCriteriaFromOracleText(oracleText);
      const cardNameChoiceReason = cardNameChoiceCriteria.restrictionText === 'card'
        ? `Choose a card name for ${effectiveCard.name}`
        : `Choose a ${cardNameChoiceCriteria.restrictionText} name for ${effectiveCard.name}`;
      let candidateNames: string[] | undefined;
      try {
        candidateNames = listLocalCardNamesForChoiceSyncIfReady(cardNameChoiceCriteria);
      } catch (error) {
        debugWarn(1, `[resolveTopOfStack] Failed to build card-name candidates for ${effectiveCard.name}:`, error);
      }

      queueResolveTopOfStackPrompt(ctx, {
        type: ResolutionStepType.CARD_NAME_CHOICE,
        playerId: controller,
        description: `Choose a card name for ${effectiveCard.name}`,
        mandatory: !oracleText.includes('you may'),
        sourceId: newPermId,
        sourceName: effectiveCard.name || 'Permanent',
        sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
        permanentId: newPermId,
        reason: cardNameChoiceReason,
        restrictionText: cardNameChoiceCriteria.restrictionText,
        ...(candidateNames && candidateNames.length > 0 ? { candidateNames } : {}),
      } as any);
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} requires card name choice, added resolution step`);
    }
  }

  const opponentPattern = /as .+? enters(?: the battlefield)?,?\s+choose (?:an opponent|a player)/i;
  if (opponentPattern.test(oracleText) && !isReplaying) {
    if (!newPermanent.chosenPlayer) {
      const opponentOnly = oracleText.includes('choose an opponent');
      const allPlayers = state.players || [];
      const validPlayers = opponentOnly
        ? allPlayers.filter((p: any) => p.id !== controller)
        : allPlayers;

      queueResolveTopOfStackPrompt(ctx, {
        type: ResolutionStepType.PLAYER_CHOICE,
        playerId: controller,
        description: opponentOnly
          ? `Choose an opponent for ${effectiveCard.name}`
          : `Choose a player for ${effectiveCard.name}`,
        mandatory: true,
        sourceId: newPermId,
        sourceName: effectiveCard.name || 'Permanent',
        sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
        permanentId: newPermId,
        players: validPlayers.map((p: any) => ({
          id: p.id,
          name: p.name || `Player ${p.seat}`,
        })),
        opponentOnly,
      } as any);
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} requires ${opponentOnly ? 'opponent' : 'player'} choice, added resolution step`);
    }
  }

  const optionPattern = /as .+? enters(?: the battlefield)?,?\s+choose (.+?)(?:\.|$)/i;
  const optionMatch = oracleText.match(optionPattern);
  if (optionMatch && !isReplaying) {
    const choiceText = optionMatch[1];
    const isSpecificPattern =
      /a colou?r/.test(choiceText) ||
      /a creature type/.test(choiceText) ||
      /a (?:card|nonland card)(?: name)?/.test(choiceText) ||
      /(?:an opponent|a player)/.test(choiceText);

    if (!isSpecificPattern && !newPermanent.chosenOption && !newPermanent.chosenOptions) {
      let options: string[] = [];
      let minSelections = 1;
      let maxSelections = 1;

      const fromAmongMatch = choiceText.match(/^(?:(\w+)\s+)?(?:abilities?|options?|cards?)\s+from\s+among\s+(.+)$/i);
      if (fromAmongMatch) {
        const numWord = fromAmongMatch[1]?.toLowerCase();
        const numMap: Record<string, number> = {
          one: 1, two: 2, three: 3, four: 4, five: 5,
          a: 1, an: 1,
        };
        const choiceCount = numWord ? (numMap[numWord] || parseInt(numWord, 10) || 1) : 1;
        minSelections = choiceCount;
        maxSelections = choiceCount;

        const itemList = fromAmongMatch[2];
        const parts = itemList.split(/,\s+(?:and\s+)?|(?:,\s+)?and\s+/);
        options = parts.map((p) => p.trim().replace(/^(a|an|the)\s+/i, '')).filter((p) => p.length > 0);

        debug(2, `[resolveTopOfStack] Parsed "from among" pattern: choose ${choiceCount} from ${options.join(', ')}`);
      } else {
        if (choiceText.includes(' or ')) {
          const parts = choiceText.split(/,?\s+or\s+/);
          options = parts.map((p) => p.trim().replace(/^(a|an|the)\s+/i, ''));
        } else if (choiceText.includes(',')) {
          options = choiceText.split(',').map((p) => p.trim().replace(/^(a|an|the)\s+/i, ''));
        }

        const chooseNMatch = choiceText.match(/^(\w+)\s+/);
        if (chooseNMatch) {
          const numWord = chooseNMatch[1].toLowerCase();
          const numMap: Record<string, number> = {
            one: 1, two: 2, three: 3, four: 4, five: 5,
          };
          if (numMap[numWord]) {
            minSelections = numMap[numWord];
            maxSelections = numMap[numWord];
          }
        }
      }

      if (options.length >= 2) {
        queueResolveTopOfStackPrompt(ctx, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: controller,
          description: `Choose ${minSelections === maxSelections ? minSelections : `${minSelections}-${maxSelections}`} for ${effectiveCard.name}: ${options.join(', ')}`,
          mandatory: true,
          sourceId: newPermId,
          sourceName: effectiveCard.name || 'Permanent',
          sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
          permanentId: newPermId,
          options: options.map((opt, idx) => ({
            id: `option_${idx}`,
            label: opt.charAt(0).toUpperCase() + opt.slice(1),
            value: opt,
          })),
          minSelections,
          maxSelections,
        } as any);
        debug(2, `[resolveTopOfStack] ${effectiveCard.name} requires option choice (${options.join('/')}, choose ${minSelections}), added resolution step`);
      }
    }
  }

  const devourMatch = oracleText.match(/devour\s+(\d+)/);
  if (devourMatch && isCreature) {
    const devourValue = parseInt(devourMatch[1], 10);
    const availableCreatures = (state.battlefield || [])
      .filter((p: any) =>
        p.controller === controller &&
        p.id !== newPermId &&
        p.card?.type_line?.toLowerCase().includes('creature'))
      .map((p: any) => ({
        permanentId: p.id,
        cardName: p.card?.name || 'Creature',
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
      }));

    if (availableCreatures.length > 0) {
      if (!isReplaying) {
        queueResolveTopOfStackPrompt(ctx, {
          type: ResolutionStepType.DEVOUR_SELECTION,
          playerId: controller,
          description: `Devour ${devourValue}: Choose any number of creatures to sacrifice`,
          mandatory: false,
          sourceId: newPermId,
          sourceName: effectiveCard.name || 'Creature',
          sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
          devourValue,
          creatureId: newPermId,
          creatureName: effectiveCard.name || 'Creature',
          availableCreatures,
        } as any);

        debug(2, `[resolveTopOfStack] ${effectiveCard.name} has Devour ${devourValue}, created selection step with ${availableCreatures.length} available creatures`);
      } else {
        debug(2, '[resolveTopOfStack] Devour: skipping resolution step during replay');
      }
    } else {
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} has Devour ${devourValue}, but no creatures to sacrifice`);
    }
  }

  try {
    const controlChangeEffects = detectControlChangeEffects(effectiveCard, newPermanent);
    const etbControlChangeEffects = controlChangeEffects.filter((e) => e.isETB);

    if (etbControlChangeEffects.length > 0) {
      for (const effect of etbControlChangeEffects) {
        if (effect.type === 'enters_under_opponent_control') {
          (newPermanent as any).pendingControlChange = {
            type: 'enters_under_opponent_control',
            originalOwner: controller,
            goadsOnChange: effect.goadsOnChange || false,
            mustAttackEachCombat: mustAttackEachCombat(effectiveCard),
            cantAttackOwner: cantAttackOwner(effectiveCard),
          };
          debug(2, `[resolveTopOfStack] ${effectiveCard.name} has ETB control change - requires opponent selection`);
        } else if (effect.type === 'may_give_control_to_opponent') {
          (newPermanent as any).pendingControlChange = {
            type: 'may_give_opponent',
            originalOwner: controller,
            isOptional: true,
            goadsOnChange: effect.goadsOnChange || false,
          };
          debug(2, `[resolveTopOfStack] ${effectiveCard.name} has optional ETB control change`);
        } else if (effect.type === 'opponent_gains_control') {
          (newPermanent as any).pendingControlChange = {
            type: 'opponent_gains',
            originalOwner: controller,
          };
          debug(2, `[resolveTopOfStack] ${effectiveCard.name} has ETB opponent gains control`);
        }
      }
    }
  } catch (err) {
    debugError(1, '[resolveTopOfStack] Error checking control change effects:', err);
  }
}
