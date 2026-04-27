/**
 * Split an AI SDK `fullStream` into substreams, one per LLM step that
 * produced text. Each yielded substream replays the step's events so the
 * consumer can pipe each into a separate `thread.post()` call — one chat
 * bubble per step.
 *
 * Why `finish-step`: it's exactly where chat-sdk's `fromFullStream` already
 * inserts a `"\n\n"` separator (../chat/packages/chat/src/from-full-stream.ts:67).
 * We trade that intra-bubble separator for a real bubble break, no other
 * information loss — `fromFullStream` drops every event except `text-delta`
 * anyway, so tool-call events were never visible.
 *
 * Streaming preserved: the segment publishes to the consumer on its first
 * `text-delta`, not on `finish-step`. Subsequent events stream through the
 * substream as they arrive, so per-bubble typing/edits keep working.
 *
 * Empty segments (steps with only tool-calls, no text) are silently
 * discarded — never yielded, so no empty bubbles get posted.
 */
export async function* splitOnFinishStep<T extends { type: string }>(
  stream: AsyncIterable<T>,
): AsyncGenerator<AsyncIterable<T>> {
  type Segment = {
    push: (e: T) => void;
    end: () => void;
    fail: (err: unknown) => void;
    iter: () => AsyncIterable<T>;
  };

  const newSegment = (): Segment => {
    const buf: T[] = [];
    let resolve: (() => void) | null = null;
    let done = false;
    let error: unknown = null;

    const wake = () => {
      resolve?.();
      resolve = null;
    };

    return {
      push(e) {
        buf.push(e);
        wake();
      },
      end() {
        done = true;
        wake();
      },
      fail(err) {
        error = err;
        done = true;
        wake();
      },
      async *iter() {
        while (true) {
          if (buf.length) {
            yield buf.shift()!;
            continue;
          }
          if (error) throw error;
          if (done) return;
          await new Promise<void>((r) => {
            resolve = r;
          });
        }
      },
    };
  };

  let current: Segment | null = null;
  let currentPublished = false;
  const pending: Segment[] = [];
  let wake: (() => void) | null = null;
  let pumpDone = false;
  let pumpError: unknown = null;

  const pingConsumer = () => {
    wake?.();
    wake = null;
  };

  const pump = (async () => {
    try {
      for await (const event of stream) {
        if (event.type === "finish-step") {
          if (current && currentPublished) {
            current.push(event);
            current.end();
          }
          // Unpublished current → discard: the step produced no text, so
          // there's no bubble to render. Buffered non-text events drop with it.
          current = null;
          currentPublished = false;
          continue;
        }
        if (!current) {
          current = newSegment();
          currentPublished = false;
        }
        current.push(event);
        if (!currentPublished && event.type === "text-delta") {
          pending.push(current);
          currentPublished = true;
          pingConsumer();
        }
      }
      // Stream exhausted with no trailing finish-step — close any
      // already-published segment so its iter() drains.
      if (current && currentPublished) current.end();
    } catch (err) {
      pumpError = err;
      if (current && currentPublished) current.fail(err);
    } finally {
      pumpDone = true;
      pingConsumer();
    }
  })();

  try {
    while (true) {
      const seg = pending.shift();
      if (seg) {
        yield seg.iter();
        continue;
      }
      if (pumpDone) {
        if (pumpError) throw pumpError;
        return;
      }
      await new Promise<void>((r) => {
        wake = r;
      });
    }
  } finally {
    // Ensure pump rejection surfaces and the IIFE settles before the outer
    // generator resolves — otherwise the unhandled rejection could escape.
    await pump.catch(() => {});
  }
}
