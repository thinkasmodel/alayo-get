// 剪藏库：File System Access 目录句柄（存在 IndexedDB），service worker 直接写入（ADR-0001、ADR-0004）。
import { get } from 'idb-keyval';
import { t } from '@/shared/i18n';

/** 剪藏库授权状态。'missing' 表示还没选剪藏库。 */
export type LibraryPermission = 'granted' | 'prompt' | 'denied' | 'missing';

/**
 * 剪藏库的读写接口。路径都相对剪藏库根目录，用 `/` 分隔，如 `标题.md`、`.assets/<id>/1.jpg`。
 * 实现：FsaLibrary（生产）、MemoryLibrary（测试）。
 */
export interface Library {
  permission(): Promise<LibraryPermission>;
  /** 根目录下现有的条目名（文件与目录）。 */
  listRoot(): Promise<string[]>;
  readText(path: string): Promise<string>;
  /** 文件在不在：目录或文件不存在为 false；其他错误（如没有权限）照常抛出（ALAG-20）。 */
  exists(path: string): Promise<boolean>;
  /** 写入（覆盖）文件，中间目录不存在时创建。 */
  write(path: string, data: Blob | string): Promise<void>;
  remove(path: string): Promise<void>;
}

export const LIBRARY_HANDLE_KEY = 'library-handle';

/**
 * 把剪藏库句柄固定在调用这一刻：一次保存或一次修改从头到尾都写同一个库，
 * 中途在选项页更换文件夹也不会改变它的目标（codex review 第 6 轮）。
 */
export function pinnedLibrary(): FsaLibrary {
  const handle = get<FileSystemDirectoryHandle>(LIBRARY_HANDLE_KEY);
  return new FsaLibrary(() => handle);
}

// TS 的 DOM 库没有 FSA 的权限方法，这里补最小声明。
type PermissionMode = { mode: 'read' | 'readwrite' };
interface PermissionedHandle {
  queryPermission(desc: PermissionMode): Promise<'granted' | 'prompt' | 'denied'>;
}

function permissionError(state: string): Error {
  const err = new Error(t('error_noPermission', state));
  err.name = 'NotAllowedError';
  return err;
}

function splitPath(path: string): { dirs: string[]; name: string } {
  const parts = path.split('/').filter((p) => p !== '');
  const name = parts.pop();
  if (!name) throw new Error(t('error_emptyPath', path));
  return { dirs: parts, name };
}

/** 生产实现：句柄从 idb-keyval 的 `library-handle` 取；每次访问前先 queryPermission，不调用 requestPermission。 */
export class FsaLibrary implements Library {
  constructor(private readonly loadHandle: () => Promise<FileSystemDirectoryHandle | undefined> = () => get(LIBRARY_HANDLE_KEY)) {}

  async permission(): Promise<LibraryPermission> {
    const handle = await this.loadHandle();
    if (!handle) return 'missing';
    return (handle as unknown as PermissionedHandle).queryPermission({ mode: 'readwrite' });
  }

  /** 取根句柄并确认已授权；未授权抛 NotAllowedError。 */
  private async root(): Promise<FileSystemDirectoryHandle> {
    const handle = await this.loadHandle();
    if (!handle) {
      const err = new Error(t('error_noLibrary'));
      err.name = 'NotFoundError';
      throw err;
    }
    const state = await (handle as unknown as PermissionedHandle).queryPermission({ mode: 'readwrite' });
    if (state !== 'granted') throw permissionError(state);
    return handle;
  }

  private async dir(dirs: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let dir = await this.root();
    for (const name of dirs) dir = await dir.getDirectoryHandle(name, { create });
    return dir;
  }

  async listRoot(): Promise<string[]> {
    const root = await this.root();
    const names: string[] = [];
    for await (const name of root.keys()) names.push(name);
    return names;
  }

  async readText(path: string): Promise<string> {
    const { dirs, name } = splitPath(path);
    const dir = await this.dir(dirs, false);
    const file = await (await dir.getFileHandle(name)).getFile();
    return file.text();
  }

  async exists(path: string): Promise<boolean> {
    const { dirs, name } = splitPath(path);
    // 没有剪藏库、没有权限时照常抛出（不当成文件不在）
    let dir = await this.root();
    try {
      for (const part of dirs) dir = await dir.getDirectoryHandle(part);
      await dir.getFileHandle(name);
      return true;
    } catch (err) {
      if ((err as { name?: unknown } | null)?.name === 'NotFoundError') return false;
      throw err;
    }
  }

  async write(path: string, data: Blob | string): Promise<void> {
    const { dirs, name } = splitPath(path);
    const dir = await this.dir(dirs, true);
    // 记下目标文件原先是否存在：本次新建的文件写入失败时要删掉，不留下空白剪藏；原有文件不删（codex review 第 4 轮）。
    const existed = await dir.getFileHandle(name).then(
      () => true,
      () => false,
    );
    const fileHandle = await dir.getFileHandle(name, { create: true });
    let writable: FileSystemWritableFileStream | undefined;
    // 写完立刻 close：持有写入流期间 .crswap 会出现在 Workbench 的待纳入里（ALAG-1 §2）。
    let closed = false;
    try {
      writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
      closed = true;
    } finally {
      if (!closed) {
        await writable?.abort().catch(() => undefined);
        if (!existed) await dir.removeEntry(name).catch(() => undefined);
      }
    }
  }

  async remove(path: string): Promise<void> {
    const { dirs, name } = splitPath(path);
    const dir = await this.dir(dirs, false);
    await dir.removeEntry(name);
  }
}
