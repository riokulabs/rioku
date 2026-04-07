(module
  ;; Import host functions from the "rioku" module.
  (import "rioku" "get_request_header" (func $get_request_header (param i32 i32) (result i32 i32)))
  (import "rioku" "set_request_header" (func $set_request_header (param i32 i32 i32 i32)))
  (import "rioku" "get_request_path" (func $get_request_path (result i32 i32)))
  (import "rioku" "get_request_method" (func $get_request_method (result i32 i32)))
  (import "rioku" "set_response_status" (func $set_response_status (param i32)))
  (import "rioku" "set_response_header" (func $set_response_header (param i32 i32 i32 i32)))
  (import "rioku" "set_response_body" (func $set_response_body (param i32 i32)))
  (import "rioku" "log_info" (func $log_info (param i32 i32)))
  (import "rioku" "get_plugin_config" (func $get_plugin_config (result i32 i32)))

  ;; Memory: 1 page min, 16 pages max.
  (memory (export "memory") 1 16)

  ;; Bump allocator pointer starts after static data.
  (global $bump_ptr (mut i32) (i32.const 1024))

  ;; malloc: simple bump allocator.
  (func (export "malloc") (param $size i32) (result i32)
    (local $ptr i32)
    (local.set $ptr (global.get $bump_ptr))
    (global.set $bump_ptr (i32.add (global.get $bump_ptr) (local.get $size)))
    (local.get $ptr)
  )

  ;; Static strings in memory.
  (data (i32.const 100) "X-Plugin")
  (data (i32.const 110) "test-v1")
  (data (i32.const 120) "plugin invoked")

  ;; handle_request: main plugin entry point.
  (func (export "handle_request") (result i32)
    ;; Call get_request_path to exercise the ABI (ignore result).
    (drop (call $get_request_path))
    (drop)

    ;; Set response header: X-Plugin: test-v1
    (call $set_response_header
      (i32.const 100) (i32.const 8)
      (i32.const 110) (i32.const 7))

    ;; Log a message.
    (call $log_info (i32.const 120) (i32.const 14))

    ;; Return ActionContinue (0).
    (i32.const 0)
  )
)
