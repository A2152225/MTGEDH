import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { hasSpellMastery } from './game-state-effects.js';
import { executeSpellEffect } from './executeSpellEffect.js';
import { addCreatureType } from './triggerDelayedEffectUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';

import type { ExecuteTriggerEffectFn } from './stackResolveSharedTypes.js';

export function resolveInstantSorceryGraveyardEffectiveOracleText(item: any, oracleText: string): string {
  const graveyardSelectedModeDescriptions: string[] = Array.isArray(item?.selectedModeDescriptions)
    ? (item.selectedModeDescriptions as any[])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
    : [];
  return graveyardSelectedModeDescriptions.length > 0
    ? graveyardSelectedModeDescriptions.join(' ')
    : oracleText;
}

export function applyInstantSorceryGraveyardZoneChangeAutomation(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    targets: any[];
    graveyardEffectiveOracleText: string;
    executeTriggerEffect: ExecuteTriggerEffectFn;
  },
): void {
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const targets = options.targets;
  const graveyardEffectiveOracleText = options.graveyardEffectiveOracleText;

  if (
    targets.length === 0
    || !/from\s+(?:your|a|any|an\s+opponent['']?s?)\s+graveyard/i.test(graveyardEffectiveOracleText)
  ) {
    return;
  }

  try {
    const targetIdSet = new Set(
      targets
        .map((t: any) => (typeof t === 'string' ? t : String(t?.id || '')).trim())
        .filter(Boolean),
    );
    const targetManaValues: number[] = [];
    const stateAny: any = (ctx as any).state || {};
    const zones = stateAny.zones || {};
    for (const tid of targetIdSet) {
      let found: any = null;
      for (const playerZones of Object.values(zones as Record<string, any>)) {
        const gy = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
        const hit = gy.find((entry: any) => String(entry?.id || '') === tid);
        if (hit) { found = hit; break; }
      }
      if (!found && Array.isArray(stateAny.battlefield)) {
        const hit = stateAny.battlefield.find((p: any) => String(p?.card?.id || p?.id || '') === tid);
        if (hit) found = hit.card || hit;
      }
      if (found) {
        const mv = Number((found as any).cmc ?? (found as any).mana_value ?? (found as any).manaValue ?? 0);
        if (Number.isFinite(mv)) targetManaValues.push(mv);
      }
    }

    const sentences = String(graveyardEffectiveOracleText)
      .replace(/[\u2019]/g, "'")
      .split(/(?<=\.)\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const fakeTriggerItem: any = {
      targets,
      card: effectiveCard,
      sourceName: effectiveCard.name || 'spell',
      source: String(item?.source || item?.permanentId || ''),
      id: String(item?.id || card?.id || ''),
    };
    for (const sentence of sentences) {
      if (!/from\s+(?:your|a|any|an\s+opponent['']?s?)\s+graveyard/i.test(sentence)) continue;
      if (!/^(?:return|put|exile)\b/i.test(sentence)) continue;
      options.executeTriggerEffect(
        ctx,
        controller,
        effectiveCard.name || 'spell',
        sentence,
        fakeTriggerItem,
      );
    }

    if (
      targetManaValues.length > 0
      && /you\s+lose\s+life\s+equal\s+to\s+its\s+mana\s+value/i.test(graveyardEffectiveOracleText)
    ) {
      const lifeLoss = targetManaValues.reduce((sum, n) => sum + Math.max(0, n), 0);
      if (lifeLoss > 0) {
        executeSpellEffect(
          ctx,
          { kind: 'LoseLife', playerId: controller, amount: lifeLoss } as any,
          controller,
          effectiveCard.name || 'spell',
          String(item?.source || item?.permanentId || ''),
          String(item?.id || card?.id || ''),
        );
        debug(2, `[resolveTopOfStack] ${effectiveCard.name} lost ${lifeLoss} life equal to reanimated card's mana value`);
      }
    }

    const spellMasteryMatch = /spell\s+mastery\s*[\u2014\-:]\s*if\s+there\s+are\s+two\s+or\s+more\s+instant\s+and\/or\s+sorcery\s+cards\s+in\s+your\s+graveyard,\s+that\s+creature\s+enters\s+with\s+(one|two|three|four|\d+)\s+additional\s+\+1\/\+1\s+counters?/i.exec(
      graveyardEffectiveOracleText.replace(/[\u2019]/g, "'"),
    );
    if (spellMasteryMatch && targetIdSet.size > 0 && hasSpellMastery(ctx, controller as string)) {
      const numWord = String(spellMasteryMatch[1] || '').toLowerCase();
      const wordToNumber: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
      const bonus = (wordToNumber[numWord] ?? Number(numWord)) || 0;
      if (bonus > 0) {
        const battlefield: any[] = Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [];
        for (const tid of targetIdSet) {
          const perm = battlefield.find((p: any) => String(p?.card?.id || p?.id || '') === tid);
          if (!perm) continue;
          perm.counters = perm.counters || {};
          perm.counters['+1/+1'] = Number(perm.counters['+1/+1'] || 0) + bonus;
          debug(2, `[resolveTopOfStack] ${effectiveCard.name} spell mastery added ${bonus} +1/+1 counters to ${perm?.card?.name || tid}`);
        }
      }
    }

    if (targetIdSet.size > 0) {
      const KEYWORD_GRANT_VOCAB = [
        'indestructible',
        'haste',
        'flying',
        'trample',
        'lifelink',
        'deathtouch',
        'vigilance',
        'menace',
        'reach',
        'first strike',
        'double strike',
        'hexproof',
        'shroud',
        'flash',
        'defender',
      ];
      const keywordAlt = KEYWORD_GRANT_VOCAB.map((k) => k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
      const grantPattern = new RegExp(
        `that\\s+(?:creature|permanent|card)\\s+gains?\\s+((?:${keywordAlt})(?:\\s*(?:,|and)\\s*(?:${keywordAlt}))*)`,
        'gi',
      );
      const granted: string[] = [];
      let gm: RegExpExecArray | null;
      while ((gm = grantPattern.exec(graveyardEffectiveOracleText)) !== null) {
        const list = String(gm[1] || '').toLowerCase();
        for (const kw of KEYWORD_GRANT_VOCAB) {
          if (list.includes(kw)) granted.push(kw);
        }
      }
      if (granted.length > 0) {
        const battlefield: any[] = Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [];
        for (const tid of targetIdSet) {
          const perm = battlefield.find((p: any) => String(p?.card?.id || p?.id || '') === tid);
          if (!perm) continue;
          perm.grantedAbilities = Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [];
          for (const kw of granted) {
            if (!perm.grantedAbilities.some((a: any) => String(a || '').toLowerCase() === kw)) {
              perm.grantedAbilities.push(kw);
            }
          }
          debug(2, `[resolveTopOfStack] ${effectiveCard.name} granted [${granted.join(', ')}] to ${perm?.card?.name || tid}`);
        }
      }
    }

    if (targetIdSet.size > 0) {
      const COLOR_WORD_TO_LETTER: Record<string, string> = {
        white: 'W',
        blue: 'U',
        black: 'B',
        red: 'R',
        green: 'G',
      };
      const colorTypePattern = /that\s+(?:creature|permanent|card)\s+is\s+a\s+(white|blue|black|red|green)\s+([A-Za-z][A-Za-z'-]+)\s+in\s+addition\s+to\s+(?:its|their)\s+other\s+colors?\s+and\s+types?/i;
      const ctMatch = colorTypePattern.exec(graveyardEffectiveOracleText);
      if (ctMatch) {
        const colorWord = String(ctMatch[1] || '').toLowerCase();
        const subtype = String(ctMatch[2] || '').replace(/^./, (c) => c.toUpperCase());
        const colorLetter = COLOR_WORD_TO_LETTER[colorWord];
        const battlefield: any[] = Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [];
        for (const tid of targetIdSet) {
          const perm = battlefield.find((p: any) => String(p?.card?.id || p?.id || '') === tid);
          if (!perm) continue;
          if (subtype) {
            addCreatureType(perm, subtype);
          }
          if (colorLetter) {
            perm.card = perm.card || {};
            perm.card.colors = Array.isArray(perm.card.colors) ? perm.card.colors.slice() : [];
            if (!perm.card.colors.includes(colorLetter)) {
              perm.card.colors.push(colorLetter);
            }
          }
          debug(2, `[resolveTopOfStack] ${effectiveCard.name} added color/type ${colorWord}/${subtype} to ${perm?.card?.name || tid}`);
        }
      }
    }

    if (targetIdSet.size > 0) {
      try {
        const gameIdLocal: string | undefined = (ctx as any).gameId;
        const isReplaying = !!(ctx as any).isReplaying;
        if (gameIdLocal && gameIdLocal !== 'unknown' && !isReplaying) {
          const scryRiderPattern = /(?:^|\.\s+|\s)(?:if\s+it['\u2019]s\s+your\s+turn\s*,\s*)?scry\s+(\d+)\s*(?:\.|$)/i;
          const sm = scryRiderPattern.exec(graveyardEffectiveOracleText);
          if (sm) {
            const scryN = Math.max(0, Number(sm[1] || 0));
            const requiresOwnTurn = /if\s+it['\u2019]s\s+your\s+turn/i.test(String(sm[0] || ''));
            const turnPlayer = String(stateAny?.turnPlayer || '');
            const controllerId = String(controller);
            const ownTurn = !requiresOwnTurn || turnPlayer === controllerId;
            if (scryN > 0 && ownTurn) {
              const sourceIdStr = String(item?.id || card?.id || '');
              const existing = ResolutionQueueManager
                .getStepsForPlayer(gameIdLocal, controllerId as any)
                .find((s: any) => s.type === ResolutionStepType.SCRY && (s as any)?.sourceId && sourceIdStr && String((s as any).sourceId) === sourceIdStr);
              if (!existing) {
                const step = ResolutionQueueManager.addStep(gameIdLocal, {
                  type: ResolutionStepType.SCRY,
                  playerId: controllerId,
                  description: `${effectiveCard.name || 'spell'}: Scry ${scryN}`,
                  mandatory: true,
                  sourceId: sourceIdStr || undefined,
                  sourceName: effectiveCard.name || 'spell',
                  scryCount: scryN,
                } as any);
                appendQueuedResolutionPromptEvent(ctx, {
                  playerId: controllerId as any,
                  sourceId: sourceIdStr || String((step as any)?.sourceId || '').trim(),
                  queuedResolutionStep: step,
                });
                debug(2, `[resolveTopOfStack] ${effectiveCard.name} queued trailing scry ${scryN} for ${controllerId}`);
              }
            }
          }
        }
      } catch (err) {
        debugWarn(1, '[resolveTopOfStack] Trailing scry rider failed:', err);
      }
    }

    if (targetIdSet.size > 0) {
      try {
        const battlefield: any[] = Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [];
        const sourceCardId = String((effectiveCard as any)?.id || '').trim();
        const sourceName = String(effectiveCard?.name || '').trim();
        const escapedSourceName = sourceName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const attachPattern = new RegExp(
          `attach\\s+(?:this\\s+enchantment|${escapedSourceName || '~'}|~)\\s+to\\s+it\\b`,
          'i',
        );
        const resolvedSourcePermanent = sourceCardId
          ? battlefield.find((perm: any) => String(perm?.card?.id || '') === sourceCardId && String(perm?.controller || '') === String(controller))
          : undefined;
        const attachedTarget = Array.from(targetIdSet)
          .map((tid) => battlefield.find((perm: any) => String(perm?.card?.id || perm?.id || '') === String(tid)))
          .find(Boolean);

        if (resolvedSourcePermanent && attachedTarget && attachPattern.test(graveyardEffectiveOracleText)) {
          const currentTypeLine = String(resolvedSourcePermanent?.card?.type_line || effectiveCard?.type_line || '').trim();
          if (/\benchantment\b/i.test(currentTypeLine) && !/\baura\b/i.test(currentTypeLine)) {
            resolvedSourcePermanent.card = resolvedSourcePermanent.card || {};
            resolvedSourcePermanent.card.type_line = currentTypeLine.includes('\u2014')
              ? `${currentTypeLine} Aura`
              : `${currentTypeLine} \u2014 Aura`;
          }

          if (resolvedSourcePermanent.attachedTo) {
            const previousTarget = battlefield.find((perm: any) => String(perm?.id || '') === String(resolvedSourcePermanent.attachedTo));
            if (previousTarget) {
              (previousTarget as any).attachments = Array.isArray((previousTarget as any).attachments)
                ? (previousTarget as any).attachments.filter((id: string) => id !== String(resolvedSourcePermanent.id || ''))
                : [];
            }
          }

          resolvedSourcePermanent.attachedTo = String((attachedTarget as any).id || '');
          (attachedTarget as any).attachments = Array.isArray((attachedTarget as any).attachments)
            ? (attachedTarget as any).attachments
            : [];
          if (!(attachedTarget as any).attachments.includes(String(resolvedSourcePermanent.id || ''))) {
            (attachedTarget as any).attachments.push(String(resolvedSourcePermanent.id || ''));
          }

          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            appendEvent(replayGameId, (stateAny as any).seq ?? 0, 'attachEnchantmentPermanent', {
              playerId: controller,
              enchantmentId: String(resolvedSourcePermanent.id || ''),
              enchantmentName: String(resolvedSourcePermanent.card?.name || sourceName || 'Enchantment'),
              targetPermanentId: String((attachedTarget as any).id || ''),
              targetPermanentName: String((attachedTarget as any).card?.name || 'Permanent'),
            });
          }

          debug(2, `[resolveTopOfStack] ${sourceName || 'Enchantment'} attached to ${String((attachedTarget as any).card?.name || (attachedTarget as any).id || 'target')}`);
        }
      } catch (err) {
        debugWarn(1, '[resolveTopOfStack] Cast-side aura-attach rider failed:', err);
      }
    }
  } catch (err) {
    debugWarn(1, '[resolveTopOfStack] Graveyard zone-change fallback failed:', err);
  }
}
