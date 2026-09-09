<script lang="ts">
  import ContextMenuShell from "./ContextMenuShell.svelte";
  import { copyImageElementToClipboard } from "../imageClipboard";
  import { runUserAction } from "../stores/appErrors";

  export let x: number;
  export let y: number;
  export let image: HTMLImageElement;
  export let onClose: () => void;

  function copyImage() {
    const selectedImage = image;
    onClose();
    void runUserAction("Copy image", () => copyImageElementToClipboard(selectedImage));
  }
</script>

<ContextMenuShell className="editor-link-menu" {x} {y} {onClose}>
  <button type="button" role="menuitem" data-menu-key="c" on:click={copyImage}>
    <span class="menu-mnemonic">C</span>opy image
  </button>
</ContextMenuShell>
