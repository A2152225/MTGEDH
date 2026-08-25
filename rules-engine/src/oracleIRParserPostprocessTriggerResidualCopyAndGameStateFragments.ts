// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseStructuredTriggerResidualGrant's chain covering
// become-a-copy fragments, life and draw doubling, lose-the-game replacements and control changes.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';
import { tryParseBareStaticCostReductionSteps } from './oracleIRParserPostprocessBareStaticCostReductionSentences';
import { OracleClauseCondition } from './oracleIR';

export function parseTriggerResidualCopyAndGameStateFragmentsOne(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  if (/^you\s+may\s+have\s+this\s+creature\s+become\s+a\s+copy\s+of\s+another\s+target\s+creature,\s+except\s+it\s+has\s+this\s+ability$/i.test(raw)) {
    return [{
      kind: 'copy_permanent',
      target: parseObjectSelector('this creature'),
      source: parseObjectSelector('another target creature'),
      retainAbilityText: 'it has this ability',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^this creature becomes a copy of that creature,\s+except it has this ability$/i.test(raw)) {
    return [{
      kind: 'copy_permanent',
      target: parseObjectSelector('this creature'),
      source: parseObjectSelector('that creature'),
      retainAbilityText: 'it has this ability',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^that creature becomes a copy of this creature\.?$/i.test(raw)) {
    return [{
      kind: 'copy_permanent',
      target: parseObjectSelector('that creature'),
      source: parseObjectSelector('this creature'),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^then, not counting that draw, if you drew more cards this turn than an opponent drew on their last turn, you may put a land card from your hand onto the battlefield$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('a land card from your hand'),
      to: 'battlefield',
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^then, if you have 1,000 or more life, you lose the game$/i.test(raw)) {
    return [{
      kind: 'conditional',
      condition: { kind: 'if', raw: 'you have 1,000 or more life' },
      steps: [{ kind: 'lose_game', raw: 'you lose the game' }],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^then, double the amount of life you lose and cards you draw for the rest of the game from this ability$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('this permanent'),
      effectText: ['double the amount of life you lose and cards you draw for the rest of the game from this ability'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^the next time you would lose the game this turn, instead draw (one|\d+|two|three|four|five|six|seven|eight|nine|ten) cards? and your life total becomes (\d+)$/i.test(raw)) {
    const loseGameReplacementMatch = raw.match(
      /^the next time you would lose the game this turn, instead draw (one|\d+|two|three|four|five|six|seven|eight|nine|ten) cards? and your life total becomes (\d+)$/i,
    );
    const drawWord = String(loseGameReplacementMatch?.[1] || '').trim().toLowerCase();
    const drawCountMap: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };
    const drawCount = drawCountMap[drawWord] ?? Number.parseInt(drawWord, 10) ?? 0;
    const lifeTotal = Number.parseInt(String(loseGameReplacementMatch?.[2] || ''), 10) || 0;
    return [{
      kind: 'register_lose_game_replacement',
      who: { kind: 'you' },
      drawCount,
      lifeTotal,
      expiresAt: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^you and that player may each put a permanent card from your hand onto the battlefield$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('a permanent card from your hand'),
      to: 'battlefield',
      who: { kind: 'each_player' },
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^curse defending player$/i.test(raw)) {
    return [{
      kind: 'create_token',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      token: 'Curse enchantment token attached to defending player',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^the attacking player gains control of this artifact and untaps it\.?$/i.test(raw)) {
    return [{
      kind: 'gain_control',
      what: parseObjectSelector('this artifact'),
      newController: { kind: 'target_player' },
      duration: 'indefinite',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const drawAndLoseWhereMatch = raw.match(
    /^you draw x cards and lose x life,? where x is (.+)$/i,
  );
  if (drawAndLoseWhereMatch) {
    const whereX = {
      kind: 'where',
      raw: String(drawAndLoseWhereMatch[1] || '').trim(),
    } as OracleClauseCondition;
    return [
      {
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'x' },
        whereX,
        raw: 'you draw x cards',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'lose_life',
        who: { kind: 'you' },
        amount: { kind: 'x' },
        whereX,
        raw: `lose x life, where x is ${whereX.raw}`,
        ...sequence,
      } as unknown as OracleEffectStep,
    ];
  }

  const bareStaticCostReduction = tryParseBareStaticCostReductionSteps(raw, sequence);
  if (bareStaticCostReduction) return bareStaticCostReduction;
  return null;
}

