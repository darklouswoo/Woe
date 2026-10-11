jest.mock("file-type", () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true });

import { fileTypeFromBuffer } from "file-type";
import { IMAGE_MAX_FILE_SIZE, validateRawImageRequest } from "../../src/utils/fileValidation";

const mockFileTypeFromBuffer = fileTypeFromBuffer as jest.Mock;

describe("validateRawImageRequest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("rejects raw image/* payload when body is not a real image", async () => {
    mockFileTypeFromBuffer.mockResolvedValue(undefined);

    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: {
        "content-type": "image/png"
      },
      body: "this-is-not-a-real-png"
    });

    const result = await validateRawImageRequest(request);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("rejects raw image/* payload larger than max size", async () => {
    mockFileTypeFromBuffer.mockResolvedValue({ ext: "png", mime: "image/png" });

    const body = new Uint8Array(IMAGE_MAX_FILE_SIZE + 1);
    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "content-length": String(body.byteLength)
      },
      body
    });

    const result = await validateRawImageRequest(request);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("less than 1MB");
    expect(mockFileTypeFromBuffer).not.toHaveBeenCalled();
  });

  test("rejects SVG uploads explicitly", async () => {
    mockFileTypeFromBuffer.mockResolvedValue({ ext: "svg", mime: "image/svg+xml" });

    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: {
        "content-type": "image/svg+xml"
      },
      body: "<svg xmlns='http://www.w3.org/2000/svg'></svg>"
    });

    const result = await validateRawImageRequest(request);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("SVG");
    expect(mockFileTypeFromBuffer).not.toHaveBeenCalled();
  });
});
