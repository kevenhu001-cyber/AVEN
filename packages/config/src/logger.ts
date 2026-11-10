export type LogEntry = {
  level: 'info' | 'warn' | 'error';
  event: string;
  request_id?: string;
  method?: string;
  route?: string;
  status?: number;
  latency_ms?: number;
};
export type LogWriter = (entry: LogEntry) => void;

export function createLogWriter(service: 'api' | 'worker'): LogWriter {
  return (entry) => {
    process.stdout.write(
      `${JSON.stringify({ timestamp: new Date().toISOString(), service, ...entry })}\n`,
    );
  };
}
