import { getPreconWizardsAnnouncementUrl } from '../src/data/preconWizardsUrls.js';
import { SCRYFALL_USER_AGENT } from '../src/services/scryfall.js';
import {
  extractWizardsSingleDeckCommanderPage,
  extractWizardsDecklistLine,
  parseWizardsDecklistFromAnnouncement,
  parseWizardsDecklistLine,
  parseWizardsBracketIdDecklist,
} from '../src/services/wizardsPreconDecklists.js';

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|li|tr|td|th|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractGathererEmbeddedFromHtml(html: string): string {
  const chunks: string[] = [];
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) {
    if (match[1].includes('deck_count') && match[1].includes('title')) {
      chunks.push(match[1]);
    }
  }
  return chunks.join('\n');
}

async function main() {
  const url = getPreconWizardsAnnouncementUrl('TMC')!;
  const html = await (await fetch(url, { headers: { 'User-Agent': SCRYFALL_USER_AGENT } })).text();
  const content = `${htmlToText(html)}\n${extractGathererEmbeddedFromHtml(html)}`;
  const name = 'Turtle Power!';
  console.log('has heading', content.includes('Turtle Power! Commander Decklist'));
  console.log('has leonardo', content.includes('Leonardo, the Balance'));
  const single = extractWizardsSingleDeckCommanderPage(content, name);
  console.log('single len', single?.length, single?.slice(0, 120));
  const line = extractWizardsDecklistLine(content, name);
  console.log('deckline len', line?.length, line?.slice(0, 120));
  const parsed = parseWizardsDecklistFromAnnouncement(content, name);
  console.log('parsed', parsed?.length, parsed?.reduce((s, l) => s + (l.count || 1), 0));
  if (single) {
    const bracketed = parseWizardsBracketIdDecklist(single);
    console.log('bracketed', bracketed.length, bracketed.reduce((s, l) => s + (l.count || 1), 0));
    console.log('has sol ring', bracketed.some((l) => l.name === 'Sol Ring'));
    console.log('names', bracketed.map((l) => l.name).join(' | '));
  }
  if (line) {
    const fromLine = parseWizardsDecklistLine(line);
    console.log('fromLine', fromLine.length, fromLine.reduce((s, l) => s + (l.count || 1), 0));
  }
  process.exit(0);
}

void main();
