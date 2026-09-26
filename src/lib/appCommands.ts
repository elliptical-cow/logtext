export type KeyboardScope = "global" | "workspace" | "editor" | "navigation";

export type KeyBinding = {
  key: string;
  code?: string;
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
  scope: KeyboardScope;
  label: string;
};

export type CommandId =
  | "app.quickOpen"
  | "app.commandPalette"
  | "workspace.search"
  | "workspace.newPage"
  | "workspace.newFolder"
  | "workspace.today"
  | "navigation.rename"
  | "navigation.move"
  | "navigation.delete"
  | "editor.copyFormatted"
  | "editor.openLineInRightPane"
  | "view.focusNextPane"
  | "view.focusPreviousPane"
  | "view.historyBack"
  | "view.historyForward"
  | "view.toggleTasks"
  | "view.toggleEditorMode"
  | "view.toggleLeftPane"
  | "view.toggleMiddlePane"
  | "view.toggleRightPane"
  | "view.toggleTheme"
  | "view.resetLayout"
  | "workspace.preferences"
  | "workspace.cleanMedia"
  | "help.shortcuts"
  | "help.about";

export type CommandDefinition = {
  id: CommandId;
  title: string;
  category: "File" | "Edit" | "Go" | "View" | "Workspace" | "Help";
  keyBinding?: KeyBinding;
  requiresWorkspace?: boolean;
  requiresNavigation?: boolean;
  requiresEditor?: boolean;
  requiresEditorSelection?: boolean;
};

export const commandDefinitions: CommandDefinition[] = [
  {
    id: "app.quickOpen",
    title: "Quick Open Page",
    category: "Go",
    keyBinding: { key: "p", mod: true, scope: "global", label: "Cmd/Ctrl+P" },
  },
  {
    id: "app.commandPalette",
    title: "Show Command Palette",
    category: "Go",
    keyBinding: { key: "p", mod: true, shift: true, scope: "global", label: "Cmd/Ctrl+Shift+P" },
  },
  {
    id: "workspace.search",
    title: "Search Workspace",
    category: "Go",
    requiresWorkspace: true,
    keyBinding: { key: "f", mod: true, shift: true, scope: "workspace", label: "Cmd/Ctrl+Shift+F" },
  },
  { id: "workspace.newPage", title: "New Page", category: "File", requiresWorkspace: true },
  { id: "workspace.newFolder", title: "New Folder", category: "File", requiresWorkspace: true },
  { id: "navigation.rename", title: "Rename Selected Page or Folder", category: "File", requiresWorkspace: true, requiresNavigation: true },
  { id: "navigation.move", title: "Move Selected Page or Folder", category: "File", requiresWorkspace: true, requiresNavigation: true },
  { id: "navigation.delete", title: "Delete Selected Page or Folder...", category: "File", requiresWorkspace: true, requiresNavigation: true },
  { id: "workspace.today", title: "Open Today's Journal", category: "Go", requiresWorkspace: true },
  {
    id: "editor.copyFormatted",
    title: "Copy as Formatted Text",
    category: "Edit",
    requiresWorkspace: true,
    requiresEditor: true,
    requiresEditorSelection: true,
  },
  {
    id: "editor.openLineInRightPane",
    title: "Show Current Line in Right Pane",
    category: "Go",
    requiresWorkspace: true,
    requiresEditor: true,
    keyBinding: {
      key: "ArrowRight",
      mod: true,
      alt: true,
      scope: "editor",
      label: "Cmd/Ctrl+Alt+Right",
    },
  },
  {
    id: "view.focusNextPane",
    title: "Focus Next Pane",
    category: "Go",
    keyBinding: { key: "F6", scope: "global", label: "F6" },
  },
  {
    id: "view.focusPreviousPane",
    title: "Focus Previous Pane",
    category: "Go",
    keyBinding: { key: "F6", shift: true, scope: "global", label: "Shift+F6" },
  },
  {
    id: "view.historyBack",
    title: "Go Back in Focused Pane",
    category: "Go",
    keyBinding: { key: "ArrowLeft", alt: true, scope: "global", label: "Alt+Left" },
  },
  {
    id: "view.historyForward",
    title: "Go Forward in Focused Pane",
    category: "Go",
    keyBinding: { key: "ArrowRight", alt: true, scope: "global", label: "Alt+Right" },
  },
  { id: "view.toggleTasks", title: "Toggle Task Overview", category: "View", requiresWorkspace: true },
  { id: "view.toggleEditorMode", title: "Toggle Editor Mode", category: "View", requiresWorkspace: true },
  { id: "view.toggleLeftPane", title: "Show or Hide Left Pane", category: "View", requiresWorkspace: true },
  { id: "view.toggleMiddlePane", title: "Show or Hide Middle Pane", category: "View", requiresWorkspace: true },
  { id: "view.toggleRightPane", title: "Show or Hide Right Pane", category: "View", requiresWorkspace: true },
  { id: "view.toggleTheme", title: "Toggle Light or Dark Theme", category: "View", requiresWorkspace: true },
  { id: "view.resetLayout", title: "Reset Column Layout", category: "View", requiresWorkspace: true },
  { id: "workspace.preferences", title: "Open Workspace Preferences", category: "Workspace", requiresWorkspace: true },
  { id: "workspace.cleanMedia", title: "Clean Unused Media", category: "Workspace", requiresWorkspace: true },
  { id: "help.shortcuts", title: "Show Keyboard Shortcuts", category: "Help" },
  { id: "help.about", title: "About Logtext", category: "Help" },
];

export function commandForKeyboardEvent(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "isComposing" | "key" | "metaKey" | "shiftKey">) {
  if (event.isComposing) {
    return null;
  }

  return commandDefinitions.find((command) =>
    command.keyBinding ? keyBindingMatches(command.keyBinding, event) : false,
  ) ?? null;
}

export function keyBindingMatches(
  binding: KeyBinding,
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
) {
  const modifierPressed = event.ctrlKey || event.metaKey;
  return event.key.toLocaleLowerCase() === binding.key.toLocaleLowerCase()
    && modifierPressed === Boolean(binding.mod)
    && event.altKey === Boolean(binding.alt)
    && event.shiftKey === Boolean(binding.shift)
    && (!binding.mod || !(event.ctrlKey && event.metaKey));
}

export function commandShortcutLabel(command: CommandDefinition) {
  return command.keyBinding?.label ?? "";
}
