package tokens

import "testing"

func TestHeuristic_EstimateText(t *testing.T) {
	h := NewHeuristic()
	cases := []struct {
		in   string
		want int
	}{
		{"", 0},
		{"abcd", 1},        // 4/4 = 1
		{"abcde", 2},       // ceil(5/4) = 2
		{"hello world", 3}, // 11 chars => ceil(11/4) = 3
		{"日本語", 1},         // 3 runes => ceil(3/4) = 1
	}
	for _, c := range cases {
		if got := h.EstimateText(c.in, "any"); got != c.want {
			t.Errorf("EstimateText(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestEstimateMessages_BasicEnvelope(t *testing.T) {
	msgs := []ChatMessage{
		{Role: "system", Content: "You are helpful."},
		{Role: "user", Content: "Hello, world!"},
	}
	// 3 (priming) + 4+est("system")+est("You are helpful.")
	//             + 4+est("user")+est("Hello, world!")
	got := EstimateMessages(msgs, "gpt-4o")
	if got <= 3 {
		t.Fatalf("got %d, expected > 3 (envelope + content tokens)", got)
	}
}

func TestEstimateMessages_Empty(t *testing.T) {
	if got := EstimateMessages(nil, "gpt-4o"); got != 0 {
		t.Errorf("empty messages = %d, want 0", got)
	}
}

func TestEstimateOutputFromBytes(t *testing.T) {
	cases := []struct {
		in, want int
	}{
		{0, 0}, {1, 1}, {4, 1}, {5, 2}, {100, 25},
	}
	for _, c := range cases {
		if got := EstimateOutputFromBytes(c.in); got != c.want {
			t.Errorf("EstimateOutputFromBytes(%d) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestSplitSSEEventBodies(t *testing.T) {
	chunk := "data: chunk1\ndata: chunk2\n: comment\n\ndata: [DONE]\n"
	got := SplitSSEEventBodies(chunk)
	want := []string{"chunk1", "chunk2", "[DONE]"}
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d (got = %v)", len(got), len(want), got)
	}
	for i, g := range got {
		if g != want[i] {
			t.Errorf("[%d] = %q, want %q", i, g, want[i])
		}
	}
}

func TestSplitSSEEventBodies_CRLF(t *testing.T) {
	got := SplitSSEEventBodies("data: a\r\ndata: b\r\n")
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Errorf("got = %v", got)
	}
}
