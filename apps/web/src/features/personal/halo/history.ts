/**
 * Conversation history helpers. The durable server state is a flat feed of messages:
 * the user's input rows have no derived run, and each assistant reply carries the run
 * id it was derived from (at most one per run). Pairing them rebuilds chat turns; the
 * live event stream is never replayed because its history expires after 24 hours.
 */
export type HistoryMessage = {
  id: string;
  body: string;
  derivedFromRunId: string | null;
  createdAt: string;
};

export type PairableTurn = {
  key: string;
  input: string;
  answer: string;
  createdAt: number;
  runId: string | undefined;
  complete: boolean;
};

/** Pair an ascending message feed into turns: each user message plus its reply, if any. */
export function pairConversationTurns(messages: HistoryMessage[]): PairableTurn[] {
  const turns: PairableTurn[] = [];
  let current: PairableTurn | null = null;
  for (const message of messages) {
    if (message.derivedFromRunId === null) {
      if (current) turns.push(current);
      current = {
        key: message.id,
        input: message.body,
        answer: '',
        createdAt: timestamp(message.createdAt),
        runId: undefined,
        complete: false,
      };
      continue;
    }
    // A reply without a preceding user message (defensive): keep it readable as its own turn.
    if (!current) {
      turns.push({
        key: message.id,
        input: '',
        answer: message.body,
        createdAt: timestamp(message.createdAt),
        runId: message.derivedFromRunId,
        complete: true,
      });
      continue;
    }
    if (!current.answer) {
      current.answer = message.body;
      current.runId = message.derivedFromRunId;
      current.complete = true;
      continue;
    }
    // An extra derived row would mean one run produced several replies; surface it
    // separately instead of silently dropping content.
    turns.push(current);
    current = {
      key: message.id,
      input: '',
      answer: message.body,
      createdAt: timestamp(message.createdAt),
      runId: message.derivedFromRunId,
      complete: true,
    };
  }
  if (current) turns.push(current);
  return turns;
}

function timestamp(iso: string): number {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}
