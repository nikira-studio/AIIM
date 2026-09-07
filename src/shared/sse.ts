export async function readSseData(response: Response, onData: (data: string) => void, emptyResponseMessage: string): Promise<void> {
  if (!response.body) throw new Error(emptyResponseMessage);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const event of events) emitEventData(event, onData);
    if (chunk.done) break;
  }
  if (buffer.trim()) emitEventData(buffer, onData);
}

function emitEventData(event: string, onData: (data: string) => void): void {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line === "data" || line.startsWith("data:"))
    .map((line) => line === "data" ? "" : line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (data) onData(data);
}
