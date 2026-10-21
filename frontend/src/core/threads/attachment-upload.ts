import {
  promptInputFilePartToFile,
  uploadFiles,
  type PromptInputMessage,
  type UploadedFileInfo,
} from "@/core/uploads";

/** Exported for tests: the attach-time-upload reuse path is worth pinning. */
export async function uploadPromptInputFiles(
  threadId: string,
  fileParts: PromptInputMessage["files"],
): Promise<Record<string, unknown>[]> {
  if (fileParts.length === 0) return [];
  const sourceFiles = await Promise.all(
    fileParts.map((part) => promptInputFilePartToFile(part)),
  );
  const files = sourceFiles.filter((file): file is File => file instanceof File);
  if (files.length === 0) return fallbackFileAttachments(fileParts);
  // The composer now uploads on attach, so by send time the bytes are usually
  // already on the server. Re-posting them would double the wait and mint a
  // second artifact for the same picture.
  const preUploaded = fileParts
    .map((part) => part.uploaded)
    .filter((info): info is UploadedFileInfo => !!info);
  const reuseUploads = preUploaded.length === fileParts.length;
  const result =
    reuseUploads
      ? { files: preUploaded }
      : await uploadFiles(threadId, files);

  // Hosted upload gives us a server-side path/URL. For image-typed
  // attachments we ALSO embed a base64 data URL so the backend can
  // build OpenAI image_url content blocks for vision models without
  // having to re-fetch the artifact.
  // The upload response preserves request order. Filenames are display names,
  // not identities: two photos from different folders may have the same name.
  const attachmentFiles = reuseUploads ? sourceFiles : files;
  const enriched = await Promise.all(
    result.files.map(async (uploaded, index) => {
      const base = uploadedFileToAttachment(uploaded);
      const file = attachmentFiles[index];
      if (!file || !isImageMime(file.type)) return base;
      const dataUrl = await readFileAsDataUrl(file).catch(() => null);
      return dataUrl
        ? { ...base, mediaType: file.type, data_url: dataUrl }
        : base;
    }),
  );
  return enriched;
}

function uploadedFileToAttachment(
  file: UploadedFileInfo,
): Record<string, unknown> {
  return {
    filename: file.filename,
    size: file.size,
    path: file.path,
    virtual_path: file.virtual_path,
    artifact_url: file.artifact_url,
    extension: file.extension,
    modified: file.modified,
    extracted_text: file.extracted_text ?? null,
  };
}

function fallbackFileAttachments(
  fileParts: PromptInputMessage["files"],
): Record<string, unknown>[] {
  return fileParts.map((part) => ({
    filename: part.filename,
    mediaType: part.mediaType,
    url: part.url,
  }));
}

/**
 * Variant of fallbackFileAttachments used when the runtime hasn't
 * created the thread yet. We can't upload to the artifact store, but
 * we CAN base64-encode any image attachments inline so the model sees
 * them on the very first turn.
 */
export async function fallbackFileAttachmentsAsync(
  fileParts: PromptInputMessage["files"],
): Promise<Record<string, unknown>[]> {
  return Promise.all(
    fileParts.map(async (part) => {
      const base: Record<string, unknown> = {
        filename: part.filename,
        mediaType: part.mediaType,
        url: part.url,
      };
      if (!isImageMime(part.mediaType)) return base;
      const file = await promptInputFilePartToFile(part);
      if (!(file instanceof File)) return base;
      const dataUrl = await readFileAsDataUrl(file).catch(() => null);
      return dataUrl ? { ...base, data_url: dataUrl } : base;
    }),
  );
}

function isImageMime(mediaType: string | undefined | null): boolean {
  return (
    typeof mediaType === "string" &&
    mediaType.toLowerCase().startsWith("image/")
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("FileReader returned non-string"));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

export async function extractImageFiles(
  fileParts: PromptInputMessage["files"],
): Promise<File[]> {
  const recovered = await Promise.all(
    fileParts.map((part) => promptInputFilePartToFile(part)),
  );
  return recovered.filter(
    (file): file is File =>
      file instanceof File && isImageMime(file.type || "image/*"),
  );
}
