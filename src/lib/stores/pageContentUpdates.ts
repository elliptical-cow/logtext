/**
 * Lightweight invalidation signal for views derived from a saved page.
 * The monotonically increasing revision makes repeated saves of one path visible
 * to Svelte subscribers.
 */

import { writable } from "svelte/store";

export type PageContentUpdate = {
  path: string;
  revision: number;
};

function createPageContentUpdateStore() {
  const { subscribe, set } = writable<PageContentUpdate | null>(null);
  let revision = 0;

  return {
    subscribe,
    notify(path: string) {
      revision += 1;
      set({ path, revision });
    },
  };
}

export const pageContentUpdateStore = createPageContentUpdateStore();
