import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Html5Qrcode } from 'html5-qrcode';
import { Button } from './ui';

/**
 * Camera QR scanner (html5-qrcode). Renders nothing until the user taps "Scan with camera".
 * Calls onScan once with the decoded text, then stops the camera.
 * Camera errors (no camera, permission denied, insecure origin) are shown inline; the parent
 * always offers manual entry as well.
 */
export function QrScanner({ onScan, disabled }: { onScan: (text: string) => void; disabled?: boolean }) {
  const regionId = `qr-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  useLayoutEffect(() => {
    onScanRef.current = onScan;
  });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let startPromise: Promise<unknown> | null = null;

    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode'); // lazy: keeps it out of the main bundle
        if (cancelled) return;
        const scanner = new Html5Qrcode(regionId, { verbose: false });
        scannerRef.current = scanner;
        startPromise = scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.7); return { width: s, height: s }; } },
          (decoded) => {
            if (cancelled) return;
            cancelled = true;
            onScanRef.current(decoded.trim());
            setActive(false);
          },
          () => {
            /* per-frame "no QR found": ignore */
          },
        );
        await startPromise;
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(
          /permission|notallowed/i.test(msg)
            ? 'Camera permission was denied. Allow camera access, or enter the code manually below.'
            : /notfound|no camera|requested device not found/i.test(msg)
              ? 'No camera found on this device. Enter the code manually below.'
              : `Couldn't start the camera (${msg}). Enter the code manually below.`,
        );
        setActive(false);
      }
    })();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (!scanner) return;
      // Wait for start() to settle before stopping, or html5-qrcode throws.
      void Promise.resolve(startPromise)
        .catch(() => undefined)
        .then(() => (scanner.isScanning ? scanner.stop() : undefined))
        .then(() => scanner.clear())
        .catch(() => undefined);
    };
  }, [active, regionId]);

  return (
    <div className="space-y-2">
      {active ? (
        <div className="space-y-2">
          <div id={regionId} className="overflow-hidden rounded-xl bg-black [&_video]:!w-full" />
          <Button variant="secondary" className="w-full" onClick={() => setActive(false)}>
            Stop camera
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          className="w-full"
          disabled={disabled}
          onClick={() => {
            setError(null);
            setActive(true);
          }}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" strokeLinecap="round" />
          </svg>
          Scan with camera
        </Button>
      )}
      {error && <p className="text-sm text-amber-800">{error}</p>}
    </div>
  );
}
