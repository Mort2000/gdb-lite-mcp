SCENARIO_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
BUILD_DIR ?= $(SCENARIO_DIR)/build
WORKSPACE_DIR ?= $(SCENARIO_DIR)/workspace
PUBLIC_DIR := $(SCENARIO_DIR)/public
STAGE_DIR := $(BUILD_DIR)/stage
CC ?= gcc
CFLAGS ?= -g -O0 -Wall -Wextra
PATH_CFLAGS := -fdebug-prefix-map=$(STAGE_DIR)=. -ffile-prefix-map=$(STAGE_DIR)=.

.PHONY: build install clean

build:
	mkdir -p "$(BUILD_DIR)" "$(STAGE_DIR)/src"
	cp "$(PUBLIC_DIR)/packet.c" "$(STAGE_DIR)/src/packet.c"
	cd "$(STAGE_DIR)" && $(CC) $(CFLAGS) $(PATH_CFLAGS) "src/packet.c" -o "$(BUILD_DIR)/packet"

install: build
	mkdir -p "$(WORKSPACE_DIR)/src" "$(WORKSPACE_DIR)/bin"
	cp "$(PUBLIC_DIR)/packet.c" "$(WORKSPACE_DIR)/src/packet.c"
	cp "$(BUILD_DIR)/packet" "$(WORKSPACE_DIR)/bin/packet"

clean:
	rm -rf "$(BUILD_DIR)"
