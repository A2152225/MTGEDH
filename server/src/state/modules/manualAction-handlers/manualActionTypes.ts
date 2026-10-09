// Origin parent: server/src/state/modules/manualActionApply.ts
// Cluster: shared result type for kitchen-table manual verbs.
// Public entry symbols: ManualPeekedCard, ManualActionResult.

export type ManualPeekedCard = {
  id: string;
  name: string;
  type_line?: string;
  image_uris?: { small?: string; normal?: string };
};

export type ManualActionResult = {
  ok: boolean;
  summary: string;
  error?: string;
  peekedCards?: ManualPeekedCard[];
  publicPeek?: boolean;
};
