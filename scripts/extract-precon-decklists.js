#!/usr/bin/env node
/**
 * Extract Precon Decklist Info from CommanderPrecons JSON files
 * 
 * This script processes JSON files from the Westly/CommanderPrecons repository
 * and extracts the essential decklist information, saving each deck to a separate file.
 * 
 * Usage:
 *   node extract-precon-decklists.js <input-directory> [output-directory]
 * 
 * Example:
 *   node extract-precon-decklists.js ./precon_json ./extracted_decklists
 * 
 * The script will:
 *   1. Read all JSON files from the input directory
 *   2. Extract deck name, commanders, color identity, and card list
 *   3. Save each deck to a separate JSON file in the output directory
 *   4. Also generate a summary file with all decks metadata
 */

const fs = require('fs');
const path = require('path');

/**
 * Extract essential info from a CommanderPrecons JSON file
 */
function extractDeckInfo(jsonData) {
  const deckInfo = {
    name: jsonData.name || 'Unknown Deck',
    format: jsonData.format || 'commander',
    commanders: [],
    colorIdentity: [],
    mainboard: [],
    sideboard: [],
    maybeboard: [],
    cardCount: 0
  };

  // Extract deck name (clean up the format)
  if (deckInfo.name.includes('(')) {
    // Format: "Deck Name (Set Name Commander Precon Decklist)"
    const match = deckInfo.name.match(/^(.+?)\s*\(/);
    if (match) {
      deckInfo.cleanName = match[1].trim();
    }
  }

  // Extract set name from deck name
  const setMatch = deckInfo.name.match(/\((.+?)\s+Commander\s+Precon/i);
  if (setMatch) {
    deckInfo.setName = setMatch[1].trim();
  }

  // Extract commanders from 'boards.commanders' if it exists
  if (jsonData.boards && jsonData.boards.commanders && jsonData.boards.commanders.cards) {
    const commanderCards = jsonData.boards.commanders.cards;
    for (const [cardName, cardData] of Object.entries(commanderCards)) {
      deckInfo.commanders.push({
        name: cardName,
        quantity: cardData.quantity || 1,
        colorIdentity: cardData.card?.color_identity || []
      });
      
      // Merge color identity
      if (cardData.card?.color_identity) {
        for (const color of cardData.card.color_identity) {
          if (!deckInfo.colorIdentity.includes(color)) {
            deckInfo.colorIdentity.push(color);
          }
        }
      }
    }
  }

  // Extract mainboard cards
  if (jsonData.boards && jsonData.boards.mainboard && jsonData.boards.mainboard.cards) {
    const mainboardCards = jsonData.boards.mainboard.cards;
    for (const [cardName, cardData] of Object.entries(mainboardCards)) {
      deckInfo.mainboard.push({
        name: cardName,
        quantity: cardData.quantity || 1,
        type: cardData.card?.type_line || '',
        manaCost: cardData.card?.mana_cost || '',
        cmc: cardData.card?.cmc || 0
      });
    }
  }

  // Alternative: Check for 'mainboard' array directly (some formats)
  if (jsonData.mainboard && Array.isArray(jsonData.mainboard)) {
    for (const cardData of jsonData.mainboard) {
      const cardName = cardData.card?.name || cardData.name || 'Unknown';
      deckInfo.mainboard.push({
        name: cardName,
        quantity: cardData.quantity || 1,
        type: cardData.card?.type_line || '',
        manaCost: cardData.card?.mana_cost || '',
        cmc: cardData.card?.cmc || 0
      });
    }
  }

  // Extract sideboard cards if present
  if (jsonData.boards && jsonData.boards.sideboard && jsonData.boards.sideboard.cards) {
    const sideboardCards = jsonData.boards.sideboard.cards;
    for (const [cardName, cardData] of Object.entries(sideboardCards)) {
      deckInfo.sideboard.push({
        name: cardName,
        quantity: cardData.quantity || 1
      });
    }
  }

  // Sort color identity in WUBRG order
  const colorOrder = ['W', 'U', 'B', 'R', 'G'];
  deckInfo.colorIdentity.sort((a, b) => colorOrder.indexOf(a) - colorOrder.indexOf(b));
  deckInfo.colorIdentityString = deckInfo.colorIdentity.join('') || 'C';

  // Calculate total card count
  deckInfo.cardCount = deckInfo.mainboard.reduce((sum, card) => sum + card.quantity, 0) +
                       deckInfo.commanders.reduce((sum, cmd) => sum + cmd.quantity, 0);

  return deckInfo;
}

/**
 * Generate a safe filename from deck name
 */
function safeFilename(name) {
  return name
    .replace(/[^a-zA-Z0-9\s\-_]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase();
}

/**
 * Main processing function
 */
function processPreconFiles(inputDir, outputDir) {
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Get all JSON files in input directory
  const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.json'));
  
  console.log(`Found ${files.length} JSON files to process`);
  
  const allDecks = [];
  const decksBySet = {};
  let processed = 0;
  let errors = 0;

  for (const file of files) {
    const filePath = path.join(inputDir, file);
    
    try {
      const jsonContent = fs.readFileSync(filePath, 'utf8');
      const jsonData = JSON.parse(jsonContent);
      
      const deckInfo = extractDeckInfo(jsonData);
      
      // Save individual deck file
      const outputFilename = safeFilename(deckInfo.cleanName || deckInfo.name) + '.json';
      const outputPath = path.join(outputDir, outputFilename);
      
      fs.writeFileSync(outputPath, JSON.stringify(deckInfo, null, 2));
      
      // Add to summary
      allDecks.push({
        name: deckInfo.cleanName || deckInfo.name,
        setName: deckInfo.setName || 'Unknown Set',
        commanders: deckInfo.commanders.map(c => c.name),
        colorIdentity: deckInfo.colorIdentityString,
        cardCount: deckInfo.cardCount,
        filename: outputFilename
      });

      // Group by set
      const setName = deckInfo.setName || 'Unknown Set';
      if (!decksBySet[setName]) {
        decksBySet[setName] = [];
      }
      decksBySet[setName].push({
        name: deckInfo.cleanName || deckInfo.name,
        commanders: deckInfo.commanders.map(c => c.name),
        colorIdentity: deckInfo.colorIdentityString
      });

      processed++;
      console.log(`✓ Processed: ${deckInfo.cleanName || deckInfo.name}`);
      
    } catch (err) {
      console.error(`✗ Error processing ${file}: ${err.message}`);
      errors++;
    }
  }

  // Save summary file
  const summaryPath = path.join(outputDir, '_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    totalDecks: allDecks.length,
    processedAt: new Date().toISOString(),
    decks: allDecks
  }, null, 2));

  // Save decks-by-set file
  const bySetPath = path.join(outputDir, '_decks_by_set.json');
  fs.writeFileSync(bySetPath, JSON.stringify(decksBySet, null, 2));

  // Generate TypeScript-compatible precons data
  const tsDataPath = path.join(outputDir, '_precons_data.ts');
  let tsContent = `// Auto-generated precon data from CommanderPrecons repository
// Generated: ${new Date().toISOString()}

export interface ExtractedPrecon {
  name: string;
  commanders: string[];
  colorIdentity: string;
}

export interface ExtractedPreconSet {
  [setName: string]: ExtractedPrecon[];
}

export const EXTRACTED_PRECONS: ExtractedPreconSet = ${JSON.stringify(decksBySet, null, 2)};
`;
  fs.writeFileSync(tsDataPath, tsContent);

  console.log('\n========================================');
  console.log(`Processing complete!`);
  console.log(`  Processed: ${processed} decks`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Output directory: ${outputDir}`);
  console.log(`  Summary file: ${summaryPath}`);
  console.log(`  By-set file: ${bySetPath}`);
  console.log(`  TypeScript data: ${tsDataPath}`);
  console.log('========================================\n');
}

// Command-line interface
const args = process.argv.slice(2);

if (args.length < 1) {
  console.log(`
Extract Precon Decklist Info from CommanderPrecons JSON files

Usage:
  node extract-precon-decklists.js <input-directory> [output-directory]

Example:
  node extract-precon-decklists.js ./precon_json ./extracted_decklists

Arguments:
  input-directory   Path to folder containing CommanderPrecons JSON files
  output-directory  Path to save extracted decklists (default: ./extracted_decklists)
`);
  process.exit(1);
}

const inputDir = args[0];
const outputDir = args[1] || './extracted_decklists';

if (!fs.existsSync(inputDir)) {
  console.error(`Error: Input directory does not exist: ${inputDir}`);
  process.exit(1);
}

processPreconFiles(inputDir, outputDir);
