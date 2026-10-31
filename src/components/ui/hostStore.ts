// A tiny external store for the app-wide hosts (dialogs, toasts): code
// anywhere calls `showDialog` or `showToast`, and the one host the app shell
// mounts renders it. React subscribes with useSyncExternalStore.
import { useSyncExternalStore } from 'react';

export type HostStore<T> = {
  get(): T;
  set(next: T | ((previous: T) => T)): void;
  subscribe(listener: () => void): () => void;
  /** How many hosts are mounted and listening (to warn when none is). */
  listenerCount(): number;
  use(): T;
};

export function createHostStore<T>(initial: T): HostStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const store: HostStore<T> = {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? (next as (previous: T) => T)(value) : next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    listenerCount: () => listeners.size,
    // A hook bound to this store (only ever called from components).
    use: () => useSyncExternalStore(store.subscribe, store.get, store.get),
  };
  return store;
}
