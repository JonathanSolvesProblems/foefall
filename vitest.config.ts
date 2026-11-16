import { configDefaults, defineConfig } from 'vitest/config';

// The type checker writes compiled copies of every file (tests included) to .tsbuild; run only the sources.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, '.tsbuild/**', 'tmp/**'] },
});
