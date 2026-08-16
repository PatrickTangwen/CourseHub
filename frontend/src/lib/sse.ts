/**
 * Incremental SSE frame parser for the CourseHub stage-event protocol
 * (docs/specs/coursehub-frontend.md §3.1).
 *
 * Frames look like:
 *   event: intent_recognized\n
 *   data: {"intent": "course_overview", ...}\n
 *   \n
 */
export interface SseEvent {
  event: string;
  data: unknown;
}

function parseBlock(block: string): SseEvent | null {
  let event = "";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (!event) return null;
  let data: unknown = null;
  if (dataLines.length > 0) {
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      data = null;
    }
  }
  return { event, data };
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const evt = parseBlock(block);
        if (evt) yield evt;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const evt = parseBlock(buffer);
      if (evt) yield evt;
    }
  } finally {
    reader.releaseLock();
  }
}
