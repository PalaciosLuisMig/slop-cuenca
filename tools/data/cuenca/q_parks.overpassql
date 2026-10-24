[out:json][timeout:120];
(
  way["leisure"~"^(park|garden|pitch|playground|recreation_ground|stadium)$"](-2.925,-79.035,-2.875,-78.980);
  relation["leisure"~"^(park|garden)$"](-2.925,-79.035,-2.875,-78.980);
  way["landuse"~"^(grass|forest|cemetery|recreation_ground)$"](-2.925,-79.035,-2.875,-78.980);
  way["natural"~"^(wood|scrub|grassland)$"](-2.925,-79.035,-2.875,-78.980);
);
out geom tags;
