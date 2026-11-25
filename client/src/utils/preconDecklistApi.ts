export type PreconDecklistResponse = {
  setCode: string;
  deckName: string;
  text: string;
  cardCount: number;
};

export async function fetchPreconDecklist(
  setCode: string,
  deckName: string,
): Promise<PreconDecklistResponse> {
  const params = new URLSearchParams({ setCode, deckName });
  const res = await fetch(`/api/precons/decklist?${params}`);
  const raw = await res.text();
  let data: { error?: string; text?: string; cardCount?: number; setCode?: string; deckName?: string } = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  if (!res.ok || typeof data.text !== 'string' || !data.text.trim()) {
    throw new Error(
      typeof data.error === 'string' && data.error.trim()
        ? data.error
        : 'Could not load that precon decklist.',
    );
  }
  return {
    setCode: String(data.setCode || setCode),
    deckName: String(data.deckName || deckName),
    text: data.text,
    cardCount: Number(data.cardCount) || 0,
  };
}
