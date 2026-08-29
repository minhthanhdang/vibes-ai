/// wawoff2 ships no types: it is Google's woff2 reference code compiled to
/// WASM, wrapped in two promise-returning functions.
declare module "wawoff2" {
  export function compress(input: Uint8Array): Promise<Uint8Array>;
  export function decompress(input: Uint8Array): Promise<Uint8Array>;
}
