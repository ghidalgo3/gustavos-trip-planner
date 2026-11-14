"""Generate required attributions and distributed software notices.

Run after pnpm install. No network requests are made.
"""

import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "src/TripPlanner.Web"
FALLBACKS = {
    "@fluentui/react-icons": "fluentui-system-icons",
    "@microsoft/dynamicproto-js": "dynamicproto-js",
    "@microsoft/applicationinsights-cfgsync-js": "applicationinsights-js",
    "embla-carousel": "embla-carousel",
    "embla-carousel-autoplay": "embla-carousel",
    "embla-carousel-fade": "embla-carousel",
}


def notice_files(directory):
    return [
        path for path in sorted(directory.iterdir())
        if path.is_file() and re.search(r"license|licence|notice|copying|copyright", path.name, re.I)
    ]


def project_url(value, fallback):
    if isinstance(value, dict):
        value = value.get("url")
    value = (value or fallback).removeprefix("git+")
    value = re.sub(r"^git://", "https://", value).removesuffix(".git")
    return value if value.startswith("https://") else fallback


def npm_packages():
    manifest = json.loads((WEB / "package.json").read_text())
    pending = [(WEB, name) for name in manifest["dependencies"]]
    seen = set()
    while pending:
        parent, name = pending.pop()
        search = parent
        while not (search / "node_modules" / name / "package.json").is_file():
            if search == search.parent:
                raise RuntimeError(f"Missing dependency {name}; run pnpm install")
            search = search.parent
        directory = (search / "node_modules" / name).resolve()
        package = json.loads((directory / "package.json").read_text())
        key = (package["name"], package["version"])
        if key in seen:
            continue
        seen.add(key)
        pending.extend((directory, dependency) for dependency in package.get("dependencies", {}))
        pending.extend(
            (directory, dependency)
            for dependency in package.get("optionalDependencies", {})
            if (directory.parent / dependency / "package.json").is_file()
        )
        files = notice_files(directory)
        if not files and name in FALLBACKS:
            files = [ROOT / "tools/notices/licenses" / (FALLBACKS[name] + ".txt")]
        if not files:
            raise RuntimeError(f"No license notice for {name}; add its upstream notice")
        license_name = package.get("license") or {"suncalc": "BSD-2-Clause"}.get(name)
        if not isinstance(license_name, str):
            raise RuntimeError(f"Review license metadata for {name}")
        # These licenses do not require retaining an attribution or license notice.
        if license_name in {"0BSD", "CC0-1.0", "Unlicense"}:
            continue
        registry = f"https://www.npmjs.com/package/{name}/v/{package['version']}"
        yield {
            "name": package["name"], "version": package["version"],
            "group": "Web packages", "license": license_name,
            "url": project_url(package.get("repository") or package.get("homepage"), registry),
            "licenseUrl": registry,
        }, [(path.name, path.read_text(encoding="utf-8-sig")) for path in files]


def assets():
    artwork = WEB / "public/artwork"
    sources = json.loads((artwork / "sources.json").read_text())
    yield {
        "name": "City Icons", "version": sources["cityIcons"]["commit"],
        "group": "Artwork and data", "license": "CC-BY-4.0", "url": "https://svgcities.com/",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    }, [("Attribution", "City Icons by Studio Partdirector (https://partdirector.ch). "
         "Standalone SVGs were converted into symbols and internal IDs were namespaced; artwork is visually unchanged."),
        ("License", (artwork / "city-icons-LICENSE.txt").read_text().split("2. SITE SOURCE CODE")[0].rstrip())]
    yield {
        "name": "Flagpack", "version": sources["flagpack"]["commit"],
        "group": "Artwork and data", "license": "MIT", "url": "https://flagpack.xyz/",
        "licenseUrl": "https://github.com/Yummygum/flagpack-core/blob/main/LICENSE",
    }, [("License", (artwork / "flagpack-LICENSE.txt").read_text()),
        ("Modifications", "Standalone SVGs were converted into symbols and internal IDs were namespaced; artwork is visually unchanged.")]
    yield {
        "name": "airportsdata", "version": "", "group": "Artwork and data",
        "license": "MIT", "url": "https://github.com/mborsetti/airportsdata",
        "licenseUrl": "https://github.com/mborsetti/airportsdata/blob/main/LICENSE",
    }, [("License", (ROOT / "src/TripPlanner.Api/Data/airportsdata-LICENSE").read_text())]
    yield {
        "name": "Timezone Boundary Builder / OpenStreetMap", "version": "",
        "group": "Artwork and data", "license": "ODbL-1.0",
        "url": "https://github.com/evansiroky/timezone-boundary-builder",
        "licenseUrl": "https://www.openstreetmap.org/copyright",
    }, [("Attribution", "Time zone boundaries used by GeoTimeZone are derived from Timezone Boundary Builder. "
         "© OpenStreetMap contributors. OpenStreetMap data is available under the Open Database License (ODbL).")]


def main():
    attributions, software = [], []
    for entry, notices in [*assets(), *npm_packages()]:
        if entry["license"] in {"CC-BY-4.0", "ODbL-1.0"}:
            entry["attribution"] = notices[0][1]
            attributions.append(entry)
        else:
            software.append((entry, notices))
    output = WEB / "src/features/notices/notices.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"attributions": attributions}, ensure_ascii=False, indent=2) + "\n")
    # Group identical notices without dropping the packages they cover.
    grouped = {}
    for entry, notices in sorted(software, key=lambda item: (item[0]["name"].casefold(), item[0]["version"])):
        grouped.setdefault(tuple(notices), []).append(entry)
    sections = ["THIRD-PARTY SOFTWARE LICENSES\n"]
    for notices, packages in grouped.items():
        sections.append("=" * 72)
        for package in packages:
            sections.append(f"{package['name']} {package['version']}\n{package['url']}\nLicense: {package['license']}")
        sections.extend(f"\n{title}\n{text}" for title, text in notices)
    document = WEB / "public/notices/software-licenses.txt"
    document.parent.mkdir(parents=True, exist_ok=True)
    document.write_text("\n\n".join(sections) + "\n")
    print(f"Generated {len(attributions)} attributions and retained notices for {len(software)} distributed components")


if __name__ == "__main__":
    main()
