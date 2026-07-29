// Command ledger-search-server serves the Ledger theme's search API from a
// Bluge index, as an alternative to Pagefind.
//
// It implements exactly the contract in
// assets/js/search/backends/bluge.js:
//
//	GET /api/search?q=&category=&tag=&page=&per=
//	{ "total": N, "results": [ {title, summary, url, category, tags, date, readingTime} ] }
//
// The index is built from the JSONL that Hugo emits via the `ledgersearch`
// output format, and rebuilt when that file changes.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
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
	Total   int      `json:"total"`
	Page    int      `json:"page"`
	Per     int      `json:"per"`
	Results []result `json:"results"`
}

type indexStamp struct {
	SourceSize    int64 `json:"source_size"`
	SourceModUnix int64 `json:"source_mod_unix"`
}

type server struct {
	reader *bluge.Reader
}

const (
	maxPerPage  = 100
	batchSize   = 500
	scanMaxLine = 64 * 1024 * 1024 // notes can be long; the default 64KB is not enough
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

		doc := bluge.NewDocument(record.URL).
			AddField(bluge.NewTextField("title", record.Title).StoreValue().HighlightMatches()).
			AddField(bluge.NewTextField("summary", record.Summary).StoreValue()).
			AddField(bluge.NewTextField("body", record.Body)).
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
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	tag := strings.TrimSpace(r.URL.Query().Get("tag"))
	page := bounded(r.URL.Query().Get("page"), 1, 1, 1<<20)
	per := bounded(r.URL.Query().Get("per"), 6, 1, maxPerPage)

	query := buildQuery(q, category, tag)

	// Ask for exactly the window this page needs. Bluge still ranks the whole
	// match set, but only offset+per documents are materialised, which is what
	// keeps response time flat as the corpus grows.
	from := (page - 1) * per
	request := bluge.NewTopNSearch(per, query).
		SetFrom(from).
		WithStandardAggregations()
	if q == "" {
		// Nothing to rank by, so newest-first is more useful than index order.
		request = request.SortBy([]string{"-sortdate"})
	}

	iter, err := s.reader.Search(context.Background(), request)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	out := response{Page: page, Per: per, Results: []result{}}
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

	w.Header().Set("Cache-Control", "public, max-age=60")
	writeJSON(w, out)
}

// buildQuery mirrors the grammar already parsed client-side in
// assets/js/search/query.js — this server never re-parses `category:` or
// `tag:` prefixes, it receives them as separate parameters.
func buildQuery(text, category, tag string) bluge.Query {
	conjunction := bluge.NewBooleanQuery()
	filtered := false

	if category != "" {
		conjunction.AddMust(bluge.NewTermQuery(category).SetField("category"))
		filtered = true
	}
	if tag != "" {
		conjunction.AddMust(bluge.NewTermQuery(tag).SetField("tag"))
		filtered = true
	}

	if text != "" {
		// Title matches outrank summary, which outranks body.
		any := bluge.NewBooleanQuery()
		any.AddShould(bluge.NewMatchQuery(text).SetField("title").SetBoost(5))
		any.AddShould(bluge.NewMatchQuery(text).SetField("summary").SetBoost(2))
		any.AddShould(bluge.NewMatchQuery(text).SetField("body"))
		any.SetMinShould(1)
		conjunction.AddMust(any)
		filtered = true
	}

	if !filtered {
		return bluge.NewMatchAllQuery()
	}
	return conjunction
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
