import { normalizeWhitespace } from "./text.mjs";

export function formatProfile(profile) {
  return `${normalizeWhitespace(profile.firstName)} ${normalizeWhitespace(profile.lastName)}`;
}
