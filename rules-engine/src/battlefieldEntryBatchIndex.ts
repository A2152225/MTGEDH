/**
 * Entry-batch battlefield index (perf). Active only inside withBattlefieldEntryBatchIndex, which token creation
 * uses while appending plain (textless-for-loss) tokens. The index caches positions of "lose"-text sources and
 * attachment hosts; it extends itself when entries are appended and rebuilds on any other shape change, so
 * lookups return exactly what a full battlefield scan would.
 */

interface BattlefieldIndex {
  len: number;
  lastObj: unknown;
  lossPositions: number[];
  idPositions: Map<string, number[]>;
  attachedToPositions: Map<string, number[]>;
}

let depth = 0;
let indexes = new WeakMap<readonly any[], BattlefieldIndex>();

export function isBattlefieldEntryBatchIndexActive(): boolean {
  return depth > 0;
}

export function withBattlefieldEntryBatchIndex<T>(fn: () => T): T {
  if (depth === 0) indexes = new WeakMap();
  depth += 1;
  try {
    return fn();
  } finally {
    depth -= 1;
    if (depth === 0) indexes = new WeakMap();
  }
}

function push(map: Map<string, number[]>, key: string, pos: number): void {
  const list = map.get(key);
  if (list) list.push(pos); else map.set(key, [pos]);
}

function indexFor(
  battlefield: readonly any[],
  mentionsLose: (perm: any) => boolean,
): BattlefieldIndex {
  let idx = indexes.get(battlefield);
  const extendable = idx && idx.len <= battlefield.length
    && (idx.len === 0 || battlefield[idx.len - 1] === idx.lastObj);
  if (!idx || !extendable) {
    idx = { len: 0, lastObj: undefined, lossPositions: [], idPositions: new Map(), attachedToPositions: new Map() };
    indexes.set(battlefield, idx);
  }
  for (let i = idx.len; i < battlefield.length; i++) {
    const perm = battlefield[i];
    if (perm && mentionsLose(perm)) idx.lossPositions.push(i);
    const id = String(perm?.id || '');
    if (id) push(idx.idPositions, id, i);
    const host = String(perm?.attachedTo || '');
    if (host) push(idx.attachedToPositions, host, i);
  }
  idx.len = battlefield.length;
  idx.lastObj = battlefield[battlefield.length - 1];
  return idx;
}

/** Battlefield entries (in order) whose own text mentions "lose"; caller re-checks the live text. */
export function indexedLossSources(battlefield: readonly any[], mentionsLose: (perm: any) => boolean): any[] {
  return indexFor(battlefield, mentionsLose).lossPositions.map((i) => battlefield[i]);
}

/** Same result as filtering the battlefield for perm's attachments (by id list or attachedTo), in board order. */
export function indexedAttachmentCandidates(
  battlefield: readonly any[],
  mentionsLose: (perm: any) => boolean,
  hostId: string,
  attachedIds: ReadonlySet<string>,
): any[] {
  const idx = indexFor(battlefield, mentionsLose);
  const positions = new Set<number>();
  if (hostId) for (const i of idx.attachedToPositions.get(hostId) || []) positions.add(i);
  for (const id of attachedIds) for (const i of idx.idPositions.get(id) || []) positions.add(i);
  return [...positions].sort((a, b) => a - b).map((i) => battlefield[i]);
}