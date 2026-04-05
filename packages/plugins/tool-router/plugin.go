// Package toolrouter implements the tool call routing middleware plugin.
// Inspects LLM responses for tool_use/function_call blocks, looks up
// tools in the registry, and routes calls to registered endpoints.
package toolrouter
