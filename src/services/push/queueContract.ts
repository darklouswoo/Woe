





export interface PushQueueMessage {

  outboxId: number;

  traceId: string;

  attempt: number;

  enqueueAt: string;
}








export function parsePushQueueMessage(input: unknown): PushQueueMessage {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid push queue message');
  }

  const record = input as Record<string, unknown>;
  if (typeof record.outboxId !== 'number' || !Number.isFinite(record.outboxId)) {
    throw new Error('Invalid push queue message');
  }

  if (typeof record.traceId !== 'string' || !record.traceId.trim()) {
    throw new Error('Invalid push queue message');
  }

  return {
    outboxId: record.outboxId,
    traceId: record.traceId,
    attempt: typeof record.attempt === 'number' && Number.isFinite(record.attempt)
      ? Math.max(0, Math.floor(record.attempt))
      : 0,
    enqueueAt: typeof record.enqueueAt === 'string' && record.enqueueAt
      ? record.enqueueAt
      : new Date().toISOString()
  };
}
