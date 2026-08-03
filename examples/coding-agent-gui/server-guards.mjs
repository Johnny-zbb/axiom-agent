export function isAllowedWriteOrigin(origin, port) {
  if (origin === undefined) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

export function isJsonContentType(contentType) {
  return typeof contentType === 'string' && /^application\/json(?:\s*;|$)/i.test(contentType);
}
