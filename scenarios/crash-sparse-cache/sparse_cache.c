#include <stdio.h>
#include <string.h>

typedef struct {
  const char *key;
  int value;
} Entry;

static Entry cache[] = {
    {"alpha", 41},
    {"beta", 17},
    {NULL, 0},
    {"gamma", 99},
    {"delta", 12},
};

static Entry *find_entry(const char *key) {
  for (int i = 0; i < 5; i++) {
    if (cache[i].key == NULL) {
      return NULL;
    }
    if (strcmp(cache[i].key, key) == 0) {
      return &cache[i];
    }
  }
  return NULL;
}

static int read_metric(const char *key) {
  Entry *entry = find_entry(key);
  return entry->value;
}

int main(void) {
  const char *keys[] = {"alpha", "beta", "gamma", "delta"};
  int total = 0;
  for (int i = 0; i < 4; i++) {
    total += read_metric(keys[i]);
  }
  printf("total=%d\n", total);
  return 0;
}
