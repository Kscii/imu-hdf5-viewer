# CW12EU-T Data Viewer

A public, local-only and read-only viewer for the two HDF5 3.2 profiles:

- `training_dataset`: the exact 25 Hz SI core used by the benchmark and training.
- `client_delivery`: the same core plus byte-identical MP4 media, piecewise timing,
  and frozen label names.

ZIP delivery, HDF5 3.1 and the experimental pre-3.2 container are intentionally not
supported. The browser reads the selected H5 locally; the application has no upload
API, analytics, authentication, or persistent dataset store.

## Development

```bash
npm ci
npm test
npm run build
npm run dev
```

Open <http://127.0.0.1:5173>. The tailored view supports both profiles without
H5Web. The advanced HDF5 tree is lazy-loaded in a separate full-screen view so its
visual system and bundle do not interfere with synchronized playback.

The two tiny browser fixtures are checked in so ordinary CI does not install Python,
HDF5, FFmpeg, or browser bundles. Every pull request runs unit tests, one production
build, and both profiles in the runner's system Chrome. The full Playwright Chromium,
Firefox, and WebKit suite runs weekly, manually, and for published releases. Regenerate
the fixtures with `scripts/create-test-fixtures.py` only when the contract fixture
changes. A release still requires the current full-size delivery to pass
`scripts/accept-client-h5.mjs` and observed Windows and macOS acceptance before the
public download is switched.

Temporary OPFS storage is used only as a media fallback when a browser cannot play a
video directly from the physical HDF5 byte range. It is cleared on page load and can
also be cleared from the footer.

## Security and integrity boundary

The viewer accepts only HDF5 3.2 `training_dataset` and `client_delivery` layouts.
It validates the shared tables and, for a client delivery, the frozen media, timing,
and label indexes before presenting the file. Multi-gigabyte files are not hashed
automatically; whole-file SHA-256 is an explicit, cancellable action. Compare that
digest with the value shown by the annotation platform or delivery response.

The canonical contract is mirrored and digest-locked at
`docs/contracts/imu-hdf5-v3.2.md`.

The MIT license applies to this viewer, not to any dataset opened with it.
