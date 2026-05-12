// Package gateway — cluster node management endpoints (#83).
//
//	GET  /api/v1/cluster/nodes              list nodes
//	POST /api/v1/cluster/nodes/{id}/remove  remove a node from the cluster
//	POST /api/v1/cluster/sync               force a config sync round
//
// Reads require `cluster:read`; mutations require `cluster:manage`.
//
// Backed by a cluster.Service implementation supplied by the daemon. The
// default is cluster.LocalOnlyService — single-node responses with the
// running daemon as the sole member. Once Discovery is wired up
// (related: #57), the daemon swaps in a multi-node implementation.
package gateway

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/riokulabs/rioku/internal/cluster"
)

// RegisterClusterRoutes registers the cluster management endpoints. Returns
// without registering anything when `svc` is nil so the gateway can stay
// silent in deployments that haven't wired a cluster service yet.
//
// IMPORTANT: also register a backwards-compatibility GET /api/v1/cluster
// shim that returns the same node list under the old shape so the existing
// admin panel keeps working until it migrates to /cluster/nodes.
func RegisterClusterRoutes(mux *http.ServeMux, svc cluster.Service) {
	if svc == nil {
		return
	}
	mux.Handle("GET /api/v1/cluster",
		RequirePermission("cluster:read")(http.HandlerFunc(handleClusterLegacy(svc))))
	mux.Handle("GET /api/v1/cluster/nodes",
		RequirePermission("cluster:read")(http.HandlerFunc(handleListClusterNodes(svc))))
	mux.Handle("POST /api/v1/cluster/nodes/{id}/remove",
		RequirePermission("cluster:manage")(http.HandlerFunc(handleRemoveClusterNode(svc))))
	mux.Handle("POST /api/v1/cluster/sync",
		RequirePermission("cluster:manage")(http.HandlerFunc(handleForceClusterSync(svc))))
}

func handleListClusterNodes(svc cluster.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		nodes, err := svc.ListNodes(r.Context())
		if err != nil {
			writeInternalError(w, r, "list cluster nodes")
			return
		}
		if nodes == nil {
			nodes = []cluster.NodeInfo{}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items": nodes,
			"total": len(nodes),
		})
	}
}

// handleClusterLegacy keeps the existing GET /api/v1/cluster shape alive
// for the current admin panel build, which expects {"nodes": [...]}.
func handleClusterLegacy(svc cluster.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		nodes, err := svc.ListNodes(r.Context())
		if err != nil {
			writeInternalError(w, r, "list cluster nodes")
			return
		}
		if nodes == nil {
			nodes = []cluster.NodeInfo{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"nodes": nodes})
	}
}

func handleRemoveClusterNode(svc cluster.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if id == "" {
			writeBadRequest(w, r, "node id is required")
			return
		}
		if err := svc.RemoveNode(r.Context(), id); err != nil {
			// Single-node + unknown-id are caller-facing errors — surface
			// the message instead of a generic 500.
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Cannot remove node",
				err.Error(), r.URL.Path, nil)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleForceClusterSync(svc cluster.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		result, err := svc.ForceSync(r.Context())
		if err != nil {
			// Include the result so the operator sees how far we got.
			payload := map[string]any{
				"error":  err.Error(),
				"result": result,
			}
			body, _ := json.Marshal(payload)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write(body)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

// errIsNoOp returns true for benign "nothing to do" sync errors that
// should still surface as 200 OK rather than 502. Currently unused —
// kept for when the multi-node service wants a softer error path.
//
//nolint:unused // future use
func errIsNoOp(err error) bool {
	return errors.Is(err, errSyncNoOp)
}

// errSyncNoOp — sentinel a future Service impl can return for a benign
// "nothing changed, no action needed" outcome.
//
//nolint:unused // future use, paired with errIsNoOp above
var errSyncNoOp = errors.New("cluster: sync no-op")
