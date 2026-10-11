jest.mock("file-type", () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true });

import { fileTypeFromBuffer } from "file-type";
import { PluginHandlers } from "../../src/handlers/pluginHandlers";

function createMockDrizzleForPluginUpload() {
  const getMock = jest.fn().mockResolvedValue({
    id: 1,
    modulePath: "builtin/displayer",
    icon: null
  });

  const whereMock = jest.fn().mockReturnValue({ get: getMock });
  const fromMock = jest.fn().mockReturnValue({ where: whereMock });
  const selectMock = jest.fn().mockReturnValue({ from: fromMock });

  return {
    select: selectMock
  } as any;
}

describe("PluginHandlers R2 availability", () => {
  test("returns 503 when uploading plugin icon without R2 binding", async () => {
    (fileTypeFromBuffer as jest.Mock).mockResolvedValue({ ext: "png", mime: "image/png" });

    const drizzle = createMockDrizzleForPluginUpload();
    const handlers = new PluginHandlers(drizzle);

    const request = new Request("http://localhost/plugin/1/image", {
      method: "POST",
      headers: {
        "content-type": "image/png"
      },
      body: new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    });

    const response = await handlers.uploadPluginIcon(1, "1", request, {}, true);
    const payload = await response.json() as { errorDescription?: string };

    expect(response.status).toBe(503);
    expect(payload.errorDescription).toBe("R2 storage not configured");
  });
});
