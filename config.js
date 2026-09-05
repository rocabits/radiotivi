var SUPABASE_URL = "https://feuhyqjyvzqnteemsecj.supabase.co";
var SUPABASE_ANON_KEY = "sb_publishable_6fy0s9-DHYA1xv7bprwXcw_-RI50YLv";

// Set radiotivi-specific configuration for the sources.
// Change these values to point the app at a different backend/list in the future.
var RADIO_SOURCES = {
  api: [
    'https://de1.api.radio-browser.info',
    'https://de2.api.radio-browser.info',
    'https://nl1.api.radio-browser.info'
  ]
};

var TV_SOURCES = {
  playlist: 'https://iptv-org.github.io/iptv/index.m3u',
  countryPlaylist: function(cc) { return 'https://iptv-org.github.io/iptv/countries/' + encodeURIComponent((cc || 'ES').toLowerCase()) + '.m3u'; },
  countries: 'https://iptv-org.github.io/api/countries.json'
};

// Google Cast - Default Media Receiver (receptor universal, no requiere registro).
var CAST_APP_ID = 'CC1AD845';
