// New sibling for generic until-next-turn “nearest opponent in chosen direction”
// attack locks (Teyo, Geometric Tactician −2 oracle pattern).
// Combat reads grant_temporary_ability / staticAbilityGrantEffects text or
// structured fields; no card-name checks.
// Public: parseNearestOpponentDirectionAttackLock,
//   getNearestOpponentInChosenDirection,
//   getNearestOpponentDirectionAllowedDefenderId,
//   getNearestOpponentDirectionAttackViolation
// Battles are legal only when the locked opponent is the battle's
// defending player / protector (not merely the battle's controller).

export type SeatDirection = 'left' | 'right';

export type NearestOpponentDirectionAttackLock = {
  readonly direction: SeatDirection;
  readonly controllerId?: string;
  readonly duration?: string;
  readonly turnApplied?: number;
  readonly expiresOnControllerTurn?: string;
};

const NEAREST_OPPONENT_DIRECTION_PATTERN =
  /may attack only the nearest opponent(?:\s+to the (left|right)|\s+in the last chosen direction)/i;

function normalizeGrantText(value: unknown): string {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function readStructuredDirection(entry: any): SeatDirection | null {
  const candidates = [
    entry?.nearestOpponentAttackDirection,
    entry?.chosenDirection,
    entry?.direction,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim().toLowerCase();
    if (normalized === 'left' || normalized === 'right') return normalized;
  }
  return null;
}

function hasStructuredNearestOpponentLock(entry: any): boolean {
  return entry?.attackLock === 'nearest_opponent_in_direction'
    || entry?.attackRestriction === 'nearest_opponent_in_chosen_direction';
}

export function parseNearestOpponentDirectionAttackLock(
  text: string,
  structured?: any,
): NearestOpponentDirectionAttackLock | null {
  const structuredDirection = readStructuredDirection(structured);
  const normalized = normalizeGrantText(text);
  const match = normalized.match(NEAREST_OPPONENT_DIRECTION_PATTERN);
  const textDirection = match?.[1] ? String(match[1]).toLowerCase() as SeatDirection : null;
  const direction = structuredDirection || textDirection;
  if (!direction) return null;
  if (!match && !hasStructuredNearestOpponentLock(structured)) return null;
  return {
    direction,
    controllerId: String(structured?.controllerId || '').trim() || undefined,
    duration: String(structured?.duration || '').trim() || undefined,
    turnApplied: Number.isFinite(Number(structured?.turnApplied))
      ? Number(structured.turnApplied)
      : undefined,
    expiresOnControllerTurn: String(structured?.expiresOnControllerTurn || '').trim() || undefined,
  };
}

function collectGrantTextFragments(entry: any): string[] {
  const fragments: string[] = [];
  if (typeof entry === 'string') {
    fragments.push(entry);
    return fragments;
  }
  if (!entry || typeof entry !== 'object') return fragments;
  if (typeof entry.raw === 'string') fragments.push(entry.raw);
  if (typeof entry.description === 'string') fragments.push(entry.description);
  if (typeof entry.ability === 'string') fragments.push(entry.ability);
  if (typeof entry.effectText === 'string') fragments.push(entry.effectText);
  if (Array.isArray(entry.effectText)) {
    for (const value of entry.effectText) fragments.push(String(value || ''));
  }
  if (Array.isArray(entry.abilities)) {
    for (const value of entry.abilities) fragments.push(String(value || ''));
  }
  if (Array.isArray(entry.grantedAbilities)) {
    for (const value of entry.grantedAbilities) fragments.push(String(value || ''));
  }
  if (Array.isArray(entry.descriptions)) {
    for (const value of entry.descriptions) fragments.push(String(value || ''));
  }
  return fragments;
}

function parseLockFromGrant(entry: any): NearestOpponentDirectionAttackLock | null {
  const structuredDirection = readStructuredDirection(entry);
  const fragments = collectGrantTextFragments(entry);
  const combined = fragments.join(' ');
  const parsed = parseNearestOpponentDirectionAttackLock(combined, entry);
  if (parsed) return parsed;
  if (structuredDirection && hasStructuredNearestOpponentLock(entry)) {
    return parseNearestOpponentDirectionAttackLock(
      `may attack only the nearest opponent to the ${structuredDirection}`,
      entry,
    );
  }
  return null;
}

function isPlayerStillInGame(player: any): boolean {
  if (!player) return false;
  if (player.hasLost || player.eliminated || player.conceded || player.isSpectator) return false;
  return true;
}

function readPlayerId(player: any): string {
  return String(player?.id || player?.playerId || '').trim();
}

function getSeatOrderIds(state: any): string[] {
  const explicit = Array.isArray(state?.turnOrder)
    ? state.turnOrder.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : [];
  if (explicit.length > 0) return explicit;
  return (Array.isArray(state?.players) ? state.players : [])
    .map(readPlayerId)
    .filter(Boolean);
}

export function getNearestOpponentInChosenDirection(
  state: any,
  attackerPlayerId: string,
  direction: SeatDirection,
): string | null {
  const attackerId = String(attackerPlayerId || '').trim();
  if (!attackerId) return null;
  const players = Array.isArray(state?.players) ? state.players : [];
  const byId = new Map<string, any>();
  for (const player of players) {
    const id = readPlayerId(player);
    if (id) byId.set(id, player);
  }
  const order = getSeatOrderIds(state);
  const start = order.indexOf(attackerId);
  if (start < 0 || order.length < 2) return null;
  const step = direction === 'left' ? 1 : -1;
  for (let offset = 1; offset < order.length; offset++) {
    const idx = (start + step * offset + order.length * offset) % order.length;
    const candidateId = order[idx];
    if (!candidateId || candidateId === attackerId) continue;
    if (isPlayerStillInGame(byId.get(candidateId) || { id: candidateId })) {
      return candidateId;
    }
  }
  return null;
}

function getActivePlayerId(state: any): string {
  return String(state?.activePlayer || state?.turnPlayer || '').trim();
}

function isLockExpired(lock: NearestOpponentDirectionAttackLock, state: any): boolean {
  const activePlayerId = getActivePlayerId(state);
  const turnNumber = Number(state?.turnNumber || state?.turn || 0);
  const expiresOn = String(lock.expiresOnControllerTurn || '').trim()
    || (String(lock.duration || '') === 'until_next_turn' ? String(lock.controllerId || '').trim() : '');
  const turnApplied = Number(lock.turnApplied || 0);
  if (!expiresOn || !activePlayerId) return false;
  if (activePlayerId !== expiresOn) return false;
  if (turnApplied > 0 && turnNumber > turnApplied) return true;
  return false;
}

function lockAppliesToAttacker(entry: any, attackerPlayerId: string): boolean {
  const targetPlayerId = String(entry?.targetPlayerId || '').trim();
  if (targetPlayerId) return targetPlayerId === attackerPlayerId;
  const targetText = normalizeGrantText(
    entry?.target?.text || entry?.target || '',
  ).toLowerCase();
  if (!targetText) return true;
  if (/^each player$/.test(targetText) || /^all players$/.test(targetText)) return true;
  if (/^you$/.test(targetText)) {
    const controllerId = String(entry?.controllerId || '').trim();
    return !controllerId || controllerId === attackerPlayerId;
  }
  return true;
}

function collectGrantEntries(state: any): any[] {
  const entries: any[] = [];
  if (Array.isArray(state?.staticAbilityGrantEffects)) {
    entries.push(...state.staticAbilityGrantEffects);
  }
  for (const player of Array.isArray(state?.players) ? state.players : []) {
    if (Array.isArray(player?.temporaryAbilities)) entries.push(...player.temporaryAbilities);
    if (Array.isArray(player?.grantedAbilities)) entries.push(...player.grantedAbilities);
    if (Array.isArray(player?.temporaryEffects)) entries.push(...player.temporaryEffects);
  }
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (Array.isArray(perm?.temporaryEffects)) entries.push(...perm.temporaryEffects);
    if (Array.isArray(perm?.temporaryAbilities)) entries.push(...perm.temporaryAbilities);
    if (Array.isArray(perm?.grantedAbilities)) entries.push(...perm.grantedAbilities);
    if (Array.isArray(perm?.staticAbilityGrantEffects)) entries.push(...perm.staticAbilityGrantEffects);
  }
  return entries;
}

function collectActiveLocksForAttacker(
  state: any,
  attackerPlayerId: string,
): NearestOpponentDirectionAttackLock[] {
  const locks: NearestOpponentDirectionAttackLock[] = [];
  for (const entry of collectGrantEntries(state)) {
    if (!lockAppliesToAttacker(entry, attackerPlayerId)) continue;
    const lock = parseLockFromGrant(entry);
    if (!lock) continue;
    if (isLockExpired(lock, state)) continue;
    locks.push(lock);
  }
  return locks;
}

export function getNearestOpponentDirectionAllowedDefenderId(
  state: any,
  attackerPlayerId: string,
): string | null | undefined {
  const locks = collectActiveLocksForAttacker(state, attackerPlayerId);
  if (locks.length === 0) return undefined;
  const lock = locks[locks.length - 1];
  return getNearestOpponentInChosenDirection(state, attackerPlayerId, lock.direction);
}

function findBattlefieldPermanent(state: any, permanentId: string): any | null {
  const needle = String(permanentId || '').trim();
  if (!needle) return null;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.find((perm: any) => String(perm?.id || '').trim() === needle) || null;
}

function isBattlePermanent(perm: any): boolean {
  const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
  return typeLine.includes('battle');
}

function readBattleDefendingPlayerId(perm: any): string {
  const candidates = [
    perm?.protectorId,
    perm?.protector,
    perm?.protectedBy,
    perm?.defendingPlayerId,
    perm?.defendingPlayer,
    perm?.chosenOpponentId,
    perm?.chosenOpponent,
  ];
  for (const candidate of candidates) {
    const id = String(candidate || '').trim();
    if (id) return id;
  }
  return '';
}

function resolveAttackTargetBattle(state: any, targetPermanentId?: string | null): any | null {
  const perm = findBattlefieldPermanent(state, String(targetPermanentId || ''));
  if (!perm || !isBattlePermanent(perm)) return null;
  return perm;
}

export function getNearestOpponentDirectionAttackViolation(args: {
  state: any;
  attackerPlayerId: string;
  defendingPlayerId?: string | null;
  targetPermanentId?: string | null;
}): { illegal: boolean; reason?: string; allowedDefenderId?: string | null } {
  const attackerPlayerId = String(args.attackerPlayerId || '').trim();
  const defendingPlayerId = String(args.defendingPlayerId || '').trim();
  const allowedDefenderId = getNearestOpponentDirectionAllowedDefenderId(args.state, attackerPlayerId);
  if (allowedDefenderId === undefined) {
    return { illegal: false };
  }
  const targetPermanentId = String(args.targetPermanentId || '').trim();
  const battle = resolveAttackTargetBattle(args.state, targetPermanentId)
    || resolveAttackTargetBattle(args.state, defendingPlayerId);
  if (battle) {
    const battleDefenderId = readBattleDefendingPlayerId(battle);
    if (allowedDefenderId && battleDefenderId === allowedDefenderId) {
      return { illegal: false, allowedDefenderId };
    }
    return {
      illegal: true,
      allowedDefenderId,
      reason: allowedDefenderId
        ? `Each player may attack only the nearest opponent in the chosen direction (and that opponent's planeswalkers)`
        : `Each player may attack only the nearest opponent in the chosen direction`,
    };
  }
  if (!defendingPlayerId) {
    return { illegal: false, allowedDefenderId };
  }
  if (allowedDefenderId && defendingPlayerId === allowedDefenderId) {
    return { illegal: false, allowedDefenderId };
  }
  return {
    illegal: true,
    allowedDefenderId,
    reason: allowedDefenderId
      ? `Each player may attack only the nearest opponent in the chosen direction (and that opponent's planeswalkers)`
      : `Each player may attack only the nearest opponent in the chosen direction`,
  };
}
