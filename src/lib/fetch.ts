import { fetch as undiciFetch } from "undici";

export const fetch = undiciFetch as unknown as typeof globalThis.fetch;
