;; plugin_no_config_read.wat — calls get_plugin_config but the host has empty config
;; This is to test the empty-config path in hostGetPluginConfig.
;; Same as plugin_full but this version explicitly reads plugin config.
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

  (data (i32.const 100) "X-Config-Read") ;; len 13
  (data (i32.const 120) "yes")            ;; len 3

  (func (export "handle_request") (result i32)
    ;; Call get_plugin_config — result is (ptr, len). Just drop it.
    (drop (call $get_plugin_config))
    (drop)

    ;; Set a response header to confirm invocation.
    (call $set_response_header
      (i32.const 100) (i32.const 13)
      (i32.const 120) (i32.const 3))

    (i32.const 0)
  )
)
