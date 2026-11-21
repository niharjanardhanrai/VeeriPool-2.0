import { useRef, useState } from 'react';
import { TileLayer } from 'react-leaflet';

// Free map tile servers, all drawing OpenStreetMap data. Some networks
// (college Wi-Fi, antivirus web shields) block tile.openstreetmap.org, which
// leaves the map blank grey — so if tiles keep failing on one server we move
// to the next, and remember the one that works for every later map.
const SERVERS = [
  {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  {
    url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors, OSM France',
  },
  {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
];

const FAILURES_BEFORE_SWITCH = 3;
let workingIndex = 0; // shared by every map on the page

export default function MapTiles() {
  const [index, setIndex] = useState(workingIndex);
  const failures = useRef(0);
  const loadedOne = useRef(false);
  const server = SERVERS[index];

  function onTileError() {
    if (loadedOne.current || index >= SERVERS.length - 1) return;
    failures.current += 1;
    if (failures.current >= FAILURES_BEFORE_SWITCH) {
      failures.current = 0;
      workingIndex = Math.max(workingIndex, index + 1);
      setIndex(index + 1);
    }
  }

  function onTileLoad() {
    loadedOne.current = true;
    workingIndex = index;
  }

  return (
    <TileLayer
      key={server.url}
      url={server.url}
      attribution={server.attribution}
      eventHandlers={{ tileerror: onTileError, tileload: onTileLoad }}
    />
  );
}
