// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken =
  'pk.eyJ1Ijoic2F6YWhpciIsImEiOiJjbXA3c3dvbDAwNWhjMnNwcnBvd2d0c3UxIn0.m-59WkpO8LxsjR36mf6Q9w';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Select the SVG element inside the map
const svg = d3.select('#map').select('svg');

// Scale for traffic flow color
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// Global time filter
let timeFilter = -1;

// Convert longitude/latitude to pixel coordinates
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Format slider minutes into readable time
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Convert Date to minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Filter trips within ±60 minutes
function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips
    : trips.filter((trip) => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);

        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}

// Compute arrivals, departures, and total traffic
function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

map.on('load', async () => {
  // Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4,
    },
  });

  // Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/vis-society/lab7/main/data/cambridge-bike-lanes.geojson',
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4,
    },
  });

  // Load station data
  const jsonData = await d3.json(
    'https://dsc106.com/labs/lab07/data/bluebikes-stations.json',
  );

  let stations = jsonData.data.stations;

  // Load traffic data
  let trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    },
  );

  // Compute traffic
  stations = computeStationTraffic(stations, trips);

  // Radius scale
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // Create circles
  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', (d) =>
      stationFlow(d.departures / d.totalTraffic),
    )
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
        );
    });

  // Position circles
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // Slider elements
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateScatterPlot(timeFilter) {
    const filteredTrips = filterTripsbyTime(trips, timeFilter);
    const filteredStations = computeStationTraffic(
      jsonData.data.stations,
      filteredTrips,
    );

    timeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    circles
      .data(filteredStations, (d) => d.short_name)
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) =>
        stationFlow(d.departures / d.totalTraffic),
      )
      .select('title')
      .text(
        (d) =>
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
      );
  }

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});