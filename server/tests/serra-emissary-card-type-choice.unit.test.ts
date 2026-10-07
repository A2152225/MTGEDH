import { describe, expect, it } from 'vitest';
import { ResolutionStepType } from '../src/state/resolution/index.js';
import { buildPlayerChoicePrompt } from '../src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerConnivePlayerChoicePrompts.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser';

describe("Serra's Emissary card type choice", () => {
  it('parses "choose a card type" as player_choice card_type', () => {
    const ir = parseOracleTextToIR(
      "As Serra's Emissary enters, choose a card type.\nSerra's Emissary has protection from each of the chosen card types.\n",
    );
    const steps = ir.abilities.flatMap((a: any) => a.steps || []);
    const choice = steps.find((s: any) => s.kind === 'player_choice' && s.choice === 'card_type');
    expect(choice).toBeTruthy();
  });

  it('builds OPTION_CHOICE with CR card types, not creature subtypes', () => {
    const prompt = buildPlayerChoicePrompt(
      { kind: 'player_choice', choice: 'card_type', raw: 'choose a card type' } as any,
      { controller: 'p1' as any, sourceName: "Serra's Emissary", sourceId: 'serra1' },
    );
    expect(prompt).toBeTruthy();
    expect(prompt!.type).toBe(ResolutionStepType.OPTION_CHOICE);
    const ids = (prompt!.options || []).map((o: any) => o.id);
    expect(ids).toEqual([
      'artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery',
    ]);
    expect(ids).not.toContain('Angel');
  });
});
