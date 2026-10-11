<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import { tick } from "svelte";
  import { get } from "svelte/store";
  import { probeCryptomatorCli } from "../api.js";
  import { trapDialogFocus } from "../dialogFocus.js";
  import { toErrorPresentation } from "../errors.js";
  import { workspaceStore } from "../stores/workspace.js";
  import ErrorDialog from "./ErrorDialog.svelte";

  export let initialVaultPath = "";
  export let onCancel: () => void;
  export let onOpened: () => void;

  let vaultPath = initialVaultPath;
  let password = "";
  let cliPath = "";
  let mounting = false;
  let error: string | null = null;
  let errorDetail: string | null = null;
  let passwordInput: HTMLInputElement | null = null;

  $: if (!mounting && initialVaultPath && !vaultPath) {
    vaultPath = initialVaultPath;
  }

  async function chooseVault() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Cryptomator vault",
    });
    if (typeof selected === "string") {
      vaultPath = selected;
      await tick();
      passwordInput?.focus({ preventScroll: true });
    }
  }

  async function chooseCli() {
    const selected = await open({
      directory: false,
      multiple: false,
      title: "Select cryptomator-cli executable",
    });
    if (typeof selected !== "string") {
      return;
    }
    try {
      const info = await probeCryptomatorCli(selected);
      cliPath = info.executablePath;
    } catch (candidateError) {
      showError(candidateError);
    }
  }

  async function submit() {
    if (mounting || !vaultPath.trim() || !password) {
      return;
    }
    mounting = true;
    error = null;
    errorDetail = null;
    try {
      const opened = await workspaceStore.openCryptomator(vaultPath, password, cliPath || undefined);
      password = "";
      if (opened) {
        onOpened();
        return;
      }
      const workspace = get(workspaceStore);
      error = workspace.error ?? "Could not open the Cryptomator vault.";
      errorDetail = workspace.errorDetail;
      workspaceStore.clearError();
    } catch (openError) {
      password = "";
      showError(openError);
    } finally {
      mounting = false;
    }
  }

  function showError(value: unknown) {
    const presentation = toErrorPresentation(value);
    error = presentation.message;
    errorDetail = presentation.detail;
  }
</script>

<div class="dialog-backdrop" role="presentation">
  <div
    class="cryptomator-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="cryptomator-dialog-title"
    tabindex="-1"
    use:trapDialogFocus={{ onClose: () => !mounting && onCancel() }}
  >
    <form on:submit|preventDefault={submit}>
      <header>
        <h2 id="cryptomator-dialog-title">Open Cryptomator Vault</h2>
        <p>The vault password is passed to cryptomator-cli and is not stored.</p>
      </header>

      <div class="cryptomator-fields">
        <label>
          <span>Vault folder</span>
          <div class="path-row">
            <input bind:value={vaultPath} autocomplete="off" spellcheck="false" disabled={mounting} />
            <button type="button" on:click={chooseVault} disabled={mounting}>Browse</button>
          </div>
        </label>
        <label>
          <span>Password</span>
          <input
            bind:this={passwordInput}
            bind:value={password}
            type="password"
            autocomplete="off"
            disabled={mounting}
          />
        </label>
        <div class="cli-row">
          <span>{cliPath || "cryptomator-cli is detected automatically"}</span>
          <button type="button" on:click={chooseCli} disabled={mounting}>Locate CLI</button>
        </div>
      </div>

      <footer>
        <button type="button" on:click={onCancel} disabled={mounting}>Cancel</button>
        <button
          type="submit"
          class="primary-action"
          disabled={mounting || !vaultPath.trim() || !password}
        >
          {mounting ? "Unlocking…" : "Unlock and open"}
        </button>
      </footer>
    </form>
  </div>
</div>

<ErrorDialog
  title="Could not open Cryptomator vault"
  message={error}
  detail={errorDetail}
  onClose={() => {
    error = null;
    errorDetail = null;
  }}
/>

<style>
  .cryptomator-dialog {
    width: min(560px, calc(100vw - 48px));
    max-height: calc(100vh - 48px);
    overflow: auto;
    border: 1px solid var(--border-default);
    border-radius: 8px;
    background: var(--surface-elevated);
    box-shadow: 0 18px 55px rgb(0 0 0 / 0.28);
  }

  form {
    display: grid;
    gap: 16px;
    padding: 18px;
  }

  header h2,
  header p {
    margin: 0;
  }

  header p {
    margin-top: 6px;
    color: var(--text-muted);
  }

  .cryptomator-fields,
  label {
    display: grid;
    gap: 8px;
  }

  .path-row,
  .cli-row,
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .path-row input {
    min-width: 0;
    flex: 1;
  }

  .cli-row {
    justify-content: space-between;
    color: var(--text-muted);
    font-size: 0.92em;
  }

  footer {
    justify-content: flex-end;
  }
</style>
