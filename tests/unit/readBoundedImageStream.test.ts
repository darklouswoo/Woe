import {
  IMAGE_MAX_OUTPUT_BYTES,
  readBoundedImageStream
} from '../../src/utils/readBoundedImageStream'

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index])
        index += 1
      } else {
        controller.close()
      }
    }
  })
}

function bytes(list: number[]): Uint8Array {
  return new Uint8Array(list)
}

describe('readBoundedImageStream', () => {
  test('declares the 8MiB transform output ceiling', () => {
    expect(IMAGE_MAX_OUTPUT_BYTES).toBe(8_388_608)
  })

  test('delivers concatenated bytes from a multi-chunk stream of unknown length', async () => {
    const buffer = await readBoundedImageStream(
      streamFromChunks([bytes([1, 2]), bytes([3]), bytes([4, 5])]),
      10
    )

    expect(buffer).toBeInstanceOf(ArrayBuffer)
    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3, 4, 5])
  })

  test('succeeds when the total equals the limit exactly', async () => {
    const buffer = await readBoundedImageStream(
      streamFromChunks([bytes([1, 2]), bytes([3, 4])]),
      4
    )

    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3, 4])
  })

  test('rejects one byte over the limit and cancels the stream', async () => {
    let cancelled = false
    let pullIndex = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullIndex += 1

        if (pullIndex === 1) controller.enqueue(bytes([1, 2]))
        else if (pullIndex === 2) controller.enqueue(bytes([3]))
        else if (pullIndex === 3) controller.enqueue(bytes([4]))
        else if (pullIndex === 4) controller.enqueue(bytes([5]))
      },
      cancel() {
        cancelled = true
      }
    })

    await expect(readBoundedImageStream(stream, 4)).rejects.toThrow(/limit|exceed/i)
    expect(cancelled).toBe(true)
  })

  test('rejects when the stream errors midway without resolving partial data', async () => {
    let pullCount = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1
        if (pullCount === 1) {
          controller.enqueue(bytes([1, 2]))
        } else {
          controller.error(new Error('stream blew up'))
        }
      }
    })

    await expect(readBoundedImageStream(stream, 10)).rejects.toThrow('stream blew up')
  })

  test('rejects empty output', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      }
    })

    await expect(readBoundedImageStream(stream, 10)).rejects.toThrow(/empty/i)
  })

  test('terminates an unbounded stream as soon as the limit is exceeded', async () => {
    let cancelled = false
    let pullCount = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1
        controller.enqueue(bytes([1, 1, 1, 1, 1]))
      },
      cancel() {
        cancelled = true
      }
    })

    await expect(readBoundedImageStream(stream, 12)).rejects.toThrow(/limit|exceed/i)
    expect(cancelled).toBe(true)
    expect(pullCount).toBeLessThanOrEqual(4)
  })
})
