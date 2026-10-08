// text-fragments-polyfill@6.7.0 没有类型声明；只声明摘录剪藏用到的 generateFragmentFromRange（ALAG-4）。
declare module 'text-fragments-polyfill/dist/fragment-generation-utils.js' {
  export interface TextFragment {
    textStart: string;
    textEnd?: string;
    prefix?: string;
    suffix?: string;
  }

  /** status：0 成功，1 无效选区，2 有歧义，3 超时，4 执行失败。成功时才有 fragment。 */
  export interface GenerateFragmentResult {
    status: number;
    fragment?: TextFragment;
  }

  /** startTime 用于超时计算（缺省 500ms）。 */
  export function generateFragmentFromRange(range: Range, startTime?: number): GenerateFragmentResult;
}
