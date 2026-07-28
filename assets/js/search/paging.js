/* Page-number windowing: always page 1, the current page ±1, and the last page,
   with a gap (null) wherever the run skips.

   The same rule exists in two other places by necessity — ledger.js for the
   sidebar mini-pager, and layouts/_partials/pagination.html for the
   server-rendered pager. Keep the three in step. */

export function windowPages(current, total) {
  var want = {};
  [1, total, current - 1, current, current + 1].forEach(function (n) {
    if (n >= 1 && n <= total) want[n] = true;
  });
  var pages = [];
  var prev = 0;
  Object.keys(want).map(Number).sort(function (a, b) { return a - b; })
    .forEach(function (n) {
      if (n - prev > 1) pages.push(null);
      pages.push(n);
      prev = n;
    });
  return pages;
}
