import { fileTypeFromBuffer } from "file-type";

export const IMAGE_MAX_FILE_SIZE = 1 * 1024 * 1024;


const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp"
]);

const SVG_MIME_TYPE = "image/svg+xml";

export interface FileValidationError {
  valid: boolean;
  error?: string;
}

export interface RawImageValidationResult extends FileValidationError {
  buffer?: ArrayBuffer;
  mime?: string;
}

function normalizeMime(mime: string): string {
  const baseType = mime.split(";")[0].trim().toLowerCase();
  if (baseType === "image/jpg") return "image/jpeg";
  return baseType;
}

function maxSizeError(maxSize: number): string {
  const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(0);
  return `File size must be less than ${maxSizeMB}MB`;
}







export async function validateImageFile(
  file: Blob,
  maxSize: number = IMAGE_MAX_FILE_SIZE
): Promise<FileValidationError> {
  const declaredMime = normalizeMime(file.type || "");
  if (declaredMime === SVG_MIME_TYPE) {
    return { valid: false, error: "SVG images are not allowed" };
  }


  const arrayBuffer = await file.arrayBuffer();


  if (arrayBuffer.byteLength > maxSize) {
    return { valid: false, error: maxSizeError(maxSize) };
  }


  const fileType = await fileTypeFromBuffer(arrayBuffer);

  if (!fileType) {
    return { valid: false, error: "Unable to determine file type" };
  }

  const normalizedDetectedMime = normalizeMime(fileType.mime);
  if (!ALLOWED_IMAGE_TYPES.has(normalizedDetectedMime)) {
    return { valid: false, error: `File type ${normalizedDetectedMime} is not allowed. Only JPG, PNG, GIF, and WEBP images are allowed.` };
  }

  return { valid: true };
}





export async function validateRawImageRequest(
  request: Request,
  maxSize: number = IMAGE_MAX_FILE_SIZE
): Promise<RawImageValidationResult> {
  const contentType = request.headers.get("content-type") || "";
  const declaredMime = normalizeMime(contentType);

  if (!declaredMime.startsWith("image/")) {
    return { valid: false, error: "Content-Type must be image/*" };
  }

  if (declaredMime === SVG_MIME_TYPE) {
    return { valid: false, error: "SVG images are not allowed" };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > maxSize) {
      return { valid: false, error: maxSizeError(maxSize) };
    }
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxSize) {
    return { valid: false, error: maxSizeError(maxSize) };
  }

  const blob = new Blob([buffer], { type: declaredMime });
  const validation = await validateImageFile(blob, maxSize);
  if (!validation.valid) {
    return validation;
  }


  const detectedType = await fileTypeFromBuffer(buffer);
  if (!detectedType) {
    return { valid: false, error: "Unable to determine file type" };
  }
  const detectedMime = normalizeMime(detectedType.mime);
  if (detectedMime !== declaredMime) {
    return {
      valid: false,
      error: `Declared content type ${declaredMime} does not match detected file type ${detectedMime}`
    };
  }

  return {
    valid: true,
    buffer,
    mime: detectedMime
  };
}
