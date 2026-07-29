package main

import (
	"net/url"
	"reflect"
	"testing"
)

// The HTTP surface is a contract shared with assets/js/search/backends/bluge.js
// and with movenotes' generated server, so the parsing rules are worth pinning
// down: they are the part that two independent clients have to agree on.

func params(raw string) (searchParams, error) {
	values, err := url.ParseQuery(raw)
	if err != nil {
		return searchParams{}, err
	}
	return parseParams(values)
}

func TestParseParamsRepeatedClausesAreCollected(t *testing.T) {
	got, err := params("q=water+ratio&phrase=whole+point&phrase=starch&tag=technique&tag=slow&category=Recipes")
	if err != nil {
		t.Fatalf("parseParams: %v", err)
	}
	if got.terms != "water ratio" {
		t.Errorf("terms = %q, want %q", got.terms, "water ratio")
	}
	if want := []string{"whole point", "starch"}; !reflect.DeepEqual(got.phrases, want) {
		t.Errorf("phrases = %q, want %q", got.phrases, want)
	}
	if want := []string{"technique", "slow"}; !reflect.DeepEqual(got.tags, want) {
		t.Errorf("tags = %q, want %q", got.tags, want)
	}
	if want := []string{"Recipes"}; !reflect.DeepEqual(got.categories, want) {
		t.Errorf("categories = %q, want %q", got.categories, want)
	}
}

func TestParseParamsBlankValuesAreDropped(t *testing.T) {
	got, err := params("tag=&tag=+&tag=slow&category=")
	if err != nil {
		t.Fatalf("parseParams: %v", err)
	}
	if want := []string{"slow"}; !reflect.DeepEqual(got.tags, want) {
		t.Errorf("tags = %q, want %q", got.tags, want)
	}
	if len(got.categories) != 0 {
		t.Errorf("categories = %q, want none", got.categories)
	}
}

func TestParseParamsPagingStyles(t *testing.T) {
	cases := []struct {
		name              string
		raw               string
		page, per, offset int
	}{
		{"defaults", "", 1, defaultPerPage, 0},
		{"page and per", "page=3&per=10", 3, 10, 20},
		{"offset and limit", "offset=20&limit=10", 3, 10, 20},
		{"offset wins over page", "page=9&offset=12&per=6", 3, 6, 12},
		{"per is capped", "per=100000", 1, maxPerPage, 0},
		{"page floors at one", "page=0", 1, defaultPerPage, 0},
		{"junk falls back", "page=x&per=y", 1, defaultPerPage, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := params(c.raw)
			if err != nil {
				t.Fatalf("parseParams: %v", err)
			}
			if got.page != c.page || got.per != c.per || got.offset != c.offset {
				t.Errorf("page/per/offset = %d/%d/%d, want %d/%d/%d",
					got.page, got.per, got.offset, c.page, c.per, c.offset)
			}
		})
	}
}

func TestParseParamsDateBounds(t *testing.T) {
	if _, err := params("since=2026-07-01&until=2026-07-02"); err != nil {
		t.Fatalf("valid bounds rejected: %v", err)
	}
	if _, err := params("since=yesterday"); err == nil {
		t.Error("since=yesterday accepted; want a 400-worthy error")
	}
	if _, err := params("until=07-01-2026"); err == nil {
		t.Error("until=07-01-2026 accepted; want a 400-worthy error")
	}
	if _, err := params("since=2026-07-02&until=2026-07-01"); err == nil {
		t.Error("inverted range accepted")
	}
	if _, err := params("since=2026-07-01&until=2026-07-01"); err == nil {
		t.Error("empty half-open range accepted; until is exclusive so this matches nothing")
	}
}

// Filter-only queries must come back newest-first, because term.html
// server-renders page 1 in Hugo's date order and the backend serves page 2.
// Ranking them by score instead would make the two pages slices of different
// sequences.
func TestParseParamsSortDefaultsToDateOnlyWithoutText(t *testing.T) {
	cases := map[string]bool{
		"":                        true,
		"tag=slow":                true,
		"since=2026-07-01":        true,
		"q=water":                 false,
		"phrase=whole+point":      false,
		"tag=slow&q=water":        false,
		"q=water&sort=date":       true,
		"tag=slow&sort=score":     false,
		"tag=slow&sort=relevance": false,
	}
	for raw, want := range cases {
		got, err := params(raw)
		if err != nil {
			t.Fatalf("parseParams(%q): %v", raw, err)
		}
		if got.sortByDate != want {
			t.Errorf("parseParams(%q).sortByDate = %v, want %v", raw, got.sortByDate, want)
		}
	}
}

// describe rebuilds what the visitor typed for the response echo and the log
// line. Values with spaces have to come back quoted, or the echoed query would
// not parse back to the query that produced it.
func TestDescribeRoundTripsQuoting(t *testing.T) {
	got := describe(searchParams{
		categories: []string{"All notes"},
		tags:       []string{"slow", "two words"},
		since:      "2026-07-01",
		until:      "2026-07-02",
		phrases:    []string{"whole point"},
		terms:      "water ratio",
	})
	want := `category:"All notes" tag:slow tag:"two words" since:2026-07-01 until:2026-07-02 "whole point" water ratio`
	if got != want {
		t.Errorf("describe() =\n  %s\nwant\n  %s", got, want)
	}
}

func TestBoundedClampsAndFallsBack(t *testing.T) {
	if got := bounded("", 6, 1, 100); got != 6 {
		t.Errorf("empty = %d, want fallback 6", got)
	}
	if got := bounded("500", 6, 1, 100); got != 100 {
		t.Errorf("over maximum = %d, want 100", got)
	}
	if got := bounded("-5", 6, 1, 100); got != 1 {
		t.Errorf("under minimum = %d, want 1", got)
	}
}
