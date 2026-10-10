const encoder = new TextEncoder();

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'x-vercel-ai-ui-message-stream': 'v1',
};

type Chunk = Record<string, unknown>;

function frame(chunk: Chunk): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
}

const DONE = encoder.encode('data: [DONE]\n\n');

/** What the server streams for one finished text answer (UI message stream, first part carries the ids). */
export function answerChunks(
  text: string,
  ids: { userMessageId: string; assistantMessageId: string }
): Chunk[] {
  return [
    { type: 'start', messageId: 'local-answer', messageMetadata: ids },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: text },
    { type: 'text-end', id: 't1' },
    { type: 'finish' },
  ];
}

/** A complete answer that is already there. */
export function sseResponse(chunks: Chunk[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(frame(chunk));
      controller.enqueue(DONE);
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: SSE_HEADERS });
}

/**
 * An answer the test feeds piece by piece, to look at the screen while it streams. When the request is aborted
 * (pass the request's `signal`), the stream fails like a real aborted response.
 */
export function openSse(signal?: AbortSignal) {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(started) {
      controller = started;
    },
  });
  signal?.addEventListener('abort', () => {
    controller?.error(new DOMException('The operation was aborted.', 'AbortError'));
  });
  return {
    response: new Response(body, { status: 200, headers: SSE_HEADERS }),
    send(chunk: Chunk) {
      controller?.enqueue(frame(chunk));
    },
    end() {
      controller?.enqueue(DONE);
      controller?.close();
    },
    /** The connection breaks in the middle of the answer (a network error, no abort). */
    fail() {
      controller?.error(new TypeError('network error'));
    },
  };
}
