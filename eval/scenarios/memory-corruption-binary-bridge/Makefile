SCENARIO_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
BUILD_DIR ?= $(SCENARIO_DIR)/build
WORKSPACE_DIR ?= $(SCENARIO_DIR)/workspace
PUBLIC_DIR := $(SCENARIO_DIR)/public
PRIVATE_DIR := $(SCENARIO_DIR)/private
STAGE_DIR := $(BUILD_DIR)/stage
CC ?= gcc
CFLAGS ?= -g -O0 -Wall -Wextra
PRIVATE_CFLAGS ?= -O2 -g0 -Wall -Wextra
PATH_CFLAGS := -fdebug-prefix-map=$(STAGE_DIR)=. -ffile-prefix-map=$(STAGE_DIR)=.

.PHONY: build install clean

build:
	mkdir -p "$(BUILD_DIR)" "$(STAGE_DIR)/src" "$(STAGE_DIR)/data"
	cp "$(PUBLIC_DIR)/import_job.c" "$(STAGE_DIR)/src/import_job.c"
	cp "$(PUBLIC_DIR)/vendor_manifest.h" "$(STAGE_DIR)/src/vendor_manifest.h"
	python3 "$(PRIVATE_DIR)/make_manifest_feed.py" "$(STAGE_DIR)/data/manifest-feed.bin"
	cd "$(STAGE_DIR)" && $(CC) $(PRIVATE_CFLAGS) -I "src" -c "$(PRIVATE_DIR)/vendor_manifest.c" -o "$(BUILD_DIR)/vendor_manifest.o"
	objcopy --strip-debug "$(BUILD_DIR)/vendor_manifest.o"
	cd "$(STAGE_DIR)" && $(CC) $(CFLAGS) $(PATH_CFLAGS) -I "src" "src/import_job.c" "$(BUILD_DIR)/vendor_manifest.o" -o "$(BUILD_DIR)/import-job"

install: build
	mkdir -p "$(WORKSPACE_DIR)/src" "$(WORKSPACE_DIR)/bin" "$(WORKSPACE_DIR)/data"
	cp "$(PUBLIC_DIR)/import_job.c" "$(WORKSPACE_DIR)/src/import_job.c"
	cp "$(PUBLIC_DIR)/vendor_manifest.h" "$(WORKSPACE_DIR)/src/vendor_manifest.h"
	cp "$(STAGE_DIR)/data/manifest-feed.bin" "$(WORKSPACE_DIR)/data/manifest-feed.bin"
	cp "$(BUILD_DIR)/import-job" "$(WORKSPACE_DIR)/bin/import-job"

clean:
	rm -rf "$(BUILD_DIR)"
