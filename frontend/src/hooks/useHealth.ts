/**
 * useHealth – polls GET /health/ready to show backend status in the UI.
 *
 * Cancellation: each poll carries an AbortSignal. When the component
 * unmounts the signal is aborted and the result is silently discarded —
 * no 'offline' flash, no error state, no side-effects on other features.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/services/api';
import { isCancelledError } from '@/services/api';
import type { HealthReady } from '@/types';

export type BackendStatus = 'checking' | 'ok' | 'degraded' | 'offline';

export interface UseHealthReturn {
  status: BackendStatus;
  detail: HealthReady | null;
  lastChecked: Date | null;
  check: () => Promise<void>;
}

export function useHealth(intervalMs = 30_000): UseHealthReturn {
  const [status, setStatus]           = useState<BackendStatus>('checking');
  const [detail, setDetail]           = useState<HealthReady | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const abortRef  = useRef<AbortController | null>(null);
  const isMounted = useRef(true);

  const check = useCallback(async () => {
    // Abort any in-flight health request before starting a new one
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const data = await api.getHealthReady(controller.signal);
      if (controller.signal.aborted || !isMounted.current) return;
      setDetail(data);
      setStatus(data.status === 'ok' ? 'ok' : 'degraded');
    } catch (err) {
      // Intentional cancellation — do nothing, don't flip status to 'offline'
      if (isCancelledError(err) || controller.signal.aborted) return;
      if (!isMounted.current) return;
      setDetail(null);
      setStatus('offline');
    } finally {
      if (isMounted.current && !controller.signal.aborted) {
        setLastChecked(new Date());
      }
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    void check();
    const timer = setInterval(() => void check(), intervalMs);
    return () => {
      isMounted.current = false;
      clearInterval(timer);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [check, intervalMs]);

  return { status, detail, lastChecked, check };
}
