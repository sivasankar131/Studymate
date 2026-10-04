/**
 * useHealth – polls GET /health/ready to show backend status in the UI.
 * Polls every `intervalMs` (default 30 s). Stops when the component unmounts.
 */

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/services/api';
import type { HealthReady } from '@/types';

export type BackendStatus = 'checking' | 'ok' | 'degraded' | 'offline';

export interface UseHealthReturn {
  status: BackendStatus;
  detail: HealthReady | null;
  lastChecked: Date | null;
  check: () => Promise<void>;
}

export function useHealth(intervalMs = 30_000): UseHealthReturn {
  const [status, setStatus] = useState<BackendStatus>('checking');
  const [detail, setDetail] = useState<HealthReady | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const check = useCallback(async () => {
    try {
      const data = await api.getHealthReady();
      setDetail(data);
      setStatus(data.status === 'ok' ? 'ok' : 'degraded');
    } catch {
      setDetail(null);
      setStatus('offline');
    } finally {
      setLastChecked(new Date());
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), intervalMs);
    return () => clearInterval(timer);
  }, [check, intervalMs]);

  return { status, detail, lastChecked, check };
}
