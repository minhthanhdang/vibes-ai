export const STREAM_BACKLOG = 512;

export function eventStream<T>(): {
  emit: (event: T) => void;
  close: () => void;
  read: () => AsyncGenerator<T>;
  dropped: () => number;
} {
  let queued: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  let gone = false;
  let dropped = 0;

  const nudge = () => {
    const waiting = wake;
    wake = null;
    waiting?.();
  };

  return {
    emit(event) {
      if (closed || gone) return;
      if (queued.length >= STREAM_BACKLOG) {
        queued.shift();
        dropped += 1;
      }
      queued.push(event);
      nudge();
    },
    close() {
      closed = true;
      nudge();
    },
    async *read() {
      try {
        for (;;) {
          while (queued.length) {
            const batch = queued;
            queued = [];
            for (const event of batch) yield event;
          }
          if (closed) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      } finally {
        gone = true;
        queued = [];
      }
    },
    dropped: () => dropped,
  };
}
