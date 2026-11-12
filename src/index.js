/**
 * blender-preview — host half of dsh-blender-preview.
 *
 * SCAFFOLD: this file only proves the row mounts. Nothing here exports or
 * serves anything yet. The planned implementation:
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

export const name = 'blender-preview'

/**
 * No service is required to mount. Soft-inject (ctx.inject) anything the
 * implementation needs, so a missing service degrades this plugin instead of
 * taking the whole row down.
 */
export const inject = []

export function apply(ctx, config = {}) {
  // ctx.get, not ctx.logger: property access on an undeclared service throws
  // in cordis. Guarded so logging can never break the mount.
  try {
    ctx.get?.('logger')?.info?.('[blender-preview] scaffold mounted (implementation pending)')
  } catch {
    // No logger service: mounting still succeeds.
  }

  // TODO(implementation): register the host-side export/serve operations the
  // browser half calls. Every spawned Blender child needs an 'error' listener
  // and a timeout — a missing binary must report, never crash the host.
}

export default { apply, inject, name }
