package main

import (
	"testing"

	"knowflick.local/workbench-go/internal/library"
)

func TestSubscriptionRequestURLMatchesFrontend(t *testing.T) {
	cases := []struct{ kind, target, want string }{
		{"rss", "https://example.org/feed.xml", "https://example.org/feed.xml"},
		{"tech_board", "https://example.org/board", "https://example.org/board"},
		{"github_release", "owner/repo", "https://api.github.com/repos/owner/repo/releases?per_page=10"},
		{"github_trending", "go", "https://api.github.com/search/repositories?q=language:go&sort=stars&order=desc&per_page=10"},
		{"github_trending", "", "https://api.github.com/search/repositories?q=stars:%3E10000&sort=stars&order=desc&per_page=10"},
	}
	for _, c := range cases {
		if got := subscriptionRequestURL(library.Subscription{Type: c.kind, TargetURL: c.target}); got != c.want {
			t.Fatalf("%s/%s: %s", c.kind, c.target, got)
		}
	}
}
