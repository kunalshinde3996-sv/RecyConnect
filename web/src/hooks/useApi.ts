import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { errorMessage } from '../api';

interface ApiState<T> {
  data: T | undefined;
  error: string | null;
  /** True only for the first load (or after `deps` change), not for background refreshes. */
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads data on mount / when `deps` change, with optional background polling every `pollMs`.
 * Changing `pollMs` only reschedules polling; it doesn't clear data or show a spinner.
 * Never throws: errors land in `error` (and the last good `data` is kept).
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[], options: { pollMs?: number } = {}): ApiState<T> {
  const { pollMs } = options;
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  useLayoutEffect(() => {
    fetcherRef.current = fetcher;
  });
  /** Bumped whenever deps change so responses for old deps are ignored. */
  const generation = useRef(0);

  const run = useCallback(async () => {
    const gen = generation.current;
    try {
      const result = await fetcherRef.current();
      if (gen !== generation.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (gen !== generation.current) return;
      setError(errorMessage(err));
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    generation.current++;
    setLoading(true);
    setData(undefined);
    setError(null);
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(() => void run(), pollMs);
    return () => clearInterval(id);
  }, [pollMs, run]);

  return { data, error, loading, reload: run };
}
