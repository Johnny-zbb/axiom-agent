import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export class WorkspaceBoundaryError extends Error {
  constructor(path: string) {
    super(`Path escapes or cannot be safely resolved inside the workspace: ${path}`);
    this.name = "WorkspaceBoundaryError";
  }
}

export class CodingWorkspace {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async create(root: string): Promise<CodingWorkspace> {
    if (!root.trim()) throw new TypeError("workspace root must not be empty.");
    const canonical = await realpath(resolve(root));
    const info = await stat(canonical);
    if (!info.isDirectory()) throw new TypeError("workspace root must be a directory.");
    return new CodingWorkspace(canonical);
  }

  async resolveExisting(path: string): Promise<string> {
    const candidate = this.#lexicalPath(path);
    const canonical = await realpath(candidate);
    this.#assertInside(canonical, path);
    return canonical;
  }

  async resolveWritable(path: string): Promise<string> {
    const candidate = this.#lexicalPath(path);
    try {
      const canonical = await realpath(candidate);
      this.#assertInside(canonical, path);
      return canonical;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }

    // New files are allowed only in an existing canonical parent. This keeps
    // creation useful while preventing a symlinked parent from escaping root.
    const canonicalParent = await realpath(dirname(candidate));
    this.#assertInside(canonicalParent, path);
    return candidate;
  }

  displayPath(path: string): string {
    const displayed = relative(this.root, path);
    return displayed || ".";
  }

  #lexicalPath(path: string): string {
    if (!path.trim()) throw new TypeError("path must not be empty.");
    const candidate = resolve(this.root, path);
    this.#assertInside(candidate, path);
    return candidate;
  }

  #assertInside(candidate: string, input: string): void {
    const relation = relative(this.root, candidate);
    if (relation === "" || (!isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${sep}`))) {
      return;
    }
    throw new WorkspaceBoundaryError(input);
  }
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
