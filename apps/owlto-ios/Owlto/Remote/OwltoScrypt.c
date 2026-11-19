#include "OwltoScrypt.h"

#include <CommonCrypto/CommonCryptoError.h>
#include <CommonCrypto/CommonKeyDerivation.h>
#include <stdlib.h>
#include <string.h>

static inline uint32_t rotl(uint32_t a, int b) { return (a << b) | (a >> (32 - b)); }

static inline uint32_t le32dec(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static inline void le32enc(uint8_t *p, uint32_t x) {
  p[0] = (uint8_t)x;
  p[1] = (uint8_t)(x >> 8);
  p[2] = (uint8_t)(x >> 16);
  p[3] = (uint8_t)(x >> 24);
}

static void salsa20_8(uint32_t b[16]) {
  uint32_t x[16];
  memcpy(x, b, sizeof(x));
  for (int i = 0; i < 8; i += 2) {
    x[4] ^= rotl(x[0] + x[12], 7);
    x[8] ^= rotl(x[4] + x[0], 9);
    x[12] ^= rotl(x[8] + x[4], 13);
    x[0] ^= rotl(x[12] + x[8], 18);
    x[9] ^= rotl(x[5] + x[1], 7);
    x[13] ^= rotl(x[9] + x[5], 9);
    x[1] ^= rotl(x[13] + x[9], 13);
    x[5] ^= rotl(x[1] + x[13], 18);
    x[14] ^= rotl(x[10] + x[6], 7);
    x[2] ^= rotl(x[14] + x[10], 9);
    x[6] ^= rotl(x[2] + x[14], 13);
    x[10] ^= rotl(x[6] + x[2], 18);
    x[3] ^= rotl(x[15] + x[11], 7);
    x[7] ^= rotl(x[3] + x[15], 9);
    x[11] ^= rotl(x[7] + x[3], 13);
    x[15] ^= rotl(x[11] + x[7], 18);
    x[1] ^= rotl(x[0] + x[3], 7);
    x[2] ^= rotl(x[1] + x[0], 9);
    x[3] ^= rotl(x[2] + x[1], 13);
    x[0] ^= rotl(x[3] + x[2], 18);
    x[6] ^= rotl(x[5] + x[4], 7);
    x[7] ^= rotl(x[6] + x[5], 9);
    x[4] ^= rotl(x[7] + x[6], 13);
    x[5] ^= rotl(x[4] + x[7], 18);
    x[11] ^= rotl(x[10] + x[9], 7);
    x[8] ^= rotl(x[11] + x[10], 9);
    x[9] ^= rotl(x[8] + x[11], 13);
    x[10] ^= rotl(x[9] + x[8], 18);
    x[12] ^= rotl(x[15] + x[14], 7);
    x[13] ^= rotl(x[12] + x[15], 9);
    x[14] ^= rotl(x[13] + x[12], 13);
    x[15] ^= rotl(x[14] + x[13], 18);
  }
  for (int i = 0; i < 16; i++) b[i] += x[i];
}

/* BlockMix: 2r 64-byte blocks in, even outputs to the first half and odd to the second. */
static void block_mix(const uint32_t *in, uint32_t *out, uint32_t r) {
  uint32_t x[16];
  memcpy(x, &in[(2 * r - 1) * 16], sizeof(x));
  for (uint32_t i = 0; i < 2 * r; i++) {
    for (int k = 0; k < 16; k++) x[k] ^= in[i * 16 + k];
    salsa20_8(x);
    uint32_t slot = (i & 1) ? r + (i >> 1) : (i >> 1);
    memcpy(&out[slot * 16], x, sizeof(x));
  }
}

static void smix(uint8_t *block, uint32_t r, uint64_t n, uint32_t *v, uint32_t *x, uint32_t *y) {
  const size_t words = 32 * (size_t)r;
  const size_t bytes = 128 * (size_t)r;
  for (size_t k = 0; k < words; k++) x[k] = le32dec(&block[4 * k]);
  for (uint64_t i = 0; i < n; i++) {
    memcpy(&v[i * words], x, bytes);
    block_mix(x, y, r);
    memcpy(x, y, bytes);
  }
  for (uint64_t i = 0; i < n; i++) {
    /* Integerify: the first word of the last block; n is a power of two below 2^32. */
    uint64_t j = x[(2 * r - 1) * 16] & (n - 1);
    const uint32_t *vj = &v[j * words];
    for (size_t k = 0; k < words; k++) x[k] ^= vj[k];
    block_mix(x, y, r);
    memcpy(x, y, bytes);
  }
  for (size_t k = 0; k < words; k++) le32enc(&block[4 * k], x[k]);
}

int owlto_scrypt(const uint8_t *password, size_t password_length, const uint8_t *salt,
                 size_t salt_length, uint64_t n, uint32_t r, uint32_t p, uint8_t *out,
                 size_t out_length) {
  if (n < 2 || (n & (n - 1)) != 0 || n > ((uint64_t)1 << 32) || r == 0 || p == 0) return -1;
  const size_t block_bytes = 128 * (size_t)r;
  uint8_t *b = malloc(block_bytes * p);
  uint32_t *x = malloc(block_bytes);
  uint32_t *y = malloc(block_bytes);
  uint32_t *v = malloc(block_bytes * (size_t)n);
  int status = -1;
  if (!b || !x || !y || !v) goto done;
  if (CCKeyDerivationPBKDF(kCCPBKDF2, (const char *)password, password_length, salt, salt_length,
                           kCCPRFHmacAlgSHA256, 1, b, block_bytes * p) != kCCSuccess)
    goto done;
  for (uint32_t i = 0; i < p; i++) smix(&b[i * block_bytes], r, n, v, x, y);
  if (CCKeyDerivationPBKDF(kCCPBKDF2, (const char *)password, password_length, b,
                           block_bytes * p, kCCPRFHmacAlgSHA256, 1, out, out_length) != kCCSuccess)
    goto done;
  status = 0;
done:
  if (b) memset(b, 0, block_bytes * p);
  free(b);
  free(x);
  free(y);
  free(v);
  return status;
}
