/**
 * blender-preview — host half of dsh-blender-preview.
 *
 * SCAFFOLD: this row proves the mount and runs one boot self-check. Nothing
 * here exports or serves a scene yet. The planned implementation:
 *
 *  - resolve the Blender executable (PATH, common install locations, and an
 *    explicit `blenderPath` config override), reporting the fix when absent;
 *  - export a .blend to GLB with headless Blender (`blender --background
 *    --python-expr ...`), cached by file mtime + size so reopening a preview
 *    costs nothing;
 *  - serve the cached GLB to the browser half, plus scene statistics.
 *
 * @module blender-preview
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'blender-preview'

/**
 * No service is required to mount. Soft-inject (ctx.inject) anything the
 * implementation needs, so a missing service degrades this plugin instead of
 * taking the whole row down.
 */
export const inject = []

/** Dependency this package ships (npm `dsh-blender`, by CheshireJCat). */
const DEPENDENCY = 'dsh-blender'

function packageOwnName() {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ).name
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/**
 * Boot self-check (non-mutating): for every profile that depends on this
 * package, verify the `dsh-blender` dependency is installed in that
 * profile's node_modules AND mounted in its `dsh.profile.bundles`. When
 * either is missing, log the exact one-liner that repairs it — this row
 * never installs or edits anything itself.
 *
 * pnpm installs this package's `dependencies` into the profile when the
 * package is added from the registry or GitHub; a `link:` dev profile must
 * hold `dsh-blender` on its own (which is already the case on the maintainer
 * machine), so the check reports there instead of assuming.
 */
function checkBlenderDependency(log) {
  const dir = join(dshHome(), 'profiles')
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
  } catch {
    log?.warn?.('[blender-preview] self-check: cannot list profiles; skipped')
    return
  }

  const own = packageOwnName()
  let checked = 0
  for (const entry of entries) {
    const profileDir = join(dir, entry.name)
    let pkg
    try {
      pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    } catch {
      continue // not a package-based profile
    }
    if (!pkg?.dependencies?.[own]) continue

    checked += 1
    const installed = existsSync(join(profileDir, 'node_modules', DEPENDENCY))
    const mounted =
      Array.isArray(pkg?.dsh?.profile?.bundles) &&
      pkg.dsh.profile.bundles.includes(DEPENDENCY)
    if (installed && mounted) continue

    const why = !installed
      ? `${DEPENDENCY} is not installed`
      : `${DEPENDENCY} is installed but not in dsh.profile.bundles`
    log?.warn?.(
      `[blender-preview] ${why} in profile "${entry.name}" — run: npx @deepseek-ai/dsh plugin --profile ${entry.name} add ${DEPENDENCY}`,
    )
  }

  if (checked === 0) {
    log?.debug?.('[blender-preview] self-check: no profile depends on this package; nothing to check')
  }
}

export function apply(ctx, config = {}) {
  // ctx.get, not ctx.logger: property access on an undeclared service throws
  // in cordis. Guarded so logging can never break the mount.
  let logger
  try {
    logger = ctx.get?.('logger')
  } catch {
    logger = undefined
  }

  try {
    logger?.info?.('[blender-preview] scaffold mounted (implementation pending)')
  } catch {
    // No usable logger: mounting still succeeds.
  }

  // Boot self-check for the dsh-blender dependency — read-only, and it can
  // never throw out of apply().
  try {
    checkBlenderDependency(logger)
  } catch (err) {
    try {
      logger?.warn?.(
        `[blender-preview] self-check failed (ignored): ${err?.message ?? String(err)}`,
      )
    } catch {
      // Nothing left to do; the mount still succeeds.
    }
  }

  // TODO(implementation): register the host-side export/serve operations the
  // browser half calls. Every spawned Blender child needs an 'error' listener
  // and a timeout — a missing binary must report, never crash the host.
}

export default { apply, inject, name }
