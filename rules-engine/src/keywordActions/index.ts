/**
 * Rule 701: Keyword Actions
 * 
 * Modular implementation of Magic: The Gathering keyword actions.
 * Each keyword action is defined in its own module file.
 * 
 * Reference: MagicCompRules 20251114.txt, Rule 701
 */

// Part 1: Rules 701.2-701.9
export * from './activate';
export * from './attach';
export * from './behold';
export * from './cast';
export * from './counter';
export * from './create';
export * from './destroy';
export * from './discard';

// Part 2: Rules 701.10-701.17
export * from './double';
export * from './triple';
export * from './exchange';
export * from './exile';
export * from './fight';
export * from './goad';
export * from './investigate';
export * from './mill';

// Part 3: Rules 701.18-701.26
export * from './play';
export * from './regenerate';
export * from './reveal';
export * from './sacrifice';
export * from './scry';
export * from './search';
export * from './shuffle';
export * from './surveil';
export * from './tapUntap';

// Union type for all keyword actions
import type { ActivateAction } from './activate';
import type { AttachAction } from './attach';
import type { BeholdAction } from './behold';
import type { CastAction } from './cast';
import type { CounterAction } from './counter';
import type { CreateAction } from './create';
import type { DestroyAction } from './destroy';
import type { DiscardAction } from './discard';
import type { DoubleAction } from './double';
import type { TripleAction } from './triple';
import type { ExchangeAction } from './exchange';
import type { ExileAction } from './exile';
import type { FightAction } from './fight';
import type { GoadAction } from './goad';
import type { InvestigateAction } from './investigate';
import type { MillAction } from './mill';
import type { PlayAction } from './play';
import type { RegenerateAction } from './regenerate';
import type { RevealAction } from './reveal';
import type { SacrificeAction } from './sacrifice';
import type { ScryAction } from './scry';
import type { SearchAction } from './search';
import type { ShuffleAction } from './shuffle';
import type { SurveilAction } from './surveil';
import type { TapUntapAction } from './tapUntap';

export type KeywordAction =
  // Part 1
  | ActivateAction
  | AttachAction
  | BeholdAction
  | CastAction
  | CounterAction
  | CreateAction
  | DestroyAction
  | DiscardAction
  // Part 2
  | DoubleAction
  | TripleAction
  | ExchangeAction
  | ExileAction
  | FightAction
  | GoadAction
  | InvestigateAction
  | MillAction
  // Part 3
  | PlayAction
  | RegenerateAction
  | RevealAction
  | SacrificeAction
  | ScryAction
  | SearchAction
  | ShuffleAction
  | SurveilAction
  | TapUntapAction;
