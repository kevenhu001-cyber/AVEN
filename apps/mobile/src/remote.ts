import { useCallback, useEffect, useRef, useState } from 'react';
import { expired, problemText } from './api';
import { useSession } from './session';

export function useRemote<T>(read: (signal: AbortSignal) => Promise<T>) {
  const { invalidate } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(true);
  const [problem, setProblem] = useState('');
  const reader = useRef(read);
  reader.current = read;
  const controller = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setData(null);
    setBusy(true);
    setProblem('');
    try {
      const result = await reader.current(abort.signal);
      if (!abort.signal.aborted) setData(result);
    } catch (error) {
      if (!abort.signal.aborted) {
        if (expired(error)) invalidate();
        else setProblem(problemText(error));
      }
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }, [invalidate]);
  useEffect(() => {
    void reload();
    return () => controller.current?.abort();
  }, [reload]);
  return { data, setData, busy, problem, reload };
}
export function useOperation() {
  const { invalidate } = useSession();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setProblem('');
    const abort = new AbortController();
    controller.current = abort;
    try {
      await work(abort.signal);
    } catch (error) {
      if (!abort.signal.aborted) {
        if (expired(error)) invalidate();
        else setProblem(problemText(error));
      }
    } finally {
      lock.current = false;
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return { busy, problem, setProblem, run };
}
