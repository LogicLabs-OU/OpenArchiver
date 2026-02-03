# Audit Log

The Audit Log is an enterprise-grade feature designed to provide a complete, immutable, and verifiable record of every significant action that occurs within the Open Archiver system. Its primary purpose is to ensure compliance with strict regulatory standards, such as the German GoBD, by establishing a tamper-proof chain of evidence for all activities.

## Core Principles

To fulfill its compliance and security functions, the audit log adheres to the following core principles:

### 1. Immutability

Every log entry is cryptographically chained to the previous one. Each new entry contains a SHA-256 hash of the preceding entry's hash, creating a verifiable chain. Any attempt to alter or delete a past entry would break this chain and be immediately detectable through the verification process.

### 2. Completeness

The system is designed to log every significant event without exception. This includes not only user-initiated actions (like logins, searches, and downloads) but also automated system processes, such as data ingestion and policy-based deletions.

### 3. Attribution

Each log entry is unambiguously linked to the actor that initiated the event. This could be a specific authenticated user, an external auditor, or an automated system process. The actor's identifier and source IP address are recorded to ensure full traceability.

### 4. Clarity and Detail

Log entries are structured to be detailed and human-readable, providing sufficient context for an auditor to understand the event without needing specialized system knowledge. This includes the action performed, the target resource affected, and a JSON object with specific, contextual details of the event.

### 5. Verifiability

The integrity of the entire audit log can be verified at any time. A dedicated process iterates through the logs from the beginning, recalculating the hash of each entry and comparing it to the stored hash, ensuring the cryptographic chain is unbroken and no entries have been tampered with.
