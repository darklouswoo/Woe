















const mockAuthenticateBasic = jest.fn();
const mockAuthenticate = jest.fn();
const mockGetAllMessages = jest.fn();
const mockGetApplicationMessages = jest.fn();

jest.mock('../../src/drizzle/index.ts', () => ({
  createDrizzle: jest.fn(() => ({} as any)),
}));

jest.mock('../../src/middleware/auth.ts', () => ({
  Authenticator: jest.fn().mockImplementation(() => ({
    authenticateBasic: mockAuthenticateBasic,
    authenticate: mockAuthenticate,
  })),
  SESSION_NOT_ELEVATED_MESSAGE: 'session not elevated',
}));

jest.mock('../../src/handlers/messageHandlers.ts', () => ({
  MessageHandlers: jest.fn().mockImplementation(() => ({
    getAllMessages: mockGetAllMessages,
    getApplicationMessages: mockGetApplicationMessages,
  })),
  resolveMessageCreateTarget: jest.fn(),
}));




jest.mock('../../src/handlers/applicationHandlers.ts', () => ({
  ApplicationHandlers: jest.fn().mockImplementation(() => ({
    getAllApplications: jest.fn(),
    createApplication: jest.fn(),
    getApplication: jest.fn(),
    updateApplication: jest.fn(),
    deleteApplication: jest.fn(),
    uploadApplicationImage: jest.fn(),
    deleteApplicationImage: jest.fn(),
  })),
}));

import { ApiResponse } from '../../src/utils/response';
import { message } from '../../src/routes/message';
import { application } from '../../src/routes/application';

const USER_ID = 7;

const mockEnv: any = { DB: {} };
const mockExecutionCtx: any = { waitUntil: jest.fn() };


const ROUTES = [
  {
    name: 'GET /message',
    makePath: (query: string) => `/${query}`,
    fetchRoute: (path: string) => message.fetch(makeGetRequest(path), mockEnv, mockExecutionCtx),
    handler: mockGetAllMessages,
    expectHandlerCalledWith: (limit: number, since: number) =>
      expect(mockGetAllMessages).toHaveBeenCalledWith(USER_ID, limit, since),
  },
  {
    name: 'GET /application/:id/message',
    makePath: (query: string) => `/42/message${query}`,
    fetchRoute: (path: string) => application.fetch(makeGetRequest(path), mockEnv, mockExecutionCtx),
    handler: mockGetApplicationMessages,
    expectHandlerCalledWith: (limit: number, since: number) =>
      expect(mockGetApplicationMessages).toHaveBeenCalledWith(USER_ID, '42', limit, since),
  },
];

function makeGetRequest(path: string) {
  return new Request(`http://localhost${path}`, {
    method: 'GET',
    headers: { 'x-gotify-key': 'Cclient-token' },
  });
}


const VALID_CASES: Array<[string, number, number]> = [
  ['?', 100, 0],
  ['?limit=1', 1, 0],
  ['?limit=100', 100, 0],
  ['?limit=200', 200, 0],
  ['?limit=002', 2, 0],
  ['?limit=%2B2', 2, 0],
  ['?since=0', 100, 0],
  ['?since=42', 100, 42],
  ['?since=', 100, 0],
  ['?since=000', 100, 0],
  ['?limit=5&limit=abc', 5, 0],
  ['?since=42&since=abc', 100, 42],
];


const INVALID_LIMIT_CASES = [
  '?limit=abc',
  '?limit=1.5',
  '?limit=10abc',
  '?limit=1e2',
  '?limit=',
  '?limit=0',
  '?limit=-1',
  '?limit=201',
  '?limit=%2B201',
  '?limit=%205',
  '?limit=+5',
  '?limit=9007199254740993',
  '?limit=abc&limit=5',
];


const INVALID_SINCE_CASES = [
  '?since=abc',
  '?since=-1',
  '?since=1.5',
  '?since=10abc',
  '?since=9007199254740992',
  '?since=%2B42',
  '?since=%2042',
  '?since=42%20',
  '?since=abc&since=42',
];

const LIMIT_ERROR_BODY = {
  error: 'Bad Request',
  errorCode: 400,
  errorDescription: 'Invalid limit parameter: must be an integer between 1 and 200',
};

const SINCE_ERROR_BODY = {
  error: 'Bad Request',
  errorCode: 400,
  errorDescription: 'Invalid since parameter: must be a non-negative integer',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthenticateBasic.mockResolvedValue(null);
  mockAuthenticate.mockResolvedValue({ userId: USER_ID, tokenType: 'client' });

  const passthrough = Promise.resolve(ApiResponse.json({ paging: {}, messages: [] }));
  mockGetAllMessages.mockReturnValue(passthrough);
  mockGetApplicationMessages.mockReturnValue(passthrough);
});

describe.each(ROUTES)('%s：分页参数表', ({ makePath, fetchRoute, handler, expectHandlerCalledWith }) => {
  test.each(VALID_CASES)('%s => 200，handler 收到 (%d, %d)', async (query, limit, since) => {
    const response = await fetchRoute(makePath(query));

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expectHandlerCalledWith(limit, since);
  });

  test.each(INVALID_LIMIT_CASES)('%s => 400 limit 错误，handler 不被调用', async (query) => {
    const response = await fetchRoute(makePath(query));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(LIMIT_ERROR_BODY);
    expect(handler).not.toHaveBeenCalled();
  });

  test.each(INVALID_SINCE_CASES)('%s => 400 since 错误，handler 不被调用', async (query) => {
    const response = await fetchRoute(makePath(query));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(SINCE_ERROR_BODY);
    expect(handler).not.toHaveBeenCalled();
  });
});
