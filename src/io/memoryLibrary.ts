// 测试用的内存剪藏库。生产代码不引用。
import type { Library, LibraryPermission } from './library';

export interface MemoryOp {
  op: 'write' | 'remove';
  path: string;
}

export class MemoryLibrary implements Library {
  /** 路径 → 内容（文本原样存；Blob 存其字节）。 */
  readonly files = new Map<string, string | Uint8Array>();
  /** 写入与删除的顺序记录。 */
  readonly ops: MemoryOp[] = [];
  permissionState: LibraryPermission = 'granted';
  /** 设置后，路径满足条件的写入会抛出此错误。 */
  failWrite: { match: (path: string) => boolean; error: Error } | null = null;

  async permission(): Promise<LibraryPermission> {
    return this.permissionState;
  }

  private assertGranted(): void {
    if (this.permissionState !== 'granted') {
      const err = new Error(`剪藏库没有写入权限（${this.permissionState}）`);
      err.name = 'NotAllowedError';
      throw err;
    }
  }

  async listRoot(): Promise<string[]> {
    this.assertGranted();
    const names = new Set<string>();
    for (const path of this.files.keys()) names.add(path.split('/')[0] ?? path);
    return [...names];
  }

  async readText(path: string): Promise<string> {
    this.assertGranted();
    const content = this.files.get(path);
    if (content === undefined) {
      const err = new Error(`找不到文件：${path}`);
      err.name = 'NotFoundError';
      throw err;
    }
    return typeof content === 'string' ? content : new TextDecoder().decode(content);
  }

  async write(path: string, data: Blob | string): Promise<void> {
    this.assertGranted();
    if (this.failWrite?.match(path)) throw this.failWrite.error;
    const content = typeof data === 'string' ? data : new Uint8Array(await data.arrayBuffer());
    this.files.set(path, content);
    this.ops.push({ op: 'write', path });
  }

  async remove(path: string): Promise<void> {
    this.assertGranted();
    if (!this.files.delete(path)) {
      const err = new Error(`找不到文件：${path}`);
      err.name = 'NotFoundError';
      throw err;
    }
    this.ops.push({ op: 'remove', path });
  }

  /** 读出文本文件（测试断言用）。 */
  text(path: string): string | undefined {
    const content = this.files.get(path);
    if (content === undefined) return undefined;
    return typeof content === 'string' ? content : new TextDecoder().decode(content);
  }
}
