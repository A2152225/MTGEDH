from pathlib import Path
import re

# ---------- 1) oracleIR.ts: add any_player_may + grant_next_spell_cost_reduction kinds ----------
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIR.ts')
text = p.read_text(encoding='utf-8')

if "kind: 'any_player_may'" not in text:
    needle = "      readonly kind: 'unless_sacrifices';"
    insert = '''      /**
       * Any player may make an optional payment; if someone does, nested steps
       * apply (typically counter this spell). Dash Hopes / Brain Gorgers-style.
       */
      readonly kind: 'any_player_may';
      readonly payment:
        | { readonly kind: 'life'; readonly amount: number }
        | { readonly kind: 'half_life_rounded_up' }
        | { readonly kind: 'discard'; readonly amount: number }
        | { readonly kind: 'sacrifice'; readonly what: string };
      readonly steps: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
'''
    if needle not in text:
        raise SystemExit('unless_sacrifices kind missing')
    text = text.replace(needle, insert + needle, 1)
    print('added any_player_may kind')
else:
    print('any_player_may already present')

if "kind: 'grant_next_spell_cost_reduction'" not in text:
    # insert near grant_static_ability if present, else after remove_counter
    needle = "      readonly kind: 'remove_counter';"
    idx = text.find(needle)
    if idx < 0:
        raise SystemExit('remove_counter kind missing')
    # find end of remove_counter union member
    end = text.find('\n  | {', idx + 10)
    block = '''
  | {
      /**
       * The next spell you cast this turn costs {N} less for each counter
       * removed this way (Mutated Cultist-style deferred cost reduction).
       */
      readonly kind: 'grant_next_spell_cost_reduction';
      readonly mana: string;
      readonly perCountersRemoved?: boolean;
      readonly amount?: number;
      readonly duration?: string;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }'''
    text = text[:end] + block + text[end:]
    print('added grant_next_spell_cost_reduction kind')
else:
    print('grant_next_spell_cost_reduction already present')

p.write_text(text, encoding='utf-8')

# ---------- 2) oracleIRExecutionTypes.ts: choice fields ----------
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutionTypes.ts')
text = p.read_text(encoding='utf-8')
if 'anyPlayerMayChoice' not in text:
    needle = "  readonly unlessSacrificesChoice?: 'sacrifice' | 'decline';"
    insert = needle + '''
  /** Bound pay/decline for any-player-may tax windows when already known. */
  readonly anyPlayerMayChoice?: 'pay' | 'decline';
  /** Player who is answering / paid the any-player-may window. */
  readonly anyPlayerMayPayerId?: PlayerID;
  /** Players who already declined an any-player-may window. */
  readonly anyPlayerMayDeclinedPlayerIds?: readonly PlayerID[];
  /** Chosen permanent id when any-player-may payment is sacrifice. */
  readonly anyPlayerMaySacrificePermanentId?: string;
  /** Counters removed by the most recent remove_counter step in this execution. */
  readonly countersRemovedThisWay?: number;'''
    if needle not in text:
        raise SystemExit('unlessSacrificesChoice missing')
    text = text.replace(needle, insert, 1)
    p.write_text(text, encoding='utf-8')
    print('added anyPlayerMay ctx fields')
else:
    print('anyPlayerMay ctx already present')

print('types done')
