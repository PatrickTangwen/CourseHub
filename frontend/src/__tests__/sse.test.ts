import { describe, expect, it } from "vitest";
import { parseSseStream, type SseEvent } from "../lib/sse";

function streamOf(text: string, chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const evt of parseSseStream(stream)) {
    events.push(evt);
  }
  return events;
}

const FRAMES =
  'event: run_started\ndata: {"conv_id":"c-1"}\n\n' +
  'event: answer\ndata: {"response":"hello"}\n\n' +
  "event: done\ndata: {}\n\n";

describe("parseSseStream", () => {
  it("parses frames regardless of chunk boundaries", async () => {
    for (const chunkSize of [1, 3, 7, 1024]) {
      const events = await collect(streamOf(FRAMES, chunkSize));
      expect(events.map((e) => e.event)).toEqual(["run_started", "answer", "done"]);
      expect(events[0].data).toEqual({ conv_id: "c-1" });
      expect(events[1].data).toEqual({ response: "hello" });
    }
  });

  it("parses a trailing frame missing its terminator", async () => {
    const truncated = 'event: run_started\ndata: {"conv_id":"c-2"}\n\nevent: error\ndata: {"message":"x"}';
    const events = await collect(streamOf(truncated, 5));
    expect(events.map((e) => e.event)).toEqual(["run_started", "error"]);
    expect(events[1].data).toEqual({ message: "x" });
  });

  it("yields null data for malformed JSON instead of throwing", async () => {
    const events = await collect(streamOf("event: answer\ndata: {broken\n\n", 4));
    expect(events).toEqual([{ event: "answer", data: null }]);
  });

  it("ignores blocks without an event name", async () => {
    const events = await collect(streamOf(': keep-alive comment\n\nevent: done\ndata: {}\n\n', 8));
    expect(events.map((e) => e.event)).toEqual(["done"]);
  });
});
