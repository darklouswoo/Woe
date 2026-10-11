import { DrizzleDB } from "../drizzle/index.ts";
import { Env } from "../types/index.ts";
import { IMAGE_MAX_OUTPUT_BYTES, readBoundedImageStream } from "../utils/readBoundedImageStream.ts";

const DEFAULT_WEBP_QUALITY = 85;
const DEFAULT_GIF_QUALITY = 75;

interface CompressionPolicy {
  enabled: boolean;
  allowOriginalFallback: boolean;
  webpQuality: number;
  gifQuality: number;
}

export interface CompressionResult {

  body: ArrayBuffer;
  contentType: string;
  usedFallback: boolean;
}

export class ImageCompressionError extends Error {
  constructor(
    public readonly status: number,
    public readonly publicMessage: string,
    public readonly code: "DISABLED" | "MISSING_BINDING" | "FAILED"
  ) {
    super(publicMessage);
    this.name = "ImageCompressionError";
  }
}

export class ImageCompressionService {
  constructor(private drizzle: DrizzleDB, private env: Env) {}

  private async getStateValue(key: string): Promise<string | null> {
    try {
      const row = await this.drizzle.$client
        .prepare("SELECT value FROM system_state WHERE key = ? LIMIT 1")
        .bind(key)
        .first<{ value: string }>();
      return row?.value ?? null;
    } catch {
      return null;
    }
  }

  private async getBoolState(key: string, fallback: boolean): Promise<boolean> {
    const value = await this.getStateValue(key);
    if (!value) return fallback;

    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true") return true;
    if (normalized === "0" || normalized === "false") return false;

    console.warn(`[image-compression] Invalid boolean for ${key}: ${value}, fallback=${String(fallback)}`);
    return fallback;
  }

  private async getQualityState(key: string, fallback: number): Promise<number> {
    const value = await this.getStateValue(key);
    if (!value) return fallback;

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
      console.warn(`[image-compression] Invalid quality for ${key}: ${value}, fallback=${String(fallback)}`);
      return fallback;
    }

    return parsed;
  }

  private async getPolicy(): Promise<CompressionPolicy> {
    return {
      enabled: await this.getBoolState("image.compression.enabled", true),
      allowOriginalFallback: await this.getBoolState("image.compression.allow_original_fallback", false),
      webpQuality: await this.getQualityState("image.compression.quality.webp", DEFAULT_WEBP_QUALITY),
      gifQuality: await this.getQualityState("image.compression.quality.gif", DEFAULT_GIF_QUALITY),
    };
  }

  private normalizeMime(mime: string): string {
    const baseType = mime.split(";")[0].trim().toLowerCase();
    if (baseType === "image/jpg") return "image/jpeg";
    return baseType;
  }

  private resolveOutput(mime: string, policy: CompressionPolicy): ImageOutputOptions {
    const normalized = this.normalizeMime(mime);

    if (normalized === "image/gif") {
      return {
        format: "image/gif",
        quality: policy.gifQuality,
        anim: true,
      };
    }

    return {
      format: "image/webp",
      quality: policy.webpQuality,
    };
  }

  private toReadableStream(buffer: ArrayBuffer): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(buffer));
        controller.close();
      },
    });
  }

  async processImage(input: ArrayBuffer, inputMime: string): Promise<CompressionResult> {
    const policy = await this.getPolicy();
    const normalizedInputMime = this.normalizeMime(inputMime);

    if (!policy.enabled) {
      if (policy.allowOriginalFallback) {
        return {
          body: input,
          contentType: normalizedInputMime,
          usedFallback: true,
        };
      }

      throw new ImageCompressionError(503, "Image compression is disabled", "DISABLED");
    }

    if (!this.env.IMAGES) {
      if (policy.allowOriginalFallback) {
        return {
          body: input,
          contentType: normalizedInputMime,
          usedFallback: true,
        };
      }

      throw new ImageCompressionError(503, "Image compression service not configured", "MISSING_BINDING");
    }

    try {
      const outputOptions = this.resolveOutput(normalizedInputMime, policy);
      const result = await this.env.IMAGES
        .input(this.toReadableStream(input))
        .output(outputOptions);


      const bufferedBody = await readBoundedImageStream(result.image(), IMAGE_MAX_OUTPUT_BYTES);

      return {
        body: bufferedBody,
        contentType: result.contentType() || outputOptions.format,
        usedFallback: false,
      };
    } catch (error) {
      if (policy.allowOriginalFallback) {
        console.warn(`[image-compression] Transform failed, fallback to original: ${error instanceof Error ? error.message : "unknown error"}`);
        return {
          body: input,
          contentType: normalizedInputMime,
          usedFallback: true,
        };
      }

      throw new ImageCompressionError(500, "Image compression failed", "FAILED");
    }
  }
}
