// src/brain/brain-encryption.ts — ChaCha20-Poly1305 encrypted brain-at-rest
// v6.0.0 — Hive Mind Edition
//
// Encrypts the global brain file on disk with ChaCha20-Poly1305 AEAD.
// Key is derived from a user passphrase (or OS-keychain-managed value).
//
// Node 22 supports chacha20-poly1305 natively via crypto.createCipheriv.

import * as crypto from 'crypto';
import * as fs from 'fs';
import { EncryptedBrainFile } from '../types.js';

const CIPHER = 'chacha20-poly1305';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const SALT_BYTES = 16;

export class BrainEncryption {
  /** Derive a 32-byte key from a passphrase + salt (scrypt). */
  static deriveKey(passphrase: string, salt: Buffer): Buffer {
    return crypto.scryptSync(passphrase, salt, KEY_BYTES, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  }

  /** Encrypt plaintext bytes with a passphrase. Returns a JSON-friendly structure. */
  static encrypt(plaintext: string | Buffer, passphrase: string): EncryptedBrainFile {
    const salt = crypto.randomBytes(SALT_BYTES);
    const nonce = crypto.randomBytes(NONCE_BYTES);
    const key = BrainEncryption.deriveKey(passphrase, salt);
    const cipher = crypto.createCipheriv(CIPHER, key, nonce, { authTagLength: 16 });
    const buf = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf-8') : plaintext;
    const encrypted = Buffer.concat([cipher.update(buf), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      schemaVersion: 1,
      cipher: CIPHER,
      salt: salt.toString('base64'),
      nonce: nonce.toString('base64'),
      ciphertext: encrypted.toString('base64'),
      authTag: authTag.toString('base64'),
      createdAt: new Date().toISOString(),
    };
  }

  /** Decrypt an encrypted file. Throws if passphrase is wrong or data tampered. */
  static decrypt(encrypted: EncryptedBrainFile, passphrase: string): Buffer {
    const salt = Buffer.from(encrypted.salt, 'base64');
    const nonce = Buffer.from(encrypted.nonce, 'base64');
    const authTag = Buffer.from(encrypted.authTag, 'base64');
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');
    const key = BrainEncryption.deriveKey(passphrase, salt);
    const decipher = crypto.createDecipheriv(CIPHER, key, nonce, { authTagLength: 16 });
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /** Encrypt a file path in-place (atomic). */
  static async encryptFile(filePath: string, passphrase: string): Promise<void> {
    const plaintext = fs.readFileSync(filePath);
    const encrypted = BrainEncryption.encrypt(plaintext, passphrase);
    const tmp = filePath + '.enc.tmp';
    fs.writeFileSync(tmp, JSON.stringify(encrypted));
    fs.renameSync(tmp, filePath + '.enc');
    fs.unlinkSync(filePath);
  }

  /** Decrypt a .enc file back to plaintext. */
  static async decryptFile(encPath: string, passphrase: string, outPath?: string): Promise<string> {
    const raw = fs.readFileSync(encPath, 'utf-8');
    const parsed = JSON.parse(raw) as EncryptedBrainFile;
    const plain = BrainEncryption.decrypt(parsed, passphrase);
    const target = outPath ?? encPath.replace(/\.enc$/, '');
    fs.writeFileSync(target, plain);
    return target;
  }
}
