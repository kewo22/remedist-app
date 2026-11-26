'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Seconds left before something may be retried (a resend cooldown, a 429's Retry-After).
 * `start(seconds)` begins or extends the wait, `reset()` ends it, and `secondsLeft` is 0 when it's over.
 */
export function useCountdown(): { secondsLeft: number; start: (seconds: number) => void; reset: () => void } {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until <= Date.now()) return;
    const id = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [until]);

  const start = useCallback((seconds: number) => {
    const current = Date.now();
    setNow(current);
    setUntil((previous) => Math.max(previous, current + seconds * 1000));
  }, []);

  const reset = useCallback(() => setUntil(0), []);

  return { secondsLeft: Math.max(0, Math.ceil((until - now) / 1000)), start, reset };
}

/** "0:42", "1:05". */
export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
