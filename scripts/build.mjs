import esbuild from 'esbuild';
import fs from 'node:fs';

// Clear out any previously built files that no longer exist
if (fs.existsSync('dist')) {
    fs.rmSync('dist', { recursive: true });
}

esbuild.build({
    entryPoints: ['src/main.js'],
    outfile: 'dist/main.cjs',
    format: 'cjs',
    platform: 'node',
    bundle: true,
    sourcemap: true,
    external: ['vscode'],
    // TBR: this is a workaround until https://github.com/microsoft/node-jsonc-parser/pull/78 is merged.
    // `project-update` relies on that package and will be bundled incorrectly otherwise
    mainFields: ['module', 'main'],
});
