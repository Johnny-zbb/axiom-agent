export function isAllowedOrigin(origin, allowedOrigins) {
  if (origin === undefined) return true;
  return allowedOrigins.includes(origin);
}

export function isJsonContentType(contentType) {
  return typeof contentType === 'string' && /^application\/json(?:\s*;|$)/i.test(contentType);
}
