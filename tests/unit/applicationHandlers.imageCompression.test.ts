jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

import { fileTypeFromBuffer } from 'file-type'
import { ApplicationHandlers } from '../../src/handlers/applicationHandlers'

function createApplicationDrizzle(state: Record<string, string> = {}, options: { failUpdate?: boolean } = {}) {
  const appGetMock = jest.fn().mockResolvedValue({ id: 1, userId: 1 })
  const selectWhereMock = jest.fn().mockReturnValue({ get: appGetMock })
  const selectFromMock = jest.fn().mockReturnValue({ where: selectWhereMock })
  const selectMock = jest.fn().mockReturnValue({ from: selectFromMock })

  const returningMock = jest.fn().mockImplementation(() => {
    if (options.failUpdate) {
      return Promise.reject(new Error('db write failed'))
    }
    return Promise.resolve([
      {
        id: 1,
        userId: 1,
        token: 'A-token',
        name: 'Test App',
        description: '',
        defaultPriority: 0,
        image: '/api/v1/image/app-images/1-123',
        internal: false,
        lastUsed: null
      }
    ])
  })
  const whereUpdateMock = jest.fn().mockReturnValue({ returning: returningMock })
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
    $client: { prepare: prepareMock }
  } as any
}

function createImagesBinding(options: { throwOnOutput?: boolean } = {}) {
  const outputMock = jest.fn().mockImplementation(async (opts: ImageOutputOptions) => {
    if (options.throwOnOutput) {
      throw new Error('transform failed')
    }

    return {
      contentType: () => opts.format,
      image: () => new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([9, 9, 9]))
          controller.close()
        }
      })
    }
  })

  const inputMock = jest.fn().mockReturnValue({ output: outputMock })
  return {
    binding: { input: inputMock, info: jest.fn() } as unknown as ImagesBinding,
    inputMock
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

describe('ApplicationHandlers image compression', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(fileTypeFromBuffer as jest.Mock).mockResolvedValue({ ext: 'png', mime: 'image/png' })
  })

  test('compresses png to webp before storing application image', async () => {
    const drizzle = createApplicationDrizzle()
    const handlers = new ApplicationHandlers(drizzle)
    const images = createImagesBinding()
    const putMock = strictPutMock()

    const request = new Request('http://localhost/application/1/image', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    })

    const response = await handlers.uploadApplicationImage(1, '1', true, request, {
      R2: { put: putMock, delete: jest.fn() },
      IMAGES: images.binding
    })

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

  test('returns 503 when compression is disabled and fallback is disallowed', async () => {
    const drizzle = createApplicationDrizzle({
      'image.compression.enabled': 'false',
      'image.compression.allow_original_fallback': 'false'
    })
    const handlers = new ApplicationHandlers(drizzle)
    const images = createImagesBinding()
    const putMock = jest.fn().mockResolvedValue({ etag: 'ok' })

    const request = new Request('http://localhost/application/1/image', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    })

    const response = await handlers.uploadApplicationImage(1, '1', true, request, {
      R2: { put: putMock, delete: jest.fn() },
      IMAGES: images.binding
    })

    const payload = await response.json() as { errorDescription?: string }
    expect(response.status).toBe(503)
    expect(payload.errorDescription).toBe('Image compression is disabled')
    expect(putMock).not.toHaveBeenCalled()
  })

  test('returns 503 when R2 binding is missing', async () => {
    const drizzle = createApplicationDrizzle()
    const handlers = new ApplicationHandlers(drizzle)

    const request = new Request('http://localhost/application/1/image', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    })

    const response = await handlers.uploadApplicationImage(1, '1', true, request, {
      IMAGES: createImagesBinding().binding
    })

    const payload = await response.json() as { errorDescription?: string }
    expect(response.status).toBe(503)
    expect(payload.errorDescription).toBe('R2 storage not configured')
  })

  test('returns 500 and writes no DB reference when R2 put fails', async () => {
    const drizzle = createApplicationDrizzle()
    const handlers = new ApplicationHandlers(drizzle)

    const putMock = jest.fn().mockRejectedValue(new Error('r2 put exploded'))

    const request = new Request('http://localhost/application/1/image', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    })

    const response = await handlers.uploadApplicationImage(1, '1', true, request, {
      R2: { put: putMock, delete: jest.fn() },
      IMAGES: createImagesBinding().binding
    })

    expect(response.status).toBe(500)
    expect(putMock).toHaveBeenCalledTimes(1)
    expect(drizzle.update).not.toHaveBeenCalled()
  })

  test('keeps the existing image reference when the DB update fails', async () => {
    const drizzle = createApplicationDrizzle({}, { failUpdate: true })
    const handlers = new ApplicationHandlers(drizzle)

    const putMock = strictPutMock()
    const deleteMock = jest.fn()

    const request = new Request('http://localhost/application/1/image', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    })

    const response = await handlers.uploadApplicationImage(1, '1', true, request, {
      R2: { put: putMock, delete: deleteMock },
      IMAGES: createImagesBinding().binding
    })

    expect(response.status).toBe(500)
    expect(putMock).toHaveBeenCalledTimes(1)
    expect(deleteMock).not.toHaveBeenCalled()
  })
})
