# CW12EU-T Data Viewer

A public, local-only and read-only viewer for CW12EU-T customer delivery v2 ZIP
packages and standalone HDF5 3.1.0 datasets.

The browser reads selected files locally. The application has no upload API,
analytics, authentication or persistent dataset store. Complete delivery ZIPs
provide synchronized review video, frozen taxonomy names and package metadata;
a standalone HDF5 provides SI sensor data and stable label codes only.

## Development

```bash
npm ci
npm test
npm run build
npm run dev
```

Open <http://127.0.0.1:5173>. Chromium desktop is the release acceptance
browser. The advanced HDF5 tree uses H5Web/h5wasm; the tailored CW12EU-T views
use the frozen project contract in `docs/contracts/`.

Temporary OPFS storage is used only as a media fallback when a browser cannot
play a video directly from its ZIP slice. It is cleared on page load and can
also be cleared from the footer.

## Security and integrity boundary

The viewer rejects unknown package major versions, compressed/encrypted ZIP
members, path traversal, duplicate members, missing inventory entries and the
wrong HDF5 shape/version/rate. It intentionally does not recompute every
SHA-256 automatically. Verify `SHA256SUMS` separately when transfer integrity
must be established.

The MIT license applies to this viewer, not to any dataset opened with it.
