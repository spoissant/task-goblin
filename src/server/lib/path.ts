import { homedir } from "os";

/**
 * Expand ~ to home directory in file paths.
 */
export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return path.replace("~", homedir());
  }
  return path;
}
