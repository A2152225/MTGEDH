#!/usr/bin/env tsx
/**
 * Generates a Markdown table covering all keyword abilities/actions
 * and high-level gameplay automation statuses.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildKeywordStatusMarkdown } from '../src/reporting/keywordStatus';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const outputPath = path.join(repoRoot, 'docs', 'keyword-implementation-status.md');

const markdown = buildKeywordStatusMarkdown({ repoRoot });

fs.writeFileSync(outputPath, markdown);
console.log(`Keyword implementation status written to ${outputPath}`);
