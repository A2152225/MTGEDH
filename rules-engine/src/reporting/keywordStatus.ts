/**
 * Keyword implementation status reporting utilities.
 *
 * Generates normalized status rows for keyword abilities (Rule 702),
 * keyword actions (Rule 701), and high-level gameplay automation checks.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  runFullAutomationVerification,
  AutomationStatus,
} from '../GameAutomationVerifier';

export type ImplementationStatus =
  | 'Fully Implemented'
  | 'Partially Implemented'
  | 'Not Yet Implemented';

export interface KeywordStatusRow {
  readonly name: string;
  readonly category: 'Keyword Ability' | 'Keyword Action';
  readonly status: ImplementationStatus;
  readonly source: string;
  readonly notes?: string;
}

export interface GameplayStatusRow {
  readonly feature: string;
  readonly category: string;
  readonly status: ImplementationStatus;
  readonly details?: string;
  readonly rulesReference?: string;
}

export interface BuildOptions {
  readonly repoRoot?: string;
  readonly overrides?: Readonly<Record<string, ImplementationStatus>>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const STATUS_EMOJI: Record<ImplementationStatus, string> = {
  'Fully Implemented': '✅ Fully Implemented',
  'Partially Implemented': '🔶 Partially Implemented',
  'Not Yet Implemented': '❌ Not Yet Implemented',
};

function toDisplayName(fileName: string): string {
  const base = fileName.replace(/\.ts$/, '');
  const spaced = base
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ');

  return spaced
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getKeywordPaths(repoRoot: string) {
  const abilitiesDir = path.join(repoRoot, 'rules-engine', 'src', 'keywordAbilities');
  const actionsDir = path.join(repoRoot, 'rules-engine', 'src', 'keywordActions');
  return { abilitiesDir, actionsDir };
}

function getStatusOverride(
  baseName: string,
  overrides?: Readonly<Record<string, ImplementationStatus>>,
): ImplementationStatus | undefined {
  if (!overrides) return undefined;
  return overrides[baseName] ?? overrides[toDisplayName(baseName)];
}

function scanKeywordDirectory(
  dir: string,
  category: KeywordStatusRow['category'],
  overrides?: Readonly<Record<string, ImplementationStatus>>,
): KeywordStatusRow[] {
  const entries = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.ts') && file !== 'index.ts');

  return entries.map((file) => {
    const name = file.replace(/\.ts$/, '');
    const displayName = toDisplayName(name);
    const status =
      getStatusOverride(name, overrides) ??
      getStatusOverride(displayName, overrides) ??
      ('Fully Implemented' as ImplementationStatus);

    return {
      name: displayName,
      category,
      status,
      source: path.join(dir, file),
      notes: status !== 'Fully Implemented' ? 'Status overridden' : '',
    };
  });
}

export function collectKeywordStatuses(options: BuildOptions = {}): KeywordStatusRow[] {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const { abilitiesDir, actionsDir } = getKeywordPaths(repoRoot);

  const rows = [
    ...scanKeywordDirectory(abilitiesDir, 'Keyword Ability', options.overrides),
    ...scanKeywordDirectory(actionsDir, 'Keyword Action', options.overrides),
  ];

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function mapAutomationToImplementation(
  status: AutomationStatus,
): ImplementationStatus {
  switch (status) {
    case AutomationStatus.IMPLEMENTED:
      return 'Fully Implemented';
    case AutomationStatus.PARTIAL:
    case AutomationStatus.MANUAL_REQUIRED:
      return 'Partially Implemented';
    case AutomationStatus.PENDING:
    case AutomationStatus.NEEDS_FIX:
    default:
      return 'Not Yet Implemented';
  }
}

export function collectGameplayStatuses(): GameplayStatusRow[] {
  const report = runFullAutomationVerification();

  return report.checks
    .map((check) => ({
      feature: check.feature,
      category: check.category,
      status: mapAutomationToImplementation(check.status),
      details: check.description,
      rulesReference: check.rulesReference,
    }))
    .sort((a, b) => {
      if (a.category === b.category) {
        return a.feature.localeCompare(b.feature);
      }
      return a.category.localeCompare(b.category);
    });
}

function formatKeywordTable(
  rows: KeywordStatusRow[],
  repoRoot: string,
): string {
  const header = '| Keyword | Category | Status | Source |\n|---|---|---|---|';
  const body = rows
    .map((row) => {
      const relSource = path.relative(repoRoot, row.source);
      const statusText = STATUS_EMOJI[row.status] ?? row.status;
      const notes = row.notes ? ` (${row.notes.trim()})` : '';
      return `| ${row.name} | ${row.category} | ${statusText}${notes} | \`${relSource}\` |`;
    })
    .join('\n');

  return [header, body].join('\n');
}

function formatGameplayTable(rows: GameplayStatusRow[]): string {
  const header = '| Feature | Category | Status | Details |\n|---|---|---|---|';
  const body = rows
    .map((row) => {
      const statusText = STATUS_EMOJI[row.status] ?? row.status;
      const details = row.rulesReference
        ? `${row.details ?? ''} (${row.rulesReference})`
        : row.details ?? '';
      return `| ${row.feature} | ${row.category} | ${statusText} | ${details} |`;
    })
    .join('\n');

  return [header, body].join('\n');
}

function summarizeStatuses(rows: { status: ImplementationStatus }[]) {
  return rows.reduce(
    (acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    },
    {
      'Fully Implemented': 0,
      'Partially Implemented': 0,
      'Not Yet Implemented': 0,
    } as Record<ImplementationStatus, number>,
  );
}

export function buildKeywordStatusMarkdown(options: BuildOptions = {}): string {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;

  const keywordRows = collectKeywordStatuses(options);
  const gameplayRows = collectGameplayStatuses();

  const keywordSummary = summarizeStatuses(keywordRows);
  const gameplaySummary = summarizeStatuses(gameplayRows);

  const totalKeywords = keywordRows.length;
  const abilityCount = keywordRows.filter((row) => row.category === 'Keyword Ability').length;
  const actionCount = totalKeywords - abilityCount;

  return [
    '# Keyword Implementation Status',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Keyword Abilities & Actions',
    '',
    `- Total keywords: ${totalKeywords} (Abilities: ${abilityCount}, Actions: ${actionCount})`,
    `- Status counts: ✅ ${keywordSummary['Fully Implemented']} | 🔶 ${keywordSummary['Partially Implemented']} | ❌ ${keywordSummary['Not Yet Implemented']}`,
    '',
    formatKeywordTable(keywordRows, repoRoot),
    '',
    '## Gameplay Automation Status (Non-keyword rules)',
    '',
    `- Status counts: ✅ ${gameplaySummary['Fully Implemented']} | 🔶 ${gameplaySummary['Partially Implemented']} | ❌ ${gameplaySummary['Not Yet Implemented']}`,
    '',
    formatGameplayTable(gameplayRows),
    '',
    '> Notes:',
    '> - Keyword statuses are inferred automatically from module presence; override map can mark partially implemented items if needed.',
    '> - Gameplay statuses are sourced from the automation verifier in `GameAutomationVerifier.ts`.',
    '',
  ].join('\n');
}
