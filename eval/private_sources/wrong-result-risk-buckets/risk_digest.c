#include "risk_digest.h"

static uint8_t classify_score(uint64_t score) {
  if (score >= 30000000ULL) {
    return 3;
  }
  if (score >= 10000000ULL) {
    return 2;
  }
  if (score >= 2500000ULL) {
    return 1;
  }
  return 0;
}

static uint32_t risk_score(const Position *position) {
  uint32_t net_exposure =
      position->exposure_cents - position->collateral_cents;
  return (net_exposure * position->volatility_bp) / 100U;
}

uint8_t risk_bucket_for(const Position *position) {
  return classify_score(risk_score(position));
}

static uint32_t mix_u32(uint32_t digest, uint32_t value) {
  digest ^= value;
  digest *= 16777619U;
  return digest;
}

static uint32_t mix_id(uint32_t digest, const char *id) {
  for (size_t i = 0; id[i] != '\0'; i++) {
    digest = mix_u32(digest, (uint8_t)id[i]);
  }
  return digest;
}

uint32_t risk_digest_book(const Position *positions, size_t count) {
  uint32_t digest = 2166136261U;

  for (size_t i = 0; i < count; i++) {
    digest = mix_id(digest, positions[i].id);
    digest = mix_u32(digest, positions[i].exposure_cents);
    digest = mix_u32(digest, positions[i].collateral_cents);
    digest = mix_u32(digest, positions[i].volatility_bp);
    digest = mix_u32(digest, risk_bucket_for(&positions[i]));
  }

  return digest;
}
