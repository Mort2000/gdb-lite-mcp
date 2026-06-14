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
	mkdir -p "$(BUILD_DIR)/bin" "$(STAGE_DIR)/src"
	cp "$(PUBLIC_DIR)/invoice_export.c" "$(STAGE_DIR)/src/invoice_export.c"
	cd "$(STAGE_DIR)" && $(CC) $(CFLAGS) $(PATH_CFLAGS) "src/invoice_export.c" -o "$(BUILD_DIR)/bin/invoice-export"
	rm -f "$(BUILD_DIR)/bin/invoice-export.core"
	run_dir="$$(mktemp -d /tmp/invoice-export-core.XXXXXX)"; \
	mkdir -p "$$run_dir/bin"; \
	cp "$(BUILD_DIR)/bin/invoice-export" "$$run_dir/bin/invoice-export"; \
	cd "$$run_dir" && env -i PATH="$$PATH" HOME="$${HOME:-/tmp}" LC_ALL=C gdb --quiet --nx --nh --batch \
		-ex "set pagination off" \
		-ex "set confirm off" \
		-ex "run" \
		-ex "generate-core-file bin/invoice-export.core" \
		-ex "quit" \
		"bin/invoice-export" >/dev/null 2>&1 || true; \
	test -f "$$run_dir/bin/invoice-export.core" && cp "$$run_dir/bin/invoice-export.core" "$(BUILD_DIR)/bin/invoice-export.core"; \
	rm -rf "$$run_dir"
	test -f "$(BUILD_DIR)/bin/invoice-export.core"

install: build
	mkdir -p "$(WORKSPACE_DIR)/src" "$(WORKSPACE_DIR)/bin"
	cp "$(PUBLIC_DIR)/invoice_export.c" "$(WORKSPACE_DIR)/src/invoice_export.c"
	cp "$(BUILD_DIR)/bin/invoice-export" "$(WORKSPACE_DIR)/bin/invoice-export"
	rm -f "$(WORKSPACE_DIR)/bin/invoice-export.core"
	cd "$(WORKSPACE_DIR)" && env -i PATH="$$PATH" HOME="$${HOME:-/tmp}" LC_ALL=C gdb --quiet --nx --nh --batch \
		-ex "set pagination off" \
		-ex "set confirm off" \
		-ex "run" \
		-ex "generate-core-file bin/invoice-export.core" \
		-ex "quit" \
		"bin/invoice-export" >/dev/null 2>&1 || true
	test -f "$(WORKSPACE_DIR)/bin/invoice-export.core"

clean:
	rm -rf "$(BUILD_DIR)"
