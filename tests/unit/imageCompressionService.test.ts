import { ImageCompressionError, ImageCompressionService } from '../../src/services/imageCompressionService'
import { IMAGE_MAX_OUTPUT_BYTES } from '../../src/utils/readBoundedImageStream'

function mockDbWithState(state: Record<string, string>) {
  return {
    $client: {
      prepare: jest.fn().mockReturnValue({
        bind: (key: string) => ({
          first: async () => (state[key] !== undefined ? { value: state[key] } : null)
        })
      })
    }
  } as any
}

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

function makeImagesBinding(options: {
  onOutput?: (opts: ImageOutputOptions) => void
  throwOnOutput?: boolean
  imageStream?: ReadableStream<Uint8Array>
} = {}) {
  return {
    input: jest.fn().mockReturnValue({
      output: jest.fn().mockImplementation(async (opts: ImageOutputOptions) => {
        options.onOutput?.(opts)
        if (options.throwOnOutput) {
          throw new Error('transform failed')
        }

        return {
          contentType: () => opts.format,
          image: () => options.imageStream ?? new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]))
              controller.close()
            }
          })
        }
      })
    })
  } as unknown as ImagesBinding
}

function erroringMidStreamStream(): ReadableStream<Uint8Array> {
  let pullCount = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount += 1
      if (pullCount === 1) {
        controller.enqueue(new Uint8Array([9, 9]))
      } else {
        controller.error(new Error('worker stream blew up'))
      }
    }
  })
}

describe('ImageCompressionService', () => {
  test('maps png to webp with default quality 85', async () => {
    const captured: ImageOutputOptions[] = []
    const service = new ImageCompressionService(
      mockDbWithState({}),
      { IMAGES: makeImagesBinding({ onOutput: (opts) => captured.push(opts) }) } as any
    )

    const result = await service.processImage(new Uint8Array([1, 2, 3]).buffer, 'image/png')

    expect(captured).toHaveLength(1)
    expect(captured[0].format).toBe('image/webp')
    expect(captured[0].quality).toBe(85)
    expect(result.contentType).toBe('image/webp')
    expect(result.usedFallback).toBe(false)
  })

  test('keeps gif and preserves animation with default quality 75', async () => {
    const captured: ImageOutputOptions[] = []
    const service = new ImageCompressionService(
      mockDbWithState({}),
      { IMAGES: makeImagesBinding({ onOutput: (opts) => captured.push(opts) }) } as any
    )

    const result = await service.processImage(new Uint8Array([4, 5, 6]).buffer, 'image/gif')

    expect(captured).toHaveLength(1)
    expect(captured[0].format).toBe('image/gif')
    expect(captured[0].quality).toBe(75)
    expect(captured[0].anim).toBe(true)
    expect(result.contentType).toBe('image/gif')
    expect(result.usedFallback).toBe(false)
  })

  test('rejects when compression disabled and fallback disallowed', async () => {
    const service = new ImageCompressionService(
      mockDbWithState({
        'image.compression.enabled': 'false',
        'image.compression.allow_original_fallback': 'false'
      }),
      { IMAGES: makeImagesBinding() } as any
    )

    await expect(service.processImage(new Uint8Array([1]).buffer, 'image/png')).rejects.toEqual(
      expect.objectContaining({
        status: 503,
        publicMessage: 'Image compression is disabled'
      })
    )
  })

  test('falls back to original when transform fails and fallback is enabled', async () => {
    const service = new ImageCompressionService(
      mockDbWithState({
        'image.compression.enabled': 'true',
        'image.compression.allow_original_fallback': 'true'
      }),
      { IMAGES: makeImagesBinding({ throwOnOutput: true }) } as any
    )

    const source = new Uint8Array([7, 8, 9]).buffer
    const result = await service.processImage(source, 'image/png')

    expect(result.usedFallback).toBe(true)
    expect(result.contentType).toBe('image/png')
    expect(result.body).toBe(source)
  })

  test('uses defaults when quality config is invalid', async () => {
    const captured: ImageOutputOptions[] = []
    const service = new ImageCompressionService(
      mockDbWithState({
        'image.compression.quality.webp': 'abc',
        'image.compression.quality.gif': '999'
      }),
      { IMAGES: makeImagesBinding({ onOutput: (opts) => captured.push(opts) }) } as any
    )

    await service.processImage(new Uint8Array([1]).buffer, 'image/webp')
    await service.processImage(new Uint8Array([1]).buffer, 'image/gif')

    expect(captured[0].quality).toBe(85)
    expect(captured[1].quality).toBe(75)
  })

  test('throws missing binding error when fallback is disallowed', async () => {
    const service = new ImageCompressionService(
      mockDbWithState({
        'image.compression.enabled': 'true',
        'image.compression.allow_original_fallback': 'false'
      }),
      {} as any
    )

    await expect(service.processImage(new Uint8Array([1]).buffer, 'image/png')).rejects.toBeInstanceOf(ImageCompressionError)
    await expect(service.processImage(new Uint8Array([1]).buffer, 'image/png')).rejects.toEqual(
      expect.objectContaining({
        status: 503,
        publicMessage: 'Image compression service not configured'
      })
    )
  })

  test('buffers multi-chunk transform output into an ArrayBuffer', async () => {
    const service = new ImageCompressionService(
      mockDbWithState({}),
      {
        IMAGES: makeImagesBinding({
          imageStream: streamFromChunks([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])])
        })
      } as any
    )

    const result = await service.processImage(new Uint8Array([1, 2, 3]).buffer, 'image/png')

    expect(result.usedFallback).toBe(false)
    expect(result.body).toBeInstanceOf(ArrayBuffer)
    expect(Array.from(new Uint8Array(result.body))).toEqual([1, 2, 3, 4, 5])
  })

  test('accepts output exactly at the 8MiB ceiling', async () => {
    const service = new ImageCompressionService(
      mockDbWithState({}),
      {
        IMAGES: makeImagesBinding({
          imageStream: streamFromChunks([new Uint8Array(IMAGE_MAX_OUTPUT_BYTES)])
        })
      } as any
    )

    const result = await service.processImage(new Uint8Array([1]).buffer, 'image/png')

    expect(result.usedFallback).toBe(false)
    expect(result.body).toBeInstanceOf(ArrayBuffer)
    expect(result.body.byteLength).toBe(IMAGE_MAX_OUTPUT_BYTES)
  })

  test('falls back to the exact original bytes and MIME when the output stream errors midway', async () => {
    const service = new ImageCompressionService(
      mockDbWithState({
        'image.compression.enabled': 'true',
        'image.compression.allow_original_fallback': 'true'
      }),
      { IMAGES: makeImagesBinding({ imageStream: erroringMidStreamStream() }) } as any
    )

    const source = new Uint8Array([7, 8, 9]).buffer
    const result = await service.processImage(source, 'image/png')

    expect(result.usedFallback).toBe(true)
    expect(result.body).toBe(source)
    expect(result.contentType).toBe('image/png')
  })

  test('returns 500 Image compression failed when the output stream errors and fallback is disallowed', async () => {
    const service = new ImageCompressionService(
      mockDbWithState({
        'image.compression.enabled': 'true',
        'image.compression.allow_original_fallback': 'false'
      }),
      { IMAGES: makeImagesBinding({ imageStream: erroringMidStreamStream() }) } as any
    )

    await expect(service.processImage(new Uint8Array([1]).buffer, 'image/png')).rejects.toEqual(
      expect.objectContaining({
        status: 500,
        publicMessage: 'Image compression failed'
      })
    )
  })

  test('falls back to the exact original bytes and MIME when the output exceeds the bounded limit', async () => {
    const service = new ImageCompressionService(
      mockDbWithState({
        'image.compression.enabled': 'true',
        'image.compression.allow_original_fallback': 'true'
      }),
      {
        IMAGES: makeImagesBinding({
          imageStream: streamFromChunks([
            new Uint8Array(IMAGE_MAX_OUTPUT_BYTES),
            new Uint8Array([1])
          ])
        })
      } as any
    )

    const source = new Uint8Array([3, 3, 3]).buffer
    const result = await service.processImage(source, 'image/webp')

    expect(result.usedFallback).toBe(true)
    expect(result.body).toBe(source)
    expect(result.contentType).toBe('image/webp')
  })

  test('returns 500 Image compression failed when the output exceeds the bounded limit and fallback is disallowed', async () => {
    const service = new ImageCompressionService(
      mockDbWithState({
        'image.compression.enabled': 'true',
        'image.compression.allow_original_fallback': 'false'
      }),
      {
        IMAGES: makeImagesBinding({
          imageStream: streamFromChunks([
            new Uint8Array(IMAGE_MAX_OUTPUT_BYTES),
            new Uint8Array([1])
          ])
        })
      } as any
    )

    await expect(service.processImage(new Uint8Array([1]).buffer, 'image/png')).rejects.toEqual(
      expect.objectContaining({
        status: 500,
        publicMessage: 'Image compression failed'
      })
    )
  })

  test('fails when the transform yields an empty output stream', async () => {
    const service = new ImageCompressionService(
      mockDbWithState({
        'image.compression.enabled': 'true',
        'image.compression.allow_original_fallback': 'false'
      }),
      { IMAGES: makeImagesBinding({ imageStream: new ReadableStream<Uint8Array>({ start(controller) { controller.close() } }) }) } as any
    )

    await expect(service.processImage(new Uint8Array([1]).buffer, 'image/png')).rejects.toEqual(
      expect.objectContaining({
        status: 500,
        publicMessage: 'Image compression failed'
      })
    )
  })
})
