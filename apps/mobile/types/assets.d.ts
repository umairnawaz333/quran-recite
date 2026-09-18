// Metro resolves an image import to an asset id (a number) that `Image`
// accepts as `source`; under vitest, vite hands back a URL string instead,
// which the test mock ignores. Either way the import type-checks here.
declare module '*.png' {
  const asset: number;
  export default asset;
}
