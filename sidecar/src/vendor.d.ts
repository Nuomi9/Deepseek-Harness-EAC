// 运行时外部依赖的最小类型声明。这些包不进 bundle、由打包的
// node_modules 在运行时解析（stage.ts 闭包含 js-yaml 与 @koromix 平台包）。
// 只声明 sidecar 实际用到的面；宽松 any 以匹配原 JS 动态语义。

declare module 'js-yaml' {
  namespace jsYaml {
    class Type {
      constructor(
        tag: string,
        opts: { kind: string; resolve?: (data: unknown) => boolean; construct?: (data: unknown) => unknown },
      );
    }
    const JSON_SCHEMA: { extend: (type: unknown) => unknown };
    function load(str: string, opts?: unknown): unknown;
    function dump(obj: unknown, opts?: unknown): string;
  }
  export = jsYaml;
}

declare module 'koffi' {
  const koffi: Record<string, ((...args: unknown[]) => unknown) & Record<string, unknown>>;
  export = koffi;
}
