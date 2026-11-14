"""Bundle City Icons and Flagpack from local upstream checkouts.

Usage: python3 tools/vendor_place_artwork.py CITY_ICONS_CHECKOUT FLAGPACK_CHECKOUT
"""

import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1] / "src/TripPlanner.Web"
OUTPUT = ROOT / "public/artwork"
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)


def sprite(files, target):
    root = ET.Element(f"{{{SVG_NS}}}svg")
    for source in files:
        icon = ET.parse(source).getroot()
        symbol_id = source.stem.lower()
        # SVG definitions are document-scoped, including when referenced by <use>.
        ids = {
            node.attrib["id"]: f"{symbol_id}-{node.attrib['id']}"
            for node in icon.iter()
            if "id" in node.attrib
        }
        for node in icon.iter():
            for key, value in list(node.attrib.items()):
                if key == "id":
                    node.set(key, ids[value])
                elif value.startswith("#") and value[1:] in ids:
                    node.set(key, "#" + ids[value[1:]])
                else:
                    node.set(
                        key,
                        re.sub(r"url\(#([^)]+)\)", lambda m: f"url(#{ids[m[1]]})", value),
                    )
        symbol = ET.SubElement(root, f"{{{SVG_NS}}}symbol", {
            "id": symbol_id,
            "viewBox": icon.attrib["viewBox"],
            **{key: icon.attrib[key] for key in ("fill", "stroke") if key in icon.attrib},
        })
        symbol.extend(icon)
    ET.ElementTree(root).write(target, encoding="utf-8", xml_declaration=True)


def commit(checkout):
    return subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()


def main():
    cities, flags = map(Path, sys.argv[1:])
    OUTPUT.mkdir(parents=True, exist_ok=True)
    metadata = [
        item
        for source in sorted((cities / "src/data/icons").glob("*.json"))
        for item in json.loads(source.read_text())
    ]
    city_files = sorted({item["svgFilename"] for item in metadata})
    flag_files = sorted((flags / "svg/s").glob("*.svg"))
    sprite([cities / "public/icons" / name for name in city_files], OUTPUT / "cities.svg")
    sprite(flag_files, OUTPUT / "flags.svg")
    index = {
        "cities": [
            {"city": item["city"], "countryCode": item["svgFilename"][:2].upper(),
             "symbol": Path(item["svgFilename"]).stem, "name": item["name"]}
            for item in metadata
        ],
        "flags": [file.stem.upper() for file in flag_files],
    }
    (ROOT / "src/shared/placeArtwork.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n")
    shutil.copyfile(cities / "LICENSE", OUTPUT / "city-icons-LICENSE.txt")
    shutil.copyfile(flags / "LICENSE", OUTPUT / "flagpack-LICENSE.txt")
    (OUTPUT / "sources.json").write_text(json.dumps({
        "cityIcons": {"repository": "https://github.com/anto1/city-icons", "commit": commit(cities)},
        "flagpack": {"repository": "https://github.com/Yummygum/flagpack-core", "commit": commit(flags)},
        "changes": "Converted standalone SVGs into symbols and namespaced internal IDs; artwork unchanged.",
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
