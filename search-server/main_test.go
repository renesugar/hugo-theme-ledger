package main

import (
	"net/url"
	"reflect"
	"strings"
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

// Every query comes back newest-first, not just filter-only ones: term.html
// server-renders page 1 in Hugo's date order and the backend serves page 2, and
// with relevance ranking on some query shapes the two were slices of different
// sequences.
func TestParseParamsSortsByDateUnlessScoreIsAskedFor(t *testing.T) {
	cases := map[string]bool{
		"":                        true,
		"tag=slow":                true,
		"since=2026-07-01":        true,
		"q=water":                 true,
		"phrase=whole+point":      true,
		"tag=slow&q=water":        true,
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

// The expression tree is the half of the contract the flat parameters cannot
// carry, and it has two implementations — this server and movenotes' generated
// one. Both parse and render it the same way, so both are pinned the same way.
func TestExpressionParsingAndEcho(t *testing.T) {
	for _, c := range []struct{ expr, want string }{
		{`{"type":"term","value":"cat"}`, "cat"},
		{`{"type":"or","nodes":[{"type":"term","value":"cat"},{"type":"term","value":"dog"}]}`, "cat OR dog"},
		{`{"type":"and","nodes":[{"type":"term","value":"a"},{"type":"or","nodes":[{"type":"term","value":"b"},{"type":"term","value":"c"}]}]}`, "a (b OR c)"},
		{`{"type":"and","nodes":[{"type":"term","value":"cat"},{"type":"not","node":{"type":"term","value":"grumpy"}}]}`, "cat -grumpy"},
		{`{"type":"not","node":{"type":"or","nodes":[{"type":"term","value":"b"},{"type":"term","value":"c"}]}}`, "-(b OR c)"},
		{`{"type":"field","field":"tag","value":"two words"}`, `tag:"two words"`},
		{`{"type":"phrase","value":"bank of canada"}`, `"bank of canada"`},
	} {
		got, err := params("expr=" + url.QueryEscape(c.expr))
		if err != nil {
			t.Fatalf("parseParams(%s): %v", c.expr, err)
		}
		if got.expr == nil {
			t.Fatalf("parseParams(%s) produced no tree", c.expr)
		}
		if described := describe(got); described != c.want {
			t.Errorf("describe(%s) = %q, want %q", c.expr, described, c.want)
		}
		// Every shape must also build a query rather than falling through.
		if buildQuery(got) == nil {
			t.Errorf("buildQuery(%s) = nil", c.expr)
		}
	}
}

// A malformed tree names its problem, so a client sending the wrong shape is
// told rather than served an empty result set.
func TestExpressionRejectsMalformedTrees(t *testing.T) {
	for _, c := range []struct{ name, expr, contains string }{
		{"not json", `{oops`, "not valid JSON"},
		{"unknown type", `{"type":"xor","nodes":[]}`, "unknown node type"},
		{"unknown field", `{"type":"field","field":"author","value":"x"}`, "unknown field"},
		{"empty conjunction", `{"type":"and","nodes":[]}`, "with no operands"},
		{"valueless term", `{"type":"term","value":""}`, "with no value"},
		{"bad date", `{"type":"field","field":"since","value":"yesterday"}`, "expected YYYY-MM-DD"},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, err := params("expr=" + url.QueryEscape(c.expr))
			if err == nil {
				t.Fatalf("parseParams(%s) accepted a malformed tree", c.expr)
			}
			if !strings.Contains(err.Error(), c.contains) {
				t.Errorf("error %q does not mention %q", err, c.contains)
			}
		})
	}
}

// A query with no tree still parses through the flat parameters, which the
// contract promises to `offset`/`limit` callers.
func TestFlatParametersStillWorkWithoutATree(t *testing.T) {
	got, err := params("q=housing&tag=economics&per=5")
	if err != nil {
		t.Fatal(err)
	}
	if got.expr != nil {
		t.Errorf("expr = %+v, want nil", got.expr)
	}
	if got.terms != "housing" || !reflect.DeepEqual(got.tags, []string{"economics"}) {
		t.Errorf("params = %+v", got)
	}
	if describe(got) != "tag:economics housing" {
		t.Errorf("describe = %q", describe(got))
	}
}
