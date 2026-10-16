// Developer-only inventory generator. It never connects to Kubernetes.
package main

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

const commit = "0e8be887b8217bbcac5e3ae0bfcd258073949cca"

type treeEntry struct {
	Path string `json:"path"`
	Type string `json:"type"`
	SHA  string `json:"sha"`
}

type sourceRef struct {
	Path string `json:"path"`
	Blob string `json:"blob"`
}

type feature struct {
	ID         string            `json:"id"`
	Category   string            `json:"category"`
	Source     string            `json:"source"`
	Line       int               `json:"line"`
	Symbol     string            `json:"symbol"`
	Attributes map[string]string `json:"attributes,omitempty"`
}

type catalog struct {
	Repository string      `json:"repository"`
	Version    string      `json:"version"`
	Commit     string      `json:"commit"`
	Sources    []sourceRef `json:"sources"`
	Features   []feature   `json:"features"`
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

func main() {
	source := flag.String("source", "", "Path to the pinned upstream source tree")
	treePath := flag.String("tree", "", "GitHub git/trees response for the pinned commit")
	output := flag.String("output", "test-files/parity/upstream.json", "Output inventory")
	check := flag.Bool("check", false, "Compare output without writing")
	flag.Parse()
	if *source == "" || *treePath == "" {
		fail(fmt.Errorf("-source and -tree are required"))
	}
	if err := generate(*source, *treePath, *output, *check); err != nil {
		fail(err)
	}
}

func selected(path string) bool {
	for _, exact := range []string{
		"routing/routes.go", "models/istio_validation.go", "models/health_status.go",
		"models/health.go", "models/health_status_test.go", "kubernetes/types.go",
		"business/istio_config.go", "graph/options.go", "frontend/src/routes.tsx",
		"frontend/src/config/Paths.ts",
	} {
		if path == exact {
			return true
		}
	}
	for _, prefix := range []string{
		"business/checkers/", "graph/telemetry/istio/appender/",
		"frontend/src/components/IstioWizards/", "frontend/src/components/Envoy/",
		"frontend/src/pages/", "frontend/src/types/", "frontend/src/config/",
	} {
		if strings.HasPrefix(path, prefix) {
			return strings.HasSuffix(path, ".go") || strings.HasSuffix(path, ".ts") ||
				strings.HasSuffix(path, ".tsx")
		}
	}
	return false
}

func generate(root, treePath, output string, check bool) error {
	var tree struct {
		SHA       string      `json:"sha"`
		Truncated bool        `json:"truncated"`
		Tree      []treeEntry `json:"tree"`
	}
	treeBytes, err := os.ReadFile(treePath)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(treeBytes, &tree); err != nil {
		return err
	}
	if tree.SHA != commit || tree.Truncated || len(tree.Tree) == 0 {
		return fmt.Errorf("expected complete GitHub tree for %s", commit)
	}
	result := catalog{Repository: "kiali/kiali", Version: "v2.33.0", Commit: commit}
	found := map[string]bool{}
	for _, entry := range tree.Tree {
		if entry.Type != "blob" || !selected(entry.Path) {
			continue
		}
		if filepath.IsAbs(entry.Path) || filepath.Clean(entry.Path) != entry.Path ||
			strings.HasPrefix(entry.Path, "../") {
			return fmt.Errorf("invalid source path %q", entry.Path)
		}
		content, err := os.ReadFile(filepath.Join(root, entry.Path))
		if err != nil {
			return err
		}
		h := sha1.New()
		fmt.Fprintf(h, "blob %d\x00", len(content))
		h.Write(content)
		if hex.EncodeToString(h.Sum(nil)) != entry.SHA {
			return fmt.Errorf("source blob mismatch: %s", entry.Path)
		}
		result.Sources = append(result.Sources, sourceRef{entry.Path, entry.SHA})
		found[entry.Path] = true
		if strings.HasSuffix(entry.Path, "_test.go") ||
			strings.Contains(entry.Path, "/__tests__/") ||
			strings.Contains(entry.Path, ".test.") {
			continue
		}
		if strings.HasSuffix(entry.Path, ".go") {
			features, err := goFeatures(entry.Path, content)
			if err != nil {
				return err
			}
			result.Features = append(result.Features, features...)
		} else {
			category := "frontend-contract"
			switch {
			case strings.Contains(entry.Path, "/IstioWizards/"):
				category = "wizard-source"
			case strings.Contains(entry.Path, "/Envoy/"):
				category = "diagnostic-source"
			case strings.Contains(entry.Path, "/pages/"):
				category = "page-source"
			}
			result.Features = append(result.Features, feature{
				ID: category + ":" + entry.Path, Category: category, Source: entry.Path,
				Line: 1, Symbol: filepath.Base(entry.Path),
			})
		}
	}
	for _, required := range []string{"routing/routes.go", "models/istio_validation.go",
		"models/health_status.go", "kubernetes/types.go", "graph/options.go",
		"frontend/src/routes.tsx"} {
		if !found[required] {
			return fmt.Errorf("baseline tree is missing required source %s", required)
		}
	}
	sort.Slice(result.Sources, func(i, j int) bool { return result.Sources[i].Path < result.Sources[j].Path })
	sort.Slice(result.Features, func(i, j int) bool { return result.Features[i].ID < result.Features[j].ID })
	ids := map[string]bool{}
	for _, feature := range result.Features {
		if ids[feature.ID] {
			return fmt.Errorf("duplicate feature identity: %s", feature.ID)
		}
		ids[feature.ID] = true
	}
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if check {
		current, err := os.ReadFile(output)
		if err != nil {
			return err
		}
		if !bytes.Equal(data, current) {
			return fmt.Errorf("inventory drift: regenerate %s and review the difference", output)
		}
	} else {
		if err := os.MkdirAll(filepath.Dir(output), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(output, data, 0644); err != nil {
			return err
		}
	}
	fmt.Printf("Verified %d source blobs and %d inventory entries\n", len(result.Sources), len(result.Features))
	return nil
}

func stringValue(node ast.Expr) (string, bool) {
	literal, ok := node.(*ast.BasicLit)
	if !ok || literal.Kind != token.STRING {
		return "", false
	}
	value, err := strconv.Unquote(literal.Value)
	return value, err == nil
}

func expression(fset *token.FileSet, node ast.Node) string {
	var out bytes.Buffer
	printer.Fprint(&out, fset, node)
	return out.String()
}

func fields(literal *ast.CompositeLit) map[string]ast.Expr {
	result := map[string]ast.Expr{}
	for _, entry := range literal.Elts {
		if field, ok := entry.(*ast.KeyValueExpr); ok {
			if key, ok := field.Key.(*ast.Ident); ok {
				result[key.Name] = field.Value
			}
		}
	}
	return result
}

func goFeatures(path string, content []byte) ([]feature, error) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, path, content, 0)
	if err != nil {
		return nil, err
	}
	result := []feature{}
	add := func(category, id, symbol string, pos token.Pos, attributes map[string]string) {
		result = append(result, feature{category + ":" + id, category, path,
			fset.Position(pos).Line, symbol, attributes})
	}
	queryOptions := map[string]bool{}
	ast.Inspect(file, func(node ast.Node) bool {
		switch n := node.(type) {
		case *ast.CompositeLit:
			if path != "routing/routes.go" {
				break
			}
			values := fields(n)
			if len(values) == 0 && len(n.Elts) == 6 {
				values = map[string]ast.Expr{"Name": n.Elts[0], "Method": n.Elts[2],
					"Pattern": n.Elts[3], "HandlerFunc": n.Elts[4]}
			}
			method, methodOK := stringValue(values["Method"])
			pattern, patternOK := stringValue(values["Pattern"])
			name, nameOK := stringValue(values["Name"])
			if methodOK && patternOK && nameOK {
				add("api", method+" "+pattern, name, n.Pos(), map[string]string{
					"method": method, "path": pattern,
					"handler": expression(fset, values["HandlerFunc"]),
				})
			}
		case *ast.ValueSpec:
			for i, name := range n.Names {
				if i >= len(n.Values) {
					continue
				}
				value := n.Values[i]
				if name.Name == "checkDescriptors" {
					if literal, ok := value.(*ast.CompositeLit); ok {
						for _, entry := range literal.Elts {
							pair, ok := entry.(*ast.KeyValueExpr)
							if !ok {
								continue
							}
							key, keyOK := stringValue(pair.Key)
							def, ok := pair.Value.(*ast.CompositeLit)
							if !ok || !keyOK {
								continue
							}
							values := fields(def)
							code, codeOK := stringValue(values["Code"])
							if !codeOK {
								continue
							}
							message, _ := stringValue(values["Message"])
							add("validation-code", key, code, pair.Pos(), map[string]string{
								"code": code, "message": message,
								"severity": expression(fset, values["Severity"]),
							})
						}
					}
				}
				if strings.HasSuffix(name.Name, "AppenderName") {
					add("graph-appender", name.Name, name.Name, name.Pos(),
						map[string]string{"value": expression(fset, value)})
				}
				if path == "graph/options.go" && strings.HasPrefix(name.Name, "default") {
					add("graph-default", name.Name, name.Name, name.Pos(),
						map[string]string{"value": expression(fset, value)})
				}
				if path == "kubernetes/types.go" {
					if call, ok := value.(*ast.CallExpr); ok {
						if fn, ok := call.Fun.(*ast.SelectorExpr); ok && fn.Sel.Name == "WithKind" {
							add("resource", name.Name, name.Name, name.Pos(),
								map[string]string{"definition": expression(fset, value)})
						}
					}
					if literal, ok := value.(*ast.CompositeLit); ok {
						if kind, ok := literal.Type.(*ast.SelectorExpr); ok && kind.Sel.Name == "GroupVersion" {
							add("api-version", name.Name, name.Name, name.Pos(),
								map[string]string{"definition": expression(fset, value)})
						}
					}
				}
			}
		case *ast.CallExpr:
			if path == "graph/options.go" || strings.HasSuffix(path, "/appender/appender.go") {
				if selector, ok := n.Fun.(*ast.SelectorExpr); ok && selector.Sel.Name == "Get" &&
					len(n.Args) == 1 {
					if key, ok := stringValue(n.Args[0]); ok && !queryOptions[key] {
						queryOptions[key] = true
						add("graph-option", path+"#"+key, key, n.Pos(), nil)
					}
				}
			}
		case *ast.FuncDecl:
			if strings.HasPrefix(path, "business/checkers/") && n.Recv != nil && n.Name.Name == "Check" {
				receiver := expression(fset, n.Recv.List[0].Type)
				add("checker", path+"#"+receiver, receiver+".Check", n.Pos(), nil)
			}
			if path == "models/health_status.go" {
				add("health-primitive", n.Name.Name, n.Name.Name, n.Pos(), nil)
			}
		}
		return true
	})
	return result, nil
}
