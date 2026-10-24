[out:json][timeout:120];
(
  way["waterway"~"^(river|stream|canal)$"](-2.925,-79.035,-2.875,-78.980);
  way["natural"="water"](-2.925,-79.035,-2.875,-78.980);
  relation["natural"="water"](-2.925,-79.035,-2.875,-78.980);
  way["riverbank"](-2.925,-79.035,-2.875,-78.980);
  way["landuse"="reservoir"](-2.925,-79.035,-2.875,-78.980);
);
out geom tags;
