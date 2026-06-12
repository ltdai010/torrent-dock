MAC_TARGET ?= $(shell rustc --print host-tuple)

.PHONY: mac-prepare mac-check mac-dev mac-build mac-build-universal

mac-prepare:
	npm run sidecar:prepare -- --target $(MAC_TARGET)
	npm run mpv:verify

mac-check:
	npm run build
	cargo check --manifest-path src-tauri/Cargo.toml

mac-dev: mac-prepare
	npm run tauri:dev

mac-build: mac-prepare
	npm run tauri:build -- --target $(MAC_TARGET)

mac-build-universal:
	$(MAKE) mac-build MAC_TARGET=universal-apple-darwin
