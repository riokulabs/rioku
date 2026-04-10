;; plugin_no_malloc.wat — exports handle_request and memory but NO malloc.
;; This causes writeGuestBytes to fail since malloc export is absent.
;; The plugin calls get_request_method which tries to write back to guest memory.
(module
  (import "rioku" "get_request_header"  (func $get_request_header  (param i32 i32) (result i32 i32)))
  (import "rioku" "set_request_header"  (func $set_request_header  (param i32 i32 i32 i32)))
  (import "rioku" "get_request_path"    (func $get_request_path    (result i32 i32)))
  (import "rioku" "get_request_method"  (func $get_request_method  (result i32 i32)))
  (import "rioku" "set_response_status" (func $set_response_status (param i32)))
  (import "rioku" "set_response_header" (func $set_response_header (param i32 i32 i32 i32)))
  (import "rioku" "set_response_body"   (func $set_response_body   (param i32 i32)))
  (import "rioku" "log_info"            (func $log_info            (param i32 i32)))
  (import "rioku" "get_plugin_config"   (func $get_plugin_config   (result i32 i32)))

  (memory (export "memory") 1 16)

  ;; NOTE: no malloc export

  (func (export "handle_request") (result i32)
    ;; Call get_request_method — host will try writeGuestString which needs malloc
    ;; Since malloc is missing, writeGuestString returns error → (0,0).
    (drop (call $get_request_method))
    (drop)

    ;; Also call get_request_path — same failure path.
    (drop (call $get_request_path))
    (drop)

    ;; Also call get_request_header with some data — needs malloc too.
    (drop (call $get_request_header (i32.const 0) (i32.const 0)))
    (drop)

    ;; Call get_plugin_config — same.
    (drop (call $get_plugin_config))
    (drop)

    (i32.const 0)
  )
)
