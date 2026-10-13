/**
 * PRATYAKSHA Extension Build Script (esbuild)
 * Sovereign Privacy-First Browser Agent
 *
 * Compiles modular LangChain and LangGraph agent architecture from `src/`
 * into optimized, browser-ready ES modules inside `pratyaksha-extension/agent/`
 * and creates a self-contained production `build/` directory ready for Chrome "Load unpacked".
 */

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, cpSync, copyFileSync, rmSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EXT_DIR = join(__dirname, 'pratyaksha-extension');
const BUILD_DIR = join(__dirname, 'build');

async function buildExtension() {
  console.log('🚀 Building PRATYAKSHA Agent Extension Bundle with esbuild...');

  try {
    // 1. Ensure output directories exist
    mkdirSync(join(EXT_DIR, 'agent'), { recursive: true });

    // 2. Esbuild plugin stubbing server logger from faultkit in browser bundle
    const stubFaultkitLoggerPlugin = {
      name: 'stub-faultkit-logger',
      setup(build) {
        build.onResolve({ filter: /logger(\.js)?$/ }, (args) => {
          if (args.importer && args.importer.includes('faultkit')) {
            return { path: 'stub-faultkit-logger', namespace: 'faultkit-stub' };
          }
        });
        build.onLoad({ filter: /.*/, namespace: 'faultkit-stub' }, () => ({
          contents: `
export const logger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
  trace: () => {},
  child: () => logger
};
export const createLogger = () => logger;
export const createAppErrorSerializer = () => (err) => ({
  message: err?.message,
  code: err?.code || err?.errorCode,
  statusCode: err?.statusCode,
  stack: err?.stack
});
export const DEFAULT_REDACT_KEYS = [];
`,
          loader: 'js'
        }));
      }
    };

    // 3. Bundle src/runner.js into pratyaksha-extension/agent/graph-engine.js
    const bundleResult = await esbuild.build({
      entryPoints: [join(__dirname, 'src/runner.js')],
      outfile: join(EXT_DIR, 'agent/graph-engine.js'),
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: ['chrome120'],
      minify: false,
      sourcemap: false,
      plugins: [stubFaultkitLoggerPlugin],
      banner: {
        js: `/* PRATYAKSHA Sovereign LangChain + LangGraph Autonomous Agent Bundle */
if (typeof globalThis.process === 'undefined') {
  globalThis.process = {
    env: {
      NODE_ENV: 'development',
      SERVICE_NAME: 'pratyaksha',
      LOG_LEVEL: 'info'
    },
    version: 'v20.0.0',
    versions: { node: '20.0.0' },
    platform: 'browser',
    nextTick: (cb, ...args) => setTimeout(() => cb(...args), 0)
  };
}
var process = globalThis.process;`
      },
      define: {
        'process.env.NODE_ENV': '"development"',
        'process.env.SERVICE_NAME': '"pratyaksha"',
        'process.env.LOG_LEVEL': '"info"'
      }
    });

    console.log('✔ Built pratyaksha-extension/agent/graph-engine.js successfully.');

    // 3. Assemble clean standalone production `build/` folder for Chrome unpacked loading
    console.log('📦 Assembling standalone production `build/` directory for Chrome...');

    if (existsSync(BUILD_DIR)) {
      rmSync(BUILD_DIR, { recursive: true, force: true });
    }
    mkdirSync(BUILD_DIR, { recursive: true });

    // Copy runtime folders
    const foldersToCopy = ['assets', 'background', 'content', 'popup', 'sidepanel', 'vault'];
    for (const folder of foldersToCopy) {
      const srcFolder = join(EXT_DIR, folder);
      if (existsSync(srcFolder)) {
        cpSync(srcFolder, join(BUILD_DIR, folder), { recursive: true });
      }
    }

    // Copy agent folder containing only graph-engine.js
    mkdirSync(join(BUILD_DIR, 'agent'), { recursive: true });
    copyFileSync(
      join(EXT_DIR, 'agent/graph-engine.js'),
      join(BUILD_DIR, 'agent/graph-engine.js')
    );

    // Copy top-level extension files
    const filesToCopy = ['manifest.json', 'env.js', 'env.example.js', '.env'];
    for (const file of filesToCopy) {
      const srcFile = join(EXT_DIR, file);
      if (existsSync(srcFile)) {
        copyFileSync(srcFile, join(BUILD_DIR, file));
      }
    }

    console.log(`✔ Assembled standalone build directory: ${BUILD_DIR}`);
    console.log('\n======================================================');
    console.log('✅ EXTENSION READY TO UNPACK IN CHROME');
    console.log('👉 To load in Chrome:');
    console.log('   1. Open chrome://extensions/');
    console.log('   2. Turn on "Developer mode" (top-right)');
    console.log('   3. Click "Load unpacked"');
    console.log(`   4. Select EITHER folder:`);
    console.log(`      • ${BUILD_DIR} (clean standalone build)`);
    console.log(`      • ${EXT_DIR} (development extension folder)`);
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ Build failed:', err);
    process.exit(1);
  }
}

buildExtension();
