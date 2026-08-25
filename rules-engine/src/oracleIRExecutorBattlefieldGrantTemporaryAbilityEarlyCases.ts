// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: early-return special cases inside applyGrantTemporaryAbilityStep
// (annihilator through registered temporary player effect).
// Public entry: tryApplyGrantTemporaryAbilityEarlyCases.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  BattlefieldStepHandlerResult,
  RecentBattlefieldRuntime,
} from './oracleIRExecutorBattlefieldStepTypes';
import { resolveAttachedStaticAbilityGrantTargets } from './oracleIRExecutorBattlefieldAttachedGrantTargets';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { readCharacteristicNumber } from './oracleIRExecutorBattlefieldCharacteristicNumber';
import { buildContextualBattlefieldTargetIds } from './oracleIRExecutorBattlefieldContextualTargets';
import { resolveEquippedCreaturesYouControl } from './oracleIRExecutorBattlefieldEquippedCreaturesYouControl';
import {
  permanentIsAlly,
  permanentIsHistoric,
  permanentIsOutlaw,
} from './oracleIRExecutorBattlefieldPermanentKindPredicates';
import {
  resolveDirectBattlefieldPermanents,
  resolveGrantTemporaryMassTargets,
} from './oracleIRExecutorBattlefieldPermanentSelectors';
import { resolveRecentlyMovedBattlefieldPermanents } from './oracleIRExecutorBattlefieldRecentlyMoved';
import { typeLineHasSubtype } from './oracleIRExecutorBattlefieldSubtypeUtils';
import { registerTemporaryStaticAbilityGrant } from './oracleIRExecutorBattlefieldTemporaryStaticAbilityGrant';
import { applyTemporaryEffectToPermanents } from './oracleIRExecutorBattlefieldTemporaryEffects';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { applyTemporarySetBasePowerToughness } from './oracleIRExecutorCreatureStepUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

export function tryApplyGrantTemporaryAbilityEarlyCases(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_temporary_ability' }>,
  ctx: OracleIRExecutionContext,
  runtime: RecentBattlefieldRuntime | undefined,
  battlefield: BattlefieldPermanent[],
  stepRaw: string,
  targetText: string,
  normalizedTargetText: string,
  sourceNameAliases: Set<string>,
): BattlefieldStepHandlerResult | null {
  if (/^annihilator 1$/i.test(targetText) || /^annihilator 1$/i.test(stepRaw.trim())) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source = sourceId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId)
      : undefined;
    if (!source) {
      return {
        applied: false,
        message: `Skipped temporary ability grant (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const nextState = applyTemporaryEffectToPermanents(state, [source], ctx, {
      descriptions: ['annihilator 1'],
      expiresAt: 'end_of_turn',
    });
    return { applied: true, state: nextState, log: ['Granted annihilator 1 until end of turn'] };
  }

  const grantControllerId = String(ctx.controllerId || '').trim();
  const grantDuringYourTurnMatch = stepRaw.match(
    /^during your turn,\s*(equipped creatures you control|commanders you control|equipped creature|other historic creatures you control|outlaws you control|allies you control)\s+(?:have|has)\s+(.+)$/i
  );
  if (grantDuringYourTurnMatch) {
    const targetPhrase = String(grantDuringYourTurnMatch[1] || '').trim().toLowerCase();
    const abilityText = String(grantDuringYourTurnMatch[2] || '').trim();
    const grantedAbilities = abilityText
      .split(/\s+and\s+|\s*,\s*/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    let targets: BattlefieldPermanent[] = [];
    if (targetPhrase === 'equipped creatures you control') {
      targets = resolveEquippedCreaturesYouControl(battlefield, grantControllerId);
    } else if (targetPhrase === 'commanders you control') {
      targets = battlefield.filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== grantControllerId) return false;
        return Boolean((perm as any)?.isCommander) || /\bcommander\b/i.test(getExecutorTypeLineLower(perm));
      });
    } else if (targetPhrase === 'equipped creature') {
      targets = resolveAttachedStaticAbilityGrantTargets(battlefield, { kind: 'raw', text: 'equipped creature' }, ctx);
    } else if (targetPhrase === 'other historic creatures you control') {
      const sourceId = String(ctx.sourceId || '').trim();
      targets = battlefield.filter((perm: any) => {
        const id = String(perm?.id || '').trim();
        if (!id || id === sourceId) return false;
        if (String(perm?.controller || '').trim() !== grantControllerId) return false;
        return permanentMatchesType(perm, 'creature') && permanentIsHistoric(perm);
      });
    } else if (targetPhrase === 'outlaws you control') {
      targets = battlefield.filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== grantControllerId) return false;
        return permanentMatchesType(perm, 'creature') && permanentIsOutlaw(perm);
      });
    } else if (targetPhrase === 'allies you control') {
      targets = battlefield.filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== grantControllerId) return false;
        return permanentMatchesType(perm, 'creature') && permanentIsAlly(perm);
      });
    }
    if (targets.length === 0) {
      return { applied: true, state, log: [`No targets for during-your-turn grant: ${targetPhrase}`] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
      descriptions: grantedAbilities.length > 0 ? grantedAbilities : [abilityText],
      grantedAbilities,
      expiresAt: 'leaves_battlefield',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Granted ${abilityText} to ${targets.length} permanent(s) during your turn`],
    };
  }

  if (/^creatures dealt damage this way can't be regenerated this turn$/i.test(stepRaw)) {
    const damagedIds = Array.from(
      new Set([
        ...collectBoundBattlefieldIds(ctx),
        ...(Array.isArray((ctx as any).lastDamagedBattlefieldPermanentIds)
          ? ((ctx as any).lastDamagedBattlefieldPermanentIds as readonly string[])
          : []),
      ])
    );
    const damagedTargets = battlefield.filter((perm: any) =>
      damagedIds.includes(String((perm as any)?.id || '').trim())
    );
    if (damagedTargets.length === 0) {
      return { applied: true, state, log: ['No damaged creatures for regeneration restriction'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, damagedTargets, ctx, {
      descriptions: ["can't be regenerated"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-be-regenerated to ${damagedTargets.length} damaged creature(s)`],
    };
  }

  if (/^equipped creature has base power and toughness 7\/7 and can't be blocked by creatures with power 2 or less$/i.test(stepRaw)) {
    const targets = resolveAttachedStaticAbilityGrantTargets(battlefield, { kind: 'raw', text: 'equipped creature' }, ctx);
    if (targets.length === 0) {
      return { applied: true, state, log: ['No equipped creature for Wrecking Ball Arm grant'] };
    }
    const targetId = String((targets[0] as any)?.id || '').trim();
    const withBasePt = applyTemporarySetBasePowerToughness(state, targetId, ctx, 7, 7);
    if (!withBasePt) {
      return { applied: true, state, log: ['Equipped creature not on battlefield for base P/T grant'] };
    }
    const nextState = applyTemporaryEffectToPermanents(withBasePt, targets, ctx, {
      descriptions: ["can't be blocked by creatures with power 2 or less"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: ['Granted 7/7 and evasion to equipped creature'],
    };
  }

  if (
    /^equipped creature has hexproof and can't be blocked$/i.test(stepRaw) ||
    /during your turn, equipped creature has hexproof and can't be blocked/i.test(stepRaw)
  ) {
    const targets = resolveAttachedStaticAbilityGrantTargets(
      battlefield,
      { kind: 'raw', text: 'equipped creature' },
      ctx
    );
    if (targets.length === 0) {
      return { applied: true, state, log: ['No equipped creature for hexproof/evasion grant'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
      descriptions: ['hexproof', "can't be blocked"],
      grantedAbilities: ['hexproof'],
      expiresAt: 'leaves_battlefield',
    });
    return { applied: true, state: nextState, log: ['Granted hexproof and evasion to equipped creature'] };
  }

  if (/^equipped creature has ward \{2\}, is an assassin in addition to its other types, and can't be blocked$/i.test(stepRaw)) {
    const targets = resolveAttachedStaticAbilityGrantTargets(
      battlefield,
      { kind: 'raw', text: 'equipped creature' },
      ctx
    );
    if (targets.length === 0) {
      return { applied: true, state, log: ['No equipped creature for Brotherhood Regalia grant'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
      descriptions: ['ward {2}', 'is an Assassin', "can't be blocked"],
      grantedAbilities: ['ward'],
      expiresAt: 'leaves_battlefield',
    });
    return { applied: true, state: nextState, log: ['Granted Brotherhood Regalia abilities to equipped creature'] };
  }

  if (/^creatures you control with power or toughness 1 or less can't be blocked$/i.test(stepRaw)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const targets = battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      const power = readCharacteristicNumber(
        (perm as any)?.effectivePower,
        (perm as any)?.basePower,
        (perm as any)?.card?.power,
        (perm as any)?.power
      );
      const toughness = readCharacteristicNumber(
        (perm as any)?.effectiveToughness,
        (perm as any)?.baseToughness,
        (perm as any)?.card?.toughness,
        (perm as any)?.toughness
      );
      if (power !== undefined && power <= 1) return true;
      if (toughness !== undefined && toughness <= 1) return true;
      return false;
    });
    if (targets.length === 0) {
      return { applied: true, state, log: ['No small creatures for Tetsuko evasion grant'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
      descriptions: ["can't be blocked"],
      expiresAt: 'leaves_battlefield',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Granted can't-be-blocked to ${targets.length} small creature(s)`],
    };
  }

  if (/^legolas can't be blocked by creatures with power 2 or less$/i.test(stepRaw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source =
      (sourceId ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId) : undefined) ||
      battlefield.find((perm: any) => /legolas/i.test(String(perm?.name || '')));
    if (!source) {
      return { applied: true, state, log: ['No Legolas source for evasion grant'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, [source], ctx, {
      descriptions: ["can't be blocked by creatures with power 2 or less"],
      expiresAt: 'leaves_battlefield',
    });
    return { applied: true, state: nextState, log: ['Granted evasion to Legolas'] };
  }

  if (
    targetText === "creatures can't be blocked this turn" ||
    /^creatures can't be blocked this turn$/i.test(stepRaw) ||
    ((targetText === 'creatures' || targetText === 'all creatures') &&
      /can't be blocked this turn/i.test(stepRaw))
  ) {
    const creatures = battlefield.filter((perm: any) =>
      String(perm?.type_line || perm?.card?.type_line || '')
        .toLowerCase()
        .includes('creature')
    );
    if (creatures.length > 0) {
      const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
        descriptions: ["can't be blocked"],
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted can't-be-blocked to ${creatures.length} creature(s) until end of turn`],
      };
    }
  }

  if (/^a creature dealt damage this way can't be regenerated this turn$/i.test(stepRaw)) {
    const damagedIds = Array.from(
      new Set([
        ...collectBoundBattlefieldIds(ctx),
        ...(Array.isArray((ctx as any).lastDamagedBattlefieldPermanentIds)
          ? ((ctx as any).lastDamagedBattlefieldPermanentIds as readonly string[])
          : []),
      ])
    );
    const damagedTargets = battlefield.filter((perm: any) =>
      damagedIds.includes(String((perm as any)?.id || '').trim())
    );
    if (damagedTargets.length === 0) {
      return { applied: true, state, log: ['No damaged creature for regeneration restriction'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, damagedTargets, ctx, {
      descriptions: ["can't be regenerated"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-be-regenerated to ${damagedTargets.length} damaged creature(s)`],
    };
  }

  if (/^those creatures also gain trample until end of turn$/i.test(stepRaw)) {
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const targets = battlefield.filter((perm: any) =>
      contextualIds.includes(String((perm as any)?.id || '').trim())
    );
    if (targets.length > 0) {
      const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
        descriptions: ['trample'],
        grantedAbilities: ['trample'],
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted trample to ${targets.length} creature(s) until end of turn`],
      };
    }
  }

  if (/^target creature can't be blocked this turn$/i.test(stepRaw.trim())) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const targets = battlefield.filter((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      return boundIds.includes(id) && permanentMatchesType(perm, 'creature');
    });
    if (targets.length > 0) {
      const nextState = applyTemporaryEffectToPermanents(state, targets.slice(0, 1), ctx, {
        descriptions: ["can't be blocked"],
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted can't-be-blocked to ${targets[0]?.card?.name || 'target creature'} until end of turn`],
      };
    }
  }

  if (/two target creatures you control that share a creature type can't be blocked this turn/i.test(stepRaw)) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const targets = battlefield.filter((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      return boundIds.includes(id) && permanentMatchesType(perm, 'creature');
    });
    if (targets.length >= 1) {
      const nextState = applyTemporaryEffectToPermanents(state, targets.slice(0, 2), ctx, {
        descriptions: ["can't be blocked"],
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted can't-be-blocked to ${Math.min(2, targets.length)} creature(s) until end of turn`],
      };
    }
  }

  if (/during your turn, zurgo has indestructible/i.test(stepRaw) || /during your turn,.+ has indestructible/i.test(stepRaw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source = sourceId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId)
      : battlefield.find((perm: any) => /zurgo/i.test(String(perm?.name || '')));
    if (source) {
      const nextState = applyTemporaryEffectToPermanents(state, [source], ctx, {
        descriptions: ['indestructible during your turn'],
        grantedAbilities: ['Indestructible'],
        expiresAt: 'leaves_battlefield',
      });
      return { applied: true, state: nextState, log: ['Granted indestructible during your turn'] };
    }
    return { applied: true, state, log: ['No Zurgo source for indestructible grant'] };
  }

  if (/^those creatures also gain lifelink until end of turn$/i.test(stepRaw)) {
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const targets = battlefield.filter((perm: any) =>
      contextualIds.includes(String((perm as any)?.id || '').trim())
    );
    if (targets.length > 0) {
      const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
        descriptions: ['lifelink'],
        grantedAbilities: ['lifelink'],
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted lifelink to ${targets.length} creature(s) until end of turn`],
      };
    }
  }

  if (/^x target creatures with power 2 or less can't be blocked this turn$/i.test(stepRaw)) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const maxCount = Number.isFinite(Number(ctx.xValue)) ? Math.max(0, Math.floor(Number(ctx.xValue))) : boundIds.length;
    const targets = battlefield
      .filter((perm: any) => {
        const id = String((perm as any)?.id || '').trim();
        if (!boundIds.includes(id) || !permanentMatchesType(perm, 'creature')) return false;
        const power = readCharacteristicNumber(
          (perm as any)?.effectivePower,
          (perm as any)?.basePower,
          (perm as any)?.card?.power,
          (perm as any)?.power
        );
        return power !== null && power <= 2;
      })
      .slice(0, maxCount || boundIds.length);
    if (targets.length > 0) {
      const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
        descriptions: ["can't be blocked"],
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted can't-be-blocked to ${targets.length} creature(s) until end of turn`],
      };
    }
  }

  if (/^scions and spawns you control$/i.test(targetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const matches = battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return typeLineHasSubtype(perm, 'scion') || typeLineHasSubtype(perm, 'spawn');
    });
    if (matches.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText, stepRaw].filter(Boolean);
      const nextState = applyTemporaryEffectToPermanents(state, matches, ctx, {
        descriptions,
        grantedAbilities,
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary abilities to ${matches.length} Scion/Spawn creature(s)`],
      };
    }
  }

  if (
    /\bbecomes a copy of\b/i.test(stepRaw) ||
    (sourceNameAliases.has(targetText) && /\bbecome(?:s)?\b/i.test(stepRaw))
  ) {
    const selfTargets = resolveDirectBattlefieldPermanents(
      battlefield,
      { kind: 'raw', text: /\bthis (?:permanent|creature|planeswalker)\b/i.test(stepRaw) ? 'this permanent' : 'this creature' },
      ctx
    );
    if (selfTargets.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText, stepRaw].filter(Boolean);
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((selfTargets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, selfTargets, ctx, {
        descriptions,
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary copy effect to ${selfTargets.length} permanent(s) until end of turn`],
      };
    }
  }

  if (/^(?:it|this creature|this permanent)$/i.test(normalizedTargetText)) {
    const selfReference = /^this permanent$/i.test(normalizedTargetText) ? 'this permanent' : 'it';
    const recentTargets = resolveRecentlyMovedBattlefieldPermanents(
      battlefield,
      { kind: 'raw', text: selfReference },
      runtime,
    );
    const selfTargets = recentTargets.length > 0
      ? recentTargets
      : resolveDirectBattlefieldPermanents(
          battlefield,
          { kind: 'raw', text: selfReference },
          ctx
        );
    if (selfTargets.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((selfTargets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, selfTargets, ctx, {
        descriptions: descriptions.length > 0 ? descriptions : [stepRaw],
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary ability text to ${selfTargets.length} permanent(s) until end of turn`],
      };
    }
    const sourceId = String(ctx.sourceId || '').trim();
    if (sourceId) {
      return registerTemporaryStaticAbilityGrant(state, step, ctx, {
        targetPermanentId: sourceId,
        duration: step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn',
      });
    }
  }

  if (/^that player$/i.test(normalizedTargetText)) {
    const targetPlayerId = String(
      ctx.selectorContext?.targetPlayerId ||
      ctx.selectorContext?.targetOpponentId ||
      ctx.targetOpponentId ||
      ''
    ).trim();
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped temporary ability grant (no deterministic target player): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    return registerTemporaryStaticAbilityGrant(state, step, ctx, {
      targetPlayerId,
      duration: step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn',
    });
  }

  if (/^each opponent$/i.test(normalizedTargetText)) {
    return registerTemporaryStaticAbilityGrant(state, step, ctx, {
      duration: step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn',
    });
  }

  if (/^each creature dealt damage this way$/i.test(normalizedTargetText)) {
    const targetPlayerId = String(
      ctx.selectorContext?.targetPlayerId || ctx.targetOpponentId || 'p2'
    ).trim();
    const damagedTargets = battlefield.filter(
      (perm: any) =>
        permanentMatchesType(perm, 'creature') &&
        String(perm?.controller || '').trim() === targetPlayerId
    );
    if (damagedTargets.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((damagedTargets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, damagedTargets, ctx, {
        descriptions: descriptions.length > 0 ? descriptions : [stepRaw],
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId
          ? { expiresOnControllerTurn: controllerId }
          : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary ability to ${damagedTargets.length} damaged creature(s) until end of turn`],
      };
    }
  }

  if (/^you$/i.test(normalizedTargetText)) {
    return registerTemporaryStaticAbilityGrant(state, step, ctx, {
      duration: step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn',
    });
  }

  if (/\bspells? you cast(?: this turn)? cost\b/i.test(stepRaw)) {
    return registerTemporaryStaticAbilityGrant(state, step, ctx, {
      duration: step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn',
    });
  }

  if (
    /creatures of the (?:chosen )?creature type of your choice/i.test(stepRaw) ||
    /^creatures of the chosen creature type you control$/i.test(normalizedTargetText) ||
    /^creatures you control of the chosen type$/i.test(normalizedTargetText)
  ) {
    const massTargetText = /^creatures you control of the chosen type$/i.test(normalizedTargetText)
      ? 'creatures you control of the chosen type'
      : 'creatures of the chosen creature type you control';
    const massTargets = resolveGrantTemporaryMassTargets(
      battlefield,
      massTargetText,
      stepRaw,
      ctx
    );
    if (massTargets && massTargets.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((massTargets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, massTargets, ctx, {
        descriptions: descriptions.length > 0 ? descriptions : [stepRaw],
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary ability text to ${massTargets.length} permanent(s) until end of turn`],
      };
    }
  }

  if (/^creature cards in your graveyard$/i.test(normalizedTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourceName = String(ctx.sourceName || '').trim();
    const existingStaticGrantEffects = Array.isArray((state as any).staticAbilityGrantEffects)
      ? [...(state as any).staticAbilityGrantEffects]
      : [];
    const staticGrantEffect = {
      id: `${sourceId || sourceName || 'oracle'}:graveyard-grant:${existingStaticGrantEffects.length + 1}`,
      sourceId: sourceId || undefined,
      sourceName: sourceName || undefined,
      controllerId: String(ctx.controllerId || '').trim() || undefined,
      target: step.target,
      abilities: Array.isArray(step.abilities) ? [...step.abilities] : [],
      effectText: Array.isArray(step.effectText) ? [...step.effectText] : [],
      duration: 'end_of_turn',
      raw: step.raw,
    };
    return {
      applied: true,
      state: {
        ...(state as any),
        staticAbilityGrantEffects: [...existingStaticGrantEffects, staticGrantEffect],
      } as GameState,
      log: [`Registered temporary graveyard cast permission: ${step.raw}`],
    };
  }

  if (/^the next (?:.+?\s+)?spell you cast(?: this turn)?$/i.test(normalizedTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourceName = String(ctx.sourceName || '').trim();
    const existingStaticGrantEffects = Array.isArray((state as any).staticAbilityGrantEffects)
      ? [...(state as any).staticAbilityGrantEffects]
      : [];
    const staticGrantEffect = {
      id: `${sourceId || sourceName || 'oracle'}:temp-player-grant:${existingStaticGrantEffects.length + 1}`,
      sourceId: sourceId || undefined,
      sourceName: sourceName || undefined,
      controllerId: String(ctx.controllerId || '').trim() || undefined,
      target: step.target,
      abilities: Array.isArray(step.abilities) ? [...step.abilities] : [],
      effectText: Array.isArray(step.effectText) ? [...step.effectText] : [],
      duration: 'end_of_turn',
      raw: step.raw,
    };
    const duplicateStaticGrant = existingStaticGrantEffects.some((entry: any) =>
      String(entry?.sourceId || '').trim() === String(staticGrantEffect.sourceId || '').trim() &&
      String(entry?.raw || '').trim() === step.raw
    );
    return {
      applied: true,
      state: {
        ...(state as any),
        staticAbilityGrantEffects: duplicateStaticGrant
          ? existingStaticGrantEffects
          : [...existingStaticGrantEffects, staticGrantEffect],
      } as GameState,
      log: [`Registered temporary player effect: ${step.raw}`],
    };
  }
  return null;
}

