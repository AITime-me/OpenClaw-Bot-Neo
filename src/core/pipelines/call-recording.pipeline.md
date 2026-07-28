# Call recording pipeline

This document describes a future contract, not an implemented integration or speech provider.

## Separated artifacts

1. **Source audio** — authenticated, validated untrusted media in temporary encrypted storage.
2. **Derived transcript** — text with independent provenance, privacy classification and retention.
3. **Analytical result** — structured needs, objections, agreements, manager errors, follow-up need
   and recommendations produced from the transcript.

The call-analysis skill receives only the authorised transcript and metadata. A service integration
is separately responsible for authenticated ingestion and never inherits the skill's business logic.

## Ordered flow

1. verify owner/account authorisation and source provenance;
2. verify signature, timestamp, replay status, idempotency and rate limit for automated ingestion;
3. enforce payload size and media validation;
4. classify privacy and define separate audio/transcript/analysis retention;
5. place audio in temporary encrypted storage;
6. call a provider-independent speech-to-text capability;
7. scan the transcript with `SensitiveDataScannerPort`;
8. call the separately registered call-analysis capability;
9. scan the structured result before memory or audit sinks;
10. require scoped owner approval before any third-party send or integration write;
11. record safe audit metadata and cleanup status;
12. delete temporary audio on success, failure or cancellation.

## Required invariants

- Every run has source provenance, correlation ID, idempotency key, finite timeout and cancellation.
- Indefinite storage is disabled by default.
- Audio, transcript and analysis have separately configurable retention and cleanup status.
- Cancellation stops downstream work and triggers temporary-audio cleanup.
- Unavailable STT or analysis capability is an explicit safe failure, never fake success.
- There is no hidden paid-provider switch and no API-key fallback.
- The analysis is never sent to a third party without scoped approval.
- No STT provider, call-service adapter, network call or real recognition is implemented here.
