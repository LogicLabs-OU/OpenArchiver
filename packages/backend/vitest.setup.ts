// Minimal env so the config module graph loads during unit tests without a real
// .env or live services. `||=` leaves any real value in place. These unit tests
// never touch storage/DB/search — they only need config import to succeed.
process.env.STORAGE_TYPE ||= 'local';
process.env.STORAGE_LOCAL_ROOT_PATH ||= '/tmp/oa-test-storage';
// 64-char hex (32 bytes), validated by config/storage.ts.
process.env.STORAGE_ENCRYPTION_KEY ||= '0'.repeat(64);
