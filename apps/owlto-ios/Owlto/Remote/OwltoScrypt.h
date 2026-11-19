#ifndef OWLTO_SCRYPT_H
#define OWLTO_SCRYPT_H

#include <stddef.h>
#include <stdint.h>

/*
 * scrypt (RFC 7914) with PBKDF2-HMAC-SHA256 from CommonCrypto. It stretches a pairing
 * code exactly as the Mac's Node `crypto.scrypt` does. It is C so a Debug build still
 * finishes N = 2^15 in well under a second. Returns 0 on success, -1 on bad parameters
 * or a failed allocation.
 */
int owlto_scrypt(const uint8_t *password, size_t password_length, const uint8_t *salt,
                 size_t salt_length, uint64_t n, uint32_t r, uint32_t p, uint8_t *out,
                 size_t out_length);

#endif
