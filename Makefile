MAC_TARGET ?= universal-apple-darwin

.PHONY: mac-prepare mac-check mac-dev mac-build mac-build-universal

mac-prepare:
	npm run sidecar:prepare -- --target=$(MAC_TARGET)

mac-check:
	npm run sidecar:prepare -- --target=$(MAC_TARGET)
	npm run electron:verify-media

mac-dev: mac-prepare
	npm run electron:dev

mac-build: mac-prepare
	npm run electron:build:mac

mac-build-universal:
	$(MAKE) mac-build MAC_TARGET=universal-apple-darwin
