# R2 command environment notes

- Windows Node ESM dynamic import rejected a raw absolute C: path with ERR_UNSUPPORTED_ESM_URL_SCHEME before starting any server. Use pathToFileURL(path).href for dynamic imports in subsequent Windows probes.
- The initial live probe incorrectly expected raw arrays from host session/message pagination; corrected to the established data.items contract. The failed run exited and removed its isolated home. This was a probe assertion error, not a product failure.
