#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "vendor_manifest.h"

#define DEFAULT_FEED_PATH "data/manifest-feed.bin"
#define KEY_CAPACITY 48
#define CANARY_CAPACITY 24
#define STAGE_CAPACITY 16

typedef struct {
  char key[KEY_CAPACITY];
  char canary[CANARY_CAPACITY];
  char stage[STAGE_CAPACITY];
} ImportJob;

static void init_job(ImportJob *job) {
  memset(job->key, 'k', sizeof(job->key));
  memset(job->canary, 'x', sizeof(job->canary));
  snprintf(job->stage, sizeof(job->stage), "queued");
}

static int canary_ok(const ImportJob *job) {
  for (size_t i = 0; i < sizeof(job->canary); i++) {
    if (job->canary[i] != 'x') {
      return 0;
    }
  }
  return 1;
}

static int prepare_import(ImportJob *job, const char *feed_path) {
  size_t required_size = 0;
  VendorManifestStatus status = vendor_manifest_key_from_file(
      feed_path, job->key, sizeof(job->key), &required_size);
  if (status != VENDOR_MANIFEST_OK) {
    fprintf(stderr, "manifest key build failed: status=%d\n", status);
    return 2;
  }

  status = vendor_manifest_stamp(job->key, 0x31U);
  if (status != VENDOR_MANIFEST_OK) {
    fprintf(stderr, "manifest stamp failed: status=%d\n", status);
    return 2;
  }

  return 0;
}

int main(int argc, char **argv) {
  const char *feed_path = argc > 1 ? argv[1] : DEFAULT_FEED_PATH;
  ImportJob job;

  init_job(&job);
  int setup_status = prepare_import(&job, feed_path);
  if (setup_status != 0) {
    return setup_status;
  }

  int ok = canary_ok(&job);
  printf("import_job_status=%s\n", ok ? "ok" : "CORRUPTED");

  return ok ? 0 : 1;
}
