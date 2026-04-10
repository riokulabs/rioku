;; plugin_full.wat — exercises every ABI host function
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

  ;; Static strings
  (data (i32.const 100) "X-Request-ID")       ;; len 12
  (data (i32.const 120) "X-Modified")          ;; len 10
  (data (i32.const 140) "modified-by-plugin")  ;; len 18
  (data (i32.const 160) "X-Plugin")            ;; len 8
  (data (i32.const 170) "full-v1")             ;; len 7
  (data (i32.const 180) "hello from plugin")   ;; len 17
  (data (i32.const 200) "full plugin invoked") ;; len 19

  ;; handle_request: exercises all ABI calls
  (func (export "handle_request") (result i32)
    ;; 1. get_request_header("X-Request-ID")
    (drop (call $get_request_header (i32.const 100) (i32.const 12)))
    (drop)

    ;; 2. set_request_header("X-Modified", "modified-by-plugin")
    (call $set_request_header
      (i32.const 120) (i32.const 10)
      (i32.const 140) (i32.const 18))

    ;; 3. get_request_method (ignore result)
    (drop (call $get_request_method))
    (drop)

    ;; 4. set_response_status(200)
    (call $set_response_status (i32.const 200))

    ;; 5. set_response_header("X-Plugin", "full-v1")
    (call $set_response_header
      (i32.const 160) (i32.const 8)
      (i32.const 170) (i32.const 7))

    ;; 6. set_response_body("hello from plugin")
    (call $set_response_body (i32.const 180) (i32.const 17))

    ;; 7. log_info("full plugin invoked")
    (call $log_info (i32.const 200) (i32.const 19))

    ;; 8. get_plugin_config (ignore result)
    (drop (call $get_plugin_config))
    (drop)

    ;; Return ActionContinue (0)
    (i32.const 0)
  )
)
