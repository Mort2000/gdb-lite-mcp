#include <stdio.h>
#include <string.h>

typedef struct {
  char label[8];
  int checksum;
  int count;
} Packet;

static int checksum_for_count(int count) {
  return count * 31 + 7;
}

static void load_label(Packet *packet, const char *source) {
  memcpy(packet->label, source, strlen(source) + 1);
}

static void prepare_packet(Packet *packet) {
  packet->count = 5;
  packet->checksum = checksum_for_count(packet->count);
  load_label(packet, "priority-high");
}

int main(void) {
  Packet packet = {{0}, 0, 0};
  prepare_packet(&packet);
  int expected = checksum_for_count(5);
  printf("label=%s checksum=%d expected=%d count=%d\n",
         packet.label,
         packet.checksum,
         expected,
         packet.count);
  return packet.checksum == expected ? 0 : 1;
}
