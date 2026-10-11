
















const mockAuthenticateBasic = jest.fn();
const mockAuthenticate = jest.fn();

const mockDrizzle: any = {
  select: jest.fn(),
};

jest.mock("../../src/drizzle/index.ts", () => ({
  createDrizzle: jest.fn(() => mockDrizzle),
}));

jest.mock("../../src/middleware/auth.ts", () => ({
  Authenticator: jest.fn().mockImplementation(() => ({
    authenticateBasic: mockAuthenticateBasic,
    authenticate: mockAuthenticate,
  })),
  SESSION_NOT_ELEVATED_MESSAGE: "session not elevated",
}));




jest.mock("../../src/handlers/applicationHandlers.ts", () => ({
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

import { message } from "../../src/routes/message";
import { application } from "../../src/routes/application";


function createPagedMessagesDrizzleMock(rows: Array<Record<string, unknown>>) {
  const executeMock = jest.fn().mockResolvedValue(rows);
  const limitMock = jest.fn().mockReturnValue({ execute: executeMock });
  const orderByMock = jest.fn().mockReturnValue({ limit: limitMock });
  const whereMock = jest.fn().mockReturnValue({ orderBy: orderByMock });
  const fromMock = jest.fn().mockReturnValue({ where: whereMock });
  const selectMock = jest.fn().mockReturnValue({ from: fromMock });

  return {
    drizzle: {
      select: selectMock,
    },
  };
}

function messageRow(id: number, appId = 42) {
  return {
    id,
    userId: 7,
    appId,
    message: `m-${id}`,
    title: "",
    priority: 0,
    date: "2026-04-03T12:00:00.000Z",
    expires: null,
    extras: null,
  };
}

const mockEnv: any = { DB: {} };
const mockExecutionCtx: any = { waitUntil: jest.fn() };

function makeGetRequest(path: string) {
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: { "x-gotify-key": "Cclient-token" },
  });
}

describe("paging.next 相对路径", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticateBasic.mockResolvedValue(null);
    mockAuthenticate.mockResolvedValue({ userId: 7, tokenType: "client" });
  });

  it("GET /message 响应 paging.next 为相对路径", async () => {

    const paged = createPagedMessagesDrizzleMock([messageRow(21), messageRow(20)]);
    mockDrizzle.select.mockImplementation(paged.drizzle.select);

    const response = await message.fetch(
      makeGetRequest("/?limit=1"),
      mockEnv,
      mockExecutionCtx
    );
    const body = (await response.json()) as {
      paging: { size: number; limit: number; since: number; next?: string };
    };

    expect(response.status).toBe(200);
    expect(body.paging.size).toBe(1);
    expect(body.paging.next).toBeDefined();
    expect(body.paging.next).toMatch(/^\/message\?limit=1&since=\d+$/);
    expect(body.paging.next!.startsWith("http")).toBe(false);
  });

  it("GET /application/:id/message 响应 paging.next 为相对路径", async () => {
    const paged = createPagedMessagesDrizzleMock([messageRow(31), messageRow(30)]);
    mockDrizzle.select.mockImplementation(paged.drizzle.select);

    const response = await application.fetch(
      makeGetRequest("/42/message?limit=1"),
      mockEnv,
      mockExecutionCtx
    );
    const body = (await response.json()) as {
      paging: { size: number; limit: number; since: number; next?: string };
    };

    expect(response.status).toBe(200);
    expect(body.paging.size).toBe(1);
    expect(body.paging.next).toBeDefined();
    expect(body.paging.next).toMatch(/^\/application\/\d+\/message\?limit=1&since=\d+$/);
    expect(body.paging.next!.startsWith("http")).toBe(false);
  });
});










const P3_ROUTES = [
  {
    name: "GET /message",
    makePath: (query: string) => `/${query}`,
    fetchRoute: (path: string) => message.fetch(makeGetRequest(path), mockEnv, mockExecutionCtx),
    nextPath: (limit: number, since: number) => `/message?limit=${limit}&since=${since}`,
  },
  {
    name: "GET /application/:id/message",
    makePath: (query: string) => `/42/message${query}`,
    fetchRoute: (path: string) => application.fetch(makeGetRequest(path), mockEnv, mockExecutionCtx),
    nextPath: (limit: number, since: number) => `/application/42/message?limit=${limit}&since=${since}`,
  },
];


async function readPaging(
  fetchRoute: (path: string) => Response | Promise<Response>,
  path: string
): Promise<{ status: number; size: number; since: number; next?: string }> {
  const response = await fetchRoute(path);
  const body = (await response.json()) as {
    paging: { size: number; limit: number; since: number; next?: string };
  };
  return { status: response.status, size: body.paging.size, since: body.paging.since, next: body.paging.next };
}

describe.each(P3_ROUTES)("末页 paging.since（%s）", (route) => {
  it("(a) 少于 limit 的末页 => since=0 且无 next", async () => {
    const paged = createPagedMessagesDrizzleMock([messageRow(21), messageRow(20)]);
    mockDrizzle.select.mockImplementation(paged.drizzle.select);

    const paging = await readPaging(route.fetchRoute, route.makePath("?limit=5"));

    expect(paging.status).toBe(200);
    expect(paging.size).toBe(2);
    expect(paging.since).toBe(0);
    expect(paging.next).toBeUndefined();
  });

  it("(b) 恰好 limit 行但无下一页 => since=0 且无 next", async () => {
    const paged = createPagedMessagesDrizzleMock([messageRow(21), messageRow(20)]);
    mockDrizzle.select.mockImplementation(paged.drizzle.select);

    const paging = await readPaging(route.fetchRoute, route.makePath("?limit=2"));

    expect(paging.status).toBe(200);
    expect(paging.size).toBe(2);
    expect(paging.since).toBe(0);
    expect(paging.next).toBeUndefined();
  });

  it("(c) 存在下一页 => since=末条 ID 且 next 为相对路径", async () => {
    const paged = createPagedMessagesDrizzleMock([messageRow(21), messageRow(20), messageRow(19)]);
    mockDrizzle.select.mockImplementation(paged.drizzle.select);

    const paging = await readPaging(route.fetchRoute, route.makePath("?limit=2"));

    expect(paging.status).toBe(200);
    expect(paging.size).toBe(2);
    expect(paging.since).toBe(20);
    expect(paging.next).toBe(route.nextPath(2, 20));
  });

  it("(d) 空页且请求 since 非零 => since=0 且无 next（不回显请求 since）", async () => {
    const paged = createPagedMessagesDrizzleMock([]);
    mockDrizzle.select.mockImplementation(paged.drizzle.select);

    const paging = await readPaging(route.fetchRoute, route.makePath("?limit=10&since=999"));

    expect(paging.status).toBe(200);
    expect(paging.size).toBe(0);
    expect(paging.since).toBe(0);
    expect(paging.next).toBeUndefined();
  });
});
