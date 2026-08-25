import fs from "node:fs";

// Chat H scratch: lift a contiguous chain of selector guards out of applyMoveZoneStep into
// sibling modules. Each guard body moves verbatim; the locals it reads are re-bound by
// destructuring a MoveZoneGuardArgs bundle, so no reference inside the body changes.
// Usage: node tools/_tmp-chatH-extract-guard-chain.mjs <from> <to> <partCount>

const FILE = "rules-engine/src/oracleIRExecutorMoveZoneStepHandlers.ts";
const FROM = Number(process.argv[2]);
const TO = Number(process.argv[3]);
const PARTS = Number(process.argv[4]);

const raw = fs.readFileSync(FILE, "utf8");
const EOL = raw.includes("\r\n") ? "\r\n" : "\n";
const lines = raw.split(/\r?\n/);
const abort = (m) => {
  console.error(`ABORT: ${m}`);
  process.exit(1);
};

// --- selector bundle membership -----------------------------------------------------
const bundleNames = (file) => {
  const src = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const at = src.findIndex((l) => l === "  return {");
  const out = [];
  for (let i = at + 1; i < src.length && src[i] !== "  };"; i++) out.push(src[i].trim().replace(/,$/, ""));
  return out;
};
const ZONE = bundleNames("rules-engine/src/oracleIRExecutorMoveZoneWhatParsersZoneQueries.ts");
const REF = bundleNames("rules-engine/src/oracleIRExecutorMoveZoneWhatParsersReferenceQueries.ts");
const PLAIN = [
  "nextState",
  "log",
  "controllerId",
  "effectiveWithCounters",
  "battlefieldEntryOverrides",
  "finalizeAppliedResult",
  "attachmentResolution",
  "sourcePermanentPower",
  "boundTargetObjectId",
  "linkedSourceId",
  "parsedOneOfThemSplit",
  "parsedOnePileSplit",
  "contextualBoundCardZone",
  "sourceCardZone",
  "whatText",
  "contextualBoundCardIds",
  "topCardLibraryOwnerId",
  "bottomCardLibraryOwnerId",
  "parsedDiceBracketIt",
];
const FN_PARAMS = ["state", "step", "ctx", "runtime"];

// --- imports of the parent ----------------------------------------------------------
const imports = [];
let importEnd = 0;
for (let i = 0; i < lines.length; i++) {
  if (!/^import\s/.test(lines[i])) continue;
  let j = i;
  let text = lines[i];
  while (!/from\s+['"][^'"]+['"];?\s*$/.test(text) && j < lines.length - 1) {
    j += 1;
    text += "\n" + lines[j];
  }
  const mod = /from\s+['"]([^'"]+)['"]/.exec(text);
  const brace = /\{([\s\S]*)\}/.exec(text);
  if (mod && brace) {
    imports.push({
      module: mod[1],
      typeOnly: /^import\s+type\s/.test(text),
      names: brace[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => ({ raw: s, name: s.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim() })),
    });
  }
  importEnd = j + 1;
  i = j;
}

// --- choose part boundaries at depth-1 guard starts ---------------------------------
const starts = [];
for (let i = FROM - 1; i < TO; i++) {
  if (!/^  \S/.test(lines[i])) continue;
  if (/^  (?:[)\]}]|\/\/)/.test(lines[i])) continue;
  starts.push(i + 1);
}
const cum = new Map();
let total = 0;
for (let i = FROM - 1; i < TO; i++) {
  total += Buffer.byteLength(lines[i], "utf8") + EOL.length;
  cum.set(i + 1, total);
}
const picks = [FROM];
for (let k = 1; k < PARTS; k++) {
  const want = (total / PARTS) * k;
  let best = starts[0];
  for (const s of starts) if (Math.abs(cum.get(s) - want) < Math.abs(cum.get(best) - want)) best = s;
  if (!picks.includes(best)) picks.push(best);
}
picks.push(TO + 1);

// --- build each part ----------------------------------------------------------------
const parts = [];
for (let k = 0; k < picks.length - 1; k++) {
  const from = picks[k];
  const to = picks[k + 1] - 1;
  const body = lines.slice(from - 1, to);
  const text = body.join("\n");
  if (!/^  if\s*\(/.test(body[0])) abort(`part ${k + 1} does not start with a guard: ${body[0]}`);
  const used = (n) => new RegExp(`\\b${n}\\b`).test(text);
  parts.push({
    from,
    to,
    body,
    text,
    zone: ZONE.filter(used),
    ref: REF.filter(used),
    plain: PLAIN.filter(used),
    fnParams: FN_PARAMS.filter(used),
  });
}

// Nothing declared inside a part may be read by a later part or by the rest of the function.
const afterChain = lines.slice(TO).join("\n");
for (const p of parts) {
  for (const line of p.body) {
    const m = /^  (?:const|let)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (!m) continue;
    if (new RegExp(`\\b${m[1]}\\b`).test(afterChain)) abort(`declaration ${m[1]} escapes the chain`);
    for (const q of parts) {
      if (q.from <= p.to) continue;
      if (new RegExp(`\\b${m[1]}\\b`).test(q.text)) abort(`declaration ${m[1]} crosses a part boundary`);
    }
  }
}

// --- module naming ------------------------------------------------------------------
// Named after the first selector each chain tests, so the TOC grep points at real content.
const slug = (name) => name.replace(/^parsed/, "");
const chainName = (p) => {
  const m = /\b(parsed[A-Za-z0-9_]+)/.exec(p.body[0]);
  return m ? slug(m[1]) : "Chain";
};

const usedNames = new Set();
for (const p of parts) {
  let base = chainName(p);
  while (usedNames.has(base)) base += "More";
  usedNames.add(base);
  p.fn = `tryApplyMoveZoneGuardsFrom${base}`;
  p.moduleBase = `oracleIRExecutorMoveZoneGuards${base}`;
  p.file = `rules-engine/src/${p.moduleBase}.ts`;
}

// --- imports for each part ----------------------------------------------------------
const chainText = parts.map((p) => p.text).join("\n");
const parentRest = lines.slice(importEnd, FROM - 1).concat(lines.slice(TO)).join("\n");
const dropped = [];
for (const imp of imports) {
  for (const n of imp.names) {
    const re = new RegExp(`\\b${n.name}\\b`);
    if (re.test(chainText) && !re.test(parentRest)) dropped.push(n);
  }
}
const dropLines = new Set();
for (const d of dropped) {
  const matches = [];
  for (let i = 0; i < importEnd; i++) if (lines[i].trim().replace(/,$/, "") === d.raw) matches.push(i);
  if (matches.length !== 1) abort(`import symbol ${d.name} has ${matches.length} dedicated lines`);
  dropLines.add(matches[0]);
}

const importBlockFor = (text) => {
  const byModule = new Map();
  for (const imp of imports) {
    for (const n of imp.names) {
      if (!new RegExp(`\\b${n.name}\\b`).test(text)) continue;
      const key = `${imp.typeOnly ? "type " : ""}${imp.module}`;
      if (!byModule.has(key)) byModule.set(key, { module: imp.module, typeOnly: imp.typeOnly, names: [] });
      byModule.get(key).names.push(n.raw);
    }
  }
  const out = [];
  for (const { module, typeOnly, names } of byModule.values()) {
    const kw = typeOnly ? "import type" : "import";
    if (names.length <= 3) out.push(`${kw} { ${names.join(", ")} } from '${module}';`);
    else out.push(`${kw} {`, ...names.map((n) => `  ${n},`), `} from '${module}';`);
  }
  return out;
};

// --- emit -----------------------------------------------------------------------------
for (const p of parts) {
  const destructure = [];
  if (p.fnParams.length || p.plain.length) {
    destructure.push(`  const { ${[...p.fnParams, ...p.plain].join(", ")} } = args;`);
  }
  if (p.zone.length) destructure.push(`  const {`, ...p.zone.map((n) => `    ${n},`), `  } = args.zoneQueries;`);
  if (p.ref.length) destructure.push(`  const {`, ...p.ref.map((n) => `    ${n},`), `  } = args.referenceQueries;`);

  const out = [
    `// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts`,
    `// Cluster moved: the applyMoveZoneStep selector guards starting at ${p.body[0].trim().slice(0, 90)}`,
    `// Public entry symbol: ${p.fn}.`,
    ``,
    `import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';`,
    `import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';`,
    ...importBlockFor(p.text),
    ``,
    `export function ${p.fn}(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {`,
    ...destructure,
    ``,
    ...p.body,
    ``,
    `  return undefined;`,
    `}`,
    ``,
  ].join(EOL);
  fs.writeFileSync(p.file, out);
  console.log(`wrote ${p.file} (${(Buffer.byteLength(out, "utf8") / 1024).toFixed(1)} KB)`);
}

// --- rewrite the parent ---------------------------------------------------------------
// Each extracted chain gets its own bundle local so repeated runs cannot collide.
const suffix = parts[0].fn.replace("tryApplyMoveZoneGuardsFrom", "");
const argsVar = `guardArgs${suffix}`;
const callSite = [
  `  const ${argsVar}: MoveZoneGuardArgs = {`,
  `    state,`,
  `    step,`,
  `    ctx,`,
  `    runtime,`,
  `    nextState,`,
  `    log,`,
  `    controllerId,`,
  `    effectiveWithCounters,`,
  `    battlefieldEntryOverrides,`,
  `    finalizeAppliedResult,`,
  `    attachmentResolution,`,
  `    sourcePermanentPower,`,
  `    boundTargetObjectId,`,
  `    linkedSourceId,`,
  `    parsedOneOfThemSplit,`,
  `    parsedOnePileSplit,`,
  `    contextualBoundCardZone,`,
  `    sourceCardZone,`,
  `    whatText,`,
  `    contextualBoundCardIds,`,
  `    topCardLibraryOwnerId,`,
  `    bottomCardLibraryOwnerId,`,
  `    parsedDiceBracketIt,`,
  `    zoneQueries,`,
  `    referenceQueries,`,
  `  };`,
  ...parts.flatMap((p, i) => [
    `  const guardResult${suffix}${i + 1} = ${p.fn}(${argsVar});`,
    `  if (guardResult${suffix}${i + 1}) return guardResult${suffix}${i + 1};`,
  ]),
];

const out = [];
for (let i = 0; i < lines.length; i++) {
  if (dropLines.has(i)) continue;
  if (i === FROM - 1) {
    out.push(...callSite);
    i = TO - 1;
    continue;
  }
  out.push(lines[i]);
}

const anchor = out.findIndex((l) => l.startsWith("import { buildMoveZoneBattlefieldEntryOverrides }"));
const newImports = parts.map((p) => `import { ${p.fn} } from './${p.moduleBase}';`);
if (!out.some((l) => l.startsWith("import type { MoveZoneGuardArgs }"))) {
  newImports.unshift(`import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';`);
}
out.splice(anchor + 1, 0, ...newImports);

fs.writeFileSync(FILE, out.join(EOL));
console.log(
  `parent ${(Buffer.byteLength(raw, "utf8") / 1024).toFixed(1)} KB -> ${(fs.statSync(FILE).size / 1024).toFixed(1)} KB, dropped ${dropped.length} imports`
);
