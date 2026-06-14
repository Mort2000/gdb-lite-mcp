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
	mkdir -p "$(BUILD_DIR)" "$(STAGE_DIR)/src"
	cp "$(PUBLIC_DIR)/risk_buckets.c" "$(STAGE_DIR)/src/risk_buckets.c"
	cp "$(PUBLIC_DIR)/risk_digest.h" "$(STAGE_DIR)/src/risk_digest.h"
	cd "$(STAGE_DIR)" && $(CC) $(PRIVATE_CFLAGS) -I "src" -c "$(PRIVATE_DIR)/risk_digest.c" -o "$(BUILD_DIR)/risk_digest.o"
	objcopy --strip-debug "$(BUILD_DIR)/risk_digest.o"
	cd "$(STAGE_DIR)" && $(CC) $(CFLAGS) $(PATH_CFLAGS) -I "src" "src/risk_buckets.c" "$(BUILD_DIR)/risk_digest.o" -o "$(BUILD_DIR)/risk-buckets"

install: build
	mkdir -p "$(WORKSPACE_DIR)/src" "$(WORKSPACE_DIR)/bin"
	cp "$(PUBLIC_DIR)/risk_buckets.c" "$(WORKSPACE_DIR)/src/risk_buckets.c"
	cp "$(PUBLIC_DIR)/risk_digest.h" "$(WORKSPACE_DIR)/src/risk_digest.h"
	cp "$(PUBLIC_DIR)/reference_digest.py" "$(WORKSPACE_DIR)/reference_digest.py"
	cp "$(BUILD_DIR)/risk-buckets" "$(WORKSPACE_DIR)/bin/risk-buckets"

clean:
	rm -rf "$(BUILD_DIR)"
