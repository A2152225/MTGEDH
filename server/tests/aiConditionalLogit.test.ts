/**
 * P1-3 conditional logit unit tests.
 */

import { describe, expect, it } from 'vitest';
import { winProbabilities } from '../../rules-engine/src/ai/winProbability.js';
import {
  type Example,
  fit,
  lossAndGrad,
  softmax,
} from '../scripts/lib/conditionalLogit.js';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('conditionalLogit', () => {
  it('softmax agrees with winProbabilities on random inputs', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 20; i++) {
      const values: Record<string, number> = {};
      const scores: number[] = [];
      for (let j = 0; j < 4; j++) {
        const v = (rng() - 0.5) * 10;
        values[`p${j}`] = v;
        scores.push(v);
      }
      const fromSoft = softmax(scores);
      const fromWin = winProbabilities(values, []);
      for (let j = 0; j < 4; j++) {
        expect(fromSoft[j]).toBeCloseTo(fromWin[`p${j}`], 10);
      }
    }
  });

  it('gradient matches a finite-difference estimate', () => {
    const data: Example[] = [
      {
        gameId: 'g1',
        pod: 'p1',
        X: [
          [1, 0.2, 0.1],
          [0.5, 0.8, 0.0],
          [0.2, 0.3, 0.9],
        ],
        winnerIdx: 1,
      },
      {
        gameId: 'g2',
        pod: 'p2',
        X: [
          [0.9, 0.1, 0.2],
          [0.1, 0.7, 0.4],
        ],
        winnerIdx: 0,
      },
    ];
    const w = [0.2, -0.1, 0.05];
    const { grad } = lossAndGrad(data, w, 0.01);
    const eps = 1e-5;
    for (let k = 0; k < w.length; k++) {
      const wPlus = w.slice();
      const wMinus = w.slice();
      wPlus[k] += eps;
      wMinus[k] -= eps;
      const num =
        (lossAndGrad(data, wPlus, 0.01).loss - lossAndGrad(data, wMinus, 0.01).loss)
        / (2 * eps);
      expect(Math.abs(grad[k] - num)).toBeLessThan(1e-4);
    }
  });

  it('recovers known weights on synthetic data', () => {
    const truth = [1.5, -2.0, 0.8];
    const rng = mulberry32(42);
    const data: Example[] = [];
    for (let i = 0; i < 3000; i++) {
      const seats = 3;
      const X: number[][] = [];
      const scores: number[] = [];
      for (let s = 0; s < seats; s++) {
        const row = [rng(), rng(), rng()];
        X.push(row);
        scores.push(truth[0] * row[0] + truth[1] * row[1] + truth[2] * row[2]);
      }
      const p = softmax(scores);
      let r = rng();
      let winnerIdx = seats - 1;
      for (let s = 0; s < seats; s++) {
        r -= p[s];
        if (r <= 0) {
          winnerIdx = s;
          break;
        }
      }
      data.push({ gameId: `g${i}`, pod: `pod${i % 50}`, X, winnerIdx });
    }
    const w = fit(data, 1e-4);
    for (let k = 0; k < truth.length; k++) {
      expect(Math.abs(w[k] - truth[k])).toBeLessThan(0.3);
    }
  });
});
