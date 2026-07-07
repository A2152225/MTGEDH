/**
 * Official Wizards announcement pages containing Commander precon decklists.
 * Keys are uppercase set codes from shared/src/precons.ts.
 */
export const PRECON_WIZARDS_ANNOUNCEMENT_URLS: Record<string, string> = {
  FIN: 'https://magic.wizards.com/en/news/announcements/final-fantasy-commander-decklists',
  SOC: 'https://magic.wizards.com/en/news/announcements/secrets-of-strixhaven-commander-decklists',
  MSC: 'https://magic.wizards.com/en/news/announcements/marvel-super-heroes-commander-decklists',
  TMC: 'https://magic.wizards.com/en/news/announcements/teenage-mutant-ninja-turtles-commander-decklist',
  TDC: 'https://magic.wizards.com/en/news/announcements/tarkir-dragonstorm-commander-decklists',
  DRC: 'https://magic.wizards.com/en/news/announcements/aetherdrift-commander-decklists',
  EOE: 'https://magic.wizards.com/en/news/announcements/edge-of-eternities-commander-decklists',
  DSC: 'https://magic.wizards.com/en/news/announcements/duskmourn-house-of-horror-commander-decklists',
  BLC: 'https://magic.wizards.com/en/news/announcements/bloomburrow-commander-decklists',
  M3C: 'https://magic.wizards.com/en/news/announcements/modern-horizons-3-commander-decklists',
  OTC: 'https://magic.wizards.com/en/news/announcements/outlaws-of-thunder-junction-commander-decklists',
  PIP: 'https://magic.wizards.com/en/news/announcements/fallout-commander-decklists',
  MKC: 'https://magic.wizards.com/en/news/announcements/murders-at-karlov-manor-commander-decklists',
  LCC: 'https://magic.wizards.com/en/news/announcements/the-lost-caverns-of-ixalan-commander-decklists',
  WHO: 'https://magic.wizards.com/en/news/announcements/magic-the-gathering-doctor-who-commander-decklists',
  WOC: 'https://magic.wizards.com/en/news/announcements/wilds-of-eldraine-commander-decklists',
  CMM: 'https://magic.wizards.com/en/news/announcements/commander-masters-commander-decklists',
  LTC: 'https://magic.wizards.com/en/news/announcements/the-lord-of-the-rings-tales-of-middle-earth-commander-decklists',
  MOC: 'https://magic.wizards.com/en/news/announcements/march-of-the-machine-commander-decklists',
  ONC: 'https://magic.wizards.com/en/news/announcements/phyrexia-all-will-be-one-commander-decklists',
  BRC: 'https://magic.wizards.com/en/news/announcements/brothers-war-commander-decklists-2022-10-28',
  '40K': 'https://magic.wizards.com/en/news/announcements/warhammer-40000-commander-decklists',
  DMC: 'https://magic.wizards.com/en/news/feature/dominaria-united-commander-decklists-2022-08-19',
  CLB: 'https://magic.wizards.com/en/news/feature/commander-legends-battle-for-baldurs-gate-commander-decklists',
  NCC: 'https://magic.wizards.com/en/news/feature/streets-of-new-capenna-commander-decklists',
  NEC: 'https://magic.wizards.com/en/news/feature/kamigawa-neon-dynasty-commander-decklists-2022-02-07',
  VOC: 'https://magic.wizards.com/en/news/feature/innistrad-crimson-vow-commander-decklists-2021-11-08',
  MIC: 'https://magic.wizards.com/en/articles/archive/news/innistrad-midnight-hunt-commander-decklists-2021-09-13',
  AFC: 'https://magic.wizards.com/en/news/announcements/adventures-forgotten-realms-commander-decklists-2021-07-09',
  C21: 'https://magic.wizards.com/en/news/announcements/commander-2021-edition-decklists-2021-04-05',
  KHC: 'https://magic.wizards.com/en/news/card-preview/kaldheim-commander-decklists-2021-01-20',
  CMR: 'https://magic.wizards.com/en/news/feature/commander-legends-commander-decklists-2020-11-05',
  ZNC: 'https://magic.wizards.com/en/news/feature/zendikar-rising-commander-decklists-2020-09-15',
  C20: 'https://magic.wizards.com/en/news/feature/ikoria-commander-decklists-2020-04-02',
  C19: 'https://magic.wizards.com/en/news/feature/commander-2019-edition-decklists-2019-08-05',
  C18: 'https://magic.wizards.com/en/news/announcements/2018-commander-decklists',
  C17: 'https://magic.wizards.com/en/news/announcements/2017-commander-decklists',
  C16: 'https://magic.wizards.com/en/news/announcements/2016-commander-decklists',
  C15: 'https://magic.wizards.com/en/news/announcements/2015-commander-decklists',
  C14: 'https://magic.wizards.com/en/news/announcements/2014-commander-decklists',
  C13: 'https://magic.wizards.com/en/news/announcements/2013-commander-decklists',
  CMD: 'https://magic.wizards.com/en/news/feature/magic-gathering-commander-decklists-2011-06-14',
};

/** Secret Lair and other products with one Wizards page per deck (not per set). */
export const PRECON_WIZARDS_DECK_URLS: Record<string, Record<string, string>> = {
  SLD: {
    'Goblin Storm':
      'https://magic.wizards.com/en/news/announcements/secret-lair-commander-deck-goblin-storm-decklist',
  },
};

export function getPreconWizardsAnnouncementUrl(
  setCode: string | undefined,
  deckName?: string,
): string | undefined {
  const key = String(setCode || '').trim().toUpperCase();
  if (!key) return undefined;

  const normalizedDeck = String(deckName || '').trim();
  if (normalizedDeck) {
    const deckUrl = PRECON_WIZARDS_DECK_URLS[key]?.[normalizedDeck];
    if (deckUrl) return deckUrl;
  }

  return PRECON_WIZARDS_ANNOUNCEMENT_URLS[key];
}
