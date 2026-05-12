package rerr

// ProblemDetail implements RFC 7807 Problem Details for HTTP APIs.
type ProblemDetail struct {
	Type     string            `json:"type"`
	Title    string            `json:"title"`
	Status   int               `json:"status"`
	Detail   string            `json:"detail"`
	Instance string            `json:"instance"`
	Errors   []ValidationError `json:"errors,omitempty"`
}

// ValidationError represents a single field-level validation error.
type ValidationError struct {
	Field  string `json:"field"`
	Reason string `json:"reason"`
	Value  any    `json:"value,omitempty"`
}
