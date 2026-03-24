import type { BattlefieldPermanent, PlayerID } from '../../shared/src';

export interface TokenCharacteristics {
  readonly name: string;
  readonly colors: readonly string[];
  readonly types: readonly string[];
  readonly subtypes: readonly string[];
  readonly power?: number;
  readonly toughness?: number;
  readonly abilities: readonly string[];
  readonly isLegendary?: boolean;
  readonly isArtifact?: boolean;
  readonly entersTapped?: boolean;
}

export interface TokenCreationRequest {
  readonly characteristics: TokenCharacteristics;
  readonly count: number;
  readonly controllerId: PlayerID;
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly withCounters?: Record<string, number>;
  readonly copyOf?: string;
}

export interface CreatedToken {
  readonly id: string;
  readonly token: BattlefieldPermanent;
  readonly triggersETB: boolean;
}

export interface TokenCreationResult {
  readonly tokens: readonly CreatedToken[];
  readonly etbTriggers: readonly ETBTriggerInfo[];
  readonly otherTriggers: readonly TokenTriggerInfo[];
  readonly log: readonly string[];
}

export interface ETBTriggerInfo {
  readonly tokenId: string;
  readonly tokenName: string;
  readonly controllerId: PlayerID;
  readonly effect: string;
  readonly requiresChoice: boolean;
  readonly choiceType?: 'target' | 'may' | 'choice';
  readonly options?: readonly string[];
}

export interface TokenTriggerInfo {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: PlayerID;
  readonly effect: string;
  readonly triggeredByTokenId: string;
  readonly requiresChoice: boolean;
}
