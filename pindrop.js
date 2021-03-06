/*
 * PinDrop plugin, pindrop.js v1.20190221
 * 
 * A jQuery plugin for Avatar Pindrop location management.
 * Download the latest release from: https://github.com/AVATARSYNDICATE/PinDrop
 *
 * Copyright 2019, AVATAR, LLC
 * Released under the MIT License: A short and simple permissive license with conditions only requiring preservation of copyright and license notices. Licensed works, modifications, and larger works may be distributed under different terms and without source code.
 * 
 */

// REQUIRED DEPENDENCIES: 
// jQuery version 3.0 or newer; 
// PinDrop will check if Handlebars.js and Font-Awesome 4.7.x is available. If not, PinDrop plugin will fetch and load them from a CDN provider.

//jquery plugin to get query string
(function ($) {
	$.extend({
		getQueryString: function (name) {
			function parseParams() {
				var params = {},
					e,
					a = /\+/g,
					r = /([^&=]+)=?([^&]*)/g,
					d = function (s) { return decodeURIComponent(s.replace(a, " ")); },
					q = window.location.search.substring(1);
				while (e = r.exec(q))
					params[d(e[1])] = d(e[2]);
				return params;
			}
			if (!this.queryStringParams)
				this.queryStringParams = parseParams();
			return this.queryStringParams[name];
		}
	});
})(jQuery);

Array.prototype.clean = function (deleteValue) {
	for (var i = 0; i < this.length; i++) {
		if (this[i] === deleteValue) {
			this.splice(i, 1);
			i--;
		}
	}
	return this;
};

// ---------------------------------
// ---------- Plugin Name ----------
// ---------------------------------
; (function ($, window, document, undefined) {

	var pluginName = 'pindrop';

	// Create the plugin constructor
	function Plugin(element, options) {

		this.element = element;
		this.$element = $(this.element);
		this._name = pluginName;
		this._defaults = $.fn[pluginName].defaults;
		this.settings = $.extend(true, {}, this._defaults, options);
		this.loadDependencies();
		
	}

	// Avoid Plugin.prototype conflicts
	$.extend(true, Plugin.prototype, {

		locations: [],
		standardLocations: [],
		servedZipLocations: [],
		markers: [],
		templates: {},
		requestData: {},
		eventsBoundOnce: false, // some events should only bind once
		isGeoLocated: false,
		hbPresent: false, // should we check if 4.0.x or greater?
		faVer4Present: false, // fa 4 uses font-awesome in css filename
		currentPaging: 0, // contains the current page when paging is enabled
		totalItems: '',  // contains total items when paging is enabled
		totalPages: 1,  // contains total pages when paging is enabled

		// load handlebars here and init helpers and templates before init
		loadDependencies: function () {

			var pl = this;
			if (typeof $ === 'undefined') { throw new Error('Pindrop requires jQuery.'); }

			if (typeof (Handlebars) !== 'undefined') { pl.handlebarsPresent = true; }

			if (!pl.handlebarsPresent) {

				var handlebarsUrl = pl.settings.handlebarsUrl;

				jQuery.cachedScript = function (handlebarsUrl, options) {
					options = $.extend(options || {}, {
						dataType: "script",
						cache: true,
						url: handlebarsUrl
					});
					return jQuery.ajax(options);
				};

				$.when($.cachedScript(handlebarsUrl)).done(function (script, textStatus) {
					pl.registerHbHelpers();
					pl.compileHbTemplates();
					pl.init();
				}).fail(function (jqxhr, settings, exception) {
					pl.checkHbDependency();
				});

			} else {
				pl.checkHbDependency();
				pl.registerHbHelpers();
				pl.compileHbTemplates();
				pl.init();
			}

			// load fa 4 if not present, fa 4 uses font-awesome in css filename TODO: upgrade this plugin to use FA ver 5.x
			if ($('link[href*="font-awesome"]').length < 1) {
				$('<link type="text/css" rel="stylesheet" data-pindroplink="font-awesome" href="'+pl.settings.fontAwesomeUrl+'">').appendTo("head");
			}

			// load required base styles
			$('<style type="text/css" data-pindropstyle="required"></style>').html(pl.settings.requiredCss).appendTo("head");

			// load optional pindrop style
			if (pl.settings.usePluginCss) {
				$('<style type="text/css" data-pindropstyle="optional"></style>').html(pl.settings.optionalCss).appendTo("head");
			}

		},

		// Initialization logic
		init: function (entityId, options) {

			var pl = this;

			pl.buildCache();

			pl.setTemplates(); // sets labels for templates and puts into dom

			//prep dom elems
			if ( pl.settings.$mapElement.length ) {
				pl.settings.$mapElement.height(pl.settings.mapContainerHeightpx);
			}

			if (pl.isValid(pl.settings.pindropKey, 'string')) {
				pl.requestData.entityId = pl.settings.pindropKey;
			} else {
				pl.doAlert("danger", "Warning", pl.settings.messages.missingEntityId, false);
				pl.setIndicator('off');
				return;
			}

			if (!pl.settings.showAllByDefault) {
				if (pl.isValid(pl.settings.defaultLocation, 'string')) {
					pl.requestData.address = pl.settings.defaultLocation;
				} else {
					pl.doAlert("danger", "Warning", pl.settings.messages.missingDefaultLocation);
					pl.setIndicator('off');
					return;
				}
			}

			if (pl.settings.enablePaging) {
				//test for negative page query
				pl.requestData.pageSize = pl.settings.resultsPerPage;
				
				if ($.getQueryString('page')) {
					if ($.getQueryString('page') > 0) {
						pl.requestData.pageNumber = $.getQueryString('page');
					} else {
						pl.requestData.pageNumber = 1;
					}
					pl.currentPaging = pl.requestData.pageNumber;
				} else {
					// paging is enabled but no page in query
					pl.requestData.pageNumber = 1;
					pl.currentPaging = 1;
				}
			} else {
				// paging is Not enabled
				pl.requestData.pageSize = 0;
				pl.requestData.pageNumber = 0;
				pl.currentPaging = 0;
			}

			if ($.getQueryString('location')) {
				pl.requestData.address = $.getQueryString('location');
				$(pl.settings.$searchInputEle).val(pl.requestData.address);
			}

			// set radius lookups dynamically and check if extended radius2 is enabled
			if (pl.settings.defaultRadiusLookup < 1) {
				pl.requestData.radius = "25";
			} else {
				pl.requestData.radius = pl.settings.defaultRadiusLookup;
			}		
			if (pl.settings.enableExtendedRadiusOnEmpty) {
				pl.requestData.radius2 = pl.settings.extendedRadiusLookup;
			}
			
			pl.getMapApiAssets();
			
		},

		getMapApiAssets: function () {
			var pl = this;
			
			$.getScript(pl.settings.mapApiUrl + pl.settings.mapApiKey)
				.done(function () {
					pl.drawMap();
					pl.setIndicator('on');
					$(pl.settings.$mapElement[0]).hide(0);
				})
				.fail(function () {
					pl.doAlert("warning", "Warning", pl.settings.messages.missingApiKey, false);
					pl.settings.$mapElement.remove();
					pl.getLocations(pl.requestData);
					pl.setIndicator('off');
				});
		},

		drawMap: function () {
			var pl = this;
			
			var latLng = new google.maps.LatLng(pl.settings.startLat, pl.settings.startLng),
				mapOptions = {
					center: latLng,
					zoom: 14,
					maxZoom: pl.settings.mapOptions.maxZoom
				};

			pl.map = new google.maps.Map(pl.settings.$mapElement[0], mapOptions);

			if (pl.settings.enableInfoWindows) {
				pl.infoWindow = new google.maps.InfoWindow({
					maxWidth: 320
				});
			}
			pl.getLocations(pl.requestData);
		},

		getLocations: function (requestData) {
			var pl = this;
			$.getJSON(pl.settings.serviceUrl, requestData)
				.done(function (results) {
					if (results.length > 0) {
						pl.removeLocations();
						pl.removeMarkers();
						$(pl.settings.$mapElement[0]).fadeIn();
						pl.locations = results;
						pl.drawMarkers(pl.locations);
						pl.drawLocationList();
						pl.bindEvents();
						if (requestData.address === pl.settings.defaultLocation) {
							$(document).find(pl.settings.$resetSearchButton).hide();
						} else {
							$(document).find(pl.settings.$resetSearchButton).show();
						}
					} else {
						pl.doAlert("warning", "Warning", pl.settings.messages.noResults);
						$(document).find("#pdMessage em").text(pl.requestData.address);
						pl.setIndicator('off');
					}
					
				})
				.fail(function (jqxhr, textStatus, error) {
					var err = textStatus + ", " + error;
					if (jqxhr.responseText.toLowerCase().match(/guid/g)) { // pindropKey invalid
						pl.doAlert("warning", "Configuration Error", pl.settings.messages.invalidEntityId);
					} else {
						pl.doAlert("warning", "Request Failed", err);
					}
					
					pl.setIndicator('off');
					
				});
		},

		drawLocationList: function () {

			var pl = this;
			
			var locationSearched = pl.settings.defaultLocation;

			if ($(pl.settings.$searchInputEle).val()) {
				locationSearched = $(pl.settings.$searchInputEle).val();
			}

			$(pl.settings.$locationListElement).html(pl.settings.templates.locationItem(pl.locations));

			$(document).find(pl.settings.$locationListElement).find(pl.settings.$locSearchedEle).text(locationSearched);

			pl.bindMarkerEvents();

			pl.doPaging();

		},

		goToMarker: function (markerIndex, scrollup) {

			var pl = this;
			google.maps.event.trigger(pl.markers[markerIndex], 'click');

			$('html, body').animate({
				scrollTop: $(pl.settings.$pluginContainer).offset().top - 75
			}, 200);
		},

		drawMarkers: function (markerArray) {
			var pl = this;
			delete pl.bounds;
			pl.bounds = new google.maps.LatLngBounds();
			for (i = 0; i < markerArray.length; i++) {
				var marker = new google.maps.Marker({
					position: {
						lat: parseFloat(markerArray[i].geo.lat),
						lng: parseFloat(markerArray[i].geo.lng)
					},
					map: pl.map,
					title: markerArray[i].name,
					id: markerArray[i].id
				});
				pl.markers.push(marker);
				if (pl.settings.enableInfoWindows) {
					google.maps.event.addListener(marker, 'click', (function (marker, i) {
						return function () {
							pl.infoWindow.close();
							pl.map.panTo(marker.position);
							pl.map.setZoom(pl.settings.mapOptions.zoomOnMarkerClick);
							pl.infoWindow.setContent(pl.createInfoWindowContent(i));
							pl.infoWindow.setOptions({ maxWidth: 320 });
							pl.infoWindow.open(pl.map, marker);
						};
					})(marker, i));

					google.maps.event.addListener(pl.infoWindow, 'domready', function () {
						var markerId = $(document).find('.pdInfoWindow:visible').attr('id');
						$(document).find('#' + markerId).focus().css({ "outline": "none" });
					});
				}
				pl.bounds.extend(marker.getPosition());
				pl.setIndicator('off');
			}
			pl.map.fitBounds(pl.bounds);
		},

		doDefaultMap: function () {
			var latLng = new google.maps.LatLng(38.3606659, -95.8774862);
			this.map.setZoom(4);
			this.map.setCenter(latLng);
		},

		createInfoWindowContent: function (i) {
			return this.settings.templates.infoWindow(this.locations[i]);
		},

		removeMarkers: function () {
			var pl = this;
			for (var i = 0; i < pl.markers.length; i++) {
				pl.markers[i].setMap(null);
			}
			pl.markers = [];
		},

		removeLocations: function () {
			this.locations = [];
		},

		doResetSearch: function () {
			var pl = this;
			pl.setIndicator('on');
			pl.requestData.address = pl.settings.defaultLocation;

			if (pl.settings.enablePaging) {
				pl.requestData.pageNumber = 1;
				pl.currentPaging = pl.requestData.pageNumber;
				window.history.replaceState({}, null, '?location=' + encodeURI(pl.settings.defaultLocation) + '&page=1');
			} else {
				pl.requestData.pageNumber = 0;
				window.history.replaceState({}, null, '?location=' + encodeURI(pl.settings.defaultLocation));
			}

			pl.getLocations(pl.requestData);

			$(document).find(pl.settings.$searchInputEle).val(pl.settings.defaultLocation);

			//pl.doPaging();
		},

		doSearchInput: function (event) {
			if (event) {
				event.preventDefault();
			}
			
			var pl = this;
			var value = $(pl.settings.$searchInputEle).val();
			if (value === '' || value === null || !value) {
				pl.doAlert("warning", "Warning", "Please enter an address.");
				return;
			}
			pl.setIndicator('on');
			pl.requestData.address = value;
			
			if (pl.settings.enablePaging) {
				pl.requestData.pageNumber = 1;
				pl.currentPaging = pl.requestData.pageNumber;
				window.history.replaceState({}, null, '?location=' + encodeURI(value) + '&page=1');
			} else {
				pl.requestData.pageNumber = 0;
				window.history.replaceState({}, null, '?location=' + encodeURI(value));
			}
			
			pl.getLocations(pl.requestData);
			pl.doPaging();
		},

		doSearchPaging: function (event) {
			var pl = this;
			var value = pl.settings.defaultLocation;

			if (event) {
				event.preventDefault();
			}
			// use default location or user inputted
			if ($(pl.settings.$searchInputEle).val().length > 0) {
				value = $(pl.settings.$searchInputEle).val();
			}

			if (value === '' || value === null || !value) {
				pl.doAlert("warning", "Warning", "Please enter an address.");
				return;
			}

			pl.setIndicator('on');

			// set requestData with location and paging info
			pl.requestData.address = value;
			pl.requestData.pageNumber = pl.currentPaging;

			window.history.replaceState({}, null, '?location=' + encodeURI(value) + '&page=' + pl.currentPaging);

			// make request
			pl.getLocations(pl.requestData);

			$('html, body').animate({
				scrollTop: $(pl.settings.$mapElement).offset().top - 175
			}, 200);
		},

		geolocationError: function (error, thisplugin) {
			//console.log(error); // can do stuff with this error to present specific notices to user
			var errCode = "";
			if (error.code === 1) {
				errCode = "Permission Denied";
			} else if (error.code === 2) {
				errCode = "Position Unavailable";
			}
			var pl = thisplugin;
			var errorMssg = "("+errCode+") " + pl.settings.messages.geoLookupFailure;
			pl.doAlert("warning", "Warning", errorMssg);
			
			setTimeout(function () {
				pl.doAlert("info", "Information", "Attempting to load default location...");
				$(pl.settings.$searchInputEle).val(pl.settings.defaultLocation);
				pl.doSearchInput();
			}, 500);

		},

		geolocationSuccess: function (position, thisplugin) {
			var pl = thisplugin;

			var lat = position.coords.latitude,
				lng = position.coords.longitude,
				point = new google.maps.LatLng(lat, lng);
			var crossHair = {
				path: "M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z",
				fillColor: '#9B0303',
				fillOpacity: 0.75,
				scale: .95,
				strokeWeight: .75,
				strokeColor: '#F12012'
			};
			var myMarker = new google.maps.Marker({
				position: point,
				map: pl.map,
				title: "My Location: " + point,
				icon: crossHair
			});

			new google.maps.Geocoder().geocode({ 'latLng': point }, function (results, status) {
				pl.geolocationResults = results;
				var address = results[0].formatted_address;
				$(pl.settings.$searchInputEle).val(address);
				pl.doSearchInput(event);
			});

			pl.map.setCenter(point);
			pl.setIndicator('off');
		},

		requestUserLocation: function (event) {
			event.preventDefault();

			var pl = this;

			// do positon via promise....
			if (navigator.geolocation) {
				var getPosition = function (options) {
					return new Promise(function (resolve, reject) {
						navigator.geolocation.getCurrentPosition(resolve, reject, options);
					});
				};

				getPosition().then(function (position) {
					pl.isGeoLocated = true;
					pl.geolocationSuccess(position, pl);
				}).catch(function (error) {
					pl.isGeoLocated = false;
					pl.geolocationError(error, pl);
					$(pl.settings.$findNearMeButton).remove();
					pl.setIndicator('off');
				});
			} else {
				pl.isGeoLocated = false;
				pl.doAlert("warning", "Warning", pl.settings.messages.geoLookupNotAllowed);
				$(pl.settings.$findNearMeButton).remove();
				pl.setIndicator('off');
			}

		},

		checkHbDependency: function () {
			var pl = this;
			if (typeof (Handlebars) === 'undefined') {
				pl.doAlert("warning", "Warning", pl.settings.messages.missingHandlebarsJs, false);
				pl.setIndicator('off');
				$(pl.settings.$searchForm).remove();
			}
		},

		registerHbHelpers: function () {

			Handlebars.registerHelper({
				addressString: function () {
					address = [this.address, this.addressTwo, this.city, this.state, this.zip].clean("");
					return encodeURIComponent(address.join(" "));
				},
				doDistance: function (distance, places) {
					places = parseFloat(places);
					if (isNaN(places)) {
						return distance;
					}
					return distance.toFixed(places);
				},
				urlEncode: function (passedString) {
					theString = encodeURIComponent(passedString);
					return theString;
				},
				numericOnly: function(passedString) {
					return passedString.replace(/\D/g,'');
				},
				checkSetHttp: function (passedString) {
					if (passedString.includes("http")) {
						return passedString;
					} else {
						return "https://" + passedString;
					}
				}

			});

		},

		compileHbTemplates: function () {
			var pl = this,
				templates = pl.settings.templates;

			templates.locationItem = Handlebars.compile(templates.locationItem);
			templates.infoWindow = Handlebars.compile(templates.infoWindow);
			templates.alert = Handlebars.compile(templates.alert);
			templates.searchForm = Handlebars.compile(templates.searchForm);
		},

		setTemplates: function () {
			var pl = this;
			var searchFormLabels = {
				searchform_Id: pl.settings.$searchInputEle.replace("#",""),
				searchform_Label: pl.settings.searchform_Label,
				searchform_Placeholder: pl.settings.searchform_Placeholder,
				searchform_SearchBtn: pl.settings.searchform_SearchBtn,
				searchform_GeoBtn: pl.settings.searchform_GeoBtn
			};
			$(pl.settings.$pluginContainer).prepend(pl.settings.templates.searchForm(searchFormLabels));

		},


		doPaging: function () {
			var pl = this;

			pl.totalItems = $(document).find(pl.settings.$locationListElement).find(pl.settings.$locationListItem).first().attr('data-total');
			pl.totalPages = Math.ceil(pl.totalItems / pl.settings.resultsPerPage);

			if (pl.totalItems) {
				$(document).find(pl.settings.$locationListElement).find(pl.settings.$locSearchedEle).parents('h2').prepend('<span>' + pl.totalItems + ' </span>');
			}

			// pagination buttons will be presented in groups of 10 pages as long as the records and pagination support more than 10 pages.
			if (pl.settings.enablePaging && pl.totalPages > 1) {

				var preActive = [];
				var postActive = [];
				var paging = "";

				// push all pages into arrays
				for (var i = 1; i <= pl.totalPages; i++) {

					if (i < pl.currentPaging && i > parseInt(pl.currentPaging) - 5) {
						preActive.push(i);
					}
					// contains current page
					if (i >= pl.currentPaging && i < parseInt(pl.currentPaging) + 6) {
						postActive.push(i);
					}

					}

				$(document).find(pl.settings.$locationListElement).find(pl.settings.pagingPage).html('Showing page ' + pl.currentPaging + ' of ' + pl.totalPages);

				paging += '<ul class="pagination justify-content-end">';

				if (parseInt(pl.currentPaging) !== 1) {
					paging += '<li class="page-item"><button aria-label="go to page ' + (parseInt(pl.currentPaging) - 1) + '" class="page-link pd-pager" data-paging="' + (parseInt(pl.currentPaging) - 1) + '">&laquo; Previous</button></li>';
				}

				// if not enough 'next' pages to have 10 total, add some behind current
				if (postActive.length < 6) {
					for (var k = 1; k <= pl.totalPages; k++) {
						if (k < pl.currentPaging - preActive.length && k >= preActive[0] + postActive.length - 6) {
							paging += '<li class="page-item"><button aria-label="go to page ' + k + '" class="page-link pd-pager" data-paging="' + k + '">' + k + '</button></li>';
						}
					}

				}
				// pages before current page
				$.each(preActive, function (i, pre) {
					paging += '<li class="page-item"><button aria-label="go to page ' + pre + '" class="page-link pd-pager" data-paging="' + pre + '">' + pre + '</button></li>';
				});

				// current page and pages ahead of it
				$.each(postActive, function (i, post) {
					if (parseInt(post) === parseInt(pl.currentPaging)) {
						paging += '<li class="page-item active"><button aria-label="go to page ' + post + '" class="page-link pd-pager" data-paging="' + post + '">' + post + '</button></li>';
					} else {
						paging += '<li class="page-item"><button aria-label="go to page ' + post + '" class="page-link pd-pager" data-paging="' + post + '">' + post + '</button></li>';
					}

				});
				// if not enough 'previous' pages to have 10 total, add some ahead of current
				if (preActive.length < 4) {
					for (var j = 1; j <= pl.totalPages; j++) {
						if (j > postActive.length + preActive.length && j < ((postActive[5] + postActive.length) - preActive.length) - 1) {
							paging += '<li class="page-item"><button aria-label="go to page ' + j + '" class="page-link pd-pager" data-paging="' + j + '">' + j + '</button></li>';
						}

					}
				}

				if (parseInt(pl.currentPaging) !== pl.totalPages) {
					paging += '<li class="page-item"><button aria-label="go to page ' + (parseInt(pl.currentPaging) + 1) + '" class="page-link pd-pager" data-paging="' + (parseInt(pl.currentPaging) + 1) + '">Next &raquo;</button></li>';
				}

				paging += '</ul>';

				$(document).find(pl.settings.$locationListElement).find(pl.settings.pagingControls).html(paging);

			}

		},

		setIndicator: function (state) {
			var pl = this,
				templates = pl.settings.templates,
				thisSpinner = pl.settings.spinnerEle;
			if (state === "on") {
				$(pl.settings.$searchForm).append(templates.indicator);
				$(document).find(thisSpinner).css(pl.settings.spinnerCss);
			}
			if (state === "off") {
				$(document).find(thisSpinner).fadeOut(1700);
				setTimeout(function () {
					$(document).find(thisSpinner).remove();
				}, 1500);
				
			}
		},

		doAlert: function (type, label, msg, use_template) {// use_template: true or false. uses template from settings
			var pl = this;
			if (use_template === undefined) { use_template = true; }
			if (use_template) {
				var alertMessage = pl.makeAlert(type, label, msg);
				$(pl.settings.$searchForm).before(pl.settings.templates.alert(alertMessage));
				$(document).find("#"+pl.settings.alertId).focus();
			} else {
				$(pl.settings.$pluginContainer).append('<div id="'+pl.settings.alertId+'" class="alert alert-' + type + '"><span aria-hidden="true" class="fa fa-exclamation-circle"></span><strong> ' + label + ':</strong> ' + msg + '</div>');
				$(document).find("#"+pl.settings.alertId).focus();
			}
			
		},

		makeAlert: function (type, label, msg) {
			return {
				type: type,
				label: label,
				message: msg,
				id: this.settings.alertId
			};
		},

		removeAlerts: function () {
			$(document).find('.alert').remove();
		},

		isValid: function (variable, type) {
			return (variable &&
				typeof variable !== 'undefined' &&
				typeof variable === type &&
				variable.trim() !== '');
		},

		// Remove plugin instance completely
		destroy: function () {
			this.unbindEvents();
			this.$element.removeData();
			$.removeData(this, "plugin_" + pluginName);
		},

		// Cache DOM nodes for performance
		buildCache: function () {
			this.$element = $(this.element);
		},

		// Bind events that trigger methods
		bindEvents: function () {
			var pl = this;
			if (!pl.eventsBoundOnce) {

				$(document).find(pl.settings.$searchInputEle).on('keyup', function () {
					if (event.keyCode === 13) {
						pl.doSearchInput(event);
						pl.removeAlerts();
					}
				});

				$(document).find(pl.settings.$doSearchButton).on('click', function (event) {
					pl.doSearchInput(event);
					pl.removeAlerts();
				});

				$(document).find(pl.settings.$findNearMeButton).on('click', function (event) {
					pl.requestUserLocation(event);
					pl.removeAlerts();
				});

				pl.eventsBoundOnce = true;
			}

			$(document).find(pl.settings.$resetSearchButton).on('click', function () {
				pl.doResetSearch();
				pl.removeAlerts();
			});

			$(document).find(pl.settings.pagingBtn).on('click', function (event) {
				pl.currentPaging = $(this).data('paging');
				pl.doSearchPaging(event);
				pl.removeAlerts();
			});

		},

		bindMarkerEvents: function () {
			var pl = this;
			$(document).find(pl.settings.goToMarkerButton).on('click', function (e) {
				e.preventDefault();
				var markerIndex = $(this).data('marker-index');			
				pl.goToMarker(markerIndex, true);
			});
			$(document).find(pl.settings.goToMarkerButton).on('keypress', function (e) {
				e.preventDefault();
				if (event.keyCode === 13) {
					var markerIndex = $(this).data('marker-index');
					pl.goToMarker(markerIndex, true);
				}
			});
		},

		// Unbind events that trigger methods
		unbindEvents: function () {
			/*
				Unbind all events in our plugin's namespace that are attached to "this.$element".
			*/
			this.$element.off('.' + this._name);
			$(this.settings.$searchInputEle).off('keyup');
			$(this.settings.$doSearchButton).off('click');
			$(this.settings.$findNearMeButton).off('click');
		}

	});

	$.fn[pluginName] = function (options) {
		return this.each(function () {
			if (!$.data(this, "plugin_" + pluginName)) {
				$.data(this, "plugin_" + pluginName, new Plugin(this, options));
			}
		});
	};

	$.fn[pluginName].defaults = {
		// START Required Settings //
		mapApiUrl: 'https://maps.googleapis.com/maps/api/js?key=',
		serviceUrl: 'https://locator.avatarsyn.com/api/locationweb/GetLocationsByAddress',
		pindropKey: '',
		mapApiKey: '',
		// END Required Settings //

		// START Optional //
		defaultLocation: '43604',
		defaultRadiusLookup: '25', // in miles
		startLat: 41.6487933,
		startLng: -83.5503455,
		usePluginCss: true,
		mapContainerHeightpx: '365px',
		searchform_Label: "Address",
		searchform_Placeholder: "Search by address&hellip;",
		searchform_SearchBtn: "Search",
		searchform_GeoBtn: "Find Near Me",
		enablePaging: false,
		resultsPerPage: 10,
		// END Optional //

		// START Advanced Settings //
		mapOptions: {
			maxZoom: 16,
			zoomOnMarkerClick: 15
		},
		enableInfoWindows: true,
		loadHandlebars: true,
		enableExtendedRadiusOnEmpty: false,
		extendedRadiusLookup: '75', // in miles
		// END Advanced Settings //

		// START DO NOT EDIT //
		handlebarsUrl: "https://cdnjs.cloudflare.com/ajax/libs/handlebars.js/4.0.11/handlebars.min.js",  // dependency
		fontAwesomeUrl: "https://maxcdn.bootstrapcdn.com/font-awesome/4.7.0/css/font-awesome.min.css",  // dependency
		$pluginContainer: '#pdPlugin',
		$mapElement: $('#pdMap'),
		$locationListElement: '#pdList',
		$searchForm: '#pdSearch',
		$searchInputEle: '#pdSearchThis',
		$findNearMeButton: '#pdSearchNear',
		$doSearchButton: '#pdSubmit',
		pagingRow: '.pd-pagination',
		pagingPage: '.pd-pagination--page',
		pagingControls: '.pd-pagination--paging',
		pagingBtn: '.pd-pager',
		spinnerEle: '#pdLoading',
		$locationListItem: '.pd-item',
		goToMarkerButton: '.pd-item--marker',
		alertId: 'pdMessage',
		$resetSearchButton: '.pd-resetSearch',
		$locSearchedEle: '.pd-locationSearched',
		templates: {
			locationItem: '{{#if this}}<h2 class="text-left mt-5">Location Results for [ <small class="pd-locationSearched"></small> ] <button class="btn btn-link btn-sm pd-resetSearch" type="button" aria-label="reset to default results"><span class="fa fa-times"></span></button></h2><div class="pd-pagination row"><div class="pd-pagination--page col-12 col-sm-3">showing</div><div class="pd-pagination--paging col-12 col-sm-9 text-right">page</div></div><div class="my-5">{{#each this}}<div data-total="{{totalRecords}}" tabindex="0" class="row pd-item mb-5"><div class="col-1 pd-item--icons text-center"><button class="btn btn-link pd-item--link pd-item--marker" data-marker-index="{{@index}}" data-markerid="{{id}}"><span class="fa fa-map-marker" aria-hidden="true"></span></button>{{#if phone}}<a href="tel:{{phone}}" class="btn btn-link pd-item--link" target="_blank"><span class="fa fa-phone" aria-hidden="true"></span></a>{{/if}}{{#if website}}<a href="{{checkSetHttp website}}" aria-label="Open {{name}} website" class="btn btn-link pd-item--link" target="_blank"><span class="fa fa-globe" aria-hidden="true"></span></a>{{/if}}<a href="https://maps.google.com?daddr={{addressString}}" aria-label="Open Google directions" class="btn btn-link pd-item--link" target="_blank"><span class="fa fa-car" aria-hidden="true"></span></a></div><div class="col-11"><h3>{{{name}}} <small>{{ city }}, {{#if stateAbbr}}{{ stateAbbr }}{{ else}}{{ state }}{{/if}}</small></h3>{{#if phone}}<p>{{ phone }}</p>{{/if}}{{#if website}}<p><a href="{{checkSetHttp website}}" target="_blank">{{ website }}</a></p>{{/if}}<p class="pd-item--address">{{ address }}<br />{{ city }}, {{#if stateAbbr}}{{ stateAbbr }}{{ else}}{{ state }}{{/if}} {{ zip }}<br /><small>{{ doDistance geo.distance 2}} miles</small></p>{{#if description}}<p>{{ description }}</p>{{/if}}</div></div>{{/each}}</div><div class="pd-pagination row"><div class="pd-pagination--page col-12 col-sm-3">showing</div><div class="pd-pagination--paging col-12 col-sm-9 text-right">page</div></div>{{/if}}',

			infoWindow: '<div class="pdInfoWindow" style="min-width: 300px !important;" tabindex="0" id="{{id}}"><p class="pdInfoWindow--name"><big><strong>{{{name}}}</strong></big></p>{{#if phone}}<p class="pdInfoWindow--phone clearfix"><a href="tel:{{numericOnly phone}}" class="pull-left fa fa-phone" target="_blank" aria-label="Start telephone call"></a><a href="tel:{{numericOnly phone}}" target="_blank" class="pull-right">{{phone}}</a></p>{{/if}}{{#if website}}<p class="pdInfoWindow--web clearfix"><a href="{{checkSetHttp website}}" class="pull-left fa fa-globe" target="_blank" aria-label="Go to thier website"></a><a href="{{checkSetHttp website}}" target="_blank" class="pull-right">{{website}}</a></p>{{/if}}<p class="pdInfoWindow--address clearfix"><a class="fa fa-car pull-left" aria-label="Open Google directions" target="_blank" href="https://maps.google.com?daddr={{addressString}}"></a><a class="pull-right" target="_blank" href="https://maps.google.com?daddr={{addressString}}">{{address}}<br/>{{city}},{{#if stateAbbr}}{{stateAbbr}}{{else}}{{state}}{{/if}} {{zip}}</a></p></div>',

			alert: '<div id="{{id}}" tabindex="0" class="alert alert-{{type}} alert-dismissable"><button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button><strong><span aria-hidden="true" class="fa fa-exclamation-circle"></span> {{label}}:</strong> {{{message}}}</div>',

			indicator: '<div id="pdLoading"><span tabindex="0" aria-label="Loading locations." class="fa fa-spinner fa-pulse fa-3x fa-fw"></span></div>',

			searchForm: '<div id="pdSearch" class="input-group"><div class="input-group-prepend"><label for="{{searchform_Id}}" class="input-group-text">{{searchform_Label}}</label></div><input id="{{searchform_Id}}" class="form-control" type="search" value="" placeholder="{{{searchform_Placeholder}}}" /><div class="input-group-append"><button id="pdSubmit" class="btn btn-primary" type="button">{{searchform_SearchBtn}} <span aria-hidden="true" class="fa fa-search"></span></button><button id="pdSearchNear" class="btn btn-secondary" type="button">{{searchform_GeoBtn}} <span aria-hidden="true" class="fa fa-map-marker"></span></button></div></div>',
		},
		
		messages: {
			noResults: "There are no locations to display for <em></em> . Please try another location.",
			missingHandlebarsJs: "Handlebars.js could not be found or did not load correctly.",
			missingApiKey: "The map could not be loaded at this time. Please confirm that the mapApiKey is correctly set.",
			missingDefaultLocation: "Default location missing. Please confirm that default location correctly set.",
			missingEntityId: "Your Pindrop API Key is missing. Please confirm that the Pindrop Key is correctly set.",
			invalidEntityId: "Please confirm that the Pindrop API Key (pindropKey) is entered correctly.",
			disabledEntityId: "Pindrop API Key may not be valid. Please contact us with any questions or to confirm your Pindrop API Key.",
			geoLookupFailure: "Your current location could not be determined. Please enter an address to search.",
			geoLookupNotAllowed: "Your browser does not support geolocation or it has not been allowed. Please enter an address to search."

		},
		spinnerCss: { "position": "absolute", "text-align": "center", "z-index": "9999", "width": "100%" },
		requiredCss: '#pdPlugin{min-height:500px; width:100% } .clearfix::after{display:block;clear:both;content:""} .pdInfoWindow .pull-right {width:90%;} .pdInfoWindow .fa:hover {text-decoration: none;}',
		optionalCss: '.pd-locationSearched {text-transform: uppercase;} .pd-resetSearch {color:#2D6073;} .pd-item { font-family: inherit; } .pd-item h3 { font-family: inherit; text-transform: uppercase; border-bottom: 1px solid #2D6073; padding-bottom: 10px; } .pd-item h3 small {text-transform: none;} .pd-item--icons { border-right: 1px solid #2D6073; } .pd-item--link { display: block; font-size: 20px; text-align: center; width: 100%; color: #2D6073; } .pd-item--marker {padding-top: 3px;} .pd-item a { color: #2D6073; } .pd-item big { line-height: 1.2; font-family: inherit; color: #000; text-decoration: none; } .pd-item--address { text-transform: uppercase; } .pd-item--address small { text-transform: capitalize; font-style: italic; } @media (max-width: 767px) { .pd-item--icons { padding: 0; } } @media (max-width: 550px) { .pd-item--icons { border: 0; } } @media (max-width: 375px) { .pd-item h3 { font-size: 1.25rem; } }'

	};

})(jQuery, window, document);
