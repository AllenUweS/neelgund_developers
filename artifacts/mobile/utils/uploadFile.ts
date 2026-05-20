import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { getPublicStorageUrl, uploadFileToStorage } from "@/lib/api";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export type UploadedFile = {
  objectPath: string;
  name: string;
  mimeType: string;
};

export class UploadFileError extends Error {
  code: "file_too_large" | "invalid_file" | "upload_failed";

  constructor(code: "file_too_large" | "invalid_file" | "upload_failed", message: string) {
    super(message);
    this.code = code;
  }
}

function sanitizeFileName(name: string): string {
  const normalized = name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "");
  return normalized || "upload.bin";
}

export async function pickAndUploadFile(_domain: string): Promise<UploadedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    copyToCacheDirectory: true,
  });

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  const originalName = asset.name;
  const name = sanitizeFileName(originalName);
  const mimeType = asset.mimeType ?? "application/octet-stream";
  const uri = asset.uri;
  const size = asset.size ?? null;

  if (!uri) {
    throw new UploadFileError("invalid_file", "Selected file is invalid.");
  }
  if (size !== null && size > MAX_UPLOAD_BYTES) {
    const limitMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
    throw new UploadFileError("file_too_large", `File is too large. Max allowed size is ${limitMb} MB.`);
  }

  const objectPath = `uploads/${Date.now()}-${name}`;

  try {
    if (Platform.OS === "web") {
      const fileRes = await fetch(uri);
      const blob = await fileRes.blob();
      await uploadFileToStorage(objectPath, blob, mimeType);
    } else {
      // Native-safe upload path: read local file as base64 and convert via data URI.
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const dataUri = `data:${mimeType};base64,${base64}`;
      const fileRes = await fetch(dataUri);
      const blob = await fileRes.blob();
      await uploadFileToStorage(objectPath, blob, mimeType);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upload file";
    throw new UploadFileError("upload_failed", message);
  }

  return { objectPath, name: originalName, mimeType };
}

export function resolveDocURL(url: string, _domain: string): string {
  if (!url) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return getPublicStorageUrl(url);
}
