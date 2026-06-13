#include <stdio.h>
#include <stddef.h>

#define ROUND_COUNT 10

typedef struct {
  const char *id;
  double opening;
  double credit_a;
  double credit_b;
  double debit;
  double expect;
} LedgerRound;

static double compute_actual(const LedgerRound *round) {
  double actual = round->opening;
  actual += round->credit_a;
  actual += round->credit_b;
  actual -= round->debit;
  return actual;
}

int main(void) {
  const LedgerRound rounds[ROUND_COUNT] = {
      {"round-01", 100.0, 12.5, 0.0, 7.5, 105.0},
      {"round-02", 48.0, 1.25, 0.75, 0.5, 49.5},
      {"round-03", 20.0, 2.0, 4.0, 1.0, 25.0},
      {"round-04", 81.0, 0.5, 0.25, 0.75, 81.0},
      {"round-05", 16.0, 8.0, 0.125, 0.125, 24.0},
      {"round-06", 9.0, 6.5, 0.5, 3.0, 13.0},
      {"round-07", 0.0, 0.1, 0.2, 0.3, 0.0},
      {"round-08", 32.0, 0.25, 0.25, 0.5, 32.0},
      {"round-09", 7.0, 10.0, 1.0, 8.0, 10.0},
      {"round-10", 120.0, 2.5, 1.5, 4.0, 120.0},
  };

  int final_result = 0;
  for (size_t round = 0; round < ROUND_COUNT; round++) {
    double actual = compute_actual(&rounds[round]);
    double expect = rounds[round].expect;

    if (actual != expect) {
      final_result = 1;
    }
  }

  printf("ledger_float_status=%d\n", final_result);
  return final_result;
}
