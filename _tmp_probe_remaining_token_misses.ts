import fs from 'node:fs';
import path from 'node:path';

import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser';

type QueueItem = {
  queueIndex: number;
  name: string;
  oracleId: string;
  clause: string;
};

const queuePath = path.resolve('_tmp_oracle_next_601_800.json');
const cardsPath = path.resolve('oracle-cards.json');
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8')).queue as QueueItem[];
const cards = JSON.parse(fs.readFileSync(cardsPath, 'utf8')) as any[];
const cardsByOracleId = new Map(cards.map(card => [String(card.oracle_id || card.id || ''), card]));

function collectStepArray(steps: readonly any[] | undefined, out: any[] = []): any[] {
  if (!Array.isArray(steps)) return out;
  for (const step of steps) {
    if (!step || typeof step !== 'object' || typeof step.kind !== 'string') continue;
    out.push(step);
    collectStepArray(step.steps, out);
    if (Array.isArray(step.modes)) {
      for (const mode of step.modes) collectStepArray(mode?.steps, out);
    }
    if (Array.isArray(step.results)) {
      for (const result of step.results) collectStepArray(result?.steps, out);
    }
  }
  return out;
}

function collectSteps(ir: any): any[] {
  const out: any[] = [];
  for (const ability of Array.isArray(ir?.abilities) ? ir.abilities : []) {
    collectStepArray(ability?.steps, out);
  }
  return out;
}

function summarizeSteps(steps: readonly any[]): string[] {
  return steps.map(step => {
    const raw = String(step.raw || step.unknownText || '').replace(/\s+/g, ' ').slice(0, 180);
    return raw ? `${step.kind}: ${raw}` : step.kind;
  });
}

const misses = [] as any[];

for (const item of queue) {
  const card = cardsByOracleId.get(String(item.oracleId));
  const text = String(card?.oracle_text || item.clause || '');
  const ir = parseOracleTextToIR(text, item.name);
  const steps = collectSteps(ir);
  if (!steps.some(step => step.kind === 'create_token')) {
    misses.push({
      queueIndex: item.queueIndex,
      name: item.name,
      clause: item.clause,
      oracleText: text.replace(/\n/g, ' / '),
      stepSummary: summarizeSteps(steps),
    });
  }
}

console.log(JSON.stringify({
  queueSize: queue.length,
  missCount: misses.length,
  misses,
}, null, 2));