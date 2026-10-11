









export const IMAGE_MAX_OUTPUT_BYTES = 8_388_608;










export async function readBoundedImageStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  const cancelQuietly = async (): Promise<void> => {
    try {
      await reader.cancel();
    } catch {

    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      total += value.length;
      if (total > maxBytes) {
        await cancelQuietly();
        throw new Error(
          `Image transform output exceeds limit: ${total} bytes > ${maxBytes} bytes`
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    await cancelQuietly();
    throw error;
  }

  if (total === 0) {
    throw new Error("Image transform output is empty");
  }

  const result = new ArrayBuffer(total);
  const view = new Uint8Array(result);
  let offset = 0;
  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.length;
  }
  chunks.length = 0;

  return result;
}
