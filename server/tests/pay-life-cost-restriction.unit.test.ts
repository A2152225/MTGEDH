import { describe, expect, it } from 'vitest';

import { canActivateAnyAbility } from '../src/state/modules/can-respond.js';
import { canChooseShockLandPayLife } from '../src/socket/land-helpers.js';
import { tryPromptCastSpellAdditionalCostsFromHand } from '../src/socket/game-actions-handlers/gameActionsCastSpellFromHandAdditionalCosts.js';
import { tryPromptCastSpellModalOverloadLifeFromHand } from '../src/socket/game-actions-handlers/gameActionsCastSpellFromHandModalOverloadLife.js';
import {
  getOptionalPaymentValidationFailure,
  queueShockLandPaymentStep,
} from '../src/socket/optional-payment-prompts.js';
import { handleLifePaymentResponse } from '../src/socket/resolution-handlers/lifePaymentResponseHandlers.js';
import { handleShockLandChoice } from '../src/socket/resolution-handlers/optionChoiceLandEntryReplacementHandlers.js';
import { maybeQueueWardPaymentPromptsForTargetSelection } from '../src/socket/resolution-handlers/targetSelectionWardPromptHandlers.js';
import { tryHandleOptionChoiceEarlySpecialsConfirmCastPayment } from '../src/socket/resolutionOptionChoiceEarlySpecialsConfirmCastPaymentHandlers.js';
import { validateCostPaymentStepsBeforeComplete } from '../src/socket/resolutionRegisterPreCompleteValidationForCostPaymentSteps.js';
import { validateOptionChoicePayCostPromptsBeforeComplete } from '../src/socket/resolutionRegisterPreCompleteValidationForOptionChoiceSteps.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { canPayLife, getMaxPayableLife, validateLifePayment } from '../src/state/utils.js';
import type { GameContext } from '../src/state/context.js';
import type { PlayerID } from '../../shared/src/index.js';

// Oracle text copied from mtg_data.db (is_token = 0).
const ANGEL_OF_JUBILATION_ORACLE =
  "Flying\nOther nonblack creatures you control get +1/+1.\nPlayers can't pay life or sacrifice creatures to cast spells or activate abilities.";
const PLATINUM_EMPERION_ORACLE =
  "Your life total can't change. (You can't gain or lose life. You can't pay any amount of life except 0.)";

function makeCtx(partial: Record<string, unknown>): GameContext {
  return { state: partial } as GameContext;
}

function angelPermanent(controller = 'p1') {
  return {
    id: 'angel_1',
    controller,
    card: {
      name: 'Custom Jubilant Angel',
      oracle_text: ANGEL_OF_JUBILATION_ORACLE,
      type_line: 'Creature — Angel',
    },
  };
}

describe('pay-life cost restriction wiring (Angel of Jubilation oracle)', () => {
  it('canPayLife / validateLifePayment consult canPlayerPayLife when ctx is provided', () => {
    const restricted = makeCtx({
      life: { p1: 40, p2: 40 },
      battlefield: [angelPermanent('p2')],
    });
    const open = makeCtx({
      life: { p1: 40, p2: 40 },
      battlefield: [],
    });

    expect(canPayLife(40, 2)).toBe(true);
    expect(canPayLife(40, 2, open, 'p1')).toBe(true);
    expect(canPayLife(40, 2, restricted, 'p1')).toBe(false);
    expect(canPayLife(40, 2, restricted, 'p2')).toBe(false);
    expect(validateLifePayment(40, 2, 'Blood Price', restricted, 'p1')).toMatch(/can't pay life/i);
    expect(validateLifePayment(40, 2, 'Blood Price', open, 'p1')).toBeNull();
    expect(getMaxPayableLife(40, restricted, 'p1')).toBe(0);
    expect(getMaxPayableLife(40, open, 'p1')).toBe(40);
  });

  it('life-total-can\'t-change still blocks pay-life through canPayLife', () => {
    const ctx = makeCtx({
      life: { p1: 40 },
      battlefield: [{
        id: 'lock_1',
        controller: 'p1',
        card: { name: 'Custom Life Lock', oracle_text: PLATINUM_EMPERION_ORACLE, type_line: 'Artifact Creature — Golem' },
      }],
    });

    expect(canPayLife(40, 2, ctx, 'p1')).toBe(false);
    expect(canPayLife(40, 2, ctx, 'p2')).toBe(true);
  });

  it('shock-land pay-life option is illegal under Angel oracle; life total still required', () => {
    const restricted = makeCtx({
      life: { p1: 40 },
      battlefield: [angelPermanent()],
    });
    const openPoor = makeCtx({ life: { p1: 1 }, battlefield: [] });
    const openRich = makeCtx({ life: { p1: 40 }, battlefield: [] });

    expect(canChooseShockLandPayLife(restricted, 'p1', 2)).toBe(false);
    expect(canChooseShockLandPayLife(openPoor, 'p1', 2)).toBe(false);
    expect(canChooseShockLandPayLife(openRich, 'p1', 2)).toBe(true);
  });

  it('shock-land queue omits pay-2-life under Angel oracle and still taps; offers pay without restriction', () => {
    const gameId = 'test_shock_land_restriction_queue';
    ResolutionQueueManager.removeQueue(gameId);
    const io = { to: () => ({ emit: () => {} }) } as any;

    const makeLand = () => ({
      id: 'shock_1',
      controller: 'p1',
      tapped: false,
      card: {
        name: 'Custom Shock Land',
        type_line: 'Land',
        oracle_text: "As this land enters, you may pay 2 life. If you don't, it enters tapped.",
      },
    });

    const restrictedLand = makeLand();
    const restrictedGame = {
      state: {
        life: { p1: 40 },
        battlefield: [restrictedLand, angelPermanent()],
        players: [{ id: 'p1', name: 'P1', life: 40 }],
      },
    };
    queueShockLandPaymentStep(io, restrictedGame, gameId, 'p1', restrictedLand, 'Custom Shock Land');
    const restrictedSteps = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any);
    expect(restrictedSteps.some((entry: any) => entry?.shockLandChoice === true)).toBe(false);
    expect(restrictedLand.tapped).toBe(true);

    ResolutionQueueManager.removeQueue(gameId);
    const openLand = makeLand();
    const openGame = {
      state: {
        life: { p1: 40 },
        battlefield: [openLand],
        players: [{ id: 'p1', name: 'P1', life: 40 }],
      },
    };
    queueShockLandPaymentStep(io, openGame, gameId, 'p1', openLand, 'Custom Shock Land');
    const openSteps = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any);
    expect(openSteps.some((entry: any) =>
      entry?.shockLandChoice === true &&
      Array.isArray(entry?.options) &&
      entry.options.some((option: any) => option?.id === 'pay_2_life'),
    )).toBe(true);
    expect(openLand.tapped).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('shock-land resolve refuses pay-2-life under Angel oracle and still pays without it', async () => {
    const io = { to: () => ({ emit: () => {} }) } as any;
    const makeLand = () => ({
      id: 'shock_1',
      controller: 'p1',
      tapped: false,
      card: { name: 'Custom Shock Land', type_line: 'Land' },
    });
    const step = {
      id: 'shock_step_1',
      shockLandChoice: true,
      permanentId: 'shock_1',
      payLifeAmount: 2,
      cardName: 'Custom Shock Land',
    } as any;
    const response = {
      playerId: 'p1',
      selections: 'pay_2_life',
      cancelled: false,
    } as any;

    const restrictedLand = makeLand();
    const restrictedGame = {
      state: {
        life: { p1: 40 },
        battlefield: [restrictedLand, angelPermanent()],
        players: [{ id: 'p1', name: 'P1', life: 40 }],
        _suppressBroadcastCount: 1,
      },
      bumpSeq: () => {},
    };
    await handleShockLandChoice(io, restrictedGame, 'test_shock_land_restriction_resolve', step, response);
    expect(restrictedGame.state.life.p1).toBe(40);
    expect(restrictedLand.tapped).toBe(true);

    const openLand = makeLand();
    const openGame = {
      state: {
        life: { p1: 40 },
        battlefield: [openLand],
        players: [{ id: 'p1', name: 'P1', life: 40 }],
        _suppressBroadcastCount: 1,
      },
      bumpSeq: () => {},
    };
    await handleShockLandChoice(io, openGame, 'test_shock_land_open_resolve', step, response);
    expect(openGame.state.life.p1).toBe(38);
    expect(openLand.tapped).toBe(false);
  });

  it('optional life-payment validation refuses pay-2-life under Angel oracle; enter-tapped stays legal', () => {
    const stepData = {
      optionalPaymentPrompt: true,
      optionalPaymentValidationKind: 'life',
      optionalPaymentPayChoiceId: 'pay_2_life',
      optionalPaymentLifeAmount: 2,
      sourceName: 'Custom Shock Land',
    };
    const restricted = {
      state: { life: { p1: 40 }, battlefield: [angelPermanent()] },
    };
    const open = {
      state: { life: { p1: 40 }, battlefield: [] },
    };

    expect(getOptionalPaymentValidationFailure(restricted, 'p1', stepData, 'pay_2_life')?.code).toBe('INSUFFICIENT_LIFE');
    expect(getOptionalPaymentValidationFailure(open, 'p1', stepData, 'pay_2_life')).toBeNull();
    expect(getOptionalPaymentValidationFailure(restricted, 'p1', stepData, 'enter_tapped')).toBeNull();
  });

  it('canActivateAnyAbility rejects tap + pay-life costs under Angel oracle', () => {
    const fetchland = {
      id: 'fetchland1',
      controller: 'p1',
      tapped: false,
      card: {
        name: 'Custom Fetch Land',
        type_line: 'Land',
        oracle_text: '{T}, Pay 1 life, Sacrifice this land: Search your library for a land card, put it onto the battlefield, then shuffle.',
      },
    };

    const legal = makeCtx({
      battlefield: [fetchland],
      manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
      life: { p1: 20 },
    });
    const blocked = makeCtx({
      battlefield: [fetchland, angelPermanent('p2')],
      manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
      life: { p1: 20 },
    });

    expect(canActivateAnyAbility(legal, 'p1' as PlayerID)).toBe(true);
    expect(canActivateAnyAbility(blocked, 'p1' as PlayerID)).toBe(false);
  });

  it('from-hand pay-life additional cost is rejected with Angel oracle and charged without it', () => {
    const cardInHand = {
      id: 'life_spell_1',
      name: 'Blood Price',
      mana_cost: '{0}',
      type_line: 'Instant',
      oracle_text: 'As an additional cost to cast this spell, pay 2 life. Draw a card.',
    };

    const makeGame = (withAngel: boolean) => ({
      state: {
        startingLife: 40,
        life: { p1: 40, p2: 40 },
        battlefield: withAngel ? [angelPermanent('p2')] : [],
        zones: { p1: { hand: [cardInHand] } },
      },
    });

    const emitted: Array<{ event: string; payload: any }> = [];
    const socket = { emit: (event: string, payload: any) => emitted.push({ event, payload }) } as any;
    const io = { to: () => ({ emit: () => {} }) } as any;

    const blocked = tryPromptCastSpellAdditionalCostsFromHand({
      io,
      socket,
      game: makeGame(true),
      gameId: 'test_pay_life_restriction_cast',
      playerId: 'p1',
      cardId: 'life_spell_1',
      cardInHand,
      oracleText: cardInHand.oracle_text,
      payment: undefined,
      targets: {},
      xValue: undefined,
      alternateCostId: undefined,
      convokeTappedCreatures: undefined,
      shouldSkipAllPrompts: false,
      zones: { hand: [cardInHand] },
    });

    expect(blocked).toBeUndefined();
    expect(emitted.some((entry) => entry.event === 'error' && entry.payload?.code === 'CANNOT_PAY_COST')).toBe(true);

    const openGame = makeGame(false);
    const allowed = tryPromptCastSpellAdditionalCostsFromHand({
      io,
      socket,
      game: openGame,
      gameId: 'test_pay_life_restriction_cast_open',
      playerId: 'p1',
      cardId: 'life_spell_1',
      cardInHand,
      oracleText: cardInHand.oracle_text,
      payment: undefined,
      targets: {},
      xValue: undefined,
      alternateCostId: undefined,
      convokeTappedCreatures: undefined,
      shouldSkipAllPrompts: false,
      zones: { hand: [cardInHand] },
    });

    expect(allowed?.kind).toBe('continue');
    expect((allowed as any)?.targets?.additionalCostPaid).toBe(true);
    expect(openGame.state.life.p1).toBe(38);
  });

  it('ward pay-life is unpayable under Angel oracle and still offered without it', () => {
    const gameId = 'test_pay_life_restriction_ward';
    ResolutionQueueManager.removeQueue(gameId);

    const buildGame = (withAngel: boolean) => ({
      state: {
        startingLife: 40,
        life: { p1: 40, p2: 40 },
        stack: [{
          id: 'stack_spell_1',
          type: 'spell',
          controller: 'p1',
          card: { name: 'Lightning Bolt', type_line: 'Instant' },
        }],
        battlefield: [
          {
            id: 'ward_1',
            controller: 'p2',
            card: {
              name: 'Custom Warded Beast',
              type_line: 'Creature — Beast',
              oracle_text: 'Ward—Pay 3 life',
            },
          },
          ...(withAngel ? [angelPermanent('p2')] : []),
        ],
      },
      bumpSeq: () => {},
    });

    const io = { to: () => ({ emit: () => {} }) } as any;
    const step = { sourceId: 'stack_spell_1' } as any;

    const blockedGame = buildGame(true);
    const blocked = maybeQueueWardPaymentPromptsForTargetSelection(io, blockedGame, gameId, step, {
      pid: 'p1',
      selections: ['ward_1'],
      spellCastContext: {},
    });
    expect(blocked).toBe(true);
    const blockedSteps = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any);
    expect(blockedSteps.some((entry: any) => entry?.wardPaymentType === 'life')).toBe(false);

    ResolutionQueueManager.removeQueue(gameId);
    const openGame = buildGame(false);
    maybeQueueWardPaymentPromptsForTargetSelection(io, openGame, gameId, step, {
      pid: 'p1',
      selections: ['ward_1'],
      spellCastContext: {},
    });
    const openSteps = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any);
    expect(openSteps.some((entry: any) => entry?.type === ResolutionStepType.OPTION_CHOICE && entry?.wardPaymentType === 'life')).toBe(true);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('LIFE_PAYMENT resume refuses pay>0 under Angel oracle', async () => {
    const emitted: Array<{ event: string; payload: any }> = [];
    const socket = {
      data: { playerId: 'p1' },
      emit: (event: string, payload: any) => emitted.push({ event, payload }),
    };
    const io = {
      sockets: { sockets: new Map([['s1', socket]]) },
      to: () => ({ emit: () => {} }),
    } as any;
    const game = {
      state: {
        startingLife: 40,
        life: { p1: 40 },
        battlefield: [angelPermanent('p2')],
        zones: { p1: { hand: [{ id: 'life_spell_1', name: 'Blood Price' }] } },
        players: [{ id: 'p1', name: 'P1', life: 40 }],
      },
    };
    await handleLifePaymentResponse(io, game, 'test_life_payment_resume_blocked', {
      type: ResolutionStepType.LIFE_PAYMENT,
      cardId: 'life_spell_1',
      cardName: 'Blood Price',
      sourceName: 'Blood Price',
    } as any, { playerId: 'p1', selections: 2 } as any);
    expect(game.state.life.p1).toBe(40);
    expect(emitted.some((entry) =>
      entry.event === 'error' &&
      entry.payload?.code === 'INVALID_LIFE_PAYMENT' &&
      /can't pay life/i.test(String(entry.payload?.message || '')),
    )).toBe(true);
  });

  it('pre-complete LIFE_PAYMENT validation refuses pay>0 under Angel oracle', () => {
    const emitted: Array<{ event: string; payload: any }> = [];
    const socket = { emit: (event: string, payload: any) => emitted.push({ event, payload }) } as any;
    const step = {
      type: ResolutionStepType.LIFE_PAYMENT,
      cardName: 'Blood Price',
      minPayment: 0,
    } as any;
    const response = { selections: 2 } as any;

    const blocked = validateCostPaymentStepsBeforeComplete({
      socket,
      step,
      response,
      cancelled: false,
      game: { state: { startingLife: 40, life: { p1: 40 }, battlefield: [angelPermanent('p2')] } },
      pid: 'p1',
    });
    expect(blocked).toBe(false);
    expect(emitted.some((entry) =>
      entry.event === 'error' &&
      entry.payload?.code === 'INVALID_LIFE_PAYMENT' &&
      /can't pay life/i.test(String(entry.payload?.message || '')),
    )).toBe(true);

    emitted.length = 0;
    const allowed = validateCostPaymentStepsBeforeComplete({
      socket,
      step,
      response,
      cancelled: false,
      game: { state: { startingLife: 40, life: { p1: 40 }, battlefield: [] } },
      pid: 'p1',
    });
    expect(allowed).toBe(true);
    expect(emitted.length).toBe(0);
  });

  it('pre-complete reflexive fixed pay-life refuses under Angel oracle', async () => {
    const emitted: Array<{ event: string; payload: any }> = [];
    const socket = { emit: (event: string, payload: any) => emitted.push({ event, payload }) } as any;
    const step = {
      type: ResolutionStepType.OPTION_CHOICE,
      reflexiveFixedPaymentChoice: true,
      reflexiveFixedPaymentController: 'p1',
      reflexiveFixedPaymentLifeAmount: 2,
      sourceName: 'Blood Price',
    } as any;
    const response = { selections: 'pay' } as any;

    const blocked = await validateOptionChoicePayCostPromptsBeforeComplete({
      socket,
      step,
      response,
      cancelled: false,
      game: { state: { startingLife: 40, life: { p1: 40 }, battlefield: [angelPermanent('p2')] } },
      pid: 'p1',
    });
    expect(blocked).toBe(false);
    expect(emitted.some((entry) =>
      entry.event === 'error' &&
      entry.payload?.code === 'INSUFFICIENT_LIFE' &&
      /can't pay life/i.test(String(entry.payload?.message || '')),
    )).toBe(true);

    emitted.length = 0;
    const allowed = await validateOptionChoicePayCostPromptsBeforeComplete({
      socket,
      step,
      response,
      cancelled: false,
      game: { state: { startingLife: 40, life: { p1: 40 }, battlefield: [] } },
      pid: 'p1',
    });
    expect(allowed).toBe(true);
    expect(emitted.length).toBe(0);
  });

  it('modal/overload provided-life path refuses pay>0 under Angel oracle and still accepts without it', () => {
    const cardInHand = {
      id: 'x_life_1',
      name: 'Toxic Deluge',
      type_line: 'Sorcery',
      oracle_text: 'As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.',
    };
    const makeArgs = (withAngel: boolean, emitted: Array<{ event: string; payload: any }>) => ({
      socket: { emit: (event: string, payload: any) => emitted.push({ event, payload }) } as any,
      game: {
        state: {
          startingLife: 40,
          life: { p1: 40 },
          battlefield: withAngel ? [angelPermanent('p2')] : [],
        },
      },
      gameId: withAngel ? 'test_modal_life_blocked' : 'test_modal_life_open',
      playerId: 'p1',
      cardId: 'x_life_1',
      cardInHand,
      isInstantOrSorcery: true,
      baseOracleText: cardInHand.oracle_text,
      oracleText: cardInHand.oracle_text,
      targets: {},
      payment: [{ lifePayment: 2 }] as any,
      selectedCastMode: undefined,
      alternateCostId: undefined,
      xValue: undefined,
      convokeTappedCreatures: undefined,
    });

    const blockedEmitted: Array<{ event: string; payload: any }> = [];
    const blocked = tryPromptCastSpellModalOverloadLifeFromHand(makeArgs(true, blockedEmitted));
    expect(blocked).toBeUndefined();
    expect(blockedEmitted.some((entry) =>
      entry.event === 'error' &&
      entry.payload?.code === 'INVALID_LIFE_PAYMENT' &&
      /can't pay life/i.test(String(entry.payload?.message || '')),
    )).toBe(true);

    const openEmitted: Array<{ event: string; payload: any }> = [];
    const allowed = tryPromptCastSpellModalOverloadLifeFromHand(makeArgs(false, openEmitted));
    expect(allowed?.kind).toBe('continue');
    expect((cardInHand as any).lifePaymentAmount).toBe(2);
    expect(openEmitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('ConfirmCastPayment reflexive consume refuses pay-life under Angel oracle', async () => {
    const emitted: Array<{ event: string; payload: any }> = [];
    const socket = {
      data: { playerId: 'p1' },
      emit: (event: string, payload: any) => emitted.push({ event, payload }),
    };
    const io = {
      sockets: { sockets: new Map([['s1', socket]]) },
      to: () => ({ emit: () => {} }),
    } as any;
    const game = {
      state: {
        startingLife: 40,
        life: { p1: 40 },
        battlefield: [angelPermanent('p2')],
        players: [{ id: 'p1', name: 'P1', life: 40 }],
        _suppressBroadcastCount: 1,
      },
      bumpSeq: () => {},
    };
    const step = {
      type: ResolutionStepType.OPTION_CHOICE,
      reflexiveFixedPaymentChoice: true,
      reflexiveFixedPaymentController: 'p1',
      reflexiveFixedPaymentLifeAmount: 2,
      reflexiveFixedPaymentSourceName: 'Blood Price',
    } as any;
    const response = { playerId: 'p1', selections: 'pay', cancelled: false } as any;

    const handled = await tryHandleOptionChoiceEarlySpecialsConfirmCastPayment(
      io,
      game,
      'test_confirm_cast_pay_life_blocked',
      step,
      response,
    );
    expect(handled).toBe(true);
    expect(game.state.life.p1).toBe(40);
    expect(emitted.some((entry) =>
      entry.event === 'error' &&
      entry.payload?.code === 'INSUFFICIENT_LIFE' &&
      /can't pay life/i.test(String(entry.payload?.message || '')),
    )).toBe(true);
  });
});
