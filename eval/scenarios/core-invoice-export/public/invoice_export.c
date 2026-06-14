#include <stdio.h>
#include <string.h>

typedef struct {
  const char *account_id;
  const char *display_name;
  int active;
} Account;

typedef struct {
  const char *invoice_id;
  const char *account_id;
  int cents;
} Invoice;

static const Account accounts[] = {
  {"acct-100", "Northwind Medical", 1},
  {"acct-200", "Blue Mesa Logistics", 0},
  {"acct-300", "Contoso Retail", 1},
};

static const Account *find_active_account(const char *account_id) {
  size_t count = sizeof(accounts) / sizeof(accounts[0]);
  for (size_t i = 0; i < count; i++) {
    if (accounts[i].active && strcmp(accounts[i].account_id, account_id) == 0) {
      return &accounts[i];
    }
  }
  return NULL;
}

static void emit_invoice_row(FILE *out, const Invoice *invoice, const Account *account) {
  fprintf(out, "%s,%s,%d\n", invoice->invoice_id, account->display_name, invoice->cents);
}

static int export_invoices(FILE *out, const Invoice *invoices, size_t count) {
  int exported = 0;

  for (size_t i = 0; i < count; i++) {
    const Account *account = find_active_account(invoices[i].account_id);
    emit_invoice_row(out, &invoices[i], account);
    exported++;
  }

  return exported;
}

int main(void) {
  const Invoice invoices[] = {
    {"inv-7001", "acct-100", 42000},
    {"inv-7002", "acct-200", 18500},
    {"inv-7003", "acct-300", 9900},
  };

  int exported = export_invoices(stdout, invoices, sizeof(invoices) / sizeof(invoices[0]));
  printf("exported=%d\n", exported);
  return 0;
}
