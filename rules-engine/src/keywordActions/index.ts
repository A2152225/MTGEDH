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

// Part 4: Rules 701.27-701.34
export * from './transform';
export * from './convert';
export * from './fateseal';
export * from './clash';
export * from './planeswalk';
export * from './setInMotion';
export * from './abandon';
export * from './proliferate';

// Part 5: Rules 701.35-701.42
export * from './detain';
export * from './populate';
export * from './monstrosity';
export * from './vote';
export * from './bolster';
export * from './manifest';
export * from './support';
export * from './meld';

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
import type { TransformAction } from './transform';
import type { ConvertAction } from './convert';
import type { FatesealAction } from './fateseal';
import type { ClashAction } from './clash';
import type { PlaneswalkAction } from './planeswalk';
import type { SetInMotionAction } from './setInMotion';
import type { AbandonAction } from './abandon';
import type { ProliferateAction } from './proliferate';
import type { DetainAction } from './detain';
import type { PopulateAction } from './populate';
import type { MonstrosityAction } from './monstrosity';
import type { VoteAction } from './vote';
import type { BolsterAction } from './bolster';
import type { ManifestAction } from './manifest';
import type { SupportAction } from './support';
import type { MeldAction } from './meld';

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
  | TapUntapAction
  // Part 4
  | TransformAction
  | ConvertAction
  | FatesealAction
  | ClashAction
  | PlaneswalkAction
  | SetInMotionAction
  | AbandonAction
  | ProliferateAction
  // Part 5
  | DetainAction
  | PopulateAction
  | MonstrosityAction
  | VoteAction
  | BolsterAction
  | ManifestAction
  | SupportAction
  | MeldAction;
