import { ApplicationHandlers } from '../../src/handlers/applicationHandlers'

jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

function createApplicationHandlersDrizzleMock(options?: {
  listRows?: Array<Record<string, unknown>>
  createdRow?: Record<string, unknown>
  updatedRow?: Record<string, unknown>
}) {
  const listRows = options?.listRows ?? []
  let insertedValues: Record<string, unknown> | undefined
  let updatedValues: Record<string, unknown> | undefined

  const orderByMock = jest.fn().mockResolvedValue(listRows)
  const whereListMock = jest.fn().mockReturnValue({ orderBy: orderByMock })
  const fromListMock = jest.fn().mockReturnValue({ where: whereListMock })
  const selectMock = jest.fn().mockReturnValue({ from: fromListMock })

  const insertReturningMock = jest.fn().mockImplementation(async () => [
    options?.createdRow ?? {
      id: 1,
      userId: 7,
      token: 'A-created-token',
      name: insertedValues?.name ?? 'App A',
      description: insertedValues?.description ?? '',
      defaultPriority: insertedValues?.defaultPriority ?? 0,
      sortKey: insertedValues?.sortKey,
      image: '',
      internal: false,
      lastUsed: null
    }
  ])

  const insertValuesMock = jest.fn().mockImplementation((payload: Record<string, unknown>) => {
    insertedValues = payload
    return { returning: insertReturningMock }
  })

  const updateReturningMock = jest.fn().mockImplementation(async () => [
    options?.updatedRow ?? {
      id: 1,
      userId: 7,
      token: 'A-updated-token',
      name: 'Updated App',
      description: '',
      defaultPriority: 0,
      sortKey: updatedValues?.sortKey ?? 'updated-key',
      image: '',
      internal: false,
      lastUsed: null
    }
  ])
  const updateWhereMock = jest.fn().mockReturnValue({ returning: updateReturningMock })
  const updateSetMock = jest.fn().mockImplementation((payload: Record<string, unknown>) => {
    updatedValues = payload
    return { where: updateWhereMock }
  })
  const updateMock = jest.fn().mockReturnValue({ set: updateSetMock })

  const drizzle = {
    select: selectMock,
    insert: jest.fn().mockReturnValue({ values: insertValuesMock }),
    update: updateMock
  }

  return {
    drizzle,
    selectMock,
    whereListMock,
    orderByMock,
    insertValuesMock,
    updateSetMock
  }
}

describe('ApplicationHandlers sortKey', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('createApplication returns a non-empty sortKey when omitted', async () => {
    const { drizzle, insertValuesMock } = createApplicationHandlersDrizzleMock()
    const handlers = new ApplicationHandlers(drizzle as any)

    const response = await handlers.createApplication(7, 'App A', 'desc', 1)
    const body = await response.json() as { sortKey: string }

    expect(response.status).toBe(200)
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      sortKey: expect.any(String)
    }))
    expect(body.sortKey).toEqual(expect.any(String))
    expect(body.sortKey.length).toBeGreaterThan(0)
  })

  test('createApplication preserves explicit sortKey', async () => {
    const { drizzle, insertValuesMock } = createApplicationHandlersDrizzleMock()
    const handlers = new ApplicationHandlers(drizzle as any)

    const response = await handlers.createApplication(7, 'App B', 'desc', 2, 'custom-key')
    const body = await response.json() as { sortKey: string }

    expect(response.status).toBe(200)
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      sortKey: 'custom-key'
    }))
    expect(body.sortKey).toBe('custom-key')
  })

  test('updateApplication updates sortKey when provided', async () => {
    const { drizzle, updateSetMock } = createApplicationHandlersDrizzleMock()
    const handlers = new ApplicationHandlers(drizzle as any)

    const response = await handlers.updateApplication(7, '1', { sortKey: 'new-key' })
    const body = await response.json() as { sortKey: string }

    expect(response.status).toBe(200)
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      sortKey: 'new-key'
    }))
    expect(body.sortKey).toBe('new-key')
  })

  test('getAllApplications includes sortKey and orders by sortKey then id', async () => {
    const { drizzle, orderByMock } = createApplicationHandlersDrizzleMock({
      listRows: [
        {
          id: 2,
          userId: 7,
          token: 'A-2',
          name: 'B',
          description: '',
          defaultPriority: 0,
          sortKey: 'b',
          image: '',
          internal: false,
          lastUsed: null
        },
        {
          id: 1,
          userId: 7,
          token: 'A-1',
          name: 'A',
          description: '',
          defaultPriority: 0,
          sortKey: 'a',
          image: '',
          internal: false,
          lastUsed: null
        }
      ]
    })
    const handlers = new ApplicationHandlers(drizzle as any)

    const response = await handlers.getAllApplications(7)
    const body = await response.json() as Array<{ id: number; sortKey: string }>

    expect(response.status).toBe(200)
    expect(body).toEqual([
      expect.objectContaining({ id: 2, sortKey: 'b' }),
      expect.objectContaining({ id: 1, sortKey: 'a' })
    ])
    expect(orderByMock).toHaveBeenCalledTimes(1)
    expect(orderByMock.mock.calls[0].length).toBe(2)
  })
})
