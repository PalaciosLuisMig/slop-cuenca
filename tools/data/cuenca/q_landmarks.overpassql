[out:json][timeout:120];
(
  way["building"]["name"](-2.925,-79.035,-2.875,-78.980);
  relation["building"]["name"](-2.925,-79.035,-2.875,-78.980);
  way["tourism"~"^(attraction|museum|viewpoint)$"]["name"](-2.925,-79.035,-2.875,-78.980);
  node["tourism"~"^(attraction|museum|viewpoint)$"]["name"](-2.925,-79.035,-2.875,-78.980);
  way["amenity"="place_of_worship"]["name"](-2.925,-79.035,-2.875,-78.980);
  way["bridge"]["name"](-2.925,-79.035,-2.875,-78.980);
);
out body geom;
