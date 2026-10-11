const mockGetPluginConfig = jest.fn().mockResolvedValue(
  new Response("{}", {
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
    authenticate: jest.fn().mockResolvedValue({ tokenType: "client", userId: 7, resourceId: 1, isAdmin: false })
  }))
}));

jest.mock("../../src/handlers/pluginHandlers.ts", () => ({
  PluginHandlers: jest.fn().mockImplementation(() => ({
    getAvailablePlugins: jest.fn(),
    getAllPlugins: jest.fn(),
    getPluginConfig: mockGetPluginConfig,
    updatePluginConfig: jest.fn(),
    enablePlugin: jest.fn(),
    disablePlugin: jest.fn(),
    getPluginDisplay: jest.fn(),
    getPluginLogs: jest.fn(),
    createPlugin: jest.fn(),
    deletePlugin: jest.fn(),
    updatePluginName: jest.fn(),
    uploadPluginIcon: jest.fn(),
    deletePluginIcon: jest.fn()
  }))
}));

import { plugin } from "../../src/routes/plugin";

describe("plugin route id validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each(["abc", "0", "-1"])("returns 400 for invalid /plugin/%s/config id", async (id) => {
    const response = await plugin.fetch(
      new Request(`http://localhost/${id}/config`, {
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
    expect(mockGetPluginConfig).not.toHaveBeenCalled();
  });
});
