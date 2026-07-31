/* FlexSearch, as its own bundle.
 *
 * Built separately and imported from a runtime URL by backends/flexsearch.js, for
 * the same reason as orama-runtime.js: a static import inlines the library into
 * the shared search bundle for every site, including the ones that never use it.
 */

export { Document, IndexedDB, Worker } from 'flexsearch';
