/**
 * useHealth – polls GET /health/ready to show backend status in the Navbar.
 *
 * Cold-start handling
 * ───────────────────
 * Render free tier can take 30–90 s to wake up. Rather than immediately
 * showing "Backend offline" (which worries the user for no reason), we:
 *  - show "checking" for the first WAKING_GRACE_MS milliseconds
 *  - only flip to "offline" once we've exceeded the grace period
 *  - use a 90 s per-request timeout so the health check survives a cold start
 *
 * Cancellation: each check carries an AbortSignal. Unmount / navigation
 * cancellations are silently ignored.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/services/api';
import { isCancelledError } from '@/services/api';
import type { HealthReady } from '@/types';

export type BackendStatus = 'checking' | 'waking' | 'ok' | 'degraded' | 'offline';

export interface UseHealthReturn {
  status: BackendStatus;
  detail: HealthReady | null;
  lastChecked: Date | null;
  check: () => Promise<void>;
}

/** Grace period before we show "offline" — covers Render cold-start window */
const WAKING_GRACE_MS = 90_000;

export function useHealth(intervalMs = 60_000): UseHealthReturn {
  const [status, setStatus]           = useState<BackendStatus>('checking');
  const [detail, setDetail]           = useState<HealthReady | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const abortRef     = useRef<AbortController | null>(null);
  const isMounted    = useRef(true);
  const firstCheckAt = useRef<number>(Date.now());
  const hasEverBeenOk = useRef(false);

  const check = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const data = await api.getHealthReady(controller.signal);
      if (controller.signal.aborted || !isMounted.current) return;
      setDetail(data);
      hasEverBeenOk.current = true;
      setStatus(data.status === 'ok' ? 'ok' : 'degraded');
    } catch (err) {
      if (isCancelledError(err) || controller.signal.aborted) return;
      if (!isMounted.current) return;
      setDetail(null);

      // Within the grace period, show "waking" instead of "offline"
      // unless the backend was confirmed alive at least once this session.
      const elapsed = Date.now() - firstCheckAt.current;
      if (!hasEverBeenOk.current && elapsed < WAKING_GRACE_MS) {
        setStatus('waking');
      } else {
        setStatus('offline');
      }
    } finally {
      if (isMounted.current && !controller.signal.aborted) {
        setLastChecked(new Date());
      }
    }
  }, []);

  useEffect(() => {
    isMounted.current    = true;
    firstCheckAt.current = Date.now();
    void check();
    // Poll less frequently than before — cold-start awareness means we
    // don't need to hammer the server on every mount
    const timer = setInterval(() => void check(), intervalMs);
    return () => {
      isMounted.current = false;
      clearInterval(timer);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [check, intervalMs]);

  return { status, detail, lastChecked, check };
}
