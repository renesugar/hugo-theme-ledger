#!/usr/bin/env bash
# Scale harness: generate a corpus, build it, index it, and report.
#
#   scripts/bench.sh 10000 100000 500000
#
# Emits one TSV row per tier to bench/out/results.tsv and leaves the largest
# built site in place for query-latency measurement.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$REPO/bench"
OUT="$BENCH/out"
SITE="$BENCH/site"
mkdir -p "$OUT"

TIERS=("$@")
[ ${#TIERS[@]} -eq 0 ] && TIERS=(10000)

# GNU time gives us peak RSS, which is the number that decides whether a build
# is possible at all on a given machine.
TIMEFMT="%e\t%M"

write_config() {
  cat > "$SITE/hugo.toml" <<'TOML'
baseURL = "https://bench.example/"
locale = "en-us"
title = "Bench"
theme = "hugo-theme-ledger"
capitalizeListTitles = false
disableKinds = ["rss"]

[taxonomies]
  category = "categories"
  tag = "tags"

[params]
  defaultTheme = "light"
  taxonomyPageLimit = 25
  googleFonts = false

  [params.pagination]
    home = 6
    term = 6
    search = 6
    tagsGrid = 18
    sidebarCategories = 7
    sidebarTags = 9

  [params.sidebar]
    width = 282
    minWidth = 190
    maxWidth = 460
    order = "count"
    allNotesLabel = "All notes"
    maxTerms = 200

  [params.search]
    backend = "pagefind"
    bundlePath = "/pagefind/pagefind.js"

  [params.scale]
    maxHomePagerPages = 500

  [params.taxonomy]
    categoryPlural = "categories"
    tagPlural = "tags"

[outputs]
  home = ["html"]
  section = ["html"]
  term = ["html"]
TOML
}

# Append, never truncate: tiers are usually run as separate invocations (a 500k
# run is long enough that you want it on its own), and overwriting would discard
# the smaller tiers that the comparison depends on.
if [ ! -s "$OUT/results.tsv" ]; then
  printf 'when\tnotes\tbuild_s\tbuild_peak_mb\tpagefind_s\tpublic_mb\tindex_mb\thtml_files\thome_kb\tnote_kb\n' \
    > "$OUT/results.tsv"
fi

for N in "${TIERS[@]}"; do
  echo "=== tier: $N notes ==="
  rm -rf "$SITE"
  mkdir -p "$SITE"
  write_config
  node "$REPO/scripts/gen-corpus.js" --count "$N" --out "$SITE"

  echo "--- hugo build ---"
  read -r BUILD_S BUILD_KB < <(
    /usr/bin/time -f "$TIMEFMT" hugo --source "$SITE" --themesDir "$REPO/.." \
      --quiet --gc 2>&1 >/dev/null | tail -1
  )
  BUILD_MB=$(( BUILD_KB / 1024 ))

  echo "--- pagefind ---"
  PF_START=$(date +%s.%N)
  npx --yes pagefind --site "$SITE/public" >/dev/null 2>&1
  PF_S=$(echo "$(date +%s.%N) - $PF_START" | bc)

  PUBLIC_MB=$(du -sm "$SITE/public" | cut -f1)
  INDEX_MB=$(du -sm "$SITE/public/pagefind" | cut -f1)
  HTML_FILES=$(find "$SITE/public" -name '*.html' | wc -l)
  HOME_KB=$(( $(stat -c%s "$SITE/public/index.html") / 1024 ))
  NOTE_KB=$(( $(stat -c%s "$SITE/public/notes/note-0/index.html") / 1024 ))

  printf '%s\t%s\t%s\t%s\t%.1f\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date -u +%Y-%m-%dT%H:%MZ)" "$N" "$BUILD_S" "$BUILD_MB" "$PF_S" "$PUBLIC_MB" \
    "$INDEX_MB" "$HTML_FILES" "$HOME_KB" "$NOTE_KB" | tee -a "$OUT/results.tsv"
done

echo
echo "results in $OUT/results.tsv"
column -t "$OUT/results.tsv"
