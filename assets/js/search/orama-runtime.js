/* Orama, as its own bundle.
 *
 * Built separately and fetched at runtime by backends/orama.js, from a URL the
 * template puts in the search config. That indirection is the whole point: a
 * static `import '@orama/orama'` inside the adapter makes esbuild inline the
 * library into the shared search bundle, which took it from 8.9 KB to 88.2 KB —
 * for every site, including the Pagefind ones that never call Orama at all.
 *
 * pagefind.js loads its runtime the same way, for the same reason.
 */

export { create, load, search } from '@orama/orama';
