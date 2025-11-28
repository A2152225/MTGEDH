/**
 * House Rule Suggestions Storage
 * 
 * Stores custom house rule suggestions submitted by players for review
 * and potential future implementation.
 */

import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const SUGGESTIONS_FILE = path.join(DATA_DIR, 'house-rule-suggestions.json');

export interface HouseRuleSuggestion {
  id: string;
  suggestion: string;
  submittedAt: string;
  status: 'pending' | 'reviewed' | 'implemented' | 'rejected';
  reviewNotes?: string;
}

/**
 * Load all house rule suggestions from file
 */
export function loadSuggestions(): HouseRuleSuggestion[] {
  try {
    if (!fs.existsSync(SUGGESTIONS_FILE)) {
      return [];
    }
    const content = fs.readFileSync(SUGGESTIONS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('[HouseRuleSuggestions] Failed to load suggestions:', err);
    return [];
  }
}

/**
 * Save all house rule suggestions to file
 */
function saveSuggestions(suggestions: HouseRuleSuggestion[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify(suggestions, null, 2));
  } catch (err) {
    console.error('[HouseRuleSuggestions] Failed to save suggestions:', err);
    throw err;
  }
}

/**
 * Add a new house rule suggestion
 */
export function addSuggestion(suggestion: string): HouseRuleSuggestion {
  const suggestions = loadSuggestions();
  
  const newSuggestion: HouseRuleSuggestion = {
    id: `suggestion_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    suggestion: suggestion.trim(),
    submittedAt: new Date().toISOString(),
    status: 'pending',
  };
  
  suggestions.push(newSuggestion);
  saveSuggestions(suggestions);
  
  console.info('[HouseRuleSuggestions] New suggestion added:', newSuggestion.id);
  
  return newSuggestion;
}

/**
 * Get all pending suggestions for review
 */
export function getPendingSuggestions(): HouseRuleSuggestion[] {
  return loadSuggestions().filter(s => s.status === 'pending');
}

/**
 * Update the status of a suggestion (for admin use)
 */
export function updateSuggestionStatus(
  id: string, 
  status: HouseRuleSuggestion['status'], 
  reviewNotes?: string
): boolean {
  const suggestions = loadSuggestions();
  const index = suggestions.findIndex(s => s.id === id);
  
  if (index === -1) {
    return false;
  }
  
  suggestions[index].status = status;
  if (reviewNotes) {
    suggestions[index].reviewNotes = reviewNotes;
  }
  
  saveSuggestions(suggestions);
  return true;
}
