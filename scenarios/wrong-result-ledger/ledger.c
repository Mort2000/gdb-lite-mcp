#include <stdio.h>

typedef enum {
  TX_CHARGE,
  TX_REFUND,
  TX_FEE,
  TX_ADJUSTMENT
} TxKind;

typedef struct {
  const char *id;
  TxKind kind;
  int cents;
} Transaction;

static int apply_transaction(int balance, Transaction tx) {
  switch (tx.kind) {
    case TX_CHARGE:
      return balance + tx.cents;
    case TX_REFUND:
      return balance - tx.cents;
    case TX_FEE:
      return balance - tx.cents;
    case TX_ADJUSTMENT:
      return balance + tx.cents;
  }
  return balance;
}

static int close_ledger(const Transaction *txs, int count, int opening_balance) {
  int balance = opening_balance;
  for (int i = 0; i < count; i++) {
    balance = apply_transaction(balance, txs[i]);
  }
  return balance;
}

int main(void) {
  Transaction txs[] = {
      {"sale-100", TX_CHARGE, 4200},
      {"monthly-fee", TX_FEE, 125},
      {"refund-42", TX_REFUND, 800},
      {"sale-101", TX_CHARGE, 500},
      {"manual-adjust", TX_ADJUSTMENT, -300},
  };
  int actual = close_ledger(txs, 5, 10000);
  int expected = 14475;
  printf("closing_balance=%d expected=%d\n", actual, expected);
  return actual == expected ? 0 : 1;
}
