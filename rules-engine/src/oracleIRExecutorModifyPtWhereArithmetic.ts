import type { GameState, PlayerID } from '../../shared/src';

type EvaluateInner = (expr: string) => number | null;

export function tryEvaluateModifyPtWhereArithmetic(args: {
  state: GameState;
  controllerId: PlayerID;
  raw: string;
  evaluateInner: EvaluateInner;
}): number | null {
  const { state, controllerId, raw, evaluateInner } = args;

  {
    const m = raw.match(/^x is the damage dealt to your opponents this turn$/i);
    if (m) {
      const stateAny: any = state as any;
      const byPlayer = stateAny?.damageTakenThisTurnByPlayer;
      if (!byPlayer || typeof byPlayer !== 'object') return null;

      return (state.players || []).reduce((sum: number, p: any) => {
        const id = String((p as any)?.id || '').trim();
        if (!id || id === controllerId) return sum;
        const dealt = Number((byPlayer as Record<string, unknown>)[id]);
        if (!Number.isFinite(dealt)) return sum;
        return sum + Math.max(0, dealt);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is (one|\d+) plus (.+)$/i);
    if (m) {
      const addend = String(m[1] || '').toLowerCase() === 'one' ? 1 : parseInt(String(m[1] || '0'), 10) || 0;
      const inner = evaluateInner(String(m[2] || ''));
      if (inner === null) return null;
      return inner + addend;
    }
  }

  {
    const m = raw.match(/^x is (one|\d+) minus (.+)$/i);
    if (m) {
      const minuend = String(m[1] || '').toLowerCase() === 'one' ? 1 : parseInt(String(m[1] || '0'), 10) || 0;
      const inner = evaluateInner(String(m[2] || ''));
      if (inner === null) return null;
      return minuend - inner;
    }
  }

  {
    const m = raw.match(/^x is (.+) minus (.+)$/i);
    if (m) {
      const minuend = evaluateInner(String(m[1] || ''));
      if (minuend !== null) {
        const subtrahend = evaluateInner(String(m[2] || ''));
        if (subtrahend !== null) return minuend - subtrahend;
      }
    }
  }

  {
    const m = raw.match(/^x is twice (.+)$/i);
    if (m) {
      const inner = evaluateInner(String(m[1] || ''));
      if (inner === null) return null;
      return inner * 2;
    }
  }

  {
    const m = raw.match(/^x is half (?:the|this|that) (.+?)(?:, rounded (up|down))?$/i);
    if (m) {
      const expr = String(m[1] || '').trim();
      let inner = evaluateInner(expr);
      if (inner === null && !/^the\s+/i.test(expr)) {
        inner = evaluateInner(`the ${expr}`);
      }
      if (inner === null) return null;
      const mode = String(m[2] || '').toLowerCase();
      if (mode === 'up') return Math.ceil(inner / 2);
      return Math.floor(inner / 2);
    }
  }

  {
    const m = raw.match(/^x is (.+) minus (one|\d+)$/i);
    if (m) {
      const inner = evaluateInner(String(m[1] || ''));
      if (inner === null) return null;
      const subtrahend = String(m[2] || '').toLowerCase() === 'one' ? 1 : parseInt(String(m[2] || '0'), 10) || 0;
      return inner - subtrahend;
    }
  }

  return null;
}
