# Slop Cuenca

Cuenca, Azuay, Ecuador, simulated with [three.js](https://threejs.org/), WebGPURenderer and TSL. Explore the city on foot, by taxi, by bicycle or by helicopter.

A fork of [mrdoob/slop-newyork](https://github.com/mrdoob/slop-newyork): the engine (controllers, cameras, sky, lighting, post-processing, audio, people and vehicles) is theirs; the city, its data pipeline and the Cuenca-specific materials are new.

## What is in the city

- **The real street network, blocks and buildings**, from OpenStreetMap: about 6,400 streets, 1,900 blocks and 21,000 buildings, each on its real footprint and, where OpenStreetMap has it (76 %), at its real height.
- **Relief** from SRTM elevations, so the valley, the Turi hill and the river banks rise and fall under the streets. The altitude gauge shows metres above sea level (about 2,550 m at Parque Calderón).
- **The old town**: lime-washed facades in the town's palette, timber doors and balconies, clay-tile roofs, the Catedral de la Inmaculada Concepción with its blue domes, and parish churches with bell towers.
- **The Tomebamba, Yanuncay and Tarqui rivers**, parks and street trees.
- **Taxis, cars, buses and pedestrians** on the real street graph, a street radar, ten teleports and seven scenic cameras.

Not built yet: the full-screen map, traffic signals, the Tomebamba gorge (SRTM is too coarse for it) and the individual look of most churches and landmarks.

## Run it

There is no build step. Serve the folder over HTTP and open `index.html`:

```
python -m http.server 8765
```

then open <http://127.0.0.1:8765/>. A browser with WebGPU gives the best results; WebGL2 is the fallback. Three.js is loaded from jsDelivr (the `dev` branch).

## Rebuild the data

```
# OpenStreetMap extracts (roads, buildings, water, parks, landmarks), written to tools/data/cuenca/
for n in roads buildings water parks landmarks; do bash tools/overpass.sh tools/data/cuenca/osm_$n.json tools/data/cuenca/q_$n.overpassql; done

# SRTM elevations on a 100 m grid (OpenTopoData public API, about two minutes)
node tools/fetch-cuenca-elevation.mjs

# Everything into js/cuenca-geodata.js
node --max-old-space-size=8192 tools/build-cuenca-geodata.mjs
```

## Layout

| | |
|---|---|
| `js/cuenca-geodata.js` | generated geography in the world frame (1 unit = 1 m, origin at Parque Calderón, axes turned 13.65° to follow the street grid) |
| `js/city-config.js` | spatial queries on that data: blocks, nearest roads, terrain height, teleports, landmarks |
| `js/cuenca-city.js` | builds the roadbed, sidewalks, buildings, rivers, parks, trees and the landmark models |
| `js/cuenca-facade.js` | the plastered facade material |
| `js/cuenca-traffic.js` | ambient vehicles and pedestrians |
| `js/cuenca-minimap.js` | the street radar |

## License and data

The project code is available under the [MIT License](LICENSE).

Geographic data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL). Elevation: SRTM, via [OpenTopoData](https://www.opentopodata.org/). Third-party data and dependencies retain their respective licenses.
