from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIR.ts')
text = p.read_text(encoding='utf-8')

old_tw = """  /** When true, max mode count becomes 2 if teamworkWasPaid is set on the execution context. */
  readonly teamworkChooseBoth?: boolean;
  /** When true, each chosen mode must target a different player (Shadrix-style). */"""
new_tw = """  /** When true, max mode count becomes 2 if teamworkWasPaid is set on the execution context. */
  readonly teamworkChooseBoth?: boolean;
  /**
   * When true, if the source was kicked, both modes resolve (forced).
   * Unkicked: choose exactly one. Matches \"If it was kicked, choose both instead.\"
   */
  readonly kickerChooseBoth?: boolean;
  /** When true, each chosen mode must target a different player (Shadrix-style). */"""
if old_tw not in text:
    raise SystemExit('teamworkChooseBoth anchor missing')
text = text.replace(old_tw, new_tw, 1)

old_unless = """      readonly kind: 'unless_discards';
      readonly who: OraclePlayerSelector;
      readonly amount: number;
      readonly steps: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * Wrapper for effects that only happen if a referenced player doesn't or
       * can't pay a fixed mana cost.
       */
      readonly kind: 'unless_pays_mana';"""
new_unless = """      readonly kind: 'unless_discards';
      readonly who: OraclePlayerSelector;
      readonly amount: number;
      readonly steps: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * Wrapper for effects that only happen if a referenced player doesn't or
       * can't sacrifice a matching permanent, e.g. \"counter it unless you
       * sacrifice a land\" (Mana Vortex).
       */
      readonly kind: 'unless_sacrifices';
      readonly who: OraclePlayerSelector;
      readonly what: { readonly kind: 'raw'; readonly text: string };
      readonly steps: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * Wrapper for effects that only happen if a referenced player doesn't or
       * can't pay a fixed mana cost.
       */
      readonly kind: 'unless_pays_mana';"""
if old_unless not in text:
    raise SystemExit('unless_discards anchor missing')
text = text.replace(old_unless, new_unless, 1)
p.write_text(text, encoding='utf-8')
print('oracleIR.ts ok')
