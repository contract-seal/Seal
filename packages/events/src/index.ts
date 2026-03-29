import { Redis } from 'ioredis';
import { env } from '@seal/config';
import { randomUUID } from 'crypto';

type Handler = (payload: Record<string, unknown>) => Promise<void>;

export class EventBus {
  private publisher: Redis;
  private consumer: Redis;
  private stream = 'seal:events';

  constructor() {
    this.publisher = new Redis(env.REDIS_URL);
    this.consumer = new Redis(env.REDIS_URL);
  }

  async publish(event: string, payload: Record<string, unknown>) {
    await this.publisher.xadd(this.stream, '*', 'id', randomUUID(), 'event', event, 'payload', JSON.stringify(payload));
  }

  async consume(serviceName: string, handlers: Record<string, Handler>) {
    const group = `${serviceName}-group`;
    const consumerName = `${serviceName}-${randomUUID().slice(0, 8)}`;
    try {
      await this.consumer.call('XGROUP', 'CREATE', this.stream, group, '$', 'MKSTREAM');
    } catch {
    }

    while (true) {
      const response = (await this.consumer.call(
        'XREADGROUP',
        'GROUP',
        group,
        consumerName,
        'BLOCK',
        '5000',
        'COUNT',
        '20',
        'STREAMS',
        this.stream,
        '>'
      )) as Array<[string, Array<[string, string[]]>]> | null;

      if (!response) {
        continue;
      }

      for (const [, messages] of response) {
        for (const [id, fields] of messages) {
          const record = Object.fromEntries(
            fields.reduce((acc: [string, string][], value: string, idx: number, arr: string[]) => {
              if (idx % 2 === 0) {
                acc.push([value, arr[idx + 1]]);
              }
              return acc;
            }, [] as [string, string][])
          );

          const eventName = record.event;
          if (!eventName) {
            await this.consumer.xack(this.stream, group, id);
            continue;
          }

          const handler = handlers[eventName];
          if (handler) {
            const payload = record.payload ? JSON.parse(record.payload) : {};
            await handler(payload);
          }

          await this.consumer.xack(this.stream, group, id);
        }
      }
    }
  }
}
