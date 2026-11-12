window.__ModuleLoader__.load({
  id: "dsh-blender-preview",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    /**
     * blender-preview — browser half of dsh-blender-preview.
     *
     * SCAFFOLD: mounts and does nothing yet. Planned:
     *  - a right-sidebar tab that opens when a .blend file is previewed;
     *  - an interactive WebGL viewport (orbit/zoom/pan) drawing the GLB the
     *    host half exports;
     *  - scene statistics: object/mesh/material counts and bounds.
     *
     * Every service must be soft-injected (ctx.inject) so a profile without
     * the right-sidebar service still mounts this plugin.
     */

    const inject = [];

    function apply(ctx) {
      // TODO(implementation): register the sidebar tab type and the viewport
      // body here, keyed under one stable tab id.
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
