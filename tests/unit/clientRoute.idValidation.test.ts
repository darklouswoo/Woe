const mockGetClient = jest.fn().mockResolvedValue(
  new Response(JSON.stringify({ id: 1, name: "device" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  })
);

jest.mock("../../src/drizzle/index.ts", () => ({
  createDrizzle: jest.fn(() => ({ __name: "drizzle-mock" }))
}));

jest.mock("../../src/middleware/auth.ts", () => ({
  Authenticator: jest.fn().mockImplementation(() => ({
    authenticateBasic: jest.fn().mockResolvedValue(null),
    authenticate: jest.fn().mockResolvedValue({ tokenType: "client", userId: 7, resourceId: 1 })
  }))
}));

jest.mock("../../src/handlers/clientHandlers.ts", () => ({
  ClientHandlers: jest.fn().mockImplementation(() => ({
    getAllClients: jest.fn(),
    createClient: jest.fn(),
    getClient: mockGetClient,
    updateClient: jest.fn(),
    updatePushState: jest.fn(),
    deleteClient: jest.fn()
  }))
}));

import { client } from "../../src/routes/client";

describe("client route id validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each(["abc", "0", "-1"])("returns 400 for invalid /client/%s id", async (id) => {
    const response = await client.fetch(
      new Request(`http://localhost/${id}`, {
        method: "GET",
        headers: {
          "x-gotify-key": "client-token"
        }
      }),
      {
        DB: {} as any
      } as any,
      {} as any
    );

    expect(response.status).toBe(400);
    expect(mockGetClient).not.toHaveBeenCalled();
  });
});
