// js/config.js — AppConfig (frozen singleton)
// Replace MAPS_KEY and Firebase values before deploying.

const AppConfig = Object.freeze({
  googleMapsApiKey: 'AIzaSyBykC-Ud0Av1cNBFcfelKjBQojtzwC3sws',

  firebase: Object.freeze({
    apiKey: 'AIzaSyDZGxOQGI30L1LFkwbOAvNS_OfT0U76_ck',
    authDomain: 'salesmap-4771d.firebaseapp.com',
    projectId: 'salesmap-4771d',
    storageBucket: 'salesmap-4771d.firebasestorage.app',
    messagingSenderId: '604440170823D',
    appId: 'YOUR_APP_I1:604440170823:web:0e1d3f6b515f9058597c62D',
    databaseURL: 'https://salesmap-4771d-default-rtdb.firebaseio.com/'
  }),

  map: Object.freeze({
    defaultCenter: Object.freeze({ lat: 37.0902, lng: -95.7129 }),
    defaultZoom: 4,
    mapTypeControl: true,
    streetViewControl: true,
    fullscreenControl: true,
    zoomControl: true,
    fitBoundsPadding: 50
  }),

  colors: Object.freeze({
    primary: Object.freeze([
      '#0078d4','#d13438','#107c10','#ffb900','#8764b8',
      '#00b7c3','#f7630c','#ca5010','#038387','#486860'
    ]),
    tierMap: Object.freeze({
      1:'#107c10', '1':'#107c10', 'tier 1':'#107c10',
      2:'#ffb900', '2':'#ffb900', 'tier 2':'#ffb900',
      3:'#d13438', '3':'#d13438', 'tier 3':'#d13438'
    }),
    default: '#cccccc'
  }),

  marker: Object.freeze({
    pinPath: 'M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z',
    scale: 0.7,
    strokeWeight: 1.5,
    strokeColor: '#ffffff',
    fillOpacity: 0.9
  }),

  polygon: Object.freeze({
    fillOpacity: 0.35,
    strokeWeight: 2,
    clickable: true
  }),

  geocoding: Object.freeze({
    delayMs: 200,
    confidenceScores: Object.freeze({
      ROOFTOP: 1.0,
      RANGE_INTERPOLATED: 0.8,
      GEOMETRIC_CENTER: 0.6,
      APPROXIMATE: 0.4
    })
  }),

  csvParser: Object.freeze({
    supportedColumns: Object.freeze({
      wkt: ['wkt','geometry','shape','geom','polygon','the_geom'],
      latitude: ['latitude','lat','latitude_decimal'],
      longitude: ['longitude','lon','lng','longitude_decimal'],
      name: ['name','title','label','account_name','business_name'],
      description: ['description','desc','notes','comments'],
      zipCode: ['zip','zipcode','zip_code','postal_code'],
      county: ['county','county_name'],
      state: ['state','state_name'],
      territory: ['territory','sales_territory','region'],
      bdm: ['bdm','manager','sales_rep','account_manager'],
      tier: ['tier','sales_tier','potential_tier','priority'],
      revenue: ['revenue','sales','annual_revenue']
    })
  }),

  storage: Object.freeze({
    localStorageKey: 'salesMapperState',
    templateStorageKey: 'columnMappingTemplates',
    pluginConfigPrefix: 'plugin_config_'
  }),

  ui: Object.freeze({
    toastDuration: 3000,
    toastDurationLong: 8000,
    sidebarWidth: '350px',
    drawerWidth: '420px'
  }),

  featureInfo: Object.freeze({
    displayProperties: ['name','description','tier','bdm'],
    systemProperties: ['layerid','wkt','id','latitude','longitude']
  }),

  layer: Object.freeze({
    defaultOpacity: 1.0,
    maxFeaturesForVirtualScroll: 500
  }),

  drawing: Object.freeze({
    polygonColor: '#0078d4',
    strokeOpacity: 0.8,
    strokeWeight: 2,
    fillOpacity: 0.35,
    vertexColor: '#FF0000',
    vertexScale: 4
  }),

  appVersion: '4.0.0'
});
