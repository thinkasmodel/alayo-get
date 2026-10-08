import { describe, expect, it } from 'vitest';
import { CAPTURE_IN_FLIGHT_KEY, sharedCapture } from './sharedCapture';

const PAGE_A = 'https://x.com/a/status/1';
const PAGE_B = 'https://x.com/b/status/2';

describe('sharedCapture：重复注入时只有一个采集在跑（codex review 第 2 轮）', () => {
  it('并发调用两次：run 只执行 1 次，两次拿到同一个结果；完成后清掉全局', async () => {
    const scope: Record<string, unknown> = {};
    let runs = 0;
    let finish: (v: string) => void = () => undefined;
    const run = () => {
      runs++;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    };
    const a = sharedCapture(scope, PAGE_A, run);
    const b = sharedCapture(scope, PAGE_A, run);
    expect(runs).toBe(1);
    expect(scope[CAPTURE_IN_FLIGHT_KEY]).toBeDefined();
    finish('结果');
    expect(await a).toBe('结果');
    expect(await b).toBe('结果');
    expect(scope[CAPTURE_IN_FLIGHT_KEY]).toBeUndefined();
  });

  it('第一次完成后再调用：重新执行', async () => {
    const scope: Record<string, unknown> = {};
    let runs = 0;
    const run = async () => ++runs;
    expect(await sharedCapture(scope, PAGE_A, run)).toBe(1);
    expect(await sharedCapture(scope, PAGE_A, run)).toBe(2);
  });

  it('采集失败也清掉全局，下一次重新执行', async () => {
    const scope: Record<string, unknown> = {};
    await expect(sharedCapture(scope, PAGE_A, async () => Promise.reject(new Error('坏了')))).rejects.toThrow('坏了');
    expect(scope[CAPTURE_IN_FLIGHT_KEY]).toBeUndefined();
    expect(await sharedCapture(scope, PAGE_A, async () => 'ok')).toBe('ok');
  });
});

describe('sharedCapture：按页面身份区分（codex review 第 3 轮）', () => {
  it('key 不同的两次并发调用：各执行 1 次，各拿各的结果；登记的是后来的那一项', async () => {
    const scope: Record<string, unknown> = {};
    const runs: string[] = [];
    const finish: Record<string, (v: string) => void> = {};
    const run = (key: string) => () => {
      runs.push(key);
      return new Promise<string>((resolve) => {
        finish[key] = resolve;
      });
    };
    const a = sharedCapture(scope, PAGE_A, run(PAGE_A));
    const b = sharedCapture(scope, PAGE_B, run(PAGE_B));
    const b2 = sharedCapture(scope, PAGE_B, run(PAGE_B));
    expect(runs).toEqual([PAGE_A, PAGE_B]);
    finish[PAGE_A]?.('A 的结果');
    expect(await a).toBe('A 的结果');
    // A 结束时全局已经是 B 的那一项，不清
    expect(scope[CAPTURE_IN_FLIGHT_KEY]).toBeDefined();
    finish[PAGE_B]?.('B 的结果');
    expect(await b).toBe('B 的结果');
    expect(await b2).toBe('B 的结果');
    expect(scope[CAPTURE_IN_FLIGHT_KEY]).toBeUndefined();
  });

  it('key 相同的并发调用：只执行 1 次', async () => {
    const scope: Record<string, unknown> = {};
    let runs = 0;
    const run = async () => ++runs;
    const [x, y] = await Promise.all([sharedCapture(scope, PAGE_A, run), sharedCapture(scope, PAGE_A, run)]);
    expect([x, y, runs]).toEqual([1, 1, 1]);
  });
});
