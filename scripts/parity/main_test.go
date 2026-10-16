package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRouteInventoryIncludesPositionalAndKeyedRoutes(t *testing.T) {
	input := `package routing
// {"NotARoute", log.X, "GET", "/ignore", h, false}
var routes = []Route{
  {"Read", log.X, "GET", "/api/items", handler(conf), true},
  {Name: "Write", Method: "POST", Pattern: "/api/items", HandlerFunc: handler},
}`
	got, err := goFeatures("routing/routes.go", []byte(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != "api:GET /api/items" || got[1].ID != "api:POST /api/items" {
		t.Fatalf("incorrect route inventory: %+v", got)
	}
	if got[0].Attributes["handler"] != "handler(conf)" || got[0].Line != 4 {
		t.Fatalf("lost source provenance: %+v", got[0])
	}
}

func TestValidationInventoryPreservesDescriptorIdentity(t *testing.T) {
	input := `package models
var checkDescriptors = map[string]IstioCheck{
 "first": {Code: "KIA0001", Message: "First message", Severity: ErrorSeverity},
 "second": {Code: "KIA0001", Message: "Alias message", Severity: WarningSeverity},
}`
	got, err := goFeatures("models/istio_validation.go", []byte(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID == got[1].ID {
		t.Fatalf("descriptors with shared codes must not be collapsed: %+v", got)
	}
	if got[1].Attributes["severity"] != "WarningSeverity" || got[1].Symbol != "KIA0001" {
		t.Fatalf("lost diagnostic metadata: %+v", got[1])
	}
}

func TestGraphInventoryRetainsDefaultsAndDeduplicatesParameterReads(t *testing.T) {
	input := `package graph
const defaultGraphType = GraphTypeWorkload
func options() {
 p.Get("graphType")
 p.Get("graphType")
 p.Get("duration")
}`
	got, err := goFeatures("graph/options.go", []byte(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("expected one default and two options: %+v", got)
	}
	if got[0].Attributes["value"] != "GraphTypeWorkload" {
		t.Fatalf("lost default expression: %+v", got[0])
	}
}

func TestMalformedGoIsRejected(t *testing.T) {
	if _, err := goFeatures("routing/routes.go", []byte("invalid source")); err == nil {
		t.Fatal("expected a parse failure")
	}
}

func TestWrongAndTruncatedTreesAreRejected(t *testing.T) {
	for _, document := range []string{
		`{"sha":"wrong","tree":[{}]}`,
		`{"sha":"` + commit + `","truncated":true,"tree":[{}]}`,
		`{"sha":"` + commit + `","tree":[]}`,
	} {
		dir := t.TempDir()
		tree := filepath.Join(dir, "tree.json")
		if err := os.WriteFile(tree, []byte(document), 0644); err != nil {
			t.Fatal(err)
		}
		if err := generate(dir, tree, filepath.Join(dir, "out.json"), false); err == nil {
			t.Fatal("expected reference-tree rejection")
		}
	}
}

func TestModifiedSourceIsRejected(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "models"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "models/health.go"), []byte("package models"), 0644); err != nil {
		t.Fatal(err)
	}
	tree := filepath.Join(dir, "tree.json")
	content := `{"sha":"` + commit + `","tree":[{"path":"models/health.go","type":"blob","sha":"wrong"}]}`
	if err := os.WriteFile(tree, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	if err := generate(dir, tree, filepath.Join(dir, "out.json"), false); err == nil {
		t.Fatal("expected modified-source rejection")
	}
}
