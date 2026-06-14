#include "vendor_manifest.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  const unsigned char *data;
  size_t len;
} FieldSlice;

typedef struct {
  FieldSlice tenant;
  FieldSlice region;
  FieldSlice source;
  FieldSlice book;
  FieldSlice instrument;
  FieldSlice batch;
} ManifestFields;

enum {
  TAG_TENANT = 1,
  TAG_REGION = 2,
  TAG_SOURCE = 3,
  TAG_BOOK = 4,
  TAG_INSTRUMENT = 5,
  TAG_BATCH = 6,
};

static uint16_t read_le16(const unsigned char *p) {
  return (uint16_t)p[0] | (uint16_t)((uint16_t)p[1] << 8);
}

static VendorManifestStatus read_file(const char *path,
                                      unsigned char **data,
                                      size_t *size) {
  FILE *fp = fopen(path, "rb");
  if (fp == NULL) {
    return VENDOR_MANIFEST_IO;
  }
  if (fseek(fp, 0, SEEK_END) != 0) {
    fclose(fp);
    return VENDOR_MANIFEST_IO;
  }
  long length = ftell(fp);
  if (length < 0 || length > 16384) {
    fclose(fp);
    return VENDOR_MANIFEST_RANGE;
  }
  if (fseek(fp, 0, SEEK_SET) != 0) {
    fclose(fp);
    return VENDOR_MANIFEST_IO;
  }

  unsigned char *buffer = malloc((size_t)length);
  if (buffer == NULL) {
    fclose(fp);
    return VENDOR_MANIFEST_IO;
  }
  size_t got = fread(buffer, 1, (size_t)length, fp);
  fclose(fp);
  if (got != (size_t)length) {
    free(buffer);
    return VENDOR_MANIFEST_IO;
  }

  *data = buffer;
  *size = (size_t)length;
  return VENDOR_MANIFEST_OK;
}

static int required_fields_present(const ManifestFields *fields) {
  return fields->tenant.data != NULL && fields->region.data != NULL &&
         fields->source.data != NULL && fields->book.data != NULL &&
         fields->instrument.data != NULL && fields->batch.data != NULL;
}

static void assign_field(ManifestFields *fields,
                         uint8_t tag,
                         const unsigned char *value,
                         size_t len) {
  FieldSlice slice = {value, len};
  switch (tag) {
    case TAG_TENANT:
      fields->tenant = slice;
      break;
    case TAG_REGION:
      fields->region = slice;
      break;
    case TAG_SOURCE:
      fields->source = slice;
      break;
    case TAG_BOOK:
      fields->book = slice;
      break;
    case TAG_INSTRUMENT:
      fields->instrument = slice;
      break;
    case TAG_BATCH:
      fields->batch = slice;
      break;
    default:
      break;
  }
}

static VendorManifestStatus parse_manifest(const unsigned char *data,
                                           size_t size,
                                           ManifestFields *fields) {
  if (size < 6 || memcmp(data, "VMF1", 4) != 0 || data[4] != 1) {
    return VENDOR_MANIFEST_FORMAT;
  }

  memset(fields, 0, sizeof(*fields));
  size_t cursor = 6;
  unsigned int records = data[5];
  for (unsigned int i = 0; i < records; i++) {
    if (cursor + 3 > size) {
      return VENDOR_MANIFEST_FORMAT;
    }
    uint8_t tag = data[cursor++];
    uint16_t len = read_le16(data + cursor);
    cursor += 2;
    if (cursor + len > size) {
      return VENDOR_MANIFEST_FORMAT;
    }
    assign_field(fields, tag, data + cursor, len);
    cursor += len;
  }

  return required_fields_present(fields) ? VENDOR_MANIFEST_OK
                                         : VENDOR_MANIFEST_FORMAT;
}

static void emit_byte(char value,
                      char *out,
                      size_t out_size,
                      size_t *required_size) {
  if (*required_size < out_size) {
    out[*required_size] = value;
  }
  (*required_size)++;
}

static void emit_literal(const char *value,
                         char *out,
                         size_t out_size,
                         size_t *required_size) {
  for (size_t i = 0; value[i] != '\0'; i++) {
    emit_byte(value[i], out, out_size, required_size);
  }
}

static void emit_field(FieldSlice field,
                       char *out,
                       size_t out_size,
                       size_t *required_size) {
  for (size_t i = 0; i < field.len; i++) {
    emit_byte((char)field.data[i], out, out_size, required_size);
  }
}

static size_t compose_key(const ManifestFields *fields,
                          char *out,
                          size_t out_size) {
  size_t required_size = 0;
  emit_literal("tenant=", out, out_size, &required_size);
  emit_field(fields->tenant, out, out_size, &required_size);
  emit_literal(";region=", out, out_size, &required_size);
  emit_field(fields->region, out, out_size, &required_size);
  emit_literal(";source=", out, out_size, &required_size);
  emit_field(fields->source, out, out_size, &required_size);
  emit_literal(";book=", out, out_size, &required_size);
  emit_field(fields->book, out, out_size, &required_size);
  emit_literal(";instrument=", out, out_size, &required_size);
  emit_field(fields->instrument, out, out_size, &required_size);
  emit_literal(";batch=", out, out_size, &required_size);
  emit_field(fields->batch, out, out_size, &required_size);

  if (required_size < out_size) {
    out[required_size] = '\0';
  }
  return required_size;
}

VendorManifestStatus vendor_manifest_key_from_file(const char *path,
                                                   char *out,
                                                   size_t out_size,
                                                   size_t *required_size) {
  if (path == NULL || out == NULL || required_size == NULL) {
    return VENDOR_MANIFEST_FORMAT;
  }

  unsigned char *data = NULL;
  size_t size = 0;
  VendorManifestStatus status = read_file(path, &data, &size);
  if (status != VENDOR_MANIFEST_OK) {
    return status;
  }

  ManifestFields fields;
  status = parse_manifest(data, size, &fields);
  if (status == VENDOR_MANIFEST_OK) {
    *required_size = compose_key(&fields, out, out_size);
  }

  free(data);
  return status;
}

static char stamped_char(unsigned char value) {
  if (value >= 'a' && value <= 'z') {
    return (char)(value - ('a' - 'A'));
  }
  if (value == '/' || value == ':' || value == ';' || value == ' ') {
    return '_';
  }
  return (char)value;
}

VendorManifestStatus vendor_manifest_stamp(char *key, unsigned mode) {
  (void)mode;
  if (key == NULL) {
    return VENDOR_MANIFEST_FORMAT;
  }

  for (size_t i = 0; i < 4096; i++) {
    if (key[i] == '\0') {
      return VENDOR_MANIFEST_OK;
    }
    key[i] = stamped_char((unsigned char)key[i]);
  }

  return VENDOR_MANIFEST_RANGE;
}
