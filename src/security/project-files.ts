import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Read a repository resource from source, compiled output, or the current checkout. */
export async function readProjectFile(relativePath: string): Promise<string> {
  if (relativePath.startsWith("/") || relativePath.split("/").includes("..")) {
    throw new Error(`Unsafe project-relative path: ${relativePath}`);
  }

  const candidates = [
    new URL(`../../${relativePath}`, import.meta.url),
    new URL(`../../../${relativePath}`, import.meta.url),
    resolve(process.cwd(), relativePath)
  ];
  const errors: unknown[] = [];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch (error) {
      errors.push(error);
    }
  }
  throw new AggregateError(errors, `Unable to locate project resource: ${relativePath}`);
}
