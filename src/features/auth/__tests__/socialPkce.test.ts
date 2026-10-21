/**
 * PKCE for the provider pages. The SHA-256 vectors are iOS's nonce-hash
 * vectors (SocialSignInTests.testTheNonceHashIsLowercaseHexSHA256: the
 * standard digest, lower-case hex); the challenge is RFC 7636 Appendix B's
 * own example.
 */
import { base64UrlEncode, CODE_CHALLENGE_METHOD, codeChallenge, newCodeVerifier, sha256Hex } from '../socialPkce';

describe('PKCE', () => {
  it('hashes with the standard SHA-256 (iOS vectors)', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('makes the S256 challenge of RFC 7636 Appendix B', () => {
    expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    expect(CODE_CHALLENGE_METHOD).toBe('s256');
  });

  it('a verifier is 43 unreserved characters and never repeats', () => {
    const a = newCodeVerifier();
    const b = newCodeVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('base64url has no padding and uses - and _', () => {
    expect(base64UrlEncode(new Uint8Array([]))).toBe('');
    expect(base64UrlEncode(new Uint8Array([0xfb]))).toBe('-w');
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('-_-_');
    expect(base64UrlEncode(new TextEncoder().encode('LifePass'))).toBe('TGlmZVBhc3M');
  });
});
