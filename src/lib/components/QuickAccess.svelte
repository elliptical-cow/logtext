<script lang="ts">
  import ContextMenuShell from "./ContextMenuShell.svelte";
  import { nextRovingIndex } from "../keyboardNavigation";

  type FavoriteItem = {
    kind: "page" | "folder";
    path: string;
  };

  type QuickContextMenuState = {
    x: number;
    y: number;
    source: "favorite" | "recent";
    favorite?: FavoriteItem;
    path: string;
  };

  export let favorites: FavoriteItem[] = [];
  export let recentPages: string[] = [];
  export let favoriteExists: (favorite: FavoriteItem) => boolean;
  export let favoriteLabel: (favorite: FavoriteItem) => string;
  export let displayNameFromPath: (path: string) => string;
  export let openFavorite: (favorite: FavoriteItem) => void;
  export let openPageInEditor: (path: string) => void;
  export let openPageInRightPane: (path: string) => void;
  export let toggleFavorite: (kind: FavoriteItem["kind"], path: string) => void;
  export let moveFavorite: (path: string, direction: "up" | "down") => void;
  export let removeRecentPage: (path: string) => void;
  export let folderGlyphStyle: (path: string) => string = () => "";

  let contextMenu: QuickContextMenuState | null = null;
  let focusedQuickIndex = 0;

  $: quickItemCount = favorites.length + recentPages.length;
  $: if (focusedQuickIndex >= quickItemCount) focusedQuickIndex = Math.max(quickItemCount - 1, 0);

  function openFavoriteContextMenu(favorite: FavoriteItem, event: MouseEvent | KeyboardEvent) {
    event.preventDefault();
    const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
    contextMenu = {
      x: event instanceof MouseEvent && event.clientX > 0 ? event.clientX : (rect?.left ?? 0) + 12,
      y: event instanceof MouseEvent && event.clientY > 0 ? event.clientY : (rect?.top ?? 0) + 12,
      source: "favorite",
      favorite,
      path: favorite.path,
    };
  }

  function openRecentContextMenu(path: string, event: MouseEvent | KeyboardEvent) {
    event.preventDefault();
    const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
    contextMenu = {
      x: event instanceof MouseEvent && event.clientX > 0 ? event.clientX : (rect?.left ?? 0) + 12,
      y: event instanceof MouseEvent && event.clientY > 0 ? event.clientY : (rect?.top ?? 0) + 12,
      source: "recent",
      path,
    };
  }

  function openContextItemInEditor() {
    if (!contextMenu) {
      return;
    }

    openPageInEditor(contextMenu.path);
    contextMenu = null;
  }

  function openContextItemInRightPane() {
    if (!contextMenu) {
      return;
    }

    openPageInRightPane(contextMenu.path);
    contextMenu = null;
  }

  function removeContextItem() {
    if (!contextMenu) {
      return;
    }

    if (contextMenu.source === "favorite" && contextMenu.favorite) {
      toggleFavorite(contextMenu.favorite.kind, contextMenu.favorite.path);
    } else {
      removeRecentPage(contextMenu.path);
    }

    contextMenu = null;
  }

  function moveContextFavorite(direction: "up" | "down") {
    if (!contextMenu || contextMenu.source !== "favorite" || !contextMenu.favorite) {
      return;
    }

    moveFavorite(contextMenu.favorite.path, direction);
    contextMenu = null;
  }

  function canMoveContextFavorite(direction: "up" | "down") {
    if (!contextMenu || contextMenu.source !== "favorite") {
      return false;
    }

    const index = favorites.findIndex((favorite) => favorite.path === contextMenu?.path);
    return direction === "up" ? index > 0 : index >= 0 && index < favorites.length - 1;
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function focusQuickItem(index: number) {
    if (quickItemCount === 0) return;
    focusedQuickIndex = (index + quickItemCount) % quickItemCount;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-quick-index="${focusedQuickIndex}"]`)?.focus();
    });
  }

  function handleQuickKeydown(
    item: { source: "favorite"; favorite: FavoriteItem } | { source: "recent"; path: string },
    index: number,
    event: KeyboardEvent,
  ) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = nextRovingIndex(index, quickItemCount, event.key);
      if (next !== null) focusQuickItem(next);
      return;
    }
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      item.source === "favorite"
        ? openFavoriteContextMenu(item.favorite, event)
        : openRecentContextMenu(item.path, event);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const path = item.source === "favorite" ? item.favorite.path : item.path;
      const isPage = item.source === "recent" || item.favorite.kind === "page";
      if (event.shiftKey && isPage) openPageInRightPane(path);
      else if (item.source === "favorite") openFavorite(item.favorite);
      else openPageInEditor(path);
    }
  }

</script>

<svelte:window on:click={closeContextMenu} />

<section class="quick-access" aria-label="Quick access">
  <div class="quick-section">
    <h2>Favorites</h2>
    {#if favorites.length === 0}
      <p>No favorites</p>
    {:else}
      {#each favorites as favorite, index}
        <div
          class:missing-favorite={!favoriteExists(favorite)}
          class="quick-row"
          role="listitem"
          on:contextmenu={(event) => openFavoriteContextMenu(favorite, event)}
        >
          <button
            type="button"
            class="quick-item"
            class:folder-quick-item={favorite.kind === "folder"}
            title={favorite.path}
            data-quick-index={index}
            tabindex={index === focusedQuickIndex ? 0 : -1}
            on:focus={() => (focusedQuickIndex = index)}
            on:keydown={(event) => handleQuickKeydown({ source: "favorite", favorite }, index, event)}
            on:click={() => openFavorite(favorite)}
          >
            {#if favorite.kind === "folder"}
              <span class="quick-icon folder-glyph" style={folderGlyphStyle(favorite.path)}></span>
            {/if}
            <span>{favoriteLabel(favorite)}</span>
          </button>
          {#if favorite.kind === "page"}
            <button
              type="button"
              class="icon-button right-pane-action"
              title="Open in right pane"
              aria-label="Open in right pane"
              disabled={!favoriteExists(favorite)}
              tabindex="-1"
              on:click={() => openPageInRightPane(favorite.path)}
            >
              R
            </button>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <div class="quick-section">
    <h2>Recent</h2>
    {#if recentPages.length === 0}
      <p>No recent pages</p>
    {:else}
      {#each recentPages as path, index}
        {@const quickIndex = favorites.length + index}
        <div
          class="quick-row"
          role="listitem"
          on:contextmenu={(event) => openRecentContextMenu(path, event)}
        >
          <button
            type="button"
            class="quick-item"
            title={path}
            data-quick-index={quickIndex}
            tabindex={quickIndex === focusedQuickIndex ? 0 : -1}
            on:focus={() => (focusedQuickIndex = quickIndex)}
            on:keydown={(event) => handleQuickKeydown({ source: "recent", path }, quickIndex, event)}
            on:click={() => openPageInEditor(path)}
          >
            <span>{displayNameFromPath(path)}</span>
          </button>
          <button
            type="button"
            class="icon-button right-pane-action"
            title="Open in right pane"
            aria-label="Open in right pane"
            tabindex="-1"
            on:click={() => openPageInRightPane(path)}
          >
            R
          </button>
        </div>
      {/each}
    {/if}
  </div>
</section>

{#if contextMenu}
  <ContextMenuShell x={contextMenu.x} y={contextMenu.y} onClose={closeContextMenu}>
    <button type="button" role="menuitem" data-menu-key="e" on:click={openContextItemInEditor}>
      Open in <span class="menu-mnemonic">e</span>ditor
    </button>
    <button type="button" role="menuitem" data-menu-key="r" on:click={openContextItemInRightPane}>
      Open in <span class="menu-mnemonic">r</span>ight pane
    </button>
    {#if contextMenu.source === "favorite"}
      <div class="context-menu-separator"></div>
      <button
        type="button"
        role="menuitem"
        data-menu-key="u"
        disabled={!canMoveContextFavorite("up")}
        on:click={() => moveContextFavorite("up")}
      >
        Move <span class="menu-mnemonic">u</span>p
      </button>
      <button
        type="button"
        role="menuitem"
        data-menu-key="d"
        disabled={!canMoveContextFavorite("down")}
        on:click={() => moveContextFavorite("down")}
      >
        Move <span class="menu-mnemonic">d</span>own
      </button>
    {/if}
    <div class="context-menu-separator"></div>
    <button type="button" role="menuitem" data-menu-key="f" on:click={removeContextItem}>
      Remove <span class="menu-mnemonic">f</span>rom {contextMenu.source === "favorite" ? "Favorites" : "Recents"}
    </button>
  </ContextMenuShell>
{/if}
