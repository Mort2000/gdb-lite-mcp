#include <stddef.h>
#include <stdio.h>

typedef enum {
  EVENT_CAPTURE,
  EVENT_REFUND,
  EVENT_RETRY,
  EVENT_SETTLE
} EventKind;

typedef struct {
  const char *event_id;
  const char *account_id;
  EventKind kind;
  int cents;
  int retry_after_ms;
} SettlementEvent;

typedef struct {
  int captured_cents;
  int refunded_cents;
  int settled_cents;
  int retry_events;
} AccountLedger;

static void apply_money(AccountLedger *ledger, const SettlementEvent *event) {
  if (event->kind == EVENT_CAPTURE) {
    ledger->captured_cents += event->cents;
  } else if (event->kind == EVENT_REFUND) {
    ledger->refunded_cents += event->cents;
  } else if (event->kind == EVENT_SETTLE) {
    ledger->settled_cents += event->cents;
  }
}

static int replay_journal(const SettlementEvent *events, size_t count, AccountLedger *ledger) {
  size_t cursor = 0;

  while (cursor < count) {
    const SettlementEvent *event = &events[cursor];

    if (event->kind == EVENT_RETRY) {
      ledger->retry_events++;
      if (event->retry_after_ms == 0) {
        continue;
      }
    } else {
      apply_money(ledger, event);
    }

    cursor++;
  }

  return ledger->captured_cents - ledger->refunded_cents - ledger->settled_cents;
}

int main(void) {
  const SettlementEvent events[] = {
    {"evt-1000", "merchant-17", EVENT_CAPTURE, 12500, 0},
    {"evt-1001", "merchant-17", EVENT_REFUND, 1500, 0},
    {"evt-1002", "merchant-17", EVENT_RETRY, 0, 0},
    {"evt-1003", "merchant-17", EVENT_SETTLE, 11000, 0},
  };
  AccountLedger ledger = {0, 0, 0, 0};

  puts("replaying settlement journal for merchant-17");
  fflush(stdout);

  int open_cents = replay_journal(events, sizeof(events) / sizeof(events[0]), &ledger);
  printf("open_cents=%d retry_events=%d\n", open_cents, ledger.retry_events);
  return 0;
}
