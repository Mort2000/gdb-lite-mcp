#include <stdio.h>

#define DAYS 3
#define INF 1000000

static int prices[DAYS] = {9, 100, 9};
static int memo[DAYS];

static int min_int(int a, int b) {
  return a < b ? a : b;
}

static int solve(int day, int coupon_used) {
  if (day == DAYS) {
    return 0;
  }
  if (memo[day] != -1) {
    return memo[day];
  }

  int buy_full = prices[day] + solve(day + 1, coupon_used);
  int buy_discounted = INF;
  if (!coupon_used) {
    buy_discounted = prices[day] / 2 + solve(day + 1, 1);
  }

  memo[day] = min_int(buy_full, buy_discounted);
  return memo[day];
}

int main(void) {
  for (int i = 0; i < DAYS; i++) {
    memo[i] = -1;
  }
  int actual = solve(0, 0);
  int expected = 68;
  printf("min_cost=%d expected=%d\n", actual, expected);
  return actual == expected ? 0 : 1;
}
