import { provider, TARGETS as ALL, type Provider } from "./providers";

export type Target = Provider;
export const TARGETS = ALL;

export function target(id: string): Target {
  if (id === "file") return { ...provider("file"), label: "file export" };
  return provider(id);
}
