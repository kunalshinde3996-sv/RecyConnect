import { useState } from 'react';

const pathOf = (u: string | null) => (u ? u.split('?')[0] : null);

/**
 * Presigned URLs get a new signature on every API call. When polling, that would make an <img>
 * re-download on each tick. This keeps returning the first URL for the same object (same path)
 * and switches only when the path changes, i.e. a different photo.
 */
export function useStableUrl(url: string | null): string | null {
  const [stable, setStable] = useState(url);
  if (pathOf(stable) !== pathOf(url)) {
    setStable(url); // React's sanctioned "adjust state during render" pattern
    return url;
  }
  return stable;
}
