import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { createCopyTokensOfCard } from '../src/state/modules/counters_tokens.js';
import { detectAttackTriggers } from '../src/state/modules/triggers/combat.js';
import { ensureLocalCardLookupIndexSync, lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';
import { parseCopyTokenOverridesFromEffect } from '../../shared/src/copyTokenOverrides.js';
import { isTriggerEffectFullyIrWired } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { tryResolveTriggerViaOracleIR } from '../src/state/modules/oracleIrTriggerExecution.js';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function extractDelinaLowRollTokenClause(oracleText: string): string {
  const match = oracleText.match(/1[-–—]14\s*\|\s*(create a tapped and attacking token.+?)(?:\n|15[-–—]20|$)/i);
  return match?.[1]?.trim() || '';
}

function extractEvilTwinEnterAsCopyClause(oracleText: string): string {
  const line = oracleText.split('\n').find((entry) => /enter the battlefield as a copy/i.test(entry));
  return line?.trim() || oracleText.trim();
}

function extractDermotaxiImprintClause(oracleText: string): string {
  const line = oracleText.split('\n').find((entry) => /^imprint/i.test(entry.trim()));
  return line?.trim() || oracleText.trim();
}

function extractDermotaxiCopyActivationClause(oracleText: string): string {
  const line = oracleText.split('\n').find((entry) => /becomes a copy of the exiled card/i.test(entry));
  return line?.trim() || '';
}

describe('copy token IR-primary integration (Delina / Evil Twin / Dermotaxi)', () => {
  let previousTriggerPrimary: string | undefined;

  beforeAll(async () => {
    await initDb();
    ensureLocalCardLookupIndexSync();
  });

  beforeEach(() => {
    previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  afterEach(() => {
    if (previousTriggerPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
    }
  });

  describe("Delina, Wild Mage", () => {
    const CARD = 'Delina, Wild Mage';

    it('detects attack trigger and IR wiring from oracle without KNOWN shorthand', () => {
      const card = lookupLocalCardByNameSync(CARD);
      expect(card?.oracle_text).toBeTruthy();

      const triggers = detectAttackTriggers(card, { id: 'delina_1', controller: 'p1' });
      expect(triggers.length).toBeGreaterThan(0);
      expect(triggers[0].description.toLowerCase()).toMatch(/roll|d20|target creature/);

      const tokenClause = extractDelinaLowRollTokenClause(String(card!.oracle_text));
      expect(tokenClause.toLowerCase()).toContain("copy of that creature");

      const steps = collectOracleEffectSteps(tokenClause, CARD);
      expect(steps.length).toBeGreaterThan(0);
      expect(isTriggerEffectFullyIrWired(tokenClause, CARD)).toBe(true);
    });

    it('creates a nonlegendary hasty Delina copy token via copy overrides', () => {
      const card = lookupLocalCardByNameSync(CARD);
      const tokenClause = extractDelinaLowRollTokenClause(String(card!.oracle_text));
      const overrides = parseCopyTokenOverridesFromEffect(tokenClause);

      const game = createInitialGameState('delina_copy_token');
      const p1 = 'p1' as PlayerID;
      game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

      const sourceCreature = {
        id: 'grizzly_source',
        name: 'Grizzly Bears',
        type_line: 'Legendary Creature — Bear',
        oracle_text: 'Trample',
        power: '2',
        toughness: '2',
        colors: ['G'],
      };

      createCopyTokensOfCard(game as any, p1, sourceCreature, 1, true, overrides);

      const copy = ((game.state as any).battlefield || []).find(
        (perm: any) => perm?.isCopyToken && perm?.card?.name === 'Grizzly Bears',
      );
      expect(copy).toBeDefined();
      expect(String(copy.card?.type_line || '').toLowerCase()).not.toContain('legendary');
      expect(copy.copyTokenOverrides?.removeLegendary).toBe(true);
    });

    it('primary IR applies Delina low-roll copy token branch', () => {
      const card = lookupLocalCardByNameSync(CARD);
      const tokenClause = extractDelinaLowRollTokenClause(String(card!.oracle_text));

      const gameId = 'delina_ir_primary';
      const game = createInitialGameState(gameId);
      const p1 = 'p1' as PlayerID;
      game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

      (game.state as any).battlefield = [
        {
          id: 'delina_perm',
          controller: p1,
          owner: p1,
          card: { ...card, id: 'delina_card' },
        },
        {
          id: 'bear_target',
          controller: p1,
          owner: p1,
          card: {
            id: 'bear_card',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            power: '2',
            toughness: '2',
          },
        },
      ];

      const ctx = game as any;
      ctx.gameId = gameId;
      ResolutionQueueManager.removeQueue(gameId);

      const outcome = tryResolveTriggerViaOracleIR(ctx, {
        controller: p1,
        sourceName: CARD,
        effectText: tokenClause,
        triggerItem: {
          id: 'delina_trigger',
          source: 'delina_perm',
          targetDetails: [{ id: 'bear_target', type: 'permanent', name: 'Grizzly Bears' }],
        },
      });

      expect(outcome.handled).toBe(true);
      expect(outcome.applied).toBeGreaterThan(0);
    });
  });

  describe('Evil Twin', () => {
    const CARD = 'Evil Twin';

    it('parses enter-as-copy ETB and granted destroy ability via IR', () => {
      const card = lookupLocalCardByNameSync(CARD);
      expect(card?.oracle_text).toBeTruthy();

      const enterClause = extractEvilTwinEnterAsCopyClause(String(card!.oracle_text));
      expect(enterClause.toLowerCase()).toContain('copy');

      const steps = collectOracleEffectSteps(enterClause, CARD);
      expect(steps.some((step) => step.kind === 'copy_permanent' || step.kind === 'grant_static_ability')).toBe(true);
      expect(isTriggerEffectFullyIrWired(enterClause, CARD)).toBe(true);
    });

    it('primary IR queues copy_permanent target selection for Evil Twin ETB', () => {
      const card = lookupLocalCardByNameSync(CARD);
      const enterClause = extractEvilTwinEnterAsCopyClause(String(card!.oracle_text));

      const gameId = 'evil_twin_ir_primary';
      const game = createInitialGameState(gameId);
      const p1 = 'p1' as PlayerID;
      const p2 = 'p2' as PlayerID;
      game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
      game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

      (game.state as any).battlefield = [
        {
          id: 'evil_twin_perm',
          controller: p1,
          owner: p1,
          card: { ...card, id: 'evil_twin_card' },
        },
        {
          id: 'bear_target',
          controller: p2,
          owner: p2,
          card: {
            id: 'bear_card',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            power: '2',
            toughness: '2',
          },
        },
      ];

      const ctx = game as any;
      ctx.gameId = gameId;
      ResolutionQueueManager.removeQueue(gameId);

      const outcome = tryResolveTriggerViaOracleIR(ctx, {
        controller: p1,
        sourceName: CARD,
        effectText: enterClause,
        triggerItem: {
          id: 'evil_twin_etb',
          source: 'evil_twin_perm',
          triggerType: 'etb',
        },
      });

      expect(outcome.handled).toBe(true);

      const queue = ResolutionQueueManager.getQueue(gameId);
      const pending = queue?.getPendingSteps?.() || [];
      const hasCopyStep = pending.some(
        (step: any) => step.type === ResolutionStepType.COPY_PERMANENT
          || step.type === ResolutionStepType.TARGET_SELECTION
          || String(step.description || '').toLowerCase().includes('copy'),
      );
      expect(hasCopyStep || outcome.applied > 0).toBe(true);
    });
  });

  describe('Dermotaxi', () => {
    const CARD = 'Dermotaxi';

    it('parses imprint ETB exile and activated copy clauses separately', () => {
      const card = lookupLocalCardByNameSync(CARD);
      expect(card?.oracle_text).toBeTruthy();

      const imprintClause = extractDermotaxiImprintClause(String(card!.oracle_text));
      expect(imprintClause.toLowerCase()).toContain('imprint');

      const imprintSteps = collectOracleEffectSteps(imprintClause, CARD);
      expect(imprintSteps.length).toBeGreaterThan(0);
      expect(isTriggerEffectFullyIrWired(imprintClause, CARD)).toBe(true);

      const activationClause = extractDermotaxiCopyActivationClause(String(card!.oracle_text));
      expect(activationClause.toLowerCase()).toContain('copy of the exiled card');

      const activationSteps = collectOracleEffectSteps(activationClause, CARD);
      expect(activationSteps.some((step) => step.kind === 'copy_permanent')).toBe(true);
      expect(isTriggerEffectFullyIrWired(activationClause, CARD)).toBe(true);
    });

    it('primary IR handles Dermotaxi imprint exile on ETB', () => {
      const card = lookupLocalCardByNameSync(CARD);
      const imprintClause = extractDermotaxiImprintClause(String(card!.oracle_text));

      const gameId = 'dermotaxi_ir_primary';
      const game = createInitialGameState(gameId);
      const p1 = 'p1' as PlayerID;
      game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

      const grizzly = {
        id: 'gy_grizzly',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        power: '2',
        toughness: '2',
      };

      (game.state as any).zones = {
        [p1]: {
          hand: [],
          handCount: 0,
          graveyard: [grizzly],
          graveyardCount: 1,
        },
      };

      (game.state as any).battlefield = [{
        id: 'dermotaxi_perm',
        controller: p1,
        owner: p1,
        card: { ...card, id: 'dermotaxi_card' },
      }];

      const ctx = game as any;
      ctx.gameId = gameId;
      ResolutionQueueManager.removeQueue(gameId);

      const outcome = tryResolveTriggerViaOracleIR(ctx, {
        controller: p1,
        sourceName: CARD,
        effectText: imprintClause,
        triggerItem: {
          id: 'dermotaxi_etb',
          source: 'dermotaxi_perm',
          triggerType: 'etb',
        },
      });

      expect(outcome.handled).toBe(true);
    });

    it('primary IR copies imprinted card when Dermotaxi crew ability resolves', () => {
      const card = lookupLocalCardByNameSync(CARD);
      const activationClause = extractDermotaxiCopyActivationClause(String(card!.oracle_text));
      expect(activationClause).toBeTruthy();

      const grizzly = {
        id: 'imprinted_grizzly',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        power: '2',
        toughness: '2',
        colors: ['G'],
      };

      const gameId = 'dermotaxi_activation_ir_primary';
      const game = createInitialGameState(gameId);
      const p1 = 'p1' as PlayerID;
      game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

      (game.state.battlefield as any[]).push({
        id: 'dermotaxi_perm',
        controller: p1,
        owner: p1,
        exiledCards: [grizzly],
        card: {
          ...card,
          id: 'dermotaxi_card',
          type_line: 'Artifact — Vehicle',
        },
        type_line: 'Artifact — Vehicle',
      });

      const ctx = game as any;
      ctx.gameId = gameId;
      ResolutionQueueManager.removeQueue(gameId);

      const outcome = tryApplyOracleIRToActivatedAbility(ctx, {
        controller: p1,
        sourceName: CARD,
        oracleText: activationClause,
        sourcePermanentId: 'dermotaxi_perm',
        stackItemId: 'dermotaxi_stack',
      });

      expect(outcome.handled).toBe(true);

      const dermotaxi = (game.state.battlefield as any[]).find((perm) => perm.id === 'dermotaxi_perm');
      expect(dermotaxi).toBeDefined();
      expect(dermotaxi.card?.name).toBe('Grizzly Bears');
      expect(String(dermotaxi.card?.oracle_text || '').toLowerCase()).toContain('vehicle');
    });
  });
});
