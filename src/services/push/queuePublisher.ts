import type { MessageSendRequest } from '@cloudflare/workers-types';
import { PushQueueMessage } from './queueContract.ts';






interface PublishOutboxJobsOptions {

  traceId: string;

  chunkSize?: number;

  attempt?: number;

  delaySeconds?: number;
}








export async function publishOutboxJobs(
  queue: Pick<Queue<PushQueueMessage>, 'sendBatch'>,
  outboxIds: number[],
  opts: PublishOutboxJobsOptions
): Promise<void> {
  if (!outboxIds.length) {
    return;
  }

  const chunkSize = Math.max(1, Math.floor(opts.chunkSize ?? 100));
  const attempt = Math.max(0, Math.floor(opts.attempt ?? 0));

  for (let i = 0; i < outboxIds.length; i += chunkSize) {
    const current = outboxIds.slice(i, i + chunkSize);

    const payloads: MessageSendRequest<PushQueueMessage>[] = current.map((id) => ({
      body: {
        outboxId: id,
        traceId: opts.traceId,
        attempt,
        enqueueAt: new Date().toISOString()
      },
      contentType: 'json',
      delaySeconds: opts.delaySeconds
    }));

    await queue.sendBatch(payloads);
  }
}
