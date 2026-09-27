# Lightweight UI reference intake

Use this process when a tenant supplies a new screenshot batch.

1. Place the untouched files under `tenants/<tenant>/ui-kit/new/`.
2. Inspect only the visible title, primary action, and dominant state.
3. Rename in place to `<domain>-<screen>-<state-or-variant>.<extension>` using lowercase kebab-case.
4. Add a short `README.md` index with the screen role and the one or two design traits the image supports.
5. Do not crop, recompress, OCR into product code, or copy customer data into the index.
6. Add screenshots containing direct customer, account, address, or contact data to the local folder's `.gitignore`. Request a masked copy before promoting them to versioned references.
7. After design extraction, move approved and masked evidence to the tenant's permanent reference directory; keep `new/` as an intake area.

This is intentionally a human-in-the-loop naming pass rather than an OCR pipeline. It is faster for small batches, avoids false Korean text extraction, and prevents unreviewed personal data from becoming filenames or metadata.
