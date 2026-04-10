;; plugin_respond.wat — returns ActionRespond (1) to test short-circuit path
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
  (global $bump_ptr (mut i32) (i32.const 1024))

  (func (export "malloc") (param $size i32) (result i32)
    (local $ptr i32)
    (local.set $ptr (global.get $bump_ptr))
    (global.set $bump_ptr (i32.add (global.get $bump_ptr) (local.get $size)))
    (local.get $ptr)
  )

  (data (i32.const 100) "X-Plugin")    ;; len 8
  (data (i32.const 110) "responder")   ;; len 9
  (data (i32.const 120) "Forbidden")   ;; len 9

  (func (export "handle_request") (result i32)
    ;; Set 403 status
    (call $set_response_status (i32.const 403))

    ;; Set response header
    (call $set_response_header
      (i32.const 100) (i32.const 8)
      (i32.const 110) (i32.const 9))

    ;; Set response body
    (call $set_response_body (i32.const 120) (i32.const 9))

    ;; Return ActionRespond (1)
    (i32.const 1)
  )
)
