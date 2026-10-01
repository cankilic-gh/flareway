"""Generate Flareway's original FT-172 trainer and fictional airfield kit.

Blender authoring axes: +X nose/forward, +Y port/left, +Z up.
The glTF exporter converts +Z up to Three.js +Y up.

No third-party meshes, textures, fonts, logos, or registrations are used.
"""
from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
AIRCRAFT_GLB = ROOT / "public/assets/aircraft/ft172-trainer.glb"
AIRFIELD_GLB = ROOT / "public/assets/airport/field-kit.glb"
BLEND_PATH = ROOT / "assets-src/blender/flareway-assets.blend"
RENDER_DIR = ROOT / "artifacts/qa/assets"

for directory in (AIRCRAFT_GLB.parent, AIRFIELD_GLB.parent, BLEND_PATH.parent, RENDER_DIR):
    directory.mkdir(parents=True, exist_ok=True)

QUICK = "--quick" in sys.argv
AIRCRAFT_ONLY = "--aircraft-only" in sys.argv


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        pass


def collection(name: str) -> bpy.types.Collection:
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def move_to_collection(obj: bpy.types.Object, col: bpy.types.Collection) -> None:
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    col.objects.link(obj)


def material(name: str, color: tuple[float, float, float, float], roughness: float, metallic: float = 0.0,
             emission: tuple[float, float, float] | None = None, emission_strength: float = 0.0,
             transmission: float = 0.0, alpha: float = 1.0) -> bpy.types.Material:
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.35 if name.startswith("Paint") else 0.0
        bsdf.inputs["Coat Roughness"].default_value = 0.12
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    if transmission:
        bsdf.inputs["Transmission Weight"].default_value = transmission
        bsdf.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "DITHERED"
        m.diffuse_color = (*color[:3], alpha)
    return m


def assign(obj: bpy.types.Object, mat: bpy.types.Material) -> bpy.types.Object:
    if obj.data and hasattr(obj.data, "materials"):
        obj.data.materials.append(mat)
    return obj


def empty(name: str, col: bpy.types.Collection, loc=(0.0, 0.0, 0.0), parent=None) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.25
    obj.location = loc
    col.objects.link(obj)
    if parent:
        obj.parent = parent
    return obj


def mesh_obj(name: str, verts, faces, col, mat=None, parent=None, smooth=True) -> bpy.types.Object:
    me = bpy.data.meshes.new(f"ME_{name}")
    me.from_pydata(verts, [], faces)
    me.update()
    obj = bpy.data.objects.new(name, me)
    col.objects.link(obj)
    if mat:
        me.materials.append(mat)
    if parent:
        obj.parent = parent
    if smooth:
        for poly in me.polygons:
            poly.use_smooth = True
    return obj


def cube(name: str, loc, scale, col, mat, parent=None, bevel=0.0, rotation=(0.0, 0.0, 0.0)) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (scale[0] / 2, scale[1] / 2, scale[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new("EdgeSoftening", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    assign(obj, mat)
    move_to_collection(obj, col)
    if parent:
        obj.parent = parent
    return obj


def sphere(name: str, loc, scale, col, mat, parent=None, segments=24, rings=12) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(obj, mat)
    move_to_collection(obj, col)
    if parent:
        obj.parent = parent
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def cylinder(name: str, loc, radius, depth, col, mat, parent=None, rotation=(0.0, 0.0, 0.0), vertices=20) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    move_to_collection(obj, col)
    if parent:
        obj.parent = parent
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def tube_between(name: str, a, b, radius, col, mat, parent=None, vertices=12) -> bpy.types.Object:
    a_v, b_v = Vector(a), Vector(b)
    direction = b_v - a_v
    mid = (a_v + b_v) * 0.5
    obj = cylinder(name, mid, radius, direction.length, col, mat, parent, vertices=vertices)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    return obj


def torus(name: str, loc, major, minor, col, mat, parent=None, rotation=(0.0, 0.0, 0.0), major_segments=24) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=major_segments,
                                    minor_segments=8, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    move_to_collection(obj, col)
    if parent:
        obj.parent = parent
    return obj


def parent_keep(obj: bpy.types.Object, parent: bpy.types.Object) -> None:
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


def fuselage_loft(name: str, stations, col, mat, parent) -> bpy.types.Object:
    rings = 24
    verts = []
    for x, half_w, half_h, zc in stations:
        for j in range(rings):
            ang = 2 * math.pi * j / rings
            y = math.cos(ang) * half_w
            z_shape = math.sin(ang)
            if z_shape < -0.55:
                z_shape = -0.55 + (z_shape + 0.55) * 0.48
            z = zc + z_shape * half_h
            verts.append((x, y, z))
    faces = []
    for i in range(len(stations) - 1):
        for j in range(rings):
            a = i * rings + j
            b = i * rings + (j + 1) % rings
            c = (i + 1) * rings + (j + 1) % rings
            d = (i + 1) * rings + j
            faces.append((a, b, c, d))
    faces.append(tuple(range(rings - 1, -1, -1)))
    last = (len(stations) - 1) * rings
    faces.append(tuple(last + j for j in range(rings)))
    obj = mesh_obj(name, verts, faces, col, mat, parent)
    bevel = obj.modifiers.new("FuselageNormals", "WEIGHTED_NORMAL")
    bevel.keep_sharp = True
    return obj


def wing_panel(name: str, y0: float, y1: float, lead0: float, trail0: float, lead1: float, trail1: float,
               z0: float, z1: float, thickness0: float, thickness1: float, col, mat, parent) -> bpy.types.Object:
    def section(y, lead, trail, z, thickness):
        chord = lead - trail
        return [
            (lead, y, z),
            (lead - chord * 0.20, y, z + thickness * 0.52),
            (trail + chord * 0.12, y, z + thickness * 0.16),
            (trail, y, z),
            (trail + chord * 0.12, y, z - thickness * 0.12),
            (lead - chord * 0.20, y, z - thickness * 0.42),
        ]
    verts = section(y0, lead0, trail0, z0, thickness0) + section(y1, lead1, trail1, z1, thickness1)
    faces = []
    for i in range(6):
        faces.append((i, (i + 1) % 6, 6 + (i + 1) % 6, 6 + i))
    faces.extend([(5, 4, 3, 2, 1, 0), (6, 7, 8, 9, 10, 11)])
    obj = mesh_obj(name, verts, faces, col, mat, parent, smooth=False)
    bevel = obj.modifiers.new("AirfoilEdges", "BEVEL")
    bevel.width = min(thickness0, thickness1) * 0.18
    bevel.segments = 2
    return obj


def control_panel(name: str, hinge_x: float, y0: float, y1: float, trail0: float, trail1: float,
                  z0: float, z1: float, thickness: float, col, mat, root, axis_runtime: str) -> bpy.types.Object:
    pivot = empty(name, col, (hinge_x, 0.0, 0.0), root)
    pivot["runtimeHingeAxis"] = axis_runtime
    pivot["maxDeflectionDeg"] = 20.0 if "Aileron" in name else 30.0
    verts = [
        (0, y0, z0 + thickness / 2), (trail0 - hinge_x, y0, z0),
        (0, y1, z1 + thickness / 2), (trail1 - hinge_x, y1, z1),
        (0, y0, z0 - thickness / 2), (trail0 - hinge_x, y0, z0 - thickness * 0.2),
        (0, y1, z1 - thickness / 2), (trail1 - hinge_x, y1, z1 - thickness * 0.2),
    ]
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 4, 6, 2), (1, 3, 7, 5), (0, 1, 5, 4), (2, 6, 7, 3)]
    child = mesh_obj(f"{name}_Surface", verts, faces, col, mat, pivot, smooth=False)
    bevel = child.modifiers.new("ControlEdges", "BEVEL")
    bevel.width = 0.018
    bevel.segments = 2
    return pivot


def add_text_mesh(name: str, text: str, loc, size: float, rotation, col, mat, parent) -> bpy.types.Object:
    bpy.ops.object.text_add(location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.extrude = 0.006
    obj.data.bevel_depth = 0.002
    assign(obj, mat)
    move_to_collection(obj, col)
    parent_keep(obj, parent)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return obj


def build_island_terrain(col, mats, parent):
    """Create a lightweight irregular island with a runway-safe central plateau."""
    segments = 72
    rings = 18
    verts = [(0.0, 0.0, -0.08)]
    for ring in range(1, rings + 1):
        r = ring / rings
        for i in range(segments):
            angle = 2 * math.pi * i / segments
            irregular = 1.0 + 0.045 * math.sin(angle * 5 + 0.8) + 0.025 * math.sin(angle * 11)
            x = math.cos(angle) * 590 * r * irregular
            y = math.sin(angle) * 260 * r * (1.0 + 0.035 * math.cos(angle * 7))
            coast = -2.35 + 2.30 * ((1.0 - r) ** 0.52)
            runway_flat = abs(y) < 72 and abs(x) < 520
            shoulder = max(0.0, min(1.0, (abs(y) - 55) / 175))
            hills = shoulder * (1.0 - r * 0.55) * (10.0 + 16.0 * (0.5 + 0.5 * math.sin(x * 0.018 + angle * 3)))
            z = -0.08 if runway_flat else coast + hills
            verts.append((x, y, z))
    faces = []
    for i in range(segments):
        faces.append((0, 1 + i, 1 + (i + 1) % segments))
    for ring in range(1, rings):
        a0 = 1 + (ring - 1) * segments
        b0 = 1 + ring * segments
        for i in range(segments):
            faces.append((a0 + i, b0 + i, b0 + (i + 1) % segments, a0 + (i + 1) % segments))
    terrain = mesh_obj("IslandTerrain", verts, faces, col, mats["grass"], parent, smooth=True)

    beach_verts = []
    for radius, z in ((0.88, -0.78), (1.015, -2.25)):
        for i in range(segments):
            angle = 2 * math.pi * i / segments
            irregular = 1.0 + 0.045 * math.sin(angle * 5 + 0.8) + 0.025 * math.sin(angle * 11)
            beach_verts.append((math.cos(angle) * 590 * radius * irregular,
                                math.sin(angle) * 260 * radius * (1.0 + 0.035 * math.cos(angle * 7)), z))
    beach_faces = []
    for i in range(segments):
        beach_faces.append((i, (i + 1) % segments, segments + (i + 1) % segments, segments + i))
    mesh_obj("BeachRing", beach_verts, beach_faces, col, mats["sand"], parent, smooth=True)
    cube("OceanReferencePlane", (0, 0, -2.55), (2200, 1600, 0.12), col, mats["water"], parent)

    for index, angle in enumerate((0.35, 1.2, 2.15, 2.75, 3.65, 4.55, 5.35, 5.85), 1):
        x = math.cos(angle) * 525
        y = math.sin(angle) * 228
        sphere(f"ShoreRock_{index}", (x, y, -0.4),
               (5.0 + index % 3 * 2.0, 3.5 + index % 2 * 1.8, 3.0 + index % 4),
               col, mats["cliff"], parent, 12, 6)

    spawns = empty("VegetationSpawns", col, parent=parent)
    for index in range(48):
        angle = 2 * math.pi * index / 48 + 0.17 * math.sin(index * 1.7)
        radius = 0.48 + 0.30 * ((index * 37) % 17) / 16
        x = math.cos(angle) * 545 * radius
        y = math.sin(angle) * 228 * radius
        if abs(y) < 65 and abs(x) < 540:
            y = 90 if y >= 0 else -90
        anchor = empty(f"VegetationSpawn_{index+1:02d}", col, (x, y, 0.0), spawns)
        anchor["variant"] = "conifer" if index % 3 == 0 else "deciduous"
        anchor["scaleSeed"] = round(0.78 + (index % 7) * 0.07, 3)
    return terrain


# --- FT-172 v2 geometry helpers -------------------------------------------------------------------------
# Proportions follow the published envelope of common four-seat high-wing trainers (8.28 m long, 11.0 m span,
# ~1.1 m cabin width); every curve here is original and parametric.

FUSELAGE_STATIONS = [
    # x, half width, top z, bottom z, top exponent, bottom exponent (superellipse; higher = boxier)
    (3.00, 0.29, 0.19, -0.22, 2.3, 2.3),
    (2.92, 0.38, 0.25, -0.29, 2.5, 2.6),
    (2.70, 0.45, 0.31, -0.34, 2.8, 3.0),
    (2.30, 0.50, 0.35, -0.37, 3.0, 3.2),
    (1.85, 0.53, 0.39, -0.41, 3.2, 3.4),
    (1.55, 0.553, 0.45, -0.43, 3.4, 3.6),
    (1.25, 0.565, 0.66, -0.45, 3.6, 3.8),
    (0.98, 0.57, 0.88, -0.46, 3.8, 3.9),
    (0.60, 0.575, 0.935, -0.46, 3.9, 3.9),
    (-0.30, 0.575, 0.94, -0.455, 3.9, 3.9),
    (-0.95, 0.56, 0.915, -0.40, 3.6, 3.6),
    # Aft fuselage: straight top and bottom lines from the cabin to the tail, as on the type's side view.
    (-1.50, 0.50, 0.855, -0.306, 3.2, 3.2),
    (-2.10, 0.40, 0.79, -0.203, 3.0, 3.0),
    (-2.80, 0.30, 0.713, -0.084, 2.8, 2.8),
    (-3.50, 0.21, 0.637, 0.036, 2.6, 2.6),
    (-4.20, 0.13, 0.56, 0.156, 2.4, 2.4),
    (-4.75, 0.075, 0.50, 0.25, 2.2, 2.2),
    (-4.98, 0.03, 0.48, 0.30, 2.0, 2.0),
]
RING = 40


def station_at(x: float):
    st = FUSELAGE_STATIONS
    if x >= st[0][0]:
        return st[0]
    if x <= st[-1][0]:
        return st[-1]
    for a, b in zip(st, st[1:]):
        if b[0] <= x <= a[0]:
            t = (a[0] - x) / (a[0] - b[0])
            return tuple(a[k] + (b[k] - a[k]) * t for k in range(6))
    return st[-1]


def skin_point(x: float, t: float, offset: float = 0.0):
    """Point on the fuselage skin at station x and section angle t (0 = port side, pi/2 = top)."""
    _, w, zt, zb, nt, nb = station_at(x)
    zc, h = (zt + zb) / 2, (zt - zb) / 2
    c, s_ = math.cos(t), math.sin(t)
    n = nt if s_ >= 0 else nb
    y = w * math.copysign(abs(c) ** (2 / n), c)
    z = zc + h * math.copysign(abs(s_) ** (2 / n), s_)
    if offset:
        d = Vector((0.0, y, (z - zc) * (w / max(h, 1e-3)))).normalized()
        y += d.y * offset
        z += d.z * offset
    return (x, y, z)


def fuselage_v2(name, col, mat, parent):
    verts, faces = [], []
    xs = [st[0] for st in FUSELAGE_STATIONS]
    for x in xs:
        for j in range(RING):
            verts.append(skin_point(x, 2 * math.pi * j / RING))
    for i in range(len(xs) - 1):
        for j in range(RING):
            a, b = i * RING + j, i * RING + (j + 1) % RING
            faces.append((a, b, b + RING, a + RING))
    faces.append(tuple(range(RING - 1, -1, -1)))
    last = (len(xs) - 1) * RING
    faces.append(tuple(last + j for j in range(RING)))
    obj = mesh_obj(name, verts, faces, col, mat, parent)
    sub = obj.modifiers.new("Smooth", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    return obj


def skin_patch(name, x0, x1, t0, t1, offset, col, mat, parent, nx=10, nt=8):
    """A panel that follows the fuselage skin between two stations and two section angles."""
    verts, faces = [], []
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        for j in range(nt + 1):
            verts.append(skin_point(x, t0 + (t1 - t0) * j / nt, offset))
    for i in range(nx):
        for j in range(nt):
            a = i * (nt + 1) + j
            faces.append((a, a + nt + 1, a + nt + 2, a + 1))
    return mesh_obj(name, verts, faces, col, mat, parent)


def skin_patch_sym(name, x0, x1, t0, t1, offset, col, mat, parent, **kw):
    skin_patch(f"{name}_L", x0, x1, t0, t1, offset, col, mat, parent, **kw)
    skin_patch(f"{name}_R", x0, x1, math.pi - t1, math.pi - t0, offset, col, mat, parent, **kw)


def naca(m: float, p: float, t: float, n: int = 14):
    """Closed NACA 4-digit profile (x/c from 1 over the top to 0 and back under), cosine spaced."""
    xs = [0.5 * (1 - math.cos(math.pi * i / n)) for i in range(n + 1)]
    upper, lower = [], []
    for x in xs:
        yt = 5 * t * (0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
        if m and x < p:
            yc, dy = m / p ** 2 * (2 * p * x - x * x), 2 * m / p ** 2 * (p - x)
        elif m:
            yc, dy = m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x * x), 2 * m / (1 - p) ** 2 * (p - x)
        else:
            yc, dy = 0.0, 0.0
        th = math.atan(dy)
        upper.append((x - yt * math.sin(th), yc + yt * math.cos(th)))
        lower.append((x + yt * math.sin(th), yc - yt * math.cos(th)))
    return list(reversed(upper)) + lower[1:]


def clip_profile(profile, x_from: float, x_to: float):
    """Keep the part of a closed profile between two chord fractions (straight cut faces)."""
    out = []
    n = len(profile)
    for i in range(n):
        a, b = profile[i], profile[(i + 1) % n]
        ina, inb = x_from <= a[0] <= x_to, x_from <= b[0] <= x_to
        if ina:
            out.append(a)
        if ina != inb:
            for edge in (x_from, x_to):
                if (a[0] - edge) * (b[0] - edge) < 0:
                    k = (edge - a[0]) / (b[0] - a[0])
                    out.append((edge, a[1] + (b[1] - a[1]) * k))
    return out


def airfoil_part(m: float, p: float, t: float, x0: float, x1: float, n: int = 12):
    """Closed polygon of a NACA 4-digit section between chord fractions x0..x1, always 2n points.

    Upper surface from x1 forward to x0, then lower surface back to x1. A fixed point count lets lofts blend
    sections with different cut positions (tapered wings) without twisting.
    """
    def surf(x):
        x = min(max(x, 0.0), 1.0)
        yt = 5 * t * (0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
        if m == 0:
            yc = 0.0
        elif x < p:
            yc = m / p ** 2 * (2 * p * x - x * x)
        else:
            yc = m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x * x)
        return yc + yt, yc - yt
    xs = [x0 + (x1 - x0) * 0.5 * (1 - math.cos(math.pi * i / (n - 1))) for i in range(n)]
    upper = [(x, surf(x)[0]) for x in reversed(xs)]
    lower = [(x, surf(x)[1]) for x in xs]
    if x0 <= 1e-6:
        lower = lower[1:] + [(x1, surf(x1)[1] - 1e-4)]
    return upper + lower


def surface_loft(name, sections, col, mat, parent, axis="y", smooth=True, cap=True):
    """Loft closed 2D profiles placed along an axis. Each section: (station, [(u, v), ...]) in world units.

    axis 'y': u -> x, v -> z (wings, stabilizers); axis 'z': u -> x, v -> y (fin, rudder).
    """
    count = len(sections[0][1])
    verts, faces = [], []
    for station, pts in sections:
        for u, v in pts:
            verts.append((u, station, v) if axis == "y" else (u, v, station))
    for i in range(len(sections) - 1):
        for j in range(count):
            a, b = i * count + j, i * count + (j + 1) % count
            faces.append((a, b, b + count, a + count))
    if cap:
        faces.append(tuple(range(count - 1, -1, -1)))
        last = (len(sections) - 1) * count
        faces.append(tuple(last + j for j in range(count)))
    obj = mesh_obj(name, verts, faces, col, mat, parent, smooth=smooth)
    wn = obj.modifiers.new("Normals", "WEIGHTED_NORMAL")
    wn.keep_sharp = True
    return obj


def place_profile(profile, le_x: float, chord: float, z: float, scale_t: float = 1.0, origin_x: float = 0.0):
    """Profile x/c runs forward-to-aft; aircraft +X is forward, so x = le_x - u * chord."""
    return [(le_x - u * chord - origin_x, z + v * chord * scale_t) for u, v in profile]


def build_aircraft(col, mats):
    root = empty("AircraftRoot", col)
    root["assetName"] = "Flareway Trainer FT-172"
    root["coordinateConvention"] = "+X forward, +Y port, +Z up in Blender; glTF exports +Y up"
    root["lengthM"] = 8.28
    root["wingspanM"] = 11.0
    root["originalLogoFree"] = True
    root["revision"] = 2

    W, ACC, DARK, MET = mats["white"], mats["accent"], mats["rubber"], mats["metal"]

    # Fuselage shell: boxy superellipse sections, deep cabin, tapering tail cone.
    fuselage_v2("Fuselage", col, W, root)

    # Cowling: front face with two intakes beside the spinner, seams, exhaust and oil door.
    for sign in (1, -1):
        sphere(f"CowlIntake_{sign}", (3.0, sign * 0.17, 0.02), (0.035, 0.11, 0.075), col, DARK, root, 20, 10)
        tube_between(f"Exhaust_{sign}", (2.18, sign * 0.30, -0.36), (1.98, sign * 0.33, -0.47), 0.025, col, mats["dark_metal"], root)
    skin_patch_sym("CowlSeam", 2.10, 2.13, -1.2, 1.2, 0.002, col, DARK, root, nx=1, nt=8)
    skin_patch("OilDoor", 2.55, 2.25, 1.35, 1.75, 0.002, col, DARK, root, nx=2, nt=2)

    # Windshield, side and rear glazing follow the skin; a darker gasket sits just under each pane.
    for gname, x0, x1, t0, t1 in (("Windshield", 1.53, 0.99, 0.30, math.pi - 0.30), ("RearWindow", -0.98, -1.58, 0.95, math.pi - 0.95)):
        skin_patch(f"{gname}_Gasket", x0 + 0.02, x1 - 0.02, t0 - 0.03, t1 + 0.03, 0.004, col, DARK, root, nx=10, nt=14)
        skin_patch(gname, x0, x1, t0, t1, 0.016, col, mats["glass"], root, nx=10, nt=14)
    for wname, x0, x1, t0, t1 in (("CabinWindow_Front", 0.93, 0.02, 0.16, 0.98), ("CabinWindow_Rear", -0.08, -0.88, 0.18, 0.92)):
        skin_patch_sym(f"{wname}_Gasket", x0 + 0.025, x1 - 0.025, t0 - 0.04, t1 + 0.04, 0.004, col, DARK, root, nx=8, nt=6)
        skin_patch_sym(wname, x0, x1, t0, t1, 0.016, col, mats["glass"], root, nx=8, nt=6)
    # Door outlines and handles.
    for dx in (0.97, -0.03):
        skin_patch_sym(f"DoorSeam_{dx}", dx + 0.006, dx - 0.006, -0.95, 1.05, 0.003, col, DARK, root, nx=1, nt=10)
    skin_patch_sym("DoorSeamBottom", 0.97, -0.03, -0.96, -0.92, 0.003, col, DARK, root, nx=6, nt=1)
    for sign in (1, -1):
        p = skin_point(0.16, 0.0 if sign > 0 else math.pi, 0.012)
        cube(f"DoorHandle_{sign}", (p[0], p[1], 0.36), (0.17, 0.03, 0.03), col, mats["dark_metal"], root, bevel=0.01)

    # Original livery: a cyan sweep with a charcoal pinstripe along each side, and a cyan band on the fin.
    skin_patch_sym("Livery_Cyan", 2.85, -4.85, -0.42, -0.26, 0.004, col, ACC, root, nx=40, nt=2)
    skin_patch_sym("Livery_Dark", 2.80, -4.80, -0.22, -0.18, 0.004, col, DARK, root, nx=40, nt=1)

    # Spinner and two twisted, tapered blades with painted tips.
    prop = empty("Propeller", col, (3.09, 0, 0.02), root)
    prop["runtimeAxis"] = "X"
    prop["maxRpm"] = 2700
    spin_sections = []
    for k, (dx, r) in enumerate(((-0.10, 0.22), (0.0, 0.215), (0.10, 0.19), (0.20, 0.14), (0.28, 0.075), (0.32, 0.02))):
        spin_sections.append((dx, [(r * math.cos(2 * math.pi * j / 24), r * math.sin(2 * math.pi * j / 24)) for j in range(24)]))
    sverts, sfaces = [], []
    for dx, ring in spin_sections:
        for y, z in ring:
            sverts.append((dx, y, z))
    for i in range(len(spin_sections) - 1):
        for j in range(24):
            a, b = i * 24 + j, i * 24 + (j + 1) % 24
            sfaces.append((a, b, b + 24, a + 24))
    sfaces.append(tuple(range(23, -1, -1)))
    last = (len(spin_sections) - 1) * 24
    sfaces.append(tuple(last + j for j in range(24)))
    mesh_obj("Propeller_Spinner", sverts, sfaces, col, MET, prop)
    blade_profile = naca(0.04, 0.4, 0.12, 8)
    for index, base in enumerate((0.0, math.pi), 1):
        sections = []
        for r, chord, twist in ((0.16, 0.13, 0.62), (0.30, 0.16, 0.48), (0.55, 0.15, 0.32), (0.80, 0.12, 0.22), (0.92, 0.09, 0.18), (0.96, 0.05, 0.16)):
            pts = []
            for u, v in blade_profile:
                lu, lv = (0.35 - u) * chord, v * chord
                pts.append((lu * math.cos(twist) - lv * math.sin(twist), lu * math.sin(twist) + lv * math.cos(twist)))
            sections.append((r, pts))
        verts, faces = [], []
        n = len(blade_profile)
        for r, pts in sections:
            for a_, b_ in pts:
                # Blade axis along +Y before rotation: chord in X-Z.
                verts.append((b_, r, a_))
        for i in range(len(sections) - 1):
            for j in range(n):
                a, b = i * n + j, i * n + (j + 1) % n
                faces.append((a, b, b + n, a + n))
        faces.append(tuple(range(n - 1, -1, -1)))
        last = (len(sections) - 1) * n
        faces.append(tuple(last + j for j in range(n)))
        blade = mesh_obj(f"Propeller_Blade_{index}", verts, faces, col, mats["prop"], prop)
        blade.rotation_euler.x = base
        tip = cube(f"Propeller_Tip_{index}", (0.0, 0.89, 0.0), (0.03, 0.12, 0.10), col, mats["tip"], prop, bevel=0.012)
        tip.rotation_euler = (base, 0.0, 0.0)
        tip.location = (0.0, 0.89 * math.cos(base), 0.89 * math.sin(base))

    # Wing: NACA 2412, constant chord inboard, tapering outboard, 1.7 deg dihedral, rounded tips.
    # The control surfaces share a straight hinge line at x = -0.68 so they rotate about the span axis.
    HINGE_X, CTRL_CHORD = -0.68, 0.42
    wing_root = empty("WingStatic", col, (0, 0, 0), root)
    wing_root["spanM"] = 11.0
    prof = naca(0.02, 0.4, 0.12, 16)

    def chord_at(y):
        a = abs(y)
        return 1.72 if a <= 2.6 else 1.72 - (a - 2.6) / (5.42 - 2.6) * 0.52

    def z_at(y):
        return 0.985 + abs(y) * math.tan(math.radians(1.7))

    def fixed_section(y, scale_t=1.0, chord_scale=1.0):
        c = chord_at(y) * chord_scale
        te = HINGE_X - CTRL_CHORD
        le = te + c
        frac = (le - HINGE_X) / c
        return (y, place_profile(airfoil_part(0.02, 0.4, 0.12, 0.0, frac, 14), le, c, z_at(y), scale_t))

    span_ys = [0.0, 0.58, 1.6, 2.6, 3.6, 4.6, 5.30, 5.42]
    sections = [fixed_section(-y) for y in reversed(span_ys[1:])] + [fixed_section(y) for y in span_ys]
    surface_loft("Wing_Main", [(y, pts) for y, pts in sections], col, W, wing_root)
    for sign, side in ((1, "L"), (-1, "R")):
        # Rounded tip cap: shrinking profiles past the last station.
        tip = [fixed_section(sign * 5.42)]
        for k, (dy, sc) in enumerate(((0.05, 0.85), (0.09, 0.6), (0.11, 0.3))):
            y = sign * (5.42 + dy)
            c = chord_at(5.42)
            te = HINGE_X - CTRL_CHORD
            le = te + c
            frac = (le - HINGE_X) / c
            tip.append((y, place_profile(airfoil_part(0.02, 0.4, 0.12, 0.0, frac, 14), le - (1 - sc) * 0.05, c - (1 - sc) * 0.10, z_at(5.42) - 0.015 * (1 - sc), sc)))
        if sign < 0:
            tip = list(reversed(tip))
        surface_loft(f"WingTip_{side}", tip, col, W, wing_root)
        # Fuel caps, nav light, pitot (port), landing light lens in the leading edge (port).
        cylinder(f"FuelCap_{side}", (0.30, sign * 1.25, z_at(1.25) + 0.11), 0.045, 0.02, col, MET, wing_root, vertices=16)
        sphere(f"NavLight_{'Port' if sign > 0 else 'Starboard'}", (0.15, sign * 5.53, z_at(5.42)), (0.08, 0.04, 0.035), col,
               mats["red_light"] if sign > 0 else mats["green_light"], root, 16, 8)
    tube_between("PitotTube", (0.20, 3.95, z_at(3.95) - 0.06), (0.62, 3.95, z_at(3.95) - 0.07), 0.009, col, mats["dark_metal"], root)
    sphere("LandingLight", (0.85, 2.0, z_at(2.0)), (0.03, 0.12, 0.05), col, mats["white_light"], root, 16, 8)

    def control_surface(name, y0, y1, mat_):
        pivot = empty(name, col, (HINGE_X, 0.0, 0.0), root)
        pivot["runtimeHingeAxis"] = "Z"
        pivot["maxDeflectionDeg"] = 20.0 if "Aileron" in name else 30.0
        secs = []
        for y in (y0, y1):
            c = chord_at(y)
            te = HINGE_X - CTRL_CHORD
            le = te + c
            frac = (le - HINGE_X) / c
            secs.append((y, place_profile(airfoil_part(0.02, 0.4, 0.12, frac + 0.006, 1.0, 8), le, c, z_at(y), 1.0, origin_x=HINGE_X)))
        if y1 < y0:
            secs = list(reversed(secs))
        surface_loft(f"{name}_Surface", secs, col, mat_, pivot, smooth=False)
        return pivot

    for sign, side in ((1, "L"), (-1, "R")):
        control_surface(f"Flap_{side}", sign * 0.60, sign * 3.12, W)
        control_surface(f"Aileron_{side}", sign * 3.16, sign * 5.30, W)
        # One faired strut per side from the lower fuselage to the wing.
        a = (0.06, sign * 0.52, -0.37)
        b = (0.12, sign * 2.95, z_at(2.95) - 0.08)
        strut = tube_between(f"WingStrut_{side}", a, b, 0.05, col, W, root, vertices=12)
        strut.scale = (1.0, 0.36, 1.0)
        cube(f"StrutFairing_{side}", (0.10, sign * 2.95, z_at(2.95) - 0.07), (0.30, 0.10, 0.06), col, W, root, bevel=0.03)

    # Horizontal tail: low on the tail cone, symmetric section, elevator on a straight hinge.
    tail_static = empty("TailStatic", col, parent=root)
    ELEV_HINGE = -4.12
    sprof = naca(0.0, 0.4, 0.10, 12)

    def stab_chord(y):
        a = abs(y)
        return 1.38 if a <= 1.2 else 1.38 - (a - 1.2) / (1.74 - 1.2) * 0.42

    def stab_section(y, scale=1.0):
        c = stab_chord(y)
        le = ELEV_HINGE + (c - 0.52)
        frac = (le - ELEV_HINGE) / c
        return (y, place_profile(airfoil_part(0.0, 0.4, 0.10, 0.0, frac, 12), le, c, 0.28, scale))

    stab_ys = [0.0, 0.6, 1.2, 1.6, 1.74]
    secs = [stab_section(-y) for y in reversed(stab_ys[1:])] + [stab_section(y) for y in stab_ys]
    surface_loft("Stabilizer", secs, col, W, tail_static)
    elevator = empty("Elevator", col, (ELEV_HINGE, 0, 0), root)
    elevator["runtimeHingeAxis"] = "Z"
    elevator["maxDeflectionDeg"] = 25.0
    for sign, side in ((1, "L"), (-1, "R")):
        es = []
        for y in (sign * 0.12, sign * 1.70):
            c = stab_chord(y)
            le = ELEV_HINGE + (c - 0.52)
            frac = (le - ELEV_HINGE) / c
            es.append((y, place_profile(airfoil_part(0.0, 0.4, 0.10, frac + 0.006, 1.0, 8), le, c, 0.28, 1.0, origin_x=ELEV_HINGE)))
        if sign < 0:
            es = list(reversed(es))
        surface_loft(f"Elevator_{side}_Surface", es, col, W, elevator, smooth=False)

    # Vertical tail: swept fin with a dorsal fillet, rudder on a vertical hinge.
    RUDDER_HINGE = -4.34
    fprof = naca(0.0, 0.4, 0.10, 12)
    fin_secs = []
    for z, le in ((0.55, -2.95), (0.70, -3.30), (1.00, -3.60), (1.35, -3.85), (1.62, -4.02)):
        c = le - RUDDER_HINGE
        pts = [(le - u * c, v * c) for u, v in fprof]
        fin_secs.append((z, pts))
    surface_loft("VerticalStabilizer", fin_secs, col, W, root, axis="z")
    dsecs = []
    for z, le in ((0.60, -2.25), (0.78, -2.85), (0.96, -3.38)):
        te = -3.95
        c = le - te
        dsecs.append((z, [(le - u * c, v * c * 0.55) for u, v in fprof]))
    surface_loft("DorsalFin", dsecs, col, W, root, axis="z")
    rudder = empty("Rudder", col, (RUDDER_HINGE, 0, 0.36), root)
    rudder["runtimeHingeAxis"] = "Y"
    rudder["maxDeflectionDeg"] = 28.0
    rprof = naca(0.0, 0.4, 0.09, 10)
    rsecs = []
    for z, chord in ((0.0, 0.62), (0.6, 0.56), (1.10, 0.46), (1.30, 0.30)):
        pts = [(-u * chord, v * chord * 0.8) for u, v in rprof]
        rsecs.append((z, pts))
    surface_loft("Rudder_Surface", rsecs, col, ACC, rudder, axis="z")
    sphere("Beacon", (-4.12, 0, 1.66), (0.05, 0.035, 0.05), col, mats["red_light"], root, 16, 8)

    # Cabin interior: four seats, panel with glareshield, two yokes.
    for x in (0.38, -0.55):
        for sign in (1, -1):
            cube(f"Seat_{x}_{sign}_Base", (x, sign * 0.27, -0.28), (0.50, 0.40, 0.14), col, mats["seat"], root, bevel=0.06)
            cube(f"Seat_{x}_{sign}_Back", (x - 0.20, sign * 0.27, 0.02), (0.14, 0.40, 0.58), col, mats["seat"], root, bevel=0.06, rotation=(0, -0.12, 0))
    cube("InstrumentPanel", (1.08, 0, 0.18), (0.10, 1.04, 0.42), col, mats["panel"], root, bevel=0.03, rotation=(0, -0.10, 0))
    cube("Glareshield", (1.04, 0, 0.42), (0.26, 1.04, 0.05), col, mats["panel"], root, bevel=0.02)
    for sign in (1, -1):
        for k in range(3):
            cylinder(f"Gauge_{sign}_{k}", (1.03, sign * (0.16 + k * 0.11), 0.26), 0.045, 0.012, col, mats["display"], root,
                     rotation=(0, math.pi / 2, 0), vertices=20)
        torus(f"Yoke_{sign}", (0.80, sign * 0.27, 0.16), 0.12, 0.016, col, DARK, root, rotation=(0, math.pi / 2, 0))
        tube_between(f"YokeStem_{sign}", (0.80, sign * 0.27, 0.16), (1.05, sign * 0.27, 0.16), 0.016, col, MET, root)

    # Fixed tricycle gear: spring-steel main legs, teardrop wheel fairings, oleo nose strut.
    def fairing(name, center, length, width, height):
        cx, cy, cz = center
        secs = []
        for u in (0.0, 0.08, 0.25, 0.5, 0.75, 0.92, 1.0):
            prof_r = (math.sin(math.pi * min(max(u * 0.92 + 0.04, 0), 1)) ** 0.6) * (1.0 - 0.35 * max(0.0, u - 0.5) * 2)
            xx = cx + length * (0.42 - u)
            ring = [(width * prof_r * math.cos(2 * math.pi * j / 20), height * prof_r * math.sin(2 * math.pi * j / 20)) for j in range(20)]
            secs.append((xx, ring))
        verts, faces = [], []
        for xx, ring in secs:
            for y, z in ring:
                verts.append((xx, cy + y, cz + z))
        for i in range(len(secs) - 1):
            for j in range(20):
                a, b = i * 20 + j, i * 20 + (j + 1) % 20
                faces.append((a, b, b + 20, a + 20))
        return mesh_obj(name, verts, faces, col, W, root)

    for sign, side in ((1, "L"), (-1, "R")):
        leg = tube_between(f"MainGearLeg_{side}", (-0.22, sign * 0.38, -0.44), (-0.18, sign * 0.96, -0.80), 0.045, col, MET, root, vertices=10)
        leg.scale = (1.0, 0.45, 1.0)
        wheel = empty(f"MainWheel_{side}", col, (-0.18, sign * 1.02, -0.80), root)
        wheel["runtimeAxis"] = "Z"
        torus(f"MainWheel_{side}_Tire", (0, 0, 0), 0.205, 0.075, col, mats["tire"], wheel, rotation=(math.pi / 2, 0, 0), major_segments=28)
        cylinder(f"MainWheel_{side}_Hub", (0, 0, 0), 0.105, 0.16, col, MET, wheel, rotation=(math.pi / 2, 0, 0), vertices=24)
        fairing(f"MainGearFairing_{side}", (-0.18, sign * 1.02, -0.76), 1.05, 0.115, 0.205)
        cube(f"Step_{side}", (-0.05, sign * 0.80, -0.58), (0.12, 0.10, 0.02), col, mats["dark_metal"], root, bevel=0.01)
    nose_steer = empty("NoseWheelSteer", col, (2.25, 0, -0.28), root)
    nose_steer["runtimeAxis"] = "Y"
    tube_between("NoseGearStrut", (0, 0, 0), (0.05, 0, -0.46), 0.042, col, MET, nose_steer)
    tube_between("NoseGearOleo", (0.04, 0, -0.30), (0.05, 0, -0.52), 0.05, col, mats["dark_metal"], nose_steer)
    tube_between("NoseGearTorqueLink", (0.10, 0, -0.33), (0.12, 0, -0.50), 0.014, col, MET, nose_steer)
    nose_wheel = empty("NoseWheel", col, (0.05, 0, -0.59), nose_steer)
    nose_wheel["runtimeAxis"] = "Z"
    torus("NoseWheel_Tire", (0, 0, 0), 0.16, 0.058, col, mats["tire"], nose_wheel, rotation=(math.pi / 2, 0, 0), major_segments=24)
    cylinder("NoseWheel_Hub", (0, 0, 0), 0.078, 0.13, col, MET, nose_wheel, rotation=(math.pi / 2, 0, 0), vertices=20)
    nf = fairing("NoseGearFairing", (2.30, 0, -0.81), 0.80, 0.095, 0.175)
    parent_keep(nf, nose_steer)

    # Antennas and the tail light give scale cues without any branding.
    tube_between("Antenna_VHF", (-0.40, 0, 0.94), (-0.62, 0, 1.24), 0.008, col, mats["dark_metal"], root)
    cube("Antenna_GPS", (-0.20, 0.0, 0.955), (0.14, 0.09, 0.025), col, mats["dark_metal"], root, bevel=0.01)
    tube_between("Antenna_Belly", (-1.20, 0, -0.28), (-1.38, 0, -0.42), 0.006, col, mats["dark_metal"], root)
    sphere("TailLight", (-4.99, 0, 0.40), (0.04, 0.035, 0.035), col, mats["white_light"], root, 16, 8)

    # Runtime anchors (unchanged: physics gear offsets and cameras depend on them).
    anchors = {
        "CG": (0, 0, 0), "PilotCamera": (0.10, -0.30, 0.58), "ChaseCamera": (-10.5, 0, 4.0),
        "MainGearContact_L": (-0.18, 1.02, -1.08), "MainGearContact_R": (-0.18, -1.02, -1.08),
        "NoseGearContact": (2.30, 0, -1.088), "TailStrikePoint": (-4.72, 0, 0.25),
    }
    for name, loc in anchors.items():
        empty(name, col, loc, root)

    return root


def build_airfield(col, mats):
    root = empty("AirfieldRoot", col)
    root["runwayDesignator"] = "09/27"
    root["runwayLengthM"] = 900.0
    root["runwayWidthM"] = 23.0
    root["fictionalAirport"] = True

    build_island_terrain(col, mats, root)
    cube("Runway", (0, 0, 0.0), (900, 23, 0.12), col, mats["asphalt"], root, bevel=0.03)
    cube("RunwayShoulder_L", (0, 13.0, -0.015), (900, 3.0, 0.09), col, mats["shoulder"], root)
    cube("RunwayShoulder_R", (0, -13.0, -0.015), (900, 3.0, 0.09), col, mats["shoulder"], root)

    markings = empty("RunwayMarkings", col, parent=root)
    # Edge lines and center dashes.
    for side in (-1, 1):
        cube(f"EdgeLine_{side}", (0, side * 10.7, 0.071), (890, 0.25, 0.015), col, mats["marking"], markings)
    for x in range(-405, 406, 30):
        cube(f"Centerline_{x}", (x, 0, 0.073), (15, 0.45, 0.018), col, mats["marking"], markings)
    # Threshold bars and aiming points at both ends.
    for end, heading in ((-1, "09"), (1, "27")):
        x_thr = end * 430
        for i in range(-4, 5):
            cube(f"Threshold_{heading}_{i}", (x_thr, i * 2.1, 0.075), (18, 1.0, 0.02), col, mats["marking"], markings)
        x_aim = x_thr - end * 180
        for side in (-1, 1):
            cube(f"Aiming_{heading}_{side}", (x_aim, side * 5.0, 0.075), (28, 2.7, 0.02), col, mats["marking"], markings)
        add_text_mesh(f"Designator_{heading}", heading, (x_thr - end * 52, 0, 0.085), 7.5,
                      (0, 0, -math.pi / 2 if end < 0 else math.pi / 2), col, mats["marking"], markings)

    # Runway edge and threshold lights.
    lights = empty("RunwayLights", col, parent=root)
    for x in range(-420, 421, 60):
        for side in (-1, 1):
            cylinder(f"EdgeLightBase_{x}_{side}", (x, side * 12.0, 0.16), 0.07, 0.22, col, mats["dark_metal"], lights, vertices=10)
            sphere(f"EdgeLightLens_{x}_{side}", (x, side * 12.0, 0.30), (0.075, 0.075, 0.06), col, mats["white_light"], lights, 12, 6)
    for end, color in ((-445, "green_light"), (445, "red_light")):
        for y in range(-10, 11, 2):
            sphere(f"ThresholdLight_{end}_{y}", (end, y, 0.18), (0.07, 0.07, 0.06), col, mats[color], lights, 12, 6)

    # Simple approach lights for Runway 09.
    for i, x in enumerate((-470, -500, -530, -560, -590)):
        for y in (-3.0, 0.0, 3.0):
            sphere(f"ApproachLight_{i}_{y}", (x, y, 0.22), (0.07, 0.07, 0.06), col, mats["white_light"], lights, 12, 6)

    # PAPI four-box unit. Separate red and white lenses for runtime switching.
    papi = empty("PAPI", col, (-300, -18.0, 0.0), root)
    papi["nominalGlideSlopeDeg"] = 3.0
    for i in range(4):
        y = i * 1.1
        cube(f"PAPI_Box_{i+1}", (0, y, 0.35), (0.65, 0.72, 0.35), col, mats["papi_box"], papi, bevel=0.05)
        sphere(f"PAPI_{i+1}_White", (-0.32, y - 0.14, 0.39), (0.075, 0.075, 0.055), col, mats["white_light"], papi, 12, 6)
        sphere(f"PAPI_{i+1}_Red", (-0.32, y + 0.14, 0.39), (0.075, 0.075, 0.055), col, mats["red_light"], papi, 12, 6)

    # Windsock with a runtime pivot. Sleeve extends along local +X.
    tube_between("WindsockPole", (-170, 34, 0.0), (-170, 34, 6.0), 0.06, col, mats["metal"], root)
    windsock = empty("WindsockPivot", col, (-170, 34, 5.8), root)
    windsock["runtimeYawAxis"] = "Y"
    windsock["windDirectionMeaning"] = "sleeve points downwind"
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.45, radius2=0.12, depth=3.2,
                                    location=(1.6, 0, 0), rotation=(0, math.pi / 2, 0))
    sleeve = bpy.context.object
    sleeve.name = "WindsockSleeve"
    assign(sleeve, mats["windsock"])
    move_to_collection(sleeve, col)
    sleeve.parent = windsock
    for x in (0.7, 1.45, 2.2):
        torus(f"WindsockStripe_{x}", (x, 0, 0), 0.28 - x * 0.045, 0.055, col, mats["marking"], windsock,
              rotation=(0, math.pi / 2, 0), major_segments=20)

    # Apron, hangar, small terminal shed and signs.
    cube("Apron", (250, 62, -0.02), (150, 85, 0.10), col, mats["apron"], root)
    cube("HangarBody", (285, 88, 7.0), (42, 28, 14), col, mats["hangar"], root, bevel=0.18)
    # Roof halves.
    cube("HangarRoof", (285, 88, 14.2), (45, 31, 1.0), col, mats["roof"], root, bevel=0.15, rotation=(0.18, 0, 0))
    cube("FlightSchool", (225, 90, 3.0), (22, 12, 6), col, mats["hangar"], root, bevel=0.15)
    cube("RunwaySign", (-360, 19, 0.65), (3.4, 0.25, 1.0), col, mats["sign"], root, bevel=0.06)
    add_text_mesh("RunwaySignText", "09-27", (-360, 18.86, 0.67), 0.52, (math.pi / 2, 0, 0), col, mats["marking"], root)
    for i in range(8):
        x = 208 + i * 2.4
        cone_loc = (x, 22, 0.35)
        bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=0.25, radius2=0.08, depth=0.70, location=cone_loc)
        cone = bpy.context.object
        cone.name = f"SafetyCone_{i+1}"
        assign(cone, mats["cone"])
        move_to_collection(cone, col)
        parent_keep(cone, root)

    # Modular environment templates for runtime instancing.
    props = empty("AirfieldProps", col, parent=root)
    deciduous = empty("TreeTemplate_Deciduous", col, (335, -78, 0), props)
    cylinder("Tree_Deciduous_Trunk", (0, 0, 2.0), 0.26, 4.0, col, mats["roof"], deciduous, vertices=10)
    sphere("Tree_Deciduous_Crown", (0, 0, 5.2), (2.1, 2.1, 2.5), col, mats["grass"], deciduous, 16, 8)
    conifer = empty("TreeTemplate_Conifer", col, (350, -82, 0), props)
    cylinder("Tree_Conifer_Trunk", (0, 0, 1.8), 0.22, 3.6, col, mats["roof"], conifer, vertices=10)
    for index, (z, radius) in enumerate(((2.2, 2.2), (4.0, 1.7), (5.5, 1.1)), 1):
        bpy.ops.mesh.primitive_cone_add(vertices=14, radius1=radius, radius2=0.12, depth=3.0, location=(0, 0, z))
        crown = bpy.context.object
        crown.name = f"Tree_Conifer_Crown_{index}"
        assign(crown, mats["grass"])
        move_to_collection(crown, col)
        crown.parent = conifer
    # Perimeter fence module and rotating beacon landmark.
    fence = empty("FenceSegmentTemplate", col, (165, -52, 0), props)
    for y in (-4.0, 0.0, 4.0):
        tube_between(f"FenceRail_{y}", (0, y, 0.8), (0, y + 4.0, 0.8), 0.035, col, mats["metal"], fence)
    for y in (-4.0, 0.0, 4.0):
        tube_between(f"FencePost_{y}", (0, y, 0), (0, y, 1.25), 0.045, col, mats["metal"], fence)
    beacon = empty("AirportBeacon", col, (210, 108, 0), props)
    tube_between("BeaconMast", (0, 0, 0), (0, 0, 9.0), 0.10, col, mats["metal"], beacon)
    beacon_head = empty("BeaconHead", col, (0, 0, 9.1), beacon)
    beacon_head["runtimeAxis"] = "Y"
    sphere("BeaconWhite", (0, -0.25, 0), (0.20, 0.16, 0.16), col, mats["white_light"], beacon_head, 12, 6)
    sphere("BeaconGreen", (0, 0.25, 0), (0.20, 0.16, 0.16), col, mats["green_light"], beacon_head, 12, 6)

    return root


def all_descendants(root):
    result = [root]
    stack = list(root.children)
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def export_root(root, path: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in all_descendants(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True, export_yup=True,
        export_apply=True, export_normals=True, export_texcoords=True, export_tangents=False,
        export_cameras=False, export_lights=False, export_animations=False,
        export_extras=True, export_materials="EXPORT", export_image_format="AUTO",
        export_copyright="Original Flareway assets, MIT, copyright 2026 Can Kilic",
    )
    bpy.ops.object.select_all(action="DESELECT")


def look_at(obj, target) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def set_hidden(objects, hidden: bool) -> None:
    for obj in objects:
        obj.hide_render = hidden


def setup_render(studio_col, mats):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 960 if QUICK else 1280
    scene.render.resolution_y = 540 if QUICK else 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.color_depth = "8"
    scene.world.color = (0.12, 0.20, 0.32)

    # Studio floor.
    floor = cube("StudioFloor", (0, 0, -1.07), (35, 35, 0.12), studio_col, mats["studio"], bevel=0.03)
    floor.hide_render = False

    bpy.ops.object.camera_add(location=(13, -14, 7))
    cam = bpy.context.object
    cam.name = "QA_Camera"
    cam.data.lens = 56
    cam.data.clip_end = 5000
    move_to_collection(cam, studio_col)
    scene.camera = cam

    bpy.ops.object.light_add(type="AREA", location=(4, -7, 11))
    key = bpy.context.object
    key.name = "Key_Area"
    key.data.energy = 1500
    key.data.shape = "DISK"
    key.data.size = 7
    move_to_collection(key, studio_col)
    look_at(key, (0, 0, 0))

    bpy.ops.object.light_add(type="AREA", location=(-7, 5, 7))
    fill = bpy.context.object
    fill.name = "Fill_Area"
    fill.data.energy = 900
    fill.data.size = 6
    move_to_collection(fill, studio_col)
    look_at(fill, (0, 0, 0))

    bpy.ops.object.light_add(type="SUN", location=(0, 0, 12))
    sun = bpy.context.object
    sun.name = "Sun"
    sun.data.energy = 2.0
    sun.rotation_euler = (math.radians(28), math.radians(-20), math.radians(-35))
    move_to_collection(sun, studio_col)
    return cam, floor


def render(scene, cam, path: str, loc, target, lens=55):
    cam.location = loc
    cam.data.lens = lens
    look_at(cam, target)
    scene.render.filepath = str(RENDER_DIR / path)
    bpy.ops.render.render(write_still=True)


def main():
    clear_scene()
    aircraft_col = collection("Aircraft")
    airfield_col = collection("Airfield")
    studio_col = collection("Studio")

    mats = {
        "white": material("Paint_WarmWhite", (0.70, 0.72, 0.72, 1), 0.30),
        "accent": material("Paint_Cyan", (0.015, 0.38, 0.52, 1), 0.28),
        "rubber": material("Rubber_Charcoal", (0.015, 0.019, 0.024, 1), 0.58),
        "metal": material("Brushed_Aluminum", (0.55, 0.58, 0.60, 1), 0.24, 0.82),
        "dark_metal": material("Dark_Metal", (0.045, 0.055, 0.065, 1), 0.34, 0.62),
        "prop": material("Propeller_Black", (0.012, 0.014, 0.018, 1), 0.30),
        "tip": material("Paint_PropTip", (0.75, 0.62, 0.04, 1), 0.35),
        "glass": material("Glass_Smoke", (0.018, 0.035, 0.045, 1), 0.20, transmission=0.12, alpha=0.90),
        "seat": material("Seat_Stone", (0.30, 0.32, 0.33, 1), 0.50),
        "panel": material("Panel_Charcoal", (0.022, 0.028, 0.035, 1), 0.48),
        "display": material("Instrument_Glass", (0.01, 0.04, 0.06, 1), 0.22, emission=(0.03, 0.25, 0.35), emission_strength=0.45),
        "tire": material("Tire", (0.012, 0.013, 0.015, 1), 0.72),
        "red_light": material("Light_Red", (0.38, 0.01, 0.01, 1), 0.22, emission=(1, 0.01, 0.01), emission_strength=5),
        "green_light": material("Light_Green", (0.01, 0.38, 0.05, 1), 0.22, emission=(0.01, 1, 0.08), emission_strength=5),
        "white_light": material("Light_White", (0.8, 0.85, 0.9, 1), 0.18, emission=(0.8, 0.9, 1), emission_strength=5),
        "grass": material("Grass", (0.07, 0.18, 0.07, 1), 0.95),
        "sand": material("Coastal_Sand", (0.46, 0.36, 0.20, 1), 0.88),
        "cliff": material("Coastal_Rock", (0.13, 0.11, 0.09, 1), 0.82),
        "water": material("Ocean_Reference", (0.015, 0.16, 0.24, 1), 0.24, transmission=0.06, alpha=0.96),
        "asphalt": material("Runway_Asphalt", (0.055, 0.06, 0.067, 1), 0.92),
        "shoulder": material("Runway_Shoulder", (0.12, 0.13, 0.13, 1), 0.90),
        "marking": material("Runway_Marking", (0.82, 0.82, 0.76, 1), 0.70),
        "apron": material("Apron_Concrete", (0.25, 0.27, 0.27, 1), 0.88),
        "papi_box": material("PAPI_Housing", (0.62, 0.64, 0.64, 1), 0.50, 0.35),
        "windsock": material("Windsock_Orange", (0.85, 0.16, 0.025, 1), 0.55),
        "hangar": material("Hangar_Siding", (0.32, 0.38, 0.40, 1), 0.68, 0.18),
        "roof": material("Roof_Metal", (0.15, 0.18, 0.20, 1), 0.48, 0.45),
        "sign": material("Sign_Red", (0.40, 0.012, 0.012, 1), 0.48),
        "cone": material("Safety_Orange", (0.90, 0.22, 0.025, 1), 0.65),
        "studio": material("Studio_Ground", (0.095, 0.11, 0.13, 1), 0.78),
    }
    aircraft_root = build_aircraft(aircraft_col, mats)
    airfield_root = build_airfield(airfield_col, mats)

    # Export before introducing QA-only transforms.
    export_root(aircraft_root, AIRCRAFT_GLB)
    if not AIRCRAFT_ONLY:
        export_root(airfield_root, AIRFIELD_GLB)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), compress=True)

    cam, floor = setup_render(studio_col, mats)
    scene = bpy.context.scene
    aircraft_objects = all_descendants(aircraft_root)
    airfield_objects = all_descendants(airfield_root)

    # Neutral aircraft renders.
    set_hidden(airfield_objects, True)
    set_hidden(aircraft_objects, False)
    floor.hide_render = False
    render(scene, cam, "01-aircraft-perspective.png", (12.5, -14.0, 6.8), (-0.5, 0, 0.1), 58)
    render(scene, cam, "02-aircraft-port-profile.png", (0.0, 17.0, 2.3), (-0.6, 0, 0.0), 62)
    render(scene, cam, "03-aircraft-top-controls.png", (-0.8, -0.8, 16.5), (-0.6, 0, 0.0), 58)
    if AIRCRAFT_ONLY:
        render(scene, cam, "05-gear-prop-detail.png", (6.0, -5.0, 0.0), (2.0, -0.1, -0.40), 68)
        render(scene, cam, "10-aircraft-front-quarter.png", (9.0, 6.5, 1.4), (0.2, 0, 0.2), 50)
        print(f"AIRCRAFT_GLB={AIRCRAFT_GLB} bytes={AIRCRAFT_GLB.stat().st_size}")
        return

    # Pilot-view proof on the real runway. The closed exterior shell is hidden for this camera only;
    # runtime cockpit mode follows the same contract while all interior, glass and control nodes stay visible.
    set_hidden(airfield_objects, False)
    floor.hide_render = True
    aircraft_root.location = (-360, 0, 1.08)
    fuselage = bpy.data.objects.get("Fuselage")
    if fuselage:
        fuselage.hide_render = True
    render(scene, cam, "04-cockpit-detail.png", (-359.90, -0.30, 1.59), (-250, 0.0, 2.2), 64)
    if fuselage:
        fuselage.hide_render = False
    aircraft_root.location = (0, 0, 0)
    set_hidden(airfield_objects, True)
    floor.hide_render = False
    render(scene, cam, "05-gear-prop-detail.png", (6.0, -5.0, 0.0), (2.0, -0.1, -0.40), 68)

    # Airfield views with aircraft positioned near threshold and on short final.
    set_hidden(airfield_objects, False)
    floor.hide_render = True
    aircraft_root.location = (-360, 0, 1.08)
    render(scene, cam, "06-runway-threshold-papi.png", (-470, -70, 28), (-315, 0, 0), 52)
    aircraft_root.location = (-600, 0, 9.2)
    aircraft_root.rotation_euler = (0, math.radians(-3.0), 0)
    render(scene, cam, "07-stabilized-final.png", (-665, -4, 21), (-330, 0, 1.8), 58)
    aircraft_root.location = (-260, 0, 1.08)
    aircraft_root.rotation_euler = (0, 0, 0)
    render(scene, cam, "08-runway-rollout.png", (-320, -48, 12), (-250, 0, 1), 58)
    render(scene, cam, "09-island-overview.png", (1080, -1080, 1380), (0, 0, -12), 58)

    aircraft_root.location = (0, 0, 0)
    aircraft_root.rotation_euler = (0, 0, 0)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), compress=True)

    print(f"AIRCRAFT_GLB={AIRCRAFT_GLB} bytes={AIRCRAFT_GLB.stat().st_size}")
    print(f"AIRFIELD_GLB={AIRFIELD_GLB} bytes={AIRFIELD_GLB.stat().st_size}")
    print(f"BLEND={BLEND_PATH} bytes={BLEND_PATH.stat().st_size}")
    print(f"RENDERS={len(list(RENDER_DIR.glob('*.png')))}")


if __name__ == "__main__":
    main()
