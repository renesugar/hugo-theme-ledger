// Command ledger-search-server serves the Ledger theme's search API from a
// Bluge index, as an alternative to Pagefind.
//
// It implements exactly the contract in
// assets/js/search/backends/bluge.js:
//
//	GET /api/search?q=&phrase=&category=&tag=&since=&until=&page=&per=
//	{ "total": N, "page": 1, "per": 6, "backend": "bluge",
//	  "results": [ {title, summary, url, category, tags, date, readingTime} ] }
//
// category, tag and phrase are repeatable and ANDed. offset/limit are accepted
// in place of page/per. The grammar itself is never parsed here: query.js splits
// it client-side and this server receives fields.
//
// The index is built from the JSONL that Hugo emits via the `ledgersearch`
// output format, and rebuilt when that file changes.
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/blugelabs/bluge"
	"github.com/blugelabs/bluge/search"
)

// sourceRecord is one line of the JSONL emitted by
// layouts/home.ledgersearch.jsonl.
type sourceRecord struct {
	URL         string   `json:"url"`
	Title       string   `json:"title"`
	Summary     string   `json:"summary"`
	Body        string   `json:"body"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
	Date        string   `json:"date"`
	ReadingTime int      `json:"readingTime"`
}

// result and response are the shapes bluge.js expects. Field names here are
// part of the adapter contract; changing one means changing the adapter.
type result struct {
	Title       string   `json:"title"`
	Summary     string   `json:"summary"`
	URL         string   `json:"url"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
	Date        string   `json:"date"`
	ReadingTime int      `json:"readingTime"`
}

type response struct {
	Backend string   `json:"backend"`
	Query   string   `json:"query"`
	Total   int      `json:"total"`
	Page    int      `json:"page"`
	Per     int      `json:"per"`
	Offset  int      `json:"offset"`
	Limit   int      `json:"limit"`
	Results []result `json:"results"`
}

// searchParams is one already-parsed query. Repeated fields are ANDed, which is
// what the grammar in assets/js/search/query.js means by repeating a clause.
type searchParams struct {
	terms      string
	phrases    []string
	categories []string
	tags       []string
	since      string
	until      string
	page       int
	per        int
	offset     int
	sortByDate bool
}

type indexStamp struct {
	SourceSize    int64 `json:"source_size"`
	SourceModUnix int64 `json:"source_mod_unix"`
}

type server struct {
	reader *bluge.Reader
}

const (
	defaultPerPage = 6
	maxPerPage     = 100
	maxOffset      = 10_000_000
	batchSize      = 500
	scanMaxLine    = 64 * 1024 * 1024 // notes can be long; the default 64KB is not enough
	dateLayout     = "2006-01-02"
)

func main() {
	source := flag.String("source", "public/search-source.jsonl", "JSONL emitted by Hugo's ledgersearch output")
	indexDir := flag.String("index", "bluge-index", "directory holding the Bluge index")
	listen := flag.String("listen", "127.0.0.1:8080", "listen address")
	site := flag.String("site", "", "optional directory of static files to serve alongside the API")
	reindex := flag.Bool("reindex", false, "rebuild the index even if it looks current")
	indexOnly := flag.Bool("index-only", false, "build the index and exit without serving")
	flag.Parse()

	if *reindex || needsBuild(*source, *indexDir) {
		log.Printf("building index from %s", *source)
		start := time.Now()
		if err := buildIndex(*source, *indexDir); err != nil {
			log.Fatalf("build index: %v", err)
		}
		log.Printf("index built in %s", time.Since(start).Round(time.Millisecond))
	}
	if *indexOnly {
		return
	}

	reader, err := bluge.OpenReader(bluge.DefaultConfig(*indexDir))
	if err != nil {
		log.Fatalf("open index: %v", err)
	}
	defer reader.Close()

	srv := &server{reader: reader}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/search", srv.search)
	mux.HandleFunc("/api/health", srv.health)
	if *site != "" {
		mux.Handle("/", http.FileServer(http.Dir(*site)))
	}

	count, _ := reader.Count()
	log.Printf("serving %d notes on %s", count, *listen)
	log.Fatal(http.ListenAndServe(*listen, mux))
}

// needsBuild compares the source file against the stamp written by the last
// successful build, so restarting the server does not reindex needlessly.
func needsBuild(sourcePath, indexDir string) bool {
	info, err := os.Stat(sourcePath)
	if err != nil {
		return false // nothing to build from; OpenReader will report the real problem
	}
	raw, err := os.ReadFile(indexDir + ".stamp.json")
	if err != nil {
		return true
	}
	var stamp indexStamp
	if json.Unmarshal(raw, &stamp) != nil {
		return true
	}
	return stamp.SourceSize != info.Size() || stamp.SourceModUnix != info.ModTime().UnixNano()
}

// buildIndex writes to a temporary directory and swaps it into place, so an
// interrupted build never leaves a half-written index behind.
func buildIndex(sourcePath, indexDir string) error {
	file, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}

	temporary := indexDir + ".building"
	if err := os.RemoveAll(temporary); err != nil {
		return err
	}
	writer, err := bluge.OpenWriter(bluge.DefaultConfig(temporary))
	if err != nil {
		return err
	}

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), scanMaxLine)
	batch := bluge.NewBatch()
	pending, total := 0, 0

	flush := func() error {
		if pending == 0 {
			return nil
		}
		if err := writer.Batch(batch); err != nil {
			return err
		}
		batch = bluge.NewBatch()
		pending = 0
		return nil
	}

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var record sourceRecord
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			writer.Close()
			return fmt.Errorf("decode line %d: %w", total+1, err)
		}

		// SearchTermPositions on all three text fields: without positions a
		// `"quoted phrase"` query silently matches nothing, because a phrase
		// query needs to know which terms are adjacent. Positions make the
		// index larger — that is the price of the phrase clause in the grammar.
		doc := bluge.NewDocument(record.URL).
			AddField(bluge.NewTextField("title", record.Title).StoreValue().SearchTermPositions().HighlightMatches()).
			AddField(bluge.NewTextField("summary", record.Summary).StoreValue().SearchTermPositions()).
			AddField(bluge.NewTextField("body", record.Body).SearchTermPositions()).
			AddField(bluge.NewKeywordField("url", record.URL).StoreValue()).
			AddField(bluge.NewKeywordField("date", record.Date).StoreValue()).
			AddField(bluge.NewStoredOnlyField("reading", []byte(strconv.Itoa(record.ReadingTime))))

		// category and tag are keyword fields: the grammar matches them
		// exactly, so they must not be tokenised or stemmed.
		if record.Category != "" {
			doc.AddField(bluge.NewKeywordField("category", record.Category).StoreValue())
		}
		for _, tag := range record.Tags {
			if tag = strings.TrimSpace(tag); tag != "" {
				doc.AddField(bluge.NewKeywordField("tag", tag).StoreValue())
			}
		}
		// Sorting newest-first needs a comparable value; the date string is
		// already zero-padded ISO, so lexical order is chronological order.
		doc.AddField(bluge.NewKeywordField("sortdate", record.Date).Sortable())

		batch.Update(doc.ID(), doc)
		pending++
		total++
		if pending >= batchSize {
			if err := flush(); err != nil {
				writer.Close()
				return err
			}
		}
		if total%10000 == 0 {
			log.Printf("indexed %d notes", total)
		}
	}
	if err := scanner.Err(); err != nil {
		writer.Close()
		return err
	}
	if err := flush(); err != nil {
		writer.Close()
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}

	old := indexDir + ".old"
	_ = os.RemoveAll(old)
	if _, err := os.Stat(indexDir); err == nil {
		if err := os.Rename(indexDir, old); err != nil {
			return err
		}
	}
	if err := os.Rename(temporary, indexDir); err != nil {
		_ = os.Rename(old, indexDir)
		return err
	}
	_ = os.RemoveAll(old)

	stamp, _ := json.Marshal(indexStamp{SourceSize: info.Size(), SourceModUnix: info.ModTime().UnixNano()})
	if err := os.WriteFile(indexDir+".stamp.json", append(stamp, '\n'), 0o644); err != nil {
		return err
	}
	log.Printf("indexed %d notes", total)
	return nil
}

func (s *server) health(w http.ResponseWriter, r *http.Request) {
	count, err := s.reader.Count()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"backend": "bluge", "notes": count})
}

func (s *server) search(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	w.Header().Set("X-Ledger-Search-Backend", "bluge")

	params, err := parseParams(r.URL.Query())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	query := buildQuery(params)

	// Ask for exactly the window this page needs. Bluge still ranks the whole
	// match set, but only offset+per documents are materialised, which is what
	// keeps response time flat as the corpus grows.
	request := bluge.NewTopNSearch(params.per, query).
		SetFrom(params.offset).
		WithStandardAggregations()
	if params.sortByDate {
		// Nothing to rank by, so newest-first is more useful than index order.
		request = request.SortBy([]string{"-sortdate"})
	}

	iter, err := s.reader.Search(r.Context(), request)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	described := describe(params)
	out := response{
		Backend: "bluge",
		Query:   described,
		Page:    params.page,
		Per:     params.per,
		Offset:  params.offset,
		Limit:   params.per,
		Results: []result{},
	}
	match, err := iter.Next()
	for err == nil && match != nil {
		out.Results = append(out.Results, toResult(match))
		match, err = iter.Next()
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	out.Total = int(iter.Aggregations().Count())

	elapsed := time.Since(started)
	w.Header().Set("Cache-Control", "public, max-age=60")
	w.Header().Set("Server-Timing", fmt.Sprintf("search;dur=%.3f", float64(elapsed.Microseconds())/1000))
	writeJSON(w, out)
	// One line per request, so a site that looks like it is not reaching the
	// backend can be told apart from one that is and found nothing.
	log.Printf("search query=%q total=%d offset=%d per=%d returned=%d duration=%s",
		described, out.Total, params.offset, params.per, len(out.Results), elapsed.Round(time.Millisecond))
}

// parseParams reads the already-split grammar off the query string. It accepts
// page/per (what bluge.js sends) or offset/limit (for anything else), and
// resolves both so the response can report either.
func parseParams(values url.Values) (searchParams, error) {
	params := searchParams{
		terms:      strings.TrimSpace(values.Get("q")),
		phrases:    nonEmpty(values["phrase"]),
		categories: nonEmpty(values["category"]),
		tags:       nonEmpty(values["tag"]),
		since:      strings.TrimSpace(values.Get("since")),
		until:      strings.TrimSpace(values.Get("until")),
	}

	for name, value := range map[string]string{"since": params.since, "until": params.until} {
		if value == "" {
			continue
		}
		if _, err := time.Parse(dateLayout, value); err != nil {
			return params, fmt.Errorf("%s: expected YYYY-MM-DD", name)
		}
	}
	if params.since != "" && params.until != "" && params.since >= params.until {
		return params, errors.New("since: must be earlier than until:")
	}

	// `limit` is the alias for `per`; whichever is present wins, and per bounds
	// the response size either way.
	perRaw := values.Get("per")
	if perRaw == "" {
		perRaw = values.Get("limit")
	}
	params.per = bounded(perRaw, defaultPerPage, 1, maxPerPage)

	if raw := values.Get("offset"); raw != "" {
		params.offset = bounded(raw, 0, 0, maxOffset)
		params.page = params.offset/params.per + 1
	} else {
		params.page = bounded(values.Get("page"), 1, 1, 1<<20)
		params.offset = (params.page - 1) * params.per
	}

	// Newest first for every query, not only filter-only ones. An archive is read
	// chronologically: relevance ordering puts the most recent note at an
	// unpredictable position, and in a long result set the visitor would have to
	// page to the end to find it. It also keeps term.html's server-rendered first
	// page and this server's second page in one sequence for every query shape.
	// `sort=score` is the escape hatch for a caller that wants ranking.
	params.sortByDate = values.Get("sort") != "score" && values.Get("sort") != "relevance"

	return params, nil
}

// buildQuery mirrors the grammar already parsed client-side in
// assets/js/search/query.js — this server never re-parses `category:`, `tag:`
// or quotes, it receives them as separate parameters. Repeated values are
// ANDed.
func buildQuery(params searchParams) bluge.Query {
	conjunction := bluge.NewBooleanQuery()
	clauses := 0

	// category and tag are keyword fields, matched exactly.
	for _, category := range params.categories {
		conjunction.AddMust(bluge.NewTermQuery(category).SetField("category"))
		clauses++
	}
	for _, tag := range params.tags {
		conjunction.AddMust(bluge.NewTermQuery(tag).SetField("tag"))
		clauses++
	}

	// Title matches outrank summary, which outranks body — for terms and for
	// phrases alike.
	if params.terms != "" {
		any := bluge.NewBooleanQuery().SetMinShould(1)
		any.AddShould(bluge.NewMatchQuery(params.terms).SetField("title").SetBoost(5))
		any.AddShould(bluge.NewMatchQuery(params.terms).SetField("summary").SetBoost(2))
		any.AddShould(bluge.NewMatchQuery(params.terms).SetField("body"))
		conjunction.AddMust(any)
		clauses++
	}
	for _, phrase := range params.phrases {
		any := bluge.NewBooleanQuery().SetMinShould(1)
		any.AddShould(bluge.NewMatchPhraseQuery(phrase).SetField("title").SetBoost(5))
		any.AddShould(bluge.NewMatchPhraseQuery(phrase).SetField("summary").SetBoost(2))
		any.AddShould(bluge.NewMatchPhraseQuery(phrase).SetField("body"))
		conjunction.AddMust(any)
		clauses++
	}

	// A lexical range over the sortable ISO date: zero-padded dates sort
	// chronologically as text, so this needs no separate datetime field.
	// `since` is inclusive and `until` exclusive, which makes a single day
	// since:D until:D+1.
	if params.since != "" || params.until != "" {
		conjunction.AddMust(
			bluge.NewTermRangeInclusiveQuery(params.since, params.until, true, false).
				SetField("sortdate"))
		clauses++
	}

	if clauses == 0 {
		return bluge.NewMatchAllQuery()
	}
	return conjunction
}

// describe rebuilds the grammar the visitor typed, for the response echo and
// the log line. The client sends fields, so there is no raw query to quote.
func describe(params searchParams) string {
	var parts []string
	for _, category := range params.categories {
		parts = append(parts, clause("category", category))
	}
	for _, tag := range params.tags {
		parts = append(parts, clause("tag", tag))
	}
	if params.since != "" {
		parts = append(parts, "since:"+params.since)
	}
	if params.until != "" {
		parts = append(parts, "until:"+params.until)
	}
	for _, phrase := range params.phrases {
		parts = append(parts, strconv.Quote(phrase))
	}
	if params.terms != "" {
		parts = append(parts, params.terms)
	}
	return strings.Join(parts, " ")
}

func clause(field, value string) string {
	if strings.ContainsAny(value, " \t\"") {
		return field + ":" + strconv.Quote(value)
	}
	return field + ":" + value
}

func nonEmpty(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			out = append(out, value)
		}
	}
	return out
}

func toResult(match *search.DocumentMatch) result {
	var out result
	var tags []string
	_ = match.VisitStoredFields(func(field string, value []byte) bool {
		switch field {
		case "title":
			out.Title = string(value)
		case "summary":
			out.Summary = string(value)
		case "url":
			out.URL = string(value)
		case "category":
			out.Category = string(value)
		case "date":
			out.Date = string(value)
		case "reading":
			out.ReadingTime, _ = strconv.Atoi(string(value))
		case "tag":
			tags = append(tags, string(value))
		}
		return true
	})
	out.Tags = tags
	if out.Tags == nil {
		out.Tags = []string{}
	}
	return out
}

func bounded(raw string, fallback, minimum, maximum int) int {
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write response: %v", err)
	}
}
