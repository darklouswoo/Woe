jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

import { fileTypeFromBuffer } from 'file-type'
import { PluginHandlers } from '../../src/handlers/pluginHandlers'

function createDrizzle(state: Record<string, string> = {}, options: { icon?: string | null, failUpdate?: boolean } = {}) {
  const getMock = jest.fn().mockResolvedValue({
    id: 1,
    modulePath: 'builtin/displayer',
    icon: options.icon !== undefined ? options.icon : null
  })

  const whereSelectMock = jest.fn().mockReturnValue({ get: getMock })
  const fromSelectMock = jest.fn().mockReturnValue({ where: whereSelectMock })
  const selectMock = jest.fn().mockReturnValue({ from: fromSelectMock })

  const whereUpdateMock = jest.fn().mockImplementation(() => {
    if (options.failUpdate) {
      return Promise.reject(new Error('db write failed'))
    }
    return Promise.resolve({})
  })
  const setUpdateMock = jest.fn().mockReturnValue({ where: whereUpdateMock })
  const updateMock = jest.fn().mockReturnValue({ set: setUpdateMock })

  const prepareMock = jest.fn().mockReturnValue({
    bind: (key: string) => ({
      first: async () => (state[key] !== undefined ? { value: state[key] } : null)
    })
  })

  return {
    select: selectMock,
    update: updateMock,
    $client: {
      prepare: prepareMock
    }
  } as any
}

function createImagesBinding(options: { throwOnOutput?: boolean } = {}) {
  const outputMock = jest.fn().mockImplementation(async () => {
    if (options.throwOnOutput) {
      throw new Error('transform failed')
    }

    return {
      contentType: () => 'image/webp',
      image: () => new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([11, 22, 33]))
          controller.close()
        }
      })
    }
  })

  const inputMock = jest.fn().mockReturnValue({ output: outputMock })
  const infoMock = jest.fn()
  return {
    binding: { input: inputMock, info: infoMock } as unknown as ImagesBinding,
    inputMock,
    infoMock,
    outputMock
  }
}


function strictPutMock() {
  return jest.fn().mockImplementation((_key: string, body: unknown) => {
    if (!(body instanceof ArrayBuffer)) {
      return Promise.reject(
        new Error(
          `R2.put requires a known-length ArrayBuffer body, got ${Object.prototype.toString.call(body)}`
        )
      )
    }
    return Promise.resolve({ etag: 'ok' })
  })
}

const OLD_ICON_URL = '/api/v1/image/plugin-images/1-100'
const OLD_ICON_KEY = 'plugin-images/1-100'

describe('PluginHandlers image compression', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(fileTypeFromBuffer as jest.Mock).mockResolvedValue({ ext: 'png', mime: 'image/png' })
  })

  test('compresses png to webp before uploading to R2', async () => {
    const drizzle = createDrizzle()
    const handlers = new PluginHandlers(drizzle)

    const images = createImagesBinding()
    const putMock = strictPutMock()

    const request = new Request('http://localhost/plugin/1/image', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    })

    const response = await handlers.uploadPluginIcon(1, '1', request, {
      R2: { put: putMock, delete: jest.fn() },
      IMAGES: images.binding
    }, true)

    expect(response.status).toBe(200)
    expect(images.inputMock).toHaveBeenCalledTimes(1)
    expect(putMock).toHaveBeenCalledTimes(1)
    expect(putMock.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer)
    expect(putMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        httpMetadata: { contentType: 'image/webp' }
      })
    )
  })

  test('falls back to original image when transform fails and fallback is enabled', async () => {
    const drizzle = createDrizzle({
      'image.compression.allow_original_fallback': 'true'
    })
    const handlers = new PluginHandlers(drizzle)

    const images = createImagesBinding({ throwOnOutput: true })
    const putMock = strictPutMock()

    const request = new Request('http://localhost/plugin/1/image', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    })

    const response = await handlers.uploadPluginIcon(1, '1', request, {
      R2: { put: putMock, delete: jest.fn() },
      IMAGES: images.binding
    }, true)

    expect(response.status).toBe(200)
    expect(images.inputMock).toHaveBeenCalledTimes(1)
    expect(putMock).toHaveBeenCalledTimes(1)
    expect(putMock.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer)
    expect(putMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        httpMetadata: { contentType: 'image/png' }
      })
    )
  })

  test('returns 503 when compression is disabled and fallback is disallowed', async () => {
    const drizzle = createDrizzle({
      'image.compression.enabled': 'false',
      'image.compression.allow_original_fallback': 'false'
    })
    const handlers = new PluginHandlers(drizzle)

    const images = createImagesBinding()
    const putMock = strictPutMock()

    const request = new Request('http://localhost/plugin/1/image', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    })

    const response = await handlers.uploadPluginIcon(1, '1', request, {
      R2: { put: putMock, delete: jest.fn() },
      IMAGES: images.binding
    }, true)

    const payload = await response.json() as { errorDescription?: string }

    expect(response.status).toBe(503)
    expect(payload.errorDescription).toBe('Image compression is disabled')
    expect(putMock).not.toHaveBeenCalled()
  })

  test('returns 503 when R2 binding is missing', async () => {
    const drizzle = createDrizzle()
    const handlers = new PluginHandlers(drizzle)

    const request = new Request('http://localhost/plugin/1/image', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    })

    const response = await handlers.uploadPluginIcon(1, '1', request, {
      IMAGES: createImagesBinding().binding
    }, true)

    const payload = await response.json() as { errorDescription?: string }
    expect(response.status).toBe(503)
    expect(payload.errorDescription).toBe('R2 storage not configured')
  })

  describe('icon swap keeps old object until new object and DB both succeed', () => {
    function makeUploadRequest(): Request {
      return new Request('http://localhost/plugin/1/image', {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: new Uint8Array([137, 80, 78, 71, 1, 2, 3])
      })
    }

    test('keeps old R2 object and DB reference when put throws', async () => {
      const drizzle = createDrizzle({}, { icon: OLD_ICON_URL })
      const handlers = new PluginHandlers(drizzle)

      const putMock = jest.fn().mockRejectedValue(new Error('r2 put exploded'))
      const deleteMock = jest.fn()

      const response = await handlers.uploadPluginIcon(1, '1', makeUploadRequest(), {
        R2: { put: putMock, delete: deleteMock },
        IMAGES: createImagesBinding().binding
      }, true)

      expect(response.status).toBe(500)
      expect(deleteMock).not.toHaveBeenCalled()
      expect(drizzle.update).not.toHaveBeenCalled()
    })

    test('keeps old R2 object and DB reference when put returns null', async () => {
      const drizzle = createDrizzle({}, { icon: OLD_ICON_URL })
      const handlers = new PluginHandlers(drizzle)

      const putMock = jest.fn().mockResolvedValue(null)
      const deleteMock = jest.fn()

      const response = await handlers.uploadPluginIcon(1, '1', makeUploadRequest(), {
        R2: { put: putMock, delete: deleteMock },
        IMAGES: createImagesBinding().binding
      }, true)

      expect(response.status).toBe(500)
      expect(deleteMock).not.toHaveBeenCalled()
      expect(drizzle.update).not.toHaveBeenCalled()
    })

    test('keeps old R2 object when the DB update fails', async () => {
      const drizzle = createDrizzle({}, { icon: OLD_ICON_URL, failUpdate: true })
      const handlers = new PluginHandlers(drizzle)

      const putMock = strictPutMock()
      const deleteMock = jest.fn()

      const response = await handlers.uploadPluginIcon(1, '1', makeUploadRequest(), {
        R2: { put: putMock, delete: deleteMock },
        IMAGES: createImagesBinding().binding
      }, true)

      expect(response.status).toBe(500)
      expect(putMock).toHaveBeenCalledTimes(1)
      expect(deleteMock).not.toHaveBeenCalled()
    })

    test('deletes the old object only after the new R2 object and DB update both succeed', async () => {
      const drizzle = createDrizzle({}, { icon: OLD_ICON_URL })
      const handlers = new PluginHandlers(drizzle)

      const putMock = strictPutMock()
      const deleteMock = jest.fn().mockResolvedValue(undefined)

      const response = await handlers.uploadPluginIcon(1, '1', makeUploadRequest(), {
        R2: { put: putMock, delete: deleteMock },
        IMAGES: createImagesBinding().binding
      }, true)

      expect(response.status).toBe(200)
      expect(putMock).toHaveBeenCalledTimes(1)
      expect(drizzle.update).toHaveBeenCalledTimes(1)
      expect(deleteMock).toHaveBeenCalledTimes(1)
      expect(deleteMock).toHaveBeenCalledWith(OLD_ICON_KEY)
      expect(deleteMock.mock.invocationCallOrder[0]).toBeGreaterThan(
        putMock.mock.invocationCallOrder[0]
      )
      expect(deleteMock.mock.invocationCallOrder[0]).toBeGreaterThan(
        (drizzle.update as jest.Mock).mock.invocationCallOrder[0]
      )
    })

    test('does not turn a successful swap into a failure when old object cleanup fails', async () => {
      const drizzle = createDrizzle({}, { icon: OLD_ICON_URL })
      const handlers = new PluginHandlers(drizzle)

      const putMock = strictPutMock()
      const deleteMock = jest.fn().mockRejectedValue(new Error('delete failed'))

      const response = await handlers.uploadPluginIcon(1, '1', makeUploadRequest(), {
        R2: { put: putMock, delete: deleteMock },
        IMAGES: createImagesBinding().binding
      }, true)

      expect(response.status).toBe(200)
      expect(deleteMock).toHaveBeenCalledTimes(1)
    })
  })
})
