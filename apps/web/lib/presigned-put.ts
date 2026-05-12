import type { PublicMessageKey } from './public-messages';

type DeskT = (key: PublicMessageKey) => string;

/** Browser PUT to a presigned object URL; network/CORS failures get a localized message. */
export async function fetchPresignedPut(
  uploadUrl: string,
  body: BodyInit,
  headers: HeadersInit,
  t: DeskT,
): Promise<Response> {
  try {
    return await fetch(uploadUrl, { method: 'PUT', body, headers });
  } catch {
    throw new Error(t('desk.storage.presignPutNetwork'));
  }
}
