/**
 * Copy Decklist: load a baked precon into the local editor and the clipboard
 * so it can be edited and saved as a new deck.
 */
import { toast } from '../ToastHost';
import { fetchPreconDecklist } from '../../utils/preconDecklistApi';
import type { DeckManagerModalTab } from './deckManagerModalSaveCacheHandlers';

export async function copyPreconDecklistIntoEditor(args: {
  setCode: string;
  deckName: string;
  clearEditMode: () => void;
  setLocalName: (name: string) => void;
  setLocalText: (text: string) => void;
  setLocalErr: (err: string | null) => void;
  setTab: (tab: DeckManagerModalTab) => void;
  syncPreviewToText: (text: string) => void;
  resolveAllFromText: (text: string) => void;
}): Promise<void> {
  const { setCode, deckName } = args;
  let loaded;
  try {
    loaded = await fetchPreconDecklist(setCode, deckName);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not load that precon decklist.';
    toast.error(message);
    return;
  }

  args.clearEditMode();
  args.setLocalErr(null);
  args.setLocalName(loaded.deckName);
  args.setLocalText(loaded.text);
  args.syncPreviewToText(loaded.text);
  void args.resolveAllFromText(loaded.text);
  args.setTab('local');

  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(loaded.text);
      copied = true;
    }
  } catch {
    copied = false;
  }

  const countLabel = loaded.cardCount > 0 ? ` (${loaded.cardCount} cards)` : '';
  if (copied) {
    toast.success(`Copied ${loaded.deckName}${countLabel} into the editor. Edit it and save your own copy.`);
  } else {
    toast.warn(`Loaded ${loaded.deckName}${countLabel} into the editor. The browser blocked copying to the clipboard.`);
  }
}
