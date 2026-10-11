const mockGetApplication = jest.fn().mockResolvedValue(
  new Response(JSON.stringify({ id: 1, name: "app" }), {
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

jest.mock("../../src/handlers/applicationHandlers.ts", () => ({
  ApplicationHandlers: jest.fn().mockImplementation(() => ({
    getAllApplications: jest.fn(),
    createApplication: jest.fn(),
    getApplication: mockGetApplication,
    updateApplication: jest.fn(),
    deleteApplication: jest.fn(),
    uploadApplicationImage: jest.fn(),
    deleteApplicationImage: jest.fn()
  }))
}));

jest.mock("../../src/handlers/messageHandlers.ts", () => ({
  MessageHandlers: jest.fn().mockImplementation(() => ({
    getApplicationMessages: jest.fn(),
    deleteApplicationMessages: jest.fn()
  }))
}));

import { application } from "../../src/routes/application";

describe("application route id validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each(["abc", "0", "-1"])("returns 400 for invalid /application/%s id", async (id) => {
    const response = await application.fetch(
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
    expect(mockGetApplication).not.toHaveBeenCalled();
  });
});
