# Place artwork and open source notices

The web trip header and list cards display one Flagpack flag per destination country; destination
cards and activity tabs display City Icons where the city and country match.
Both SVG collections are bundled locally and cached with the offline application
shell. Cities without matching artwork keep their text labels. Credits and license
notices are available on the **Notices** page linked from the page footer.

City Icons artwork is by [Studio Partdirector](https://svgcities.com/), licensed
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Flagpack is by
[Yummygum](https://flagpack.xyz/), licensed under MIT. The bundled artwork is visually
unchanged; standalone SVGs are converted into symbols with namespaced internal IDs.
Source commits are recorded in `src/TripPlanner.Web/public/artwork/sources.json`.
Trip summaries include unique country codes from active destinations, allowing
list cards to show flags without loading each trip document. Downloaded documents
retain these summaries in the offline catalog.
To refresh the assets from local upstream checkouts, run
`python3 tools/vendor_place_artwork.py /path/to/city-icons /path/to/flagpack-core`,
then format the generated JSON with the web project's Prettier command.

## Browser favicon

The browser favicon is a 48×48 PNG under 10 KB at `src/TripPlanner.Web/public/icons/trip-planner-icon.png`. Its full-resolution source and generation prompt live in `docs/design/`, outside the deployed web assets.

## Open source notices

The public `/notices` page shows the required City Icons and OpenStreetMap
attributions. A linked **Third-party software licenses** document retains the
required copyright, license, and NOTICE text for distributed browser software,
Flagpack, and airport data, grouping identical notices. Server-only packages and
licenses without notice requirements are excluded. Both pages work signed out
and offline.

After changing dependencies, run `corepack pnpm run notices` from
`src/TripPlanner.Web` after installing web dependencies.
This regenerates the checked-in `src/features/notices/notices.json` attributions
and `public/notices/software-licenses.txt` from installed runtime packages.
Upstream license files missing from npm distributions are retained in
`tools/notices/licenses`, with their sources recorded in `tools/notices/sources.json`.
Review and commit the regenerated inventory with dependency or artwork updates.
