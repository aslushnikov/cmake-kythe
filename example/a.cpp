#include <stdio.h>

OPUS_EXPORT int main() {
  fprintf(stderr, "%s\n", GETTEXT_PACKAGE);
  return 0;
}
