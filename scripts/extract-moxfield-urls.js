#!/usr/bin/env node
/**
 * Extract Moxfield URLs from CommanderPrecons CSV files
 * 
 * This script processes CSV files from the Westly/CommanderPrecons repository
 * and extracts the Moxfield decklist URLs for easy import.
 * 
 * Usage:
 *   node extract-moxfield-urls.js <input-directory> [output-file]
 * 
 * Example:
 *   node extract-moxfield-urls.js ./precon_csv ./moxfield_urls.json
 * 
 * The script will:
 *   1. Read all CSV files from the input directory
 *   2. Extract deck name and Moxfield URL from the first data row
 *   3. Save all URLs to a JSON file organized by set
 */

const fs = require('fs');
const path = require('path');

/**
 * Extract deck info from just the first 2 lines of a CommanderPrecons CSV file
 * The CSV structure has the Moxfield URL in the 7th column (index 6)
 * and the deck name in the 2nd column (index 1)
 * 
 * Only reads first 2 lines for efficiency - no need to load entire file
 */
function extractFromCsvLines(headerLine, dataLine, filename) {
  if (!dataLine || !dataLine.trim()) {
    return null;
  }

  const dataRow = dataLine;
  
  // Parse CSV - handle quoted fields
  const fields = parseCSVLine(dataRow);
  
  // Extract deck name from filename or column 2
  let deckName = fields[1] || filename.replace('.csv', '');
  
  // Clean up deck name - extract just the deck name part
  const nameMatch = deckName.match(/^(.+?)\s*\(/);
  const cleanName = nameMatch ? nameMatch[1].trim() : deckName;
  
  // Extract set name - handles formats like:
  // "Deck Name (Set Name Commander Precon Decklist)"
  // "Deck Name (Set Name Commander 2021 Precon Decklist)"
  const setMatch = deckName.match(/\((.+?)(?:\s+Commander|\s+Precon)/i);
  const setName = setMatch ? setMatch[1].trim() : 'Unknown Set';
  
  // Extract Moxfield URL (column 7, index 6)
  const moxfieldUrl = fields[6] || '';
  
  // Extract Moxfield deck ID
  const idMatch = moxfieldUrl.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/);
  const moxfieldId = idMatch ? idMatch[1] : '';

  return {
    name: cleanName,
    fullName: deckName,
    setName: setName,
    moxfieldUrl: moxfieldUrl,
    moxfieldId: moxfieldId
  };
}

/**
 * Parse a CSV line handling quoted fields
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  // Don't forget the last field
  result.push(current.trim());
  
  return result;
}

/**
 * Read only the first N lines of a file efficiently
 */
function readFirstLines(filePath, numLines) {
  const fd = fs.openSync(filePath, 'r');
  const bufferSize = 4096; // Read in chunks
  const buffer = Buffer.alloc(bufferSize);
  let content = '';
  let lines = [];
  
  try {
    while (lines.length < numLines) {
      const bytesRead = fs.readSync(fd, buffer, 0, bufferSize, null);
      if (bytesRead === 0) break;
      
      content += buffer.toString('utf8', 0, bytesRead);
      lines = content.split('\n');
    }
  } finally {
    fs.closeSync(fd);
  }
  
  return lines.slice(0, numLines);
}

/**
 * Main processing function
 */
function processCSVFiles(inputDir, outputFile) {
  // Get all CSV files in input directory
  const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.csv'));
  
  console.log(`Found ${files.length} CSV files to process`);
  console.log(`(Reading only first 2 lines from each file for efficiency)\n`);
  
  const allDecks = [];
  const decksBySet = {};
  let processed = 0;
  let errors = 0;

  for (const file of files) {
    const filePath = path.join(inputDir, file);
    
    try {
      // Only read first 2 lines - header and first data row
      const lines = readFirstLines(filePath, 2);
      
      if (lines.length < 2) {
        console.log(`⚠ ${file}: Not enough lines`);
        continue;
      }
      
      const deckInfo = extractFromCsvLines(lines[0], lines[1], file);
      
      if (deckInfo && deckInfo.moxfieldUrl) {
        allDecks.push(deckInfo);
        
        // Group by set
        if (!decksBySet[deckInfo.setName]) {
          decksBySet[deckInfo.setName] = [];
        }
        decksBySet[deckInfo.setName].push({
          name: deckInfo.name,
          moxfieldUrl: deckInfo.moxfieldUrl,
          moxfieldId: deckInfo.moxfieldId
        });
        
        processed++;
        console.log(`✓ ${deckInfo.name} (${deckInfo.setName}): ${deckInfo.moxfieldUrl}`);
      } else {
        console.log(`⚠ ${file}: No Moxfield URL found`);
      }
      
    } catch (err) {
      console.error(`✗ Error processing ${file}: ${err.message}`);
      errors++;
    }
  }

  // Sort sets alphabetically and by year (newer first)
  const sortedSets = Object.keys(decksBySet).sort();

  // Create output
  const output = {
    extractedAt: new Date().toISOString(),
    totalDecks: allDecks.length,
    decksBySet: decksBySet,
    allDecks: allDecks.sort((a, b) => a.setName.localeCompare(b.setName) || a.name.localeCompare(b.name))
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

  // Also generate a simple URL list for easy copy/paste
  const urlListFile = outputFile.replace('.json', '_urls.txt');
  const urlList = allDecks
    .sort((a, b) => a.setName.localeCompare(b.setName) || a.name.localeCompare(b.name))
    .map(d => `${d.name} (${d.setName}): ${d.moxfieldUrl}`)
    .join('\n');
  fs.writeFileSync(urlListFile, urlList);

  // Generate TypeScript data for precons.ts
  const tsFile = outputFile.replace('.json', '.ts');
  let tsContent = `// Auto-generated Moxfield URLs from CommanderPrecons repository
// Generated: ${new Date().toISOString()}

export interface MoxfieldPrecon {
  name: string;
  moxfieldUrl: string;
  moxfieldId: string;
}

export interface MoxfieldPreconsBySet {
  [setName: string]: MoxfieldPrecon[];
}

export const MOXFIELD_PRECONS: MoxfieldPreconsBySet = ${JSON.stringify(decksBySet, null, 2)};

// Quick lookup by deck name
export const MOXFIELD_URLS: Record<string, string> = {
${allDecks.map(d => `  "${d.name}": "${d.moxfieldUrl}"`).join(',\n')}
};
`;
  fs.writeFileSync(tsFile, tsContent);

  console.log('\n========================================');
  console.log(`Processing complete!`);
  console.log(`  Processed: ${processed} decks with Moxfield URLs`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Output files:`);
  console.log(`    - ${outputFile} (JSON)`);
  console.log(`    - ${urlListFile} (plain text)`);
  console.log(`    - ${tsFile} (TypeScript)`);
  console.log('========================================\n');
}

// Command-line interface
const args = process.argv.slice(2);

if (args.length < 1) {
  console.log(`
Extract Moxfield URLs from CommanderPrecons CSV files

Usage:
  node extract-moxfield-urls.js <input-directory> [output-file]

Example:
  node extract-moxfield-urls.js ./precon_csv ./moxfield_urls.json

Arguments:
  input-directory   Path to folder containing CommanderPrecons CSV files
  output-file       Path to save extracted URLs (default: ./moxfield_urls.json)

This is simpler than processing the large JSON files - just extracts
the Moxfield deck URLs which can then be used to import full decklists.
`);
  process.exit(1);
}

const inputDir = args[0];
const outputFile = args[1] || './moxfield_urls.json';

if (!fs.existsSync(inputDir)) {
  console.error(`Error: Input directory does not exist: ${inputDir}`);
  process.exit(1);
}

processCSVFiles(inputDir, outputFile);
