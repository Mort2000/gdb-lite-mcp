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
	cp "$(PUBLIC_DIR)/settlement_cursor.c" "$(STAGE_DIR)/src/settlement_cursor.c"
	cd "$(STAGE_DIR)" && $(CC) $(CFLAGS) $(PATH_CFLAGS) "src/settlement_cursor.c" -o "$(BUILD_DIR)/settlement-cursor"

install: build
	mkdir -p "$(WORKSPACE_DIR)/src" "$(WORKSPACE_DIR)/bin"
	cp "$(PUBLIC_DIR)/settlement_cursor.c" "$(WORKSPACE_DIR)/src/settlement_cursor.c"
	cp "$(BUILD_DIR)/settlement-cursor" "$(WORKSPACE_DIR)/bin/settlement-cursor"

clean:
	rm -rf "$(BUILD_DIR)"
