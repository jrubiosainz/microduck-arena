"""Export Pollen's official Reachy Mini visual model for the judges (metres).

Run with `uv run scripts/vendor_reachy.py`. MuJoCo compiles the CAD transforms;
only visual meshes are exported. Physics and race assets are never modified.
"""

import json
import re
import struct
import tempfile
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

import mujoco
import numpy as np

REV = "9d364df0d8b6c92fbda7a9252fc378e23d4ab47c"
REPO = "pollen-robotics/reachy_mini"
SOURCE = "src/reachy_mini/descriptions/reachy_mini/mjcf"
DEST = Path(__file__).resolve().parents[1] / "app/public/robot/reachy-mini"


def download(url, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(urlopen(url).read())


def export(source):
    model = mujoco.MjModel.from_xml_path(str(source))
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    # World-space neutral pose, converted from MuJoCo Z-up to Three Y-up.
    basis = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]])
    head = model.body("xl_330").id
    antenna_ids = [model.body(f"dc15_a01_horn_dummy_{i}").id for i in (7, 8)]
    pivots = [np.zeros(3), np.array([0, 0.155, 0])]
    pivots += [basis @ data.xpos[b] for b in antenna_ids]
    nodes = [
        {"name": "reachy_mini", "children": [1, 2]},
        {"name": "reachy_base"},
        {"name": "reachy_head", "translation": pivots[1].tolist(), "children": [3, 4]},
        *[
            {"name": f"antenna_{side}", "translation": (p - pivots[1]).tolist()}
            for side, p in zip(("right", "left"), pivots[2:])
        ],
    ]
    grouped = {}
    for i in range(model.ngeom):
        if model.geom_group[i] != 2:
            continue
        body = model.geom_bodyid[i]
        part = 0
        while body:
            if body in antenna_ids:
                part = 2 + antenna_ids.index(body)
                break
            if body == head:
                part = 1
                break
            body = model.body_parentid[body]
        mesh = model.geom_dataid[i]
        # Shells, lenses, neck rods and antennas; enclosed electronics stay out.
        if not re.search(
            r"body_(foot|down|top)_3dprint|head_(back|front|mic)_3dprint|neck_reference|lens|antenna|stewart_link_rod|glasses",
            model.mesh(mesh).name,
        ):
            continue
        start, count = model.mesh_vertadr[mesh], model.mesh_vertnum[mesh]
        vertices = model.mesh_vert[start : start + count].astype(float)
        vertices = (vertices @ data.geom_xmat[i].reshape(3, 3).T + data.geom_xpos[i]) @ basis.T
        vertices -= pivots[part]
        start, count = model.mesh_faceadr[mesh], model.mesh_facenum[mesh]
        faces = model.mesh_face[start : start + count].copy()
        grouped.setdefault((part, int(model.geom_matid[i])), []).append((vertices, faces))
    doc = {
        "asset": {"version": "2.0", "generator": f"microduck-arena from {REPO}@{REV}"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": nodes,
        "meshes": [],
        "materials": [],
        "accessors": [],
        "bufferViews": [],
        "buffers": [],
    }
    for i in range(model.nmat):
        rgba = model.mat_rgba[i].tolist()
        doc["materials"].append(
            {
                "name": model.material(i).name,
                "pbrMetallicRoughness": {
                    "baseColorFactor": rgba,
                    "metallicFactor": 0.08,
                    "roughnessFactor": 0.45,
                },
                **({"alphaMode": "BLEND"} if rgba[3] < 1 else {}),
            }
        )
    binary = bytearray()

    def accessor(values, component, kind, bounds=False):
        while len(binary) % 4:
            binary.append(0)
        view = len(doc["bufferViews"])
        doc["bufferViews"].append(
            {"buffer": 0, "byteOffset": len(binary), "byteLength": values.nbytes}
        )
        binary.extend(values.tobytes())
        a = {"bufferView": view, "componentType": component, "count": len(values), "type": kind}
        if bounds:
            a.update(min=values.min(axis=0).tolist(), max=values.max(axis=0).tolist())
        doc["accessors"].append(a)
        return len(doc["accessors"]) - 1

    for part in range(4):
        primitives = []
        for (group, material), pieces in grouped.items():
            if group != part:
                continue
            vertices, faces, offset = [], [], 0
            for v, f in pieces:
                vertices.append(v)
                faces.append(f + offset)
                offset += len(v)
            v = np.concatenate(vertices).astype("<f4")
            f = np.concatenate(faces).astype("<u4")
            normals = np.zeros_like(v)
            n = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
            for corner in range(3):
                np.add.at(normals, f[:, corner], n)
            normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
            primitives.append(
                {
                    "attributes": {
                        "POSITION": accessor(v, 5126, "VEC3", True),
                        "NORMAL": accessor(normals, 5126, "VEC3"),
                    },
                    "indices": accessor(f.ravel(), 5125, "SCALAR"),
                    "material": material,
                }
            )
        nodes[part + 1]["mesh"] = len(doc["meshes"])
        doc["meshes"].append({"primitives": primitives})
    doc["buffers"] = [{"byteLength": len(binary)}]
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary += b"\0" * (-len(binary) % 4)
    glb = struct.pack("<III", 0x46546C67, 2, 28 + len(encoded) + len(binary))
    glb += struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
    glb += struct.pack("<II", len(binary), 0x004E4942) + binary
    (DEST / "reachy-mini.glb").write_bytes(glb)
    print(f"Exported {len(glb):,} bytes to {DEST}")


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    raw = f"https://raw.githubusercontent.com/{REPO}/{REV}"
    download(f"{raw}/LICENSE", DEST / "LICENSE")
    with tempfile.TemporaryDirectory() as temp:
        source = Path(temp) / "reachy_mini.xml"
        download(f"{raw}/{SOURCE}/reachy_mini.xml", source)
        tree = ET.parse(source)
        for parent in tree.iter():
            for child in list(parent):
                if (child.tag == "geom" and child.get("class") == "collision") or (
                    child.tag == "mesh" and child.get("file", "").startswith("collision/")
                ):
                    parent.remove(child)
        tree.write(source)
        media = f"https://media.githubusercontent.com/media/{REPO}/{REV}/{SOURCE}/assets"
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(
                pool.map(
                    lambda mesh: download(
                        f"{media}/{mesh.get('file')}", Path(temp) / "assets" / mesh.get("file")
                    ),
                    tree.findall(".//mesh"),
                )
            )
        export(source)


if __name__ == "__main__":
    main()
