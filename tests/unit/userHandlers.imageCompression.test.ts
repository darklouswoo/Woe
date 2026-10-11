jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

import { fileTypeFromBuffer } from 'file-type'
import { UserHandlers } from '../../src/handlers/userHandlers'

function createUserDrizzle(state: Record<string, string> = {}, options: { failUpdate?: boolean } = {}) {
  const userGetMock = jest.fn().mockResolvedValue({ id: 1 })
  const selectWhereMock = jest.fn().mockReturnValue({ get: userGetMock })
  const selectFromMock = jest.fn().mockReturnValue({ where: selectWhereMock })
  const selectMock = jest.fn().mockReturnValue({ from: selectFromMock })

  const returningMock = jest.fn().mockImplementation(() => {
    if (options.failUpdate) {
      return Promise.reject(new Error('db write failed'))
    }
    return Promise.resolve([
      {
        id: 1,
        name: 'user',
        nickname: 'user',
        email: 'u@example.com',
        avatar: '/api/v1/image/user-avatars/1-123',
        description: '',
        admin: false,
        disabled: false
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

function createImagesBinding() {
  const outputMock = jest.fn().mockImplementation(async (opts: ImageOutputOptions) => ({
    contentType: () => opts.format,
    image: () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([5, 5, 5]))
        controller.close()
      }
    })
  }))

  const inputMock = jest.fn().mockReturnValue({ output: outputMock })
  return {
    binding: { input: inputMock, info: jest.fn() } as unknown as ImagesBinding,
    inputMock,
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

describe('UserHandlers image compression', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(fileTypeFromBuffer as jest.Mock).mockResolvedValue({ ext: 'gif', mime: 'image/gif' })
  })

  test('keeps gif format and preserves animation before storing avatar', async () => {
    const drizzle = createUserDrizzle()
    const handlers = new UserHandlers(drizzle)
    const images = createImagesBinding()
    const putMock = strictPutMock()

    const request = new Request('http://localhost/user/1/avatar', {
      method: 'POST',
      headers: { 'content-type': 'image/gif' },
      body: new Uint8Array([71, 73, 70, 56, 57, 97, 1, 2, 3])
    })

    const response = await handlers.uploadUserAvatar(1, 1, true, request, {
      R2: { put: putMock, delete: jest.fn() },
      IMAGES: images.binding
    })

    expect(response.status).toBe(200)
    expect(images.inputMock).toHaveBeenCalledTimes(1)
    expect(images.outputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'image/gif',
        anim: true
      })
    )
    expect(putMock).toHaveBeenCalledTimes(1)
    expect(putMock.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer)
    expect(putMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        httpMetadata: { contentType: 'image/gif' }
      })
    )
  })

  test('returns 503 when R2 binding is missing', async () => {
    const drizzle = createUserDrizzle()
    const handlers = new UserHandlers(drizzle)

    const request = new Request('http://localhost/user/1/avatar', {
      method: 'POST',
      headers: { 'content-type': 'image/gif' },
      body: new Uint8Array([71, 73, 70, 56, 57, 97, 1, 2, 3])
    })

    const response = await handlers.uploadUserAvatar(1, 1, true, request, {
      IMAGES: createImagesBinding().binding
    })

    const payload = await response.json() as { errorDescription?: string }
    expect(response.status).toBe(503)
    expect(payload.errorDescription).toBe('R2 storage not configured')
  })

  test('returns 500 and writes no DB reference when R2 put fails', async () => {
    const drizzle = createUserDrizzle()
    const handlers = new UserHandlers(drizzle)

    const putMock = jest.fn().mockRejectedValue(new Error('r2 put exploded'))

    const request = new Request('http://localhost/user/1/avatar', {
      method: 'POST',
      headers: { 'content-type': 'image/gif' },
      body: new Uint8Array([71, 73, 70, 56, 57, 97, 1, 2, 3])
    })

    const response = await handlers.uploadUserAvatar(1, 1, true, request, {
      R2: { put: putMock, delete: jest.fn() },
      IMAGES: createImagesBinding().binding
    })

    expect(response.status).toBe(500)
    expect(putMock).toHaveBeenCalledTimes(1)
    expect(drizzle.update).not.toHaveBeenCalled()
  })

  test('keeps the existing avatar reference when the DB update fails', async () => {
    const drizzle = createUserDrizzle({}, { failUpdate: true })
    const handlers = new UserHandlers(drizzle)

    const putMock = strictPutMock()
    const deleteMock = jest.fn()

    const request = new Request('http://localhost/user/1/avatar', {
      method: 'POST',
      headers: { 'content-type': 'image/gif' },
      body: new Uint8Array([71, 73, 70, 56, 57, 97, 1, 2, 3])
    })

    const response = await handlers.uploadUserAvatar(1, 1, true, request, {
      R2: { put: putMock, delete: deleteMock },
      IMAGES: createImagesBinding().binding
    })

    expect(response.status).toBe(500)
    expect(putMock).toHaveBeenCalledTimes(1)
    expect(deleteMock).not.toHaveBeenCalled()
  })
})
