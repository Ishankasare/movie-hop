"use client";

import { useSyncExternalStore } from "react";

const KEY = "movie-hop:nickname";
const EVENT = "movie-hop:nickname-change";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The player's nickname, remembered on this device (no account needed). */
export function useNickname(): [string, (value: string) => void] {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const set = (value: string) => {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // storage unavailable: the nickname just isn't remembered
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [raw ?? "", set];
}
