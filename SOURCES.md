# Sources

Primary references used only for scale, aviation terminology, runway visual aids, and game-design constraints. No source artwork, mesh, texture, logo, livery, or diagram is redistributed.

## Aircraft

- Textron Aviation, **Cessna Skyhawk product card**: https://cessna.txtav.com/-/media/cessna/files/product-cards/piston/skyhawk_product_card.pdf
  - Confirms the current Skyhawk category and published dimensions: 11.00 m wingspan and 8.28 m length.
- Textron Aviation, **Cessna Skyhawk product page**: https://cessna.txtav.com/en/piston/cessna-skyhawk
  - Confirms the high-wing piston trainer category. Flareway does not reproduce branded geometry or livery.

## Takeoff and landing concepts

- FAA, **Airplane Flying Handbook FAA-H-8083-3C, Chapter 6: Takeoffs and Departure Climbs**: https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook/07_afh_ch6.pdf
- FAA, **Airplane Flying Handbook FAA-H-8083-3C, Chapter 9: Approaches and Landings**: https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook/10_afh_ch9.pdf
  - Used for high-level concepts such as directional control, stabilized approach, flare/roundout, crosswind correction, go-around judgment, and runway alignment. The game uses simplified fictional performance values and is not instructional software.

## Runway and visual aids

- FAA, **Airport Signs, Markings and Lights**: https://www.faa.gov/airports/runway_safety/publications/Airport-Signs-Markings-Lights.pdf
- FAA, **PAPI overview**: https://www.faa.gov/about/office_org/headquarters_offices/ato/service_units/techops/navservices/lsg/papi
- FAA, **AC 150/5340-1M Standards for Airport Markings**: https://www.faa.gov/airports/resources/advisory_circulars/index.cfm/go/document.current/documentNumber/150_5340-1
  - Used to make fictional runway markings and four-box PAPI behavior visually legible.

## Runtime asset format

- Khronos glTF 2.0 specification: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- Blender glTF 2.0 exporter documentation: https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html

## Three.js visual references

- Three.js repost of Andrei Provkin's Boring Forest: https://x.com/threejs/status/2105276283815129169
- Original Boring Forest post and measured performance notes: https://x.com/AndreiProvkin/status/2105028422141428086
- Live Boring Forest demo: https://boring-forest.vercel.app/
- Three.js repost of Dan Greenheck's island/terrain experiment: https://x.com/threejs/status/2105218618535628930
- Original Water Pro v4 island/terrain experiment post: https://x.com/dangreenheck/status/2105063750822691261

These references are analyzed in `VISUAL_REFERENCE_RESEARCH.md`. They inform lighting, terrain, shoreline, vegetation, water and performance requirements only. No code or assets are copied. Dan Greenheck describes the island work as a possible premium asset/starter pack; it must not be used without a separate license review.
