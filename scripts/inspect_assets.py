#!/usr/bin/env python3
"""Inspect Flareway GLBs and enforce the runtime asset contract."""
from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AIRCRAFT = ROOT / "public/assets/aircraft/ft172-trainer.glb"
AIRFIELD = ROOT / "public/assets/airport/field-kit.glb"
REPORT = ROOT / "artifacts/qa/assets/asset-report.json"


def load_glb(path: Path) -> dict:
    raw = path.read_bytes()
    if len(raw) < 20 or raw[:4] != b"glTF":
        raise AssertionError(f"{path}: invalid GLB header")
    version, total = struct.unpack_from("<II", raw, 4)
    if version != 2 or total != len(raw):
        raise AssertionError(f"{path}: invalid GLB version/length")
    offset = 12
    payload = None
    while offset < len(raw):
        length, chunk_type = struct.unpack_from("<II", raw, offset)
        offset += 8
        chunk = raw[offset: offset + length]
        offset += length
        if chunk_type == 0x4E4F534A:
            payload = json.loads(chunk.rstrip(b" \t\r\n\0"))
    if payload is None:
        raise AssertionError(f"{path}: JSON chunk missing")
    return payload


def triangles(doc: dict) -> int:
    total = 0
    accessors = doc.get("accessors", [])
    for mesh in doc.get("meshes", []):
        for prim in mesh.get("primitives", []):
            mode = prim.get("mode", 4)
            if mode != 4:
                continue
            if "indices" in prim:
                total += accessors[prim["indices"]]["count"] // 3
            else:
                pos = prim.get("attributes", {}).get("POSITION")
                if pos is not None:
                    total += accessors[pos]["count"] // 3
    return total


def inspect(path: Path, required: set[str], max_bytes: int, max_triangles: int, max_materials: int) -> dict:
    doc = load_glb(path)
    names = [node.get("name", "") for node in doc.get("nodes", [])]
    missing = sorted(required - set(names))
    if missing:
        raise AssertionError(f"{path.name}: missing nodes: {missing}")
    duplicate_contract = sorted(name for name in required if names.count(name) != 1)
    if duplicate_contract:
        raise AssertionError(f"{path.name}: duplicated contract nodes: {duplicate_contract}")
    external = []
    for group in ("buffers", "images"):
        for item in doc.get(group, []):
            uri = item.get("uri")
            if uri and not uri.startswith("data:"):
                external.append(uri)
    if external:
        raise AssertionError(f"{path.name}: external URI dependencies: {external}")
    blob = json.dumps(doc).lower()
    forbidden = [word for word in ("cessna", "skyhawk", "textron", "garmin", "lycoming") if word in blob]
    if forbidden:
        raise AssertionError(f"{path.name}: forbidden branded metadata: {forbidden}")
    suspicious_nodes = sorted(name for name in names if re.search(r"(^|[_ -])(logo|badge|registration)([_ -]|$)", name, re.I))
    if suspicious_nodes:
        raise AssertionError(f"{path.name}: forbidden branding nodes: {suspicious_nodes}")
    solid_aircraft_paint = None
    if "Fuselage" in required:
        materials = doc.get("materials", [])
        paint_index = next((i for i, mat in enumerate(materials) if mat.get("name") == "Paint_WarmWhite"), None)
        if paint_index is None:
            raise AssertionError(f"{path.name}: Paint_WarmWhite material missing")
        paint = materials[paint_index]
        alpha = paint.get("pbrMetallicRoughness", {}).get("baseColorFactor", [1, 1, 1, 1])[3]
        if paint.get("alphaMode", "OPAQUE") != "OPAQUE" or alpha < 0.999:
            raise AssertionError(f"{path.name}: aircraft paint must remain opaque")
        fuselage_node = next(node for node in doc.get("nodes", []) if node.get("name") == "Fuselage")
        fuselage_mesh = doc.get("meshes", [])[fuselage_node["mesh"]]
        material_indices = {prim.get("material") for prim in fuselage_mesh.get("primitives", [])}
        if material_indices != {paint_index}:
            raise AssertionError(f"{path.name}: Fuselage must use only Paint_WarmWhite, got {material_indices}")
        solid_aircraft_paint = True
    tri_count = triangles(doc)
    mat_count = len(doc.get("materials", []))
    if path.stat().st_size > max_bytes:
        raise AssertionError(f"{path.name}: {path.stat().st_size} bytes > {max_bytes}")
    if tri_count > max_triangles:
        raise AssertionError(f"{path.name}: {tri_count} triangles > {max_triangles}")
    if mat_count > max_materials:
        raise AssertionError(f"{path.name}: {mat_count} materials > {max_materials}")
    return {
        "path": str(path.relative_to(ROOT)),
        "bytes": path.stat().st_size,
        "triangles": tri_count,
        "materials": mat_count,
        "nodes": len(names),
        "requiredNodes": sorted(required),
        "externalUris": external,
        "extensionsUsed": doc.get("extensionsUsed", []),
        "solidAircraftPaint": solid_aircraft_paint,
    }


def main() -> None:
    aircraft_required = {
        "AircraftRoot", "Fuselage", "WingStatic", "Aileron_L", "Aileron_R", "Flap_L", "Flap_R",
        "Elevator", "Rudder", "Propeller", "NoseWheelSteer", "NoseWheel", "MainWheel_L", "MainWheel_R",
        "CG", "PilotCamera", "ChaseCamera", "MainGearContact_L", "MainGearContact_R", "NoseGearContact",
        "TailStrikePoint",
    }
    airfield_required = {
        "AirfieldRoot", "IslandTerrain", "BeachRing", "OceanReferencePlane", "VegetationSpawns",
        "Runway", "RunwayMarkings", "RunwayLights", "PAPI", "WindsockPivot",
        "WindsockSleeve", "TreeTemplate_Deciduous", "TreeTemplate_Conifer", "FenceSegmentTemplate",
        "AirportBeacon", "BeaconHead",
    }
    result = {
        "aircraft": inspect(AIRCRAFT, aircraft_required, 2_500_000, 45_000, 16),
        "airfield": inspect(AIRFIELD, airfield_required, 3_000_000, 45_000, 20),
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, ValueError, KeyError, IndexError) as exc:
        print(f"asset contract failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
