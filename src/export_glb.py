# blender-preview: export the opened .blend as one GLB for the browser viewer.
#
# Run by Blender in the background:
#   blender -b --factory-startup <file.blend> --python export_glb.py -- <out.glb>
#
# Only options this Blender's glTF exporter actually has are passed, so a
# renamed or removed option on another Blender version is skipped rather than
# failing the whole export.
import bpy
import json
import sys

argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]

wanted = {
    "export_format": "GLB",
    "export_animations": True,     # actions, rigs, shape keys
    "export_apply": True,          # modifiers applied, as the viewport shows them
    "export_yup": True,
    "export_cameras": False,
    "export_lights": False,
    "export_extras": False,
}
props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
kwargs = {key: value for key, value in wanted.items() if key in props}

scene = bpy.context.scene
info = {
    "blender": bpy.app.version_string,
    "objects": len(bpy.data.objects),
    "meshes": len(bpy.data.meshes),
    "materials": len(bpy.data.materials),
    "actions": len(bpy.data.actions),
    "frameStart": scene.frame_start,
    "frameEnd": scene.frame_end,
    "fps": scene.render.fps / (scene.render.fps_base or 1),
}

bpy.ops.export_scene.gltf(filepath=out, **kwargs)
print("BLEND_PREVIEW_INFO " + json.dumps(info), flush=True)
