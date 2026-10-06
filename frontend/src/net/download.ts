/**
 * Downloads url, telling received the bytes in so far as they arrive, for the
 * loading bar (#227). The bytes are the decoded body's, so they match the
 * file's size also when the server compresses it.
 */
export async function download(url: string, received: (bytes: number) => void, fetcher: typeof fetch = fetch): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`error downloading ${url}: ${String(response.status)}`);
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return new Uint8Array(await response.arrayBuffer());
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    chunks.push(chunk.value);
    length += chunk.value.byteLength;
    received(length);
  }
  const body = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }

  return body;
}
