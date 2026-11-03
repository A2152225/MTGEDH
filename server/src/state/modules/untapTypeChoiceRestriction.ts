// server/src/state/modules/untapTypeChoiceRestriction.ts
// B48: Storage Matrix - "As long as ~ is untapped, each player chooses artifact, creature, or land during their
// untap step. That player can untap only permanents of the chosen type this step."
// The choice is read from state.untapTypeChoice[playerId] when a UI/AI choice was recorded; otherwise the type
// with the most tapped permanents the player controls is chosen (ties: land, creature, artifact).
// Origin parent: qualifiedUntapProhibitionSource (untapQualifierProhibitions.ts).
// Public entry symbols: untapTypeChoiceSource, chooseUntapType.

const TYPES = ['land', 'creature', 'artifact'] as const;
const MATRIX_RE = /as long as (?:~|this artifact) is untapped, each player chooses artifact, creature, or land during their untap step/;

function lowerOracle(perm: any): string {
  const card = perm?.card || {};
  const faces = Array.isArray(card.card_faces) ? card.card_faces.map((f: any) => f?.oracle_text || '') : [];
  const name = String(card.name || '').toLowerCase();
  const t = [card.oracle_text || '', ...faces].join('\n').toLowerCase().replace(/[\u2018\u2019]/g, "'");
  return name ? t.split(name).join('~') : t;
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function wasTapped(p: any, atStart?: Set<any>): boolean {
  return atStart ? atStart.has(p?.id) : p?.tapped === true;
}

export function chooseUntapType(battlefield: readonly any[], playerId: string, recorded?: string, atStart?: Set<any>): string {
  if (recorded && (TYPES as readonly string[]).includes(recorded)) return recorded;
  let best: string = 'land';
  let bestCount = -1;
  for (const type of TYPES) {
    const n = battlefield.filter((p: any) => p && wasTapped(p, atStart) && String(p.controller || '') === playerId && new RegExp('\\b' + type + '\\b').test(typeLineOf(p))).length;
    if (n > bestCount) { best = type; bestCount = n; }
  }
  return best;
}

/** Source name when a Storage Matrix-style effect stops this permanent untapping, else null. */
export function untapTypeChoiceSource(battlefield: readonly any[] | undefined, permanent: any, state?: any): string | null {
  const list = Array.isArray(battlefield) ? battlefield : [];
  const atStart: Set<any> | undefined = state?.untapStepTappedAtStart instanceof Set ? state.untapStepTappedAtStart : undefined;
  const src = list.find((p: any) => p && !p.phasedOut && !wasTapped(p, atStart) && !p.tapped && MATRIX_RE.test(lowerOracle(p)));
  if (!src) return null;
  const pid = String(permanent?.controller || '');
  const chosen = chooseUntapType(list, pid, state?.untapTypeChoice?.[pid], atStart);
  if (new RegExp('\\b' + chosen + '\\b').test(typeLineOf(permanent))) return null;
  return String(src?.card?.name || 'A permanent');
}
