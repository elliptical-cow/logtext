import { writable } from "svelte/store";
import { listTasks } from "../api.js";
import { toErrorMessage } from "../errors.js";
import type { TaskItem } from "../types.js";

type TaskStoreState = {
  tasks: TaskItem[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
};

const initialState: TaskStoreState = {
  tasks: [],
  loading: false,
  loaded: false,
  error: null,
};

export function createTaskStore(loadTasks: typeof listTasks = listTasks) {
  const { subscribe, set, update } = writable<TaskStoreState>(initialState);
  let requestGeneration = 0;

  return {
    subscribe,
    clear() {
      requestGeneration += 1;
      set(initialState);
    },
    clearError() {
      update((state) => ({ ...state, error: null }));
    },
    async refresh() {
      const generation = ++requestGeneration;
      update((state) => ({ ...state, loading: true, error: null }));

      try {
        const tasks = await loadTasks();
        if (generation === requestGeneration) {
          set({ tasks, loading: false, loaded: true, error: null });
        }
      } catch (error) {
        if (generation === requestGeneration) {
          update((state) => ({
            ...state,
            loading: false,
            error: toErrorMessage(error),
          }));
        }
      }
    },
  };
}

export const taskStore = createTaskStore();
