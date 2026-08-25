// Origin parent: rules-engine/src/AutomationService.ts
// Cluster moved: TargetingSourceInfo, TargetDecisionZone, TargetDecisionConstraints.
// Public entry symbols: TargetingSourceInfo, TargetDecisionZone, TargetDecisionConstraints.
// Leaf must not import AutomationService.ts or AutomationService-handlers/index.ts.

export interface TargetingSourceInfo {
  readonly sourceId?: string;
  readonly controllerId: string;
  readonly colors?: readonly string[];
  readonly objectType: 'spell' | 'ability';
  readonly typeName?: string;
}

export type TargetDecisionZone = 'graveyard' | 'hand' | 'exile' | 'library' | 'commandZone';

export interface TargetDecisionConstraints {
  readonly controllerScope?: 'self' | 'opponent';
  readonly customFilters?: readonly string[];
  readonly zones?: readonly TargetDecisionZone[];
}
