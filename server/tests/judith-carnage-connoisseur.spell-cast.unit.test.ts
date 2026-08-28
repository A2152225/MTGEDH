import { afterEach, describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { isModalChooseModesEffectText } from '../src/state/modules/inferTriggeredAbilityTargetMetadata.js';
import { detectSpellCastTriggers } from '../src/state/modules/triggered-abilities.js';
import { tryDeferTriggeredAbilitySpecialPrompts } from '../src/state/modules/stackResolveTriggeredAbilitySpecialPromptUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const JUDITH_ORACLE =
  'Whenever you cast an instant or sorcery spell, choose one —\n' +
  '\u2022 That spell gains deathtouch and lifelink.\n' +
  '\u2022 Create a 2/2 red Imp creature token with "When this token dies, it deals 2 damage to each opponent."';

describe('Judith, Carnage Connoisseur spell-cast modal', () => {
  const afterEachCleanupIds: string[] = [];
  afterEach(() => {
    for (const gameId of afterEachCleanupIds) {
      ResolutionQueueManager.removeQueue(gameId);
    }
    afterEachCleanupIds.length = 0;
  });

  it('keeps both choose-one modes in the detected effect', () => {
    const triggers = detectSpellCastTriggers(
      { name: 'Judith, Carnage Connoisseur', oracle_text: JUDITH_ORACLE },
      { id: 'judith-1', controller: 'p1' },
    );

    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.spellCondition).toBe('instant_sorcery');
    expect(isModalChooseModesEffectText(String(triggers[0]?.effect || ''))).toBe(true);
    expect(String(triggers[0]?.effect || '')).toMatch(/that spell gains deathtouch and lifelink/i);
    expect(String(triggers[0]?.effect || '')).toMatch(/create a 2\/2 red imp creature token/i);
  });

  it('collects a choose_mode step whose first mode grants keywords to that spell', () => {
    const ir = parseOracleTextToIR(JUDITH_ORACLE, 'Judith, Carnage Connoisseur');
    const castAbility = ir.abilities.find((ability) =>
      /cast an instant or sorcery/i.test(String(ability.triggerCondition || ability.text || '')),
    );
    expect(castAbility?.steps.some((step) => step.kind === 'choose_mode')).toBe(true);

    const triggers = detectSpellCastTriggers(
      { name: 'Judith, Carnage Connoisseur', oracle_text: JUDITH_ORACLE },
      { id: 'judith-1' },
    );
    const steps = collectOracleEffectSteps(String(triggers[0]?.effect || ''), 'Judith, Carnage Connoisseur');
    const chooseMode = steps.find((step) => step.kind === 'choose_mode') as Extract<
      (typeof steps)[number],
      { kind: 'choose_mode' }
    > | undefined;
    expect(chooseMode).toBeDefined();
    expect(chooseMode?.modes).toHaveLength(2);

    const keywordGrant = chooseMode?.modes?.[0]?.steps?.find(
      (step) => step.kind === 'grant_static_ability' || step.kind === 'grant_temporary_ability',
    ) as { kind: string; abilities?: string[]; target?: { text?: string } } | undefined;
    expect(keywordGrant).toBeDefined();
    expect(String(keywordGrant?.target?.text || '')).toMatch(/that spell/i);
    expect(keywordGrant?.abilities).toEqual(expect.arrayContaining(['deathtouch', 'lifelink']));
  });

  it('keeps the triggering stack spell id on the choose-one prompt', () => {
    const gameId = `judith_modal_bind_${Date.now()}`;
    afterEachCleanupIds.push(gameId);
    const ctx = {
      gameId,
      state: { id: gameId, battlefield: [], stack: [] },
      isReplaying: false,
    } as any;
    const deferred = tryDeferTriggeredAbilitySpecialPrompts(
      ctx,
      {
        type: 'triggered_ability',
        requiresChoice: true,
        effect: JUDITH_ORACLE,
        triggeringStackItemId: 'stack_reckless',
        effectData: { triggeringStackItemId: 'stack_reckless' },
      },
      ctx.state,
      {
        triggerController: 'p1' as any,
        sourceName: 'Judith, Carnage Connoisseur',
        sourceId: 'judith_1',
        description: JUDITH_ORACLE,
        triggerType: 'cast_creature_type',
      },
    );

    expect(deferred).toBe(true);
    const step = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(step?.type).toBe('modal_choice');
    expect(String(step?.triggerData?.triggeringStackItemId || '')).toBe('stack_reckless');
    expect(String(step?.triggerData?.effectData?.triggeringStackItemId || '')).toBe('stack_reckless');
  });

  it('stamps the triggering spell on the choose-one prompt for the client', () => {
    const gameId = `judith_modal_cause_${Date.now()}`;
    afterEachCleanupIds.push(gameId);
    const ctx = {
      gameId,
      state: {
        id: gameId,
        battlefield: [],
        stack: [{
          id: 'stack_reckless',
          type: 'spell',
          card: {
            name: 'Reckless Blaze',
            image_uris: { small: 'https://example.test/reckless.jpg' },
          },
        }],
      },
      isReplaying: false,
    } as any;
    const deferred = tryDeferTriggeredAbilitySpecialPrompts(
      ctx,
      {
        type: 'triggered_ability',
        requiresChoice: true,
        effect: JUDITH_ORACLE,
        triggeringStackItemId: 'stack_reckless',
        triggeringSpell: { id: 'reckless_blaze_1', name: 'Reckless Blaze' },
        effectData: { triggeringStackItemId: 'stack_reckless', triggeringSpell: { name: 'Reckless Blaze' } },
      },
      ctx.state,
      {
        triggerController: 'p1' as any,
        sourceName: 'Judith, Carnage Connoisseur',
        sourceId: 'judith_1',
        description: JUDITH_ORACLE,
        triggerType: 'cast_creature_type',
      },
    );

    expect(deferred).toBe(true);
    const step = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(String(step?.causeName || '')).toBe('Reckless Blaze');
    expect(String(step?.causeLabel || '')).toBe('You cast');
    expect(String(step?.causeImage || '')).toBe('https://example.test/reckless.jpg');
    expect(String(step?.sourceName || '')).toBe('Judith, Carnage Connoisseur');
  });
});
