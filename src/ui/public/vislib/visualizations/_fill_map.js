define(function (require) {
  return function FillMapMapFactory(Private) {
    var _ = require('lodash');
    var $ = require('jquery');
    var L = require('leaflet');
    var Rainbow = require('rainbowvis.js');


    var defaultMapZoom = 2;
    var defaultMapCenter = [15, 5];

    var mapTiles = {
      url: 'https://otile{s}-s.mqcdn.com/tiles/1.0.0/map/{z}/{x}/{y}.jpeg',
      options: {
        attribution: 'Tiles by <a href="http://www.mapquest.com/">MapQuest</a> &mdash; ' +
          'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors, ' +
          '<a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>',
        subdomains: '1234'
      }
    };

    /**
     * Tile Map Maps
     *
     * @class Map
     * @constructor
     * @param container {HTML Element} Element to render map into
     * @param chartData {Object} Elasticsearch query results for this map
     * @param params {Object} Parameters used to build a map
     */
    function FillMapMap(container, chartData, params) {
      this._container = $(container).get(0);
      this._chartData = chartData;

      // keep a reference to all of the optional params
      this._events = _.get(params, 'events');
      this._valueFormatter = params.valueFormatter || _.identity;
      this._tooltipFormatter = params.tooltipFormatter || _.identity;
      this._attr = params.attr || {};

      var mapOptions = {
        minZoom: 1,
        maxZoom: 18,
        noWrap: true,
        maxBounds: L.latLngBounds([-90, -220], [90, 220]),
        scrollWheelZoom: false,
        fadeAnimation: false,
      };

      this._createMap(mapOptions, chartData);
    }

    FillMapMap.prototype.addBoundingControl = function () {
      if (this._boundingControl) return;

      var self = this;
      var drawOptions = { draw: {} };

      _.each(['polyline', 'polygon', 'circle', 'marker', 'rectangle', 'geometry'], function (drawShape) {
        if (self._events && !self._events.listenerCount(drawShape)) {
          drawOptions.draw[drawShape] = false;
        } else {
          drawOptions.draw[drawShape] = {
            shapeOptions: {
              stroke: false,
              color: '#000'
            }
          };
        }
      });

      this._boundingControl = new L.Control.Draw(drawOptions);
      this.map.addControl(this._boundingControl);
    };

    FillMapMap.prototype.addFitControl = function () {
      if (this._fitControl) return;

      var self = this;
      var fitContainer = L.DomUtil.create('div', 'leaflet-control leaflet-bar leaflet-control-fit');

      // Add button to fit container to points
      var FitControl = L.Control.extend({
        options: {
          position: 'topleft'
        },
        onAdd: function (map) {
          $(fitContainer).html('<a class="fa fa-crop" href="#" title="Fit Data Bounds"></a>')
          .on('click', function (e) {
            e.preventDefault();
            self._fitBounds();
          });

          return fitContainer;
        },
        onRemove: function (map) {
          $(fitContainer).off('click');
        }
      });

      this._fitControl = new FitControl();
      this.map.addControl(this._fitControl);
    };

    /**
     * Adds label div to each map when data is split
     *
     * @method addTitle
     * @param mapLabel {String}
     * @return {undefined}
     */
    FillMapMap.prototype.addTitle = function (mapLabel) {
      if (this._label) return;

      var label = this._label = L.control();

      label.onAdd = function () {
        this._div = L.DomUtil.create('div', 'tilemap-info tilemap-label');
        this.update();
        return this._div;
      };
      label.update = function () {
        this._div.innerHTML = '<h2>' + _.escape(mapLabel) + '</h2>';
      };

      // label.addTo(this.map);
      this.map.addControl(label);
    };

    /**
     * remove css class for desat filters on map tiles
     *
     * @method saturateTiles
     * @return undefined
     */
    FillMapMap.prototype.saturateTiles = function () {
      if (!this._attr.isDesaturated) {
        $('img.leaflet-tile-loaded').addClass('filters-off');
      }
    };

    FillMapMap.prototype.updateSize = function () {
      this.map.invalidateSize({
        debounceMoveend: true
      });
    };

    FillMapMap.prototype.destroy = function () {
      console.log("destroy");
      if (this._label) this._label.removeFrom(this.map);
      if (this._fitControl) this._fitControl.removeFrom(this.map);
      if (this._boundingControl) this._boundingControl.removeFrom(this.map);
      this.map.remove();
      this.map = undefined;
    };


    FillMapMap.prototype._attachEvents = function () {
      var self = this;
      var saturateTiles = self.saturateTiles.bind(self);

      this._tileLayer.on('tileload', saturateTiles);

      this.map.on('unload', function () {
        self._tileLayer.off('tileload', saturateTiles);
      });

      this.map.on('moveend', function setZoomCenter(ev) {
        // update internal center and zoom references
        self._mapCenter = self.map.getCenter();
        self._mapZoom = self.map.getZoom();

        if (!self._events) return;

        self._events.emit('mapMoveEnd', {
          chart: self._chartData,
          map: self.map,
          center: self._mapCenter,
          zoom: self._mapZoom,
        });
      });

      this.map.on('draw:created', function (e) {
        var drawType = e.layerType;
        if (!self._events || !self._events.listenerCount(drawType)) return;

        // TODO: Different drawTypes need differ info. Need a switch on the object creation
        var bounds = e.layer.getBounds();

        self._events.emit(drawType, {
          e: e,
          chart: self._chartData,
          bounds: {
            top_left: {
              lat: bounds.getNorthWest().lat,
              lon: bounds.getNorthWest().lng
            },
            bottom_right: {
              lat: bounds.getSouthEast().lat,
              lon: bounds.getSouthEast().lng
            }
          }
        });
      });

      this.map.on('zoomend', function () {
        self._mapZoom = self.map.getZoom();
        if (!self._events) return;

        self._events.emit('mapZoomEnd', {
          chart: self._chartData,
          map: self.map,
          zoom: self._mapZoom,
        });
      });
    };

    FillMapMap.prototype.addLegend = function() {

    };

    FillMapMap.prototype.addInfo = function() {

    };

    FillMapMap.prototype._createMap = function (mapOptions, chartData) {
      if (this.map) this.destroy();
      var self = this;

      // get center and zoom from mapdata, or use defaults
      this._mapCenter = _.get(this._geoJson, 'properties.center') || defaultMapCenter;
      this._mapZoom = _.get(this._geoJson, 'properties.zoom') || defaultMapZoom;

      // add map tiles layer, using the mapTiles object settings
      if (this._attr.wms && this._attr.wms.enabled) {
        this._tileLayer = L.tileLayer.wms(this._attr.wms.url, this._attr.wms.options);
      } else {
        this._tileLayer = L.tileLayer(mapTiles.url, mapTiles.options);
      }

      // append tile layers, center and zoom to the map options
      mapOptions.layers = this._tileLayer;
      mapOptions.center = this._mapCenter;
      mapOptions.zoom = this._mapZoom;

      this.map = L.map(this._container, mapOptions);
      this._attachEvents();

      var saloneData = {"type":"FeatureCollection","features":
      [{"type":"Feature","properties":{"id":"N","name":"Nortern Province"},
      "geometry":{"type":"polygon", "coordinates":[[[-10.832519,9.438224],[-11.25,8.928487],[-11.590576,8.581021],[-11.656494,8.450638],[-11.931152,8.385431],[-12.041015,8.276727],[-12.249755,8.331082],[-12.557373,8.287598],[-12.95288,8.276727],[-12.94876,8.254982],[-12.95494,8.466939],[-12.972106,8.564725],[-13.084716,8.586452],[-13.260498,8.722218],[-13.331909,9.009876],[-13.222045,9.096672],[-13.013305,9.074975],[-12.980346,9.167178],[-12.95288,9.2702],[-12.86499,9.286464],[-12.74414,9.351512],[-12.722167,9.416548],[-12.634277,9.519496],[-12.590332,9.616998],[-12.5354,9.7253],[-12.370605,9.887687],[-12.233276,9.936387],[-12.134399,9.871451],[-11.909179,9.941798],[-11.8927,10.00131],[-11.217041,10.00131],[-11.156616,9.925565],[-10.991821,9.736128],[-10.90393,9.589917],[-10.832519,9.438224]]],"type":"Polygon"},"id":"03f95e477246974e6fb9eb6162a2242a"},
      {"type":"Feature","properties":{"id":"S","name":"Southern Province"},
      "geometry":{"type":"polygon", "coordinates":[[[-12.991333,8.21149],[-12.908935,8.102738],[-12.903442,7.972197],[-12.95288,7.906911],[-12.804565,7.776308],[-12.694702,7.700104],[-12.76062,7.612997],[-12.963867,7.574882],[-12.617797,7.465964],[-12.5354,7.384257],[-12.277221,7.307984],[-11.964111,7.18265],[-11.733398,7.068185],[-11.499938,6.929153],[-11.428527,6.942785],[-11.384582,7.008215],[-11.34613,7.079088],[-11.343383,7.141773],[-11.304931,7.199],[-11.269226,7.234423],[-11.206054,7.261669],[-11.153869,7.313433],[-11.131896,7.357018],[-11.085205,7.395152],[-11.027526,7.43056],[-10.958862,7.495919],[-10.917663,7.506811],[-10.857238,7.539487],[-10.780334,7.637498],[-10.761108,7.672885],[-11.184082,7.833452],[-11.274719,8.086423],[-11.593322,8.05651],[-11.826782,8.409885],[-11.928405,8.382713],[-12.041015,8.282163],[-12.266235,8.3338],[-12.554626,8.287598],[-12.947387,8.282163],[-12.991333,8.21149]]],"type":"Polygon"},"id":"9a4c7c290c9f99bde16222837b554dad"},
      {"type":"Feature","properties":{"id":"E","name":"Eastern Province"},
      "geometry":{"type":"polygon","coordinates":[[[-11.826782,8.407168],[-11.601562,8.059229],[-11.266479,8.080984],[-11.184082,7.836173],[-10.865478,7.716435],[-10.755615,7.672885],[-10.67871,7.754537],[-10.607299,7.792636],[-10.607299,8.05379],[-10.497436,8.157118],[-10.316162,8.189742],[-10.288696,8.2278],[-10.299682,8.303905],[-10.26123,8.418036],[-10.272216,8.494104],[-10.327148,8.515835],[-10.415039,8.472372],[-10.426025,8.418036],[-10.508422,8.358257],[-10.662231,8.379996],[-10.629272,8.50497],[-10.563354,8.597315],[-10.480957,8.640764],[-10.48645,8.705929],[-10.535888,8.81451],[-10.596313,8.988174],[-10.57434,9.064126],[-10.634765,9.074975],[-10.733642,9.0804],[-10.739135,9.167178],[-10.684204,9.221404],[-10.656738,9.302727],[-10.744628,9.367772],[-10.821533,9.421967],[-11.25,8.955619],[-11.596069,8.575589],[-11.651,8.445205],[-11.826782,8.407168]]],"type":"Polygon"},
      "id":"ea9b8622b9ff40fe0c034ee87ccad698"},
      {"type":"Feature","properties":
      {"id":"W","name":"western Area"},
      "geometry":{"type":"polygon","coordinates":[[[-13.167457,8.456072],[-13.154754,8.452676],[-13.152351,8.442148],[-13.146858,8.432639],[-13.141021,8.427885],[-13.136558,8.424828],[-13.131408,8.426187],[-13.115959,8.419394],[-13.118705,8.415658],[-13.112869,8.411243],[-13.106346,8.409545],[-13.095016,8.413621],[-13.08815,8.403432],[-13.083686,8.393582],[-13.077507,8.378298],[-13.06652,8.37626],[-13.057937,8.375241],[-13.053131,8.37558],[-13.052101,8.342972],[-13.052444,8.315116],[-13.024291,8.254982],[-13.017082,8.241052],[-13.059654,8.238333],[-13.072013,8.234596],[-13.079223,8.229839],[-13.081626,8.226441],[-13.083343,8.218965],[-13.089523,8.215567],[-13.100166,8.213189],[-13.101882,8.206733],[-13.113555,8.199936],[-13.122138,8.196198],[-13.129692,8.196198],[-13.135871,8.189402],[-13.143081,8.182266],[-13.16574,8.17275],[-13.161964,8.179037],[-13.162565,8.184899],[-13.162908,8.188637],[-13.163251,8.193055],[-13.162565,8.194584],[-13.161106,8.195944],[-13.161191,8.200956],[-13.159646,8.20308],[-13.157672,8.206648],[-13.156042,8.209111],[-13.155956,8.214973],[-13.159904,8.231368],[-13.163166,8.237314],[-13.16471,8.245808],[-13.165912,8.252604],[-13.169345,8.256171],[-13.17398,8.25753],[-13.174324,8.260758],[-13.170375,8.265515],[-13.1678,8.270781],[-13.16883,8.275707],[-13.170547,8.279105],[-13.168659,8.280634],[-13.160076,8.2859],[-13.165569,8.286579],[-13.167114,8.28505],[-13.169689,8.284201],[-13.170547,8.28522],[-13.173122,8.283182],[-13.175182,8.283182],[-13.175868,8.281653],[-13.1781,8.283012],[-13.182907,8.283521],[-13.184452,8.28488],[-13.18531,8.287938],[-13.188056,8.292694],[-13.194236,8.295752],[-13.19355,8.299319],[-13.191146,8.305944],[-13.193206,8.308492],[-13.196125,8.312398],[-13.197669,8.321231],[-13.206424,8.335498],[-13.218612,8.342292],[-13.224449,8.343311],[-13.230628,8.343651],[-13.233375,8.346369],[-13.237838,8.352483],[-13.246078,8.362673],[-13.251914,8.372524],[-13.257408,8.37592],[-13.263244,8.379996],[-13.263244,8.382543],[-13.263759,8.384666],[-13.263072,8.38577],[-13.262472,8.387638],[-13.264274,8.392139],[-13.266162,8.394771],[-13.267364,8.396512],[-13.268609,8.397488],[-13.269424,8.3977],[-13.270068,8.396936],[-13.270497,8.397318],[-13.270025,8.397828],[-13.269896,8.39838],[-13.270325,8.399908],[-13.27054,8.401946],[-13.271012,8.403941],[-13.272514,8.407932],[-13.276977,8.414555],[-13.279123,8.417441],[-13.28041,8.419055],[-13.28144,8.420753],[-13.283586,8.421347],[-13.285217,8.420838],[-13.287191,8.41897],[-13.288822,8.419649],[-13.2938,8.42313],[-13.293435,8.423512],[-13.29262,8.423682],[-13.291826,8.423915],[-13.291761,8.424234],[-13.291246,8.424489],[-13.29086,8.424382],[-13.290603,8.424743],[-13.290131,8.424637],[-13.290002,8.424934],[-13.289809,8.425062],[-13.289487,8.42538],[-13.28895,8.425741],[-13.2888,8.426823],[-13.288886,8.427906],[-13.289229,8.429455],[-13.289594,8.43075],[-13.289959,8.432321],[-13.290324,8.433701],[-13.290903,8.434051],[-13.291525,8.434454],[-13.291869,8.434698],[-13.292609,8.435367],[-13.292534,8.435675],[-13.292781,8.435876],[-13.292824,8.436088],[-13.292748,8.436216],[-13.292802,8.436354],[-13.29292,8.436449],[-13.293038,8.436778],[-13.292781,8.437044],[-13.292502,8.437044],[-13.292115,8.437033],[-13.2916,8.436821],[-13.291096,8.436428],[-13.290839,8.436354],[-13.290646,8.436513],[-13.290399,8.436354],[-13.290098,8.436057],[-13.290066,8.435706],[-13.289841,8.43542],[-13.289455,8.435399],[-13.28895,8.435239],[-13.288264,8.435165],[-13.287813,8.434953],[-13.28777,8.434804],[-13.287599,8.434826],[-13.287363,8.434964],[-13.287041,8.435208],[-13.286751,8.435537],[-13.286547,8.435844],[-13.286279,8.435951],[-13.286097,8.436184],[-13.285753,8.436142],[-13.285152,8.435929],[-13.284691,8.435706],[-13.284412,8.435611],[-13.284037,8.435982],[-13.283532,8.436258],[-13.283168,8.436555],[-13.283103,8.437065],[-13.283017,8.437426],[-13.282846,8.437542],[-13.282535,8.4375],[-13.282288,8.437288],[-13.282073,8.437277],[-13.28188,8.437309],[-13.281462,8.43785],[-13.281,8.438243],[-13.280743,8.438752],[-13.280324,8.439697],[-13.28011,8.440493],[-13.279992,8.440917],[-13.279885,8.441756],[-13.279563,8.444048],[-13.279595,8.445979],[-13.280249,8.451615],[-13.280453,8.451784],[-13.280754,8.452198],[-13.280678,8.452718],[-13.280829,8.453047],[-13.280657,8.453196],[-13.280335,8.453164],[-13.280153,8.45327],[-13.279756,8.453079],[-13.279541,8.45327],[-13.279445,8.453451],[-13.279209,8.454491],[-13.279219,8.454947],[-13.27894,8.455552],[-13.278608,8.456528],[-13.278919,8.458576],[-13.27923,8.460211],[-13.279949,8.461877],[-13.280357,8.464328],[-13.281011,8.466716],[-13.281558,8.467957],[-13.281902,8.46904],[-13.282653,8.471523],[-13.283565,8.473645],[-13.284476,8.475768],[-13.284809,8.476595],[-13.28585,8.478972],[-13.287255,8.482516],[-13.287695,8.483514],[-13.289186,8.486655],[-13.291461,8.490411],[-13.294143,8.492937],[-13.294503,8.492995],[-13.294819,8.492953],[-13.294975,8.492751],[-13.294782,8.492629],[-13.294808,8.492507],[-13.29512,8.492369],[-13.295243,8.49247],[-13.295903,8.492369],[-13.29645,8.492608],[-13.296949,8.49299],[-13.297238,8.493298],[-13.297421,8.493382],[-13.298177,8.493908],[-13.298467,8.494353],[-13.298537,8.494603],[-13.298317,8.49491],[-13.297995,8.494937],[-13.297904,8.49481],[-13.297786,8.494842],[-13.297904,8.495468],[-13.297764,8.496449],[-13.297603,8.496598],[-13.29726,8.496635],[-13.297142,8.496783],[-13.297169,8.497102],[-13.297158,8.497378],[-13.297008,8.497733],[-13.297056,8.49811],[-13.296986,8.49838],[-13.296965,8.498778],[-13.296681,8.499128],[-13.296536,8.49915],[-13.296455,8.499065],[-13.296305,8.499166],[-13.296101,8.499059],[-13.295871,8.498868],[-13.295634,8.49855],[-13.29579,8.498465],[-13.295897,8.498412],[-13.295838,8.498221],[-13.295769,8.498067],[-13.295597,8.497977],[-13.295484,8.497839],[-13.29549,8.497712],[-13.295388,8.497547],[-13.295297,8.497447],[-13.295195,8.497441],[-13.295087,8.497325],[-13.294594,8.497261],[-13.294218,8.49699],[-13.294036,8.496789],[-13.293843,8.496884],[-13.293832,8.496714],[-13.294057,8.496449],[-13.294122,8.49642],[-13.294076,8.496229],[-13.2941,8.496096],[-13.294057,8.496003],[-13.294095,8.495876],[-13.29425,8.495733],[-13.29432,8.495754],[-13.294417,8.495722],[-13.294406,8.495606],[-13.294406,8.495494],[-13.294449,8.495399],[-13.294701,8.49533],[-13.294637,8.495048],[-13.294476,8.494783],[-13.294132,8.494518],[-13.293617,8.494189],[-13.292931,8.494083],[-13.292126,8.494125],[-13.291836,8.494221],[-13.291472,8.494539],[-13.291397,8.494666],[-13.291332,8.494751],[-13.291354,8.494921],[-13.291611,8.495048],[-13.291869,8.495399],[-13.29218,8.495759],[-13.292191,8.496407],[-13.291858,8.49682],[-13.291794,8.496958],[-13.291568,8.497075],[-13.291321,8.496958],[-13.290989,8.497022],[-13.290839,8.496969],[-13.290721,8.497054],[-13.290785,8.497521],[-13.29057,8.498051],[-13.290635,8.498189],[-13.290538,8.498444],[-13.290581,8.498624],[-13.290463,8.498943],[-13.290238,8.499187],[-13.289723,8.49942],[-13.289637,8.499452],[-13.289262,8.499378],[-13.288671,8.499516],[-13.288135,8.499622],[-13.287577,8.499579],[-13.287169,8.499452],[-13.286526,8.499176],[-13.286139,8.498582],[-13.285903,8.498168],[-13.285678,8.497425],[-13.2857,8.49716],[-13.285474,8.497086],[-13.285324,8.496852],[-13.28497,8.496523],[-13.284788,8.496194],[-13.284648,8.496003],[-13.284358,8.495791],[-13.283972,8.495356],[-13.28365,8.495123],[-13.283717,8.495043],[-13.283699,8.494937],[-13.283355,8.494709],[-13.282942,8.494719],[-13.282736,8.494897],[-13.282875,8.495128],[-13.282722,8.495399],[-13.282178,8.495929],[-13.281711,8.496274],[-13.282116,8.496051],[-13.281118,8.496332],[-13.280818,8.49595],[-13.280711,8.495483],[-13.280421,8.495155],[-13.280217,8.494815],[-13.280367,8.494359],[-13.280442,8.494019],[-13.280164,8.493818],[-13.279734,8.49351],[-13.279541,8.493542],[-13.279252,8.493764],[-13.27908,8.493881],[-13.278683,8.493711],[-13.278554,8.493467],[-13.278436,8.49351],[-13.278286,8.493414],[-13.27805,8.493499],[-13.277986,8.493658],[-13.277771,8.493743],[-13.277374,8.49403],[-13.277277,8.493818],[-13.276934,8.493701],[-13.276677,8.493658],[-13.276516,8.493467],[-13.276162,8.493467],[-13.276044,8.493669],[-13.276087,8.493966],[-13.275969,8.494146],[-13.275754,8.49403],[-13.275529,8.494136],[-13.275378,8.494072],[-13.275185,8.494083],[-13.275185,8.493786],[-13.275035,8.49351],[-13.274821,8.493351],[-13.274391,8.493255],[-13.274155,8.493128],[-13.274145,8.492958],[-13.272321,8.492502],[-13.272256,8.492459],[-13.27202,8.492565],[-13.271967,8.492809],[-13.271752,8.492947],[-13.271698,8.49316],[-13.271473,8.493245],[-13.271098,8.493616],[-13.271108,8.49404],[-13.271323,8.494115],[-13.271344,8.494348],[-13.271237,8.494656],[-13.270894,8.494719],[-13.270819,8.495123],[-13.270647,8.495239],[-13.27055,8.495483],[-13.270153,8.495526],[-13.269789,8.495929],[-13.26951,8.49611],[-13.269392,8.496385],[-13.269177,8.496608],[-13.268834,8.496736],[-13.268576,8.496831],[-13.268426,8.49699],[-13.26819,8.497192],[-13.267804,8.497001],[-13.267536,8.496725],[-13.267278,8.496545],[-13.267096,8.496407],[-13.266795,8.496492],[-13.266516,8.496545],[-13.266313,8.496619],[-13.266109,8.496534],[-13.265808,8.496269],[-13.265304,8.496067],[-13.264971,8.495834],[-13.264371,8.495865],[-13.263727,8.495367],[-13.263416,8.494815],[-13.26304,8.494528],[-13.262729,8.494337],[-13.262633,8.494072],[-13.262,8.493998],[-13.26171,8.494104],[-13.261399,8.493658],[-13.261291,8.493255],[-13.26098,8.492831],[-13.26053,8.492353],[-13.260422,8.49212],[-13.260444,8.491897],[-13.260283,8.49161],[-13.260015,8.49126],[-13.259811,8.491101],[-13.25965,8.49073],[-13.259242,8.490178],[-13.259221,8.489828],[-13.259339,8.489573],[-13.259596,8.489446],[-13.259779,8.489276],[-13.26009,8.488798],[-13.260197,8.488586],[-13.260133,8.488321],[-13.260133,8.48796],[-13.259897,8.487716],[-13.259618,8.487419],[-13.25951,8.487292],[-13.259446,8.487016],[-13.259017,8.487101],[-13.258974,8.48744],[-13.257966,8.488225],[-13.257386,8.487631],[-13.257837,8.487419],[-13.257772,8.487058],[-13.257944,8.48674],[-13.257772,8.486506],[-13.257858,8.486209],[-13.257429,8.485827],[-13.256742,8.485573], [-13.256571,8.484957],[-13.256077,8.484448],[-13.25509,8.484405],[-13.25421,8.484554],[-13.253223,8.484936],[-13.252837,8.485212],[-13.252279,8.485445],[-13.252193,8.485933],[-13.252644,8.486358],[-13.252601,8.486761],[-13.25318,8.48761],[-13.253159,8.487992],[-13.25318,8.488416], [-13.253352,8.489329],[-13.253417,8.48986],[-13.253009,8.490242],[-13.252644,8.490666],[-13.252322,8.49143],[-13.251593,8.492258],[-13.250477,8.493107],[-13.249576,8.49334],[-13.248953,8.493446],[-13.248438,8.493361],[-13.247752,8.493658],[-13.247237,8.493595],[-13.246829,8.493234], [-13.246378,8.493149],[-13.241615,8.489011],[-13.234062,8.491388],[-13.229598,8.48935],[-13.222389,8.491048],[-13.214149,8.494444],[-13.204193,8.491048],[-13.202819,8.484257],[-13.199043,8.48154],[-13.194236,8.482559],[-13.18737,8.481201],[-13.181877,8.477465],[-13.17398,8.471013],[-13.169517,8.463203],[-13.167457,8.456072]]],"type":"Polygon"},"id":"fba8316a75c8692f69cbb354676e9b09"}],"id":"bayohi90.njkj115a"}; 
      
      if (chartData) {
        chartValues = chartData.series[0].values
        saloneData.features = _.map(saloneData.features, function (feature) {
          var matchingColumn = _.get(feature.properties, 'id');
          chartItem = _.find(chartValues, {
            x: matchingColumn
          });
          feature.properties.count = _.has(chartItem, 'y') ? chartItem.y : 0;
          return feature;
        });

        this._rainbow = new Rainbow;

        var min = _.min(saloneData.features, function(feature){
          return feature.properties.count;
        }).properties.count;
        var max = _.max(saloneData.features, function(feature){
          return feature.properties.count;
        }).properties.count;

        this._rainbow.setNumberRange(min, max);
        this._rainbow.setSpectrum('red', 'yellow');

      }


      // control that shows state info on hover
      var info = L.control();

      info.onAdd = function (map) {
        this._div = L.DomUtil.create('div', 'info');
        this.update();
        return this._div;
      };

      info.update = function (props) {
        this._div.innerHTML = '<h4>Sierrra Leone 117 Calls</h4>' +  (props ?
          '<b>' + props.name + '</b><br />' + props.count + ' Calls'
          : 'Hover over a region to show call count');
      };

      info.addTo(this.map);

      function getColor(d) {
        var color = '#' + self._rainbow.colourAt(d);
        return color;

        //d > 100000 ? '#800026' :
          //d > 75000 ? '#BD0026' :
          //d > 50000 ? '#E31A1C' :
          //d > 25000 ? '#FC4E2A' :
          //d > 12500 ? '#FD8D3C' :
          //d > 6250 ? '#FEB24C' :
          //d > 10 ? '#FED976' :
          //d > 0 ? '#FFEDA0' :
      };
      function style(feature) {
        return {
          fillColor: getColor(feature.properties.count),
          weight: 2,
          opacity: 1,
          color: 'white',
          dashArray: '3',
          fillOpacity: 0.7
        };
      };
      //mouse handlers
      function highlightFeature(e) {
        var layer = e.target;
        layer.setStyle({
          weight: 5,
          color: '#666',
          dashArray: '',
          fillOpacity: 0.7
        });
        info.update(layer.feature.properties)
      };
      
      function resetHighlight(e) {
        self._geoJson.resetStyle(e.target);
        info.update();
      };

      var zoomToFeature = function zoomTofeature(e) {
        self.map.fitBounds(e.target.getBounds());
      };

      function onEachFeature(feature, layer) {
        layer.on({
          mouseover: highlightFeature,
          mouseout: resetHighlight,
          click: zoomToFeature

        });
        var popup = L.popup();


        var label = L.marker(layer.getBounds().getCenter(), {
          icon: L.divIcon({
            className: 'label',
            html: feature.properties.name,
            iconSize: [100, 0],
            iconColor: '#BD0026'
          })
        });
        label.addTo(self.map);
      };



      this._geoJson = L.geoJson(saloneData, {
        style: style,
        onEachFeature: onEachFeature
      });
      this._geoJson.addTo(this.map);

      this.map.attributionControl.addAttribution(
        'Total Calls &copy; <a herf="http://census.gov/>117 call Center</a>"'
      );
      var legend = L.control({
        position: 'bottomright'
      });
      legend.onAdd = function (map) {
        var div = L.DomUtil.create('div', 'info legend'),
          grades = [100, 3000, 6500, 12500, 25000, 50000, 75000, 100000],
          labels = [];
        // loop through our density intervals and generate a label with a colored square for each interval
        for (var i = 0; i < grades.length; i++) {
          from = grades[i];
          to = grades[i + 1];
          labels.push(
            '<i style="background: ' + getColor(from + 1) + '"></i> ' +
            from + (to ? '&ndash;' + to : '+'));
        }
        div.innerHTML = labels.join('<br>');
        return div;
      };
      legend.addTo(this.map);

    };

    /**
     * zoom map to fit all features in featureLayer
     *
     * @method _fitBounds
     * @param map {Leaflet Object}
     * @return {boolean}
     */
    FillMapMap.prototype._fitBounds = function () {
      this.map.fitBounds(this._geoJson.getBounds());
    };

    return FillMapMap;
  };
});
