/**
 * An in-memory app sandbox for `expo-file-system`, both its APIs:
 *
 *   - the SDK 54 object API (`File`, `Directory`, `Paths` from
 *     'expo-file-system'): its native module (`build/ExpoFileSystem`);
 *   - the legacy functions ('expo-file-system/legacy'): its native module
 *     (`build/legacy/ExponentFileSystem`).
 *
 * Only the NATIVE layers are replaced, so the package's own JS (path joining,
 * the File and Directory wrappers, the legacy argument handling) runs as on a
 * phone. Several packages keep per-member files (the Plan tab's health cache
 * under health/<profileId>/, the workout outbox, the foods cache) and their
 * sign-out wipes must remove them; tests need a disk that remembers.
 *
 * Behaviour follows Android: writing into a folder that does not exist
 * throws; `create` refuses an existing path unless asked to overwrite (or,
 * for folders, to be idempotent); reading or deleting what is not there
 * throws, except a legacy `deleteAsync(..., { idempotent: true })`. Nothing
 * here touches the network: downloads and uploads throw.
 *
 *   import { fileSystemState } from '@test/mocks/expoFileSystem';
 *   fileSystemState.seed('health/p1/today.json', '{"date":"2026-10-16"}');
 *   expect(fileSystemState.files()).toEqual([]);   // after the wipe
 */
const APP = 'file:///data/user/0/is.lifepass.android';
export const DOCUMENT_DIRECTORY = `${APP}/files/`;
export const CACHE_DIRECTORY = `${APP}/cache/`;
const BUNDLE_DIRECTORY = 'asset:///';

type Node =
  | { kind: 'file'; data: Uint8Array; created: number; modified: number }
  | { kind: 'dir'; created: number; modified: number };

const nodes = new Map<string, Node>();

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One key per path: `file:///a/b`, no trailing slash, no `//` runs. */
function key(uri: string): string {
  let value = String(uri);
  if (value.startsWith('/')) value = `file://${value}`;
  value = value.replace(/^file:\/(?!\/)/, 'file:///');
  const [scheme, rest] = value.includes('://') ? value.split('://', 2) as [string, string] : ['file', value];
  let path = `/${rest.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
  try {
    path = decodeURI(path);
  } catch {
    // Keep it as written.
  }
  path = path.replace(/\/+$/, '') || '/';
  return `${scheme}://${path}`;
}

function parentOf(k: string): string | null {
  const [scheme, path] = k.split('://') as [string, string];
  if (path === '/' || path === '') return null;
  const parent = path.slice(0, path.lastIndexOf('/')) || '/';
  return `${scheme}://${parent}`;
}

function nameOf(k: string): string {
  return k.slice(k.lastIndexOf('/') + 1);
}

function isRoot(k: string): boolean {
  return parentOf(k) === null;
}

function isDir(k: string): boolean {
  return isRoot(k) || nodes.get(k)?.kind === 'dir';
}

function now(): number {
  return Date.now();
}

function mkdirs(k: string): void {
  const chain: string[] = [];
  for (let at: string | null = k; at && !isRoot(at); at = parentOf(at)) chain.unshift(at);
  for (const dir of chain) {
    const node = nodes.get(dir);
    if (node?.kind === 'file') throw new Error(`${dir} is a file, not a folder`);
    if (!node) nodes.set(dir, { kind: 'dir', created: now(), modified: now() });
  }
}

function requireParentDir(k: string): void {
  const parent = parentOf(k);
  if (parent && !isDir(parent)) {
    throw new Error(`The folder ${parent} does not exist (Android: ENOENT)`);
  }
}

function readFile(k: string): Uint8Array {
  const node = nodes.get(k);
  if (!node || node.kind !== 'file') throw new Error(`File ${k} does not exist`);
  return node.data;
}

function writeFile(k: string, data: Uint8Array, append = false): void {
  requireParentDir(k);
  const existing = nodes.get(k);
  if (existing?.kind === 'dir') throw new Error(`${k} is a folder`);
  const bytes =
    append && existing?.kind === 'file' ? concat(existing.data, data) : new Uint8Array(data);
  nodes.set(k, { kind: 'file', data: bytes, created: existing?.created ?? now(), modified: now() });
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function children(k: string): string[] {
  const prefix = `${k}/`;
  return [...nodes.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'));
}

function subtree(k: string): string[] {
  const prefix = `${k}/`;
  return [...nodes.keys()].filter((p) => p === k || p.startsWith(prefix));
}

function removeTree(k: string): void {
  for (const p of subtree(k)) nodes.delete(p);
}

function copyTree(from: string, to: string): void {
  const prefix = `${from}/`;
  for (const p of subtree(from)) {
    const node = nodes.get(p)!;
    const target = p === from ? to : `${to}/${p.slice(prefix.length)}`;
    nodes.set(target, node.kind === 'file' ? { ...node, data: new Uint8Array(node.data) } : { ...node });
  }
}

function toBytes(content: string | Uint8Array, encoding?: string): Uint8Array {
  if (typeof content !== 'string') return new Uint8Array(content);
  return encoding === 'base64' ? new Uint8Array(Buffer.from(content, 'base64')) : encoder.encode(content);
}

function mimeFor(k: string): string {
  const ext = k.slice(k.lastIndexOf('.') + 1).toLowerCase();
  const types: Record<string, string> = {
    json: 'application/json',
    txt: 'text/plain',
    csv: 'text/csv',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
  };
  return types[ext] ?? 'application/octet-stream';
}

function contentUri(k: string): string {
  return `content://is.lifepass.android.FileSystemFileProvider/root${k.split('://')[1]}`;
}

function uriOf(target: { uri: string } | string): string {
  return typeof target === 'string' ? target : target.uri;
}

function noNetwork(): never {
  throw new Error('expo-file-system downloads and uploads are not available in tests (no network)');
}

// --- The SDK 54 object API's native classes ---------------------------------

class FileSystemFile {
  uri: string;

  constructor(uri: string) {
    this.uri = uri;
  }

  validatePath(): void {
    if (!/^(file|content|asset):/.test(this.uri)) throw new Error(`Invalid file path: ${this.uri}`);
  }

  get exists(): boolean {
    return nodes.get(key(this.uri))?.kind === 'file';
  }

  get size(): number {
    return this.exists ? readFile(key(this.uri)).length : 0;
  }

  get md5(): string | null {
    return null;
  }

  get modificationTime(): number | null {
    return nodes.get(key(this.uri))?.modified ?? null;
  }

  get creationTime(): number | null {
    return nodes.get(key(this.uri))?.created ?? null;
  }

  get type(): string {
    return mimeFor(key(this.uri));
  }

  get contentUri(): string {
    return contentUri(key(this.uri));
  }

  textSync(): string {
    return decoder.decode(readFile(key(this.uri)));
  }

  async text(): Promise<string> {
    return this.textSync();
  }

  base64Sync(): string {
    return Buffer.from(readFile(key(this.uri))).toString('base64');
  }

  async base64(): Promise<string> {
    return this.base64Sync();
  }

  bytesSync(): Uint8Array {
    return new Uint8Array(readFile(key(this.uri)));
  }

  async bytes(): Promise<Uint8Array> {
    return this.bytesSync();
  }

  write(content: string | Uint8Array, options?: { encoding?: string }): void {
    writeFile(key(this.uri), toBytes(content, options?.encoding));
  }

  delete(): void {
    const k = key(this.uri);
    if (nodes.get(k)?.kind !== 'file') throw new Error(`File ${k} does not exist`);
    nodes.delete(k);
  }

  create(options?: { intermediates?: boolean; overwrite?: boolean }): void {
    const k = key(this.uri);
    if (nodes.has(k) && !options?.overwrite) throw new Error(`File ${k} already exists`);
    if (options?.intermediates) mkdirs(parentOf(k)!);
    writeFile(k, new Uint8Array());
  }

  copy(destination: { uri: string }): void {
    const from = key(this.uri);
    readFile(from);
    const target = isDir(key(destination.uri)) ? `${key(destination.uri)}/${nameOf(from)}` : key(destination.uri);
    writeFile(target, readFile(from));
  }

  move(destination: { uri: string }): void {
    const from = key(this.uri);
    const target = isDir(key(destination.uri)) ? `${key(destination.uri)}/${nameOf(from)}` : key(destination.uri);
    writeFile(target, readFile(from));
    nodes.delete(from);
    this.uri = target;
  }

  rename(newName: string): void {
    const from = key(this.uri);
    const target = `${parentOf(from)}/${newName}`;
    writeFile(target, readFile(from));
    nodes.delete(from);
    this.uri = target;
  }

  info(options?: { md5?: boolean }): Record<string, unknown> {
    const k = key(this.uri);
    const node = nodes.get(k);
    if (!node || node.kind !== 'file') return { exists: false, uri: this.uri };
    return {
      exists: true,
      uri: this.uri,
      size: node.data.length,
      modificationTime: node.modified,
      creationTime: node.created,
      ...(options?.md5 ? { md5: null } : {}),
    };
  }

  open(): never {
    throw new Error('File.open() (file handles) is not available in tests');
  }
}

class FileSystemDirectory {
  uri: string;

  constructor(uri: string) {
    this.uri = uri;
  }

  validatePath(): void {
    if (!/^(file|content|asset):/.test(this.uri)) throw new Error(`Invalid directory path: ${this.uri}`);
  }

  get exists(): boolean {
    return isDir(key(this.uri));
  }

  get size(): number | null {
    if (!this.exists) return null;
    return subtree(key(this.uri)).reduce((sum, p) => {
      const node = nodes.get(p);
      return sum + (node?.kind === 'file' ? node.data.length : 0);
    }, 0);
  }

  create(options?: { intermediates?: boolean; overwrite?: boolean; idempotent?: boolean }): void {
    const k = key(this.uri);
    if (nodes.has(k)) {
      if (options?.idempotent && isDir(k)) return;
      if (!options?.overwrite) throw new Error(`Directory ${k} already exists`);
      removeTree(k);
    }
    if (options?.intermediates) mkdirs(k);
    else {
      requireParentDir(k);
      nodes.set(k, { kind: 'dir', created: now(), modified: now() });
    }
  }

  delete(): void {
    const k = key(this.uri);
    if (nodes.get(k)?.kind !== 'dir') throw new Error(`Directory ${k} does not exist`);
    removeTree(k);
  }

  createFile(name: string, _mimeType: string | null): FileSystemFile {
    const file = new FileSystemFile(`${key(this.uri)}/${name}`);
    file.create();
    return file;
  }

  createDirectory(name: string): FileSystemDirectory {
    const dir = new FileSystemDirectory(`${key(this.uri)}/${name}`);
    dir.create();
    return dir;
  }

  copy(destination: { uri: string }): void {
    const from = key(this.uri);
    if (!isDir(from)) throw new Error(`Directory ${from} does not exist`);
    const dest = key(destination.uri);
    const target = isDir(dest) ? `${dest}/${nameOf(from)}` : dest;
    requireParentDir(target);
    copyTree(from, target);
  }

  move(destination: { uri: string }): void {
    const from = key(this.uri);
    const dest = key(destination.uri);
    const target = isDir(dest) ? `${dest}/${nameOf(from)}` : dest;
    this.copy(destination);
    removeTree(from);
    this.uri = target;
  }

  rename(newName: string): void {
    const from = key(this.uri);
    const target = `${parentOf(from)}/${newName}`;
    copyTree(from, target);
    removeTree(from);
    this.uri = target;
  }

  listAsRecords(): { isDirectory: boolean; uri: string }[] {
    const k = key(this.uri);
    if (!isDir(k)) throw new Error(`Directory ${k} does not exist`);
    return children(k).map((p) => ({ isDirectory: isDir(p), uri: isDir(p) ? `${p}/` : p }));
  }

  list(): { isDirectory: boolean; uri: string }[] {
    return this.listAsRecords();
  }

  info(): Record<string, unknown> {
    const k = key(this.uri);
    if (!isDir(k)) return { exists: false, uri: this.uri };
    const node = nodes.get(k);
    return {
      exists: true,
      uri: this.uri,
      size: this.size,
      modificationTime: node?.modified,
      creationTime: node?.created,
      files: children(k).map(nameOf),
    };
  }
}

/** The SDK 54 native module (`requireNativeModule('FileSystem')`). */
export const objectApiNativeModule = {
  FileSystemFile,
  FileSystemDirectory,
  documentDirectory: DOCUMENT_DIRECTORY,
  cacheDirectory: CACHE_DIRECTORY,
  bundleDirectory: BUNDLE_DIRECTORY,
  totalDiskSpace: 128_000_000_000,
  availableDiskSpace: 64_000_000_000,
  appleSharedContainers: {},
  info(uri: string): { exists: boolean; isDirectory: boolean | null } {
    const k = key(uri);
    if (isDir(k)) return { exists: true, isDirectory: true };
    if (nodes.has(k)) return { exists: true, isDirectory: false };
    return { exists: false, isDirectory: null };
  },
  downloadFileAsync: async () => noNetwork(),
  pickFileAsync: async () => {
    throw new Error('The system file picker is not available in tests');
  },
  pickDirectoryAsync: async () => {
    throw new Error('The system folder picker is not available in tests');
  },
};

// --- The legacy API's native module -----------------------------------------

/** The legacy native module (`ExponentFileSystem`). Times are in seconds there. */
export const legacyNativeModule = {
  documentDirectory: DOCUMENT_DIRECTORY,
  cacheDirectory: CACHE_DIRECTORY,
  bundleDirectory: BUNDLE_DIRECTORY,

  async getInfoAsync(uri: string, options: { md5?: boolean } = {}) {
    const k = key(uri);
    const node = nodes.get(k);
    if (!node && !isRoot(k)) return { exists: false, uri, isDirectory: false };
    const isDirectory = isDir(k);
    return {
      exists: true,
      uri,
      isDirectory,
      size: node?.kind === 'file' ? node.data.length : 0,
      modificationTime: Math.floor((node?.modified ?? now()) / 1000),
      ...(options.md5 && !isDirectory ? { md5: null } : {}),
    };
  },

  async readAsStringAsync(uri: string, options: { encoding?: string; position?: number; length?: number } = {}) {
    let data = readFile(key(uri));
    if (options.position !== undefined || options.length !== undefined) {
      const start = options.position ?? 0;
      data = data.slice(start, options.length !== undefined ? start + options.length : undefined);
    }
    return options.encoding === 'base64' ? Buffer.from(data).toString('base64') : decoder.decode(data);
  },

  async writeAsStringAsync(uri: string, contents: string, options: { encoding?: string; append?: boolean } = {}) {
    writeFile(key(uri), toBytes(contents, options.encoding), options.append === true);
  },

  async deleteAsync(uri: string, options: { idempotent?: boolean } = {}) {
    const k = key(uri);
    if (!nodes.has(k)) {
      if (options.idempotent) return;
      throw new Error(`File '${uri}' could not be deleted because it could not be found`);
    }
    removeTree(k);
  },

  async moveAsync({ from, to }: { from: string; to: string }) {
    const source = key(from);
    if (!nodes.has(source)) throw new Error(`File '${from}' could not be moved: it does not exist`);
    requireParentDir(key(to));
    copyTree(source, key(to));
    removeTree(source);
  },

  async copyAsync({ from, to }: { from: string; to: string }) {
    const source = key(from);
    if (!nodes.has(source)) throw new Error(`File '${from}' could not be copied: it does not exist`);
    requireParentDir(key(to));
    copyTree(source, key(to));
  },

  async makeDirectoryAsync(uri: string, options: { intermediates?: boolean } = {}) {
    const k = key(uri);
    if (nodes.has(k)) {
      if (options.intermediates && isDir(k)) return;
      throw new Error(`Directory '${uri}' could not be created or already exists`);
    }
    if (options.intermediates) mkdirs(k);
    else {
      requireParentDir(k);
      nodes.set(k, { kind: 'dir', created: now(), modified: now() });
    }
  },

  async readDirectoryAsync(uri: string) {
    const k = key(uri);
    if (!isDir(k)) throw new Error(`Directory '${uri}' could not be read`);
    return children(k).map(nameOf);
  },

  async getFreeDiskStorageAsync() {
    return objectApiNativeModule.availableDiskSpace;
  },

  async getTotalDiskCapacityAsync() {
    return objectApiNativeModule.totalDiskSpace;
  },

  async getContentUriAsync(uri: string) {
    return contentUri(key(uri));
  },

  downloadAsync: async () => noNetwork(),
  uploadAsync: async () => noNetwork(),
  downloadResumableStartAsync: async () => noNetwork(),
  downloadResumablePauseAsync: async () => noNetwork(),
  uploadTaskStartAsync: async () => noNetwork(),
  networkTaskCancelAsync: async () => undefined,
  addListener: () => ({ remove: () => undefined }),
  removeListeners: () => undefined,
};

// --- Test controls ----------------------------------------------------------

function seedRoots(): void {
  mkdirs(key(DOCUMENT_DIRECTORY));
  mkdirs(key(CACHE_DIRECTORY));
}
seedRoots();

/** A path relative to the documents folder, or any absolute URI, as a key. */
function resolve(pathOrUri: string): string {
  return key(/^[a-z]+:/.test(pathOrUri) ? pathOrUri : `${DOCUMENT_DIRECTORY}${pathOrUri}`);
}

export const fileSystemState = {
  /** Writes a file (creating its folders), e.g. `seed('health/p1/today.json', '{}')`. */
  seed(pathOrUri: string, content: string | Uint8Array): void {
    const k = resolve(pathOrUri);
    mkdirs(parentOf(k)!);
    writeFile(k, toBytes(content));
  },
  /** The text of a file, or null when there is none. */
  read(pathOrUri: string): string | null {
    const node = nodes.get(resolve(pathOrUri));
    return node?.kind === 'file' ? decoder.decode(node.data) : null;
  },
  exists(pathOrUri: string): boolean {
    return nodes.has(resolve(pathOrUri));
  },
  /** Every file under the documents and cache folders, as paths relative to the app sandbox. */
  files(): string[] {
    const base = key(APP);
    return [...nodes.entries()]
      .filter(([, node]) => node.kind === 'file')
      .map(([k]) => k.slice(base.length + 1))
      .sort();
  },
  reset(): void {
    nodes.clear();
    seedRoots();
  },
};
