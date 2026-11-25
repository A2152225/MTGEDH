#!/usr/bin/env node
/**
 * Tally self-play jsonl rows for a given out/ prefix (e.g. gate-p2-regate-s7).
 * Usage: node scripts/_tmp-tally-selfplay-prefix.mjs <prefix> [from] [toExclusive]
 */
import fs from 'fs'
import path from 'path'

const prefix = process.argv[2]
if (!prefix) {
  console.error('Usage: node scripts/_tmp-tally-selfplay-prefix.mjs <prefix> [from] [toExclusive]')
  process.exit(1)
}
const from = process.argv[3] != null ? Number(process.argv[3]) : null
const to = process.argv[4] != null ? Number(process.argv[4]) : null
const dir = 'out'

let v2 = 0
let v1 = 0
let tl = 0
let stall = 0
let err = 0
let n = 0
const stallRows = []

const files = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith(prefix) && f.endsWith('.jsonl'))
  .sort((a, b) => {
    const na = Number((a.match(/(\d+)\.jsonl$/) || [])[1])
    const nb = Number((b.match(/(\d+)\.jsonl$/) || [])[1])
    return na - nb
  })

for (const f of files) {
  const shard = Number((f.match(/(\d+)\.jsonl$/) || [])[1])
  if (Number.isFinite(from) && shard < from) continue
  if (Number.isFinite(to) && shard >= to) continue
  const p = path.join(dir, f)
  if (fs.statSync(p).size < 20) continue
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/).filter(Boolean)
  if (!lines.length) continue
  const row = JSON.parse(lines[lines.length - 1])
  n++
  if (row.endReason === 'turn-limit') {
    tl++
    continue
  }
  if (row.endReason === 'stall') {
    stall++
    stallRows.push({ shard, stallReason: row.stallReason, turns: row.turns })
    continue
  }
  if (row.endReason === 'error') {
    err++
    continue
  }
  if (row.endReason === 'win') {
    const brain = row.seatBrains?.[row.winner]
    if (brain === 'v2') v2++
    else v1++
  }
}

const decisive = v2 + v1
const out = {
  prefix,
  n,
  v2,
  v1,
  tl,
  stall,
  err,
  decisive,
  rate: decisive ? `${((v2 / decisive) * 100).toFixed(1)}%` : 'n/a',
  stallPct: n ? `${((stall / n) * 100).toFixed(1)}%` : 'n/a',
}
console.log(JSON.stringify(out, null, 2))
if (stallRows.length) {
  console.log('stalls:', JSON.stringify(stallRows, null, 2))
}
