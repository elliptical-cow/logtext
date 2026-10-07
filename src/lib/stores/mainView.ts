import { writable } from "svelte/store";

export type MainView = "editor" | "tasks" | "health";

export const mainViewStore = writable<MainView>("editor");
