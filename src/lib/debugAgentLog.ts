import fs from 'fs';

/** Temporary debug-mode logger. Writes NDJSON to the agent log file and a grep-able console line. */
export function agentLog(
  hypothesisId: string,
  location: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  const payload = {
    hypothesisId,
    location,
    message,
    data: data ?? {},
    timestamp: Date.now(),
  };
  try {
    fs.appendFileSync('/opt/cursor/logs/debug.log', JSON.stringify(payload) + '\n');
  } catch {
    // Netlify / missing log dir — console still captures the line.
  }
  console.log(`[DBG-WH] ${hypothesisId} ${location} ${message} ${JSON.stringify(data ?? {})}`);
}
