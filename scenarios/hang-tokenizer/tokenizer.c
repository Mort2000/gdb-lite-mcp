#include <ctype.h>
#include <stdio.h>

static int scan_tokens(const char *input) {
  int pos = 0;
  int tokens = 0;

  while (input[pos] != '\0') {
    if (isalpha((unsigned char)input[pos])) {
      while (isalnum((unsigned char)input[pos])) {
        pos++;
      }
      tokens++;
    } else if (input[pos] == '_') {
      tokens++;
      continue;
    } else {
      pos++;
    }
  }

  return tokens;
}

int main(void) {
  const char *input = "alpha_beta gamma";
  int tokens = scan_tokens(input);
  printf("tokens=%d expected=3\n", tokens);
  return tokens == 3 ? 0 : 1;
}
