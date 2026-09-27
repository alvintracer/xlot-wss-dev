# Tenant UI-kit contract

Every institution is a configuration and presentation package, not an application fork.

Put institution screenshots and design evidence in `tenants/<tenant>/ui-kit/`. Add a `README.md` that points to the authoritative `AGENT_IMPLEMENTATION_BRIEF.md`, design guide, tokens, contract, and QA checklist. Agents must read that brief before tenant-visible UI work.

Reference images are evidence and remain unchanged. Put crops, measurements, generated tokens, preview HTML, and comparison output inside a separate extracted-guide directory with provenance.

Tenant-specific runtime behavior belongs in the tenant package or a named provider adapter. Shared WebView code must consume a manifest/presentation contract and must not branch on the tenant name.
