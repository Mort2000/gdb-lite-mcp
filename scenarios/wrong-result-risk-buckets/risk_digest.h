#ifndef RISK_DIGEST_H
#define RISK_DIGEST_H

#include <stddef.h>
#include <stdint.h>

typedef struct {
  char id[32];
  uint32_t exposure_cents;
  uint32_t collateral_cents;
  uint32_t volatility_bp;
} Position;

uint8_t risk_bucket_for(const Position *position);
uint32_t risk_digest_book(const Position *positions, size_t count);

#endif
