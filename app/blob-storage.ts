import { del, get, put } from "@vercel/blob";

type BlobAccess = "public" | "private";

function token() {
  const value = process.env.BLOB_READ_WRITE_TOKEN;
  if (!value) throw new Error("BLOB_READ_WRITE_TOKEN is not configured.");
  return value;
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function isAccessMismatch(cause: unknown, access: BlobAccess) {
  const detail = message(cause).toLowerCase();
  return detail.includes(`cannot use ${access} access`) && detail.includes("store");
}

/**
 * Vercel binds a token to one Blob store and requires put() to declare the
 * matching access mode. Try public first (the normal ReportFlow setup), then
 * transparently fall back to private when Vercel supplied a private-store
 * token. This keeps deployments working even if the store connection changes.
 */
export async function putReportBlob(
  pathname: string,
  body: File | ArrayBuffer,
  contentType: string,
) {
  const credential = token();
  const options = {
    addRandomSuffix: false,
    contentType,
    token: credential,
  } as const;

  try {
    return await put(pathname, body, { ...options, access: "public" });
  } catch (cause) {
    if (!isAccessMismatch(cause, "public")) throw cause;
    return put(pathname, body, { ...options, access: "private" });
  }
}

/** Return a normal Response for either a public or private stored object. */
export async function readReportBlob(url: string) {
  if (!url.includes(".private.blob.vercel-storage.com/")) {
    const response = await fetch(url);
    return response.ok ? response : null;
  }

  const result = await get(url, { access: "private", token: token() });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return new Response(result.stream, {
    headers: {
      "content-type": result.blob.contentType || "application/octet-stream",
      etag: result.blob.etag,
    },
  });
}

export async function deleteReportBlob(url: string) {
  await del(url, { token: token() });
}

export function blobError(cause: unknown) {
  const detail = message(cause);
  if (/token|unauthori[sz]ed|forbidden/i.test(detail)) {
    return "The connected Vercel Blob token was rejected. Reconnect the Blob store and redeploy.";
  }
  if (/access.*store|store.*access/i.test(detail)) {
    return `The connected Vercel Blob store has an incompatible access setting: ${detail}`;
  }
  return detail || "Vercel Blob operation failed.";
}
