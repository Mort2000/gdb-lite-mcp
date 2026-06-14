#ifndef VENDOR_MANIFEST_H
#define VENDOR_MANIFEST_H

#include <stddef.h>

typedef enum {
  VENDOR_MANIFEST_OK = 0,
  VENDOR_MANIFEST_IO = 1,
  VENDOR_MANIFEST_FORMAT = 2,
  VENDOR_MANIFEST_RANGE = 3,
} VendorManifestStatus;

/*
 * Reads a vendor manifest feed and writes the canonical audit key into out.
 * required_size receives the size needed by the normalized key data.
 */
VendorManifestStatus vendor_manifest_key_from_file(const char *path,
                                                   char *out,
                                                   size_t out_size,
                                                   size_t *required_size);

/*
 * Applies the vendor audit normalization rules in place.
 */
VendorManifestStatus vendor_manifest_stamp(char *key, unsigned mode);

#endif
