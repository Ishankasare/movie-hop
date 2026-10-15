"use client";

import { useEffect, useState } from "react";

const nowMs = () => Date.now();

/** Re-renders every `ms` milliseconds and returns the device's current time (add the server offset for server time). */
export function useTicker(ms: number): number {
  const [t, setT] = useState(nowMs);
  useEffect(() => {
    const id = setInterval(() => setT(nowMs()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}
