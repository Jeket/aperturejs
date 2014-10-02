/**
 * Source: openLayers2.js
 * Copyright (c) 2013-2014 Oculus Info Inc.
 * @fileOverview Aperture OpenLayers 2.x integration APIs
 */



/*
 * TODO: Create a generic container layer that just creates a canvas for children
 * to use.  Map lat/lon to [0,1] ranges and then renderers can scale x/y based on
 * size of canvas.  Then can make MapNodeLayer derive from this layer.  This layer
 * could be used as parent for a layer drawing a series of points/labels, for
 * example.
 */



/**
 * @namespace Geospatial vizlet layers. If not used, may be excluded.
 * @requires OpenLayers2
 */
aperture.geo = (
/** @private */
function(ns) {

	if (!window.OpenLayers) {
		aperture.log.info('OpenLayers 2 js not present. Skipping OL2 map api implementation.');
		return ns;
	}


	/**********************************************************************/

	/*
	 * The projection that the API expects for lat/lon data unless instructed otherwise.
	 */
	var apiProjection = new OpenLayers.Projection('EPSG:4326');


	/**
	 * @private
	 * OpenLayers implementation that positions a DIV that covers the entire world
	 * at the current zoom level.  This provides the basis for the MapNodeLayer
	 * to allow child layers to render via DOM or Vector graphics.
	 */
	var DivOpenLayer = OpenLayers.Class(OpenLayers.Layer,
	{

		/**
		 * APIProperty: isBaseLayer
		 * {Boolean} Markers layer is never a base layer.
		 */
		isBaseLayer : false,

		/**
		 * @private
		 */
		topLeftPixelLocation : null,

		/**
		 * @private constructor
		 *
		 * Parameters:
		 * name - {String}
		 * options - {Object} Hashtable of extra options to tag onto the layer
		 */
		initialize : function(name, options) {
			OpenLayers.Layer.prototype.initialize.apply(this, arguments);

			// The frame is big enough to contain the entire world
			this.contentFrame = document.createElement('div');
			this.contentFrame.style.overflow = 'hidden';
			this.contentFrame.style.position = 'absolute';
			// It is contained in the 'div' element which is fit exactly
			// to the map's main container layer
			this.div.appendChild(this.contentFrame);
		},

		/**
		 * APIMethod: destroy
		 */
		destroy : function() {
			OpenLayers.Layer.prototype.destroy.apply(this, arguments);
		},

		/**
		 * Method: moveTo
		 *
		 * Parameters:
		 * bounds - {<OpenLayers.Bounds>}
		 * zoomChanged - {Boolean}
		 * dragging - {Boolean}
		 */
		moveTo : function(bounds, zoomChanged, dragging) {
			var extent, topLeft, bottomRight;

			OpenLayers.Layer.prototype.moveTo.apply(this, arguments);

			// Adjust content DIV to cover visible area + 1 equivalent area in each direction
			topLeft = this.map.getLayerPxFromLonLat(new OpenLayers.LonLat(bounds.left, bounds.top));
			bottomRight = this.map.getLayerPxFromLonLat(new OpenLayers.LonLat(bounds.right, bounds.bottom));

			var width = bottomRight.x - topLeft.x;
			var height = bottomRight.y - topLeft.y;

			// Layer origin is offset that must be subtracted from a pixel location to transform
			// from OpenLayer's layer pixel coordinates to the contentFrame's coordinates
			this.olLayerOrigin = {
				x: topLeft.x - width,
				y: topLeft.y - height,
			};

			this.contentFrame.style.top = this.olLayerOrigin.y + 'px';
			this.contentFrame.style.left = this.olLayerOrigin.x + 'px';
			this.contentFrame.style.width = (3*width) + 'px';
			this.contentFrame.style.height = (3*height) + 'px';

			if (this.onFrameChange) {
				this.onFrameChange(bounds);
			}
		},

		getContentPixelForLonLat : function( lon, lat ) {
			// Convert from lon/lat to pixel space, account for projection
			var pt = new OpenLayers.Geometry.Point(lon, lat);
			// Reproject to map's projection
			if( this.map.projection != apiProjection ) {
				pt.transform(apiProjection, this.map.projection);
			}
			// Get layer pixel
			var px = this.map.getLayerPxFromLonLat(new OpenLayers.LonLat(pt.x, pt.y));
			// Transform pixel to contentFrame space
			px.x -= this.olLayerOrigin.x;
			px.y -= this.olLayerOrigin.y;

			return px;
		},

		getLonLatExtent: function() {
			var extent = this.map.getExtent();
			var p0 = new OpenLayers.Geometry.Point(extent.left, extent.top);
			var p1 = new OpenLayers.Geometry.Point(extent.right, extent.bottom);
			if( this.map.projection != apiProjection ) {
				p0.transform(this.map.projection, apiProjection);
				p1.transform(this.map.projection, apiProjection);
			}
			return {
				left: p0.x,
				top: p0.y,
				right: p1.x,
				bottom: p1.y
			};
		},

		drawFeature : function(feature, style, force) {
			// Called by OpenLayers to force this feature to redraw (e.g. if some state changed
			// such as selection that could affect the visual.  Not needed for a container layer
		},

		CLASS_NAME : 'DivOpenLayer'
	});

	ns.OL2ContainerLayer = DivOpenLayer;


	/**********************************************************************/


	var BaseMapNodeLayer = aperture.PlotLayer.extend('aperture.geo.BaseMapNodeLayer',
	/** @lends aperture.geo.BaseMapNodeLayer# */
	{
		/**
		 * @class A layer that draws child layer items at point locations.
		 *
		 * @mapping {Number} longitude
		 *   The longitude at which to locate a node
		 *
		 * @mapping {Number} latitude
		 *   The latitude at which to locate a node
		 *
		 * @augments aperture.PlotLayer
		 * @constructs
		 * @factoryMade
		 */
		init : function( spec, mappings ) {
			aperture.PlotLayer.prototype.init.call(this, spec, mappings );
			this._layer = spec.olLayer;
		},

		/**
		 * @private
		 */
		canvasType: aperture.canvas.VECTOR_CANVAS,

		/**
		 * @private
		 */
		render : function( changeSet ) {
			// just need to update positions
			aperture.util.forEach(changeSet.updates, function( node ) {
				// If lon,lat is specified pass the position to children
				// Otherwise let the children render at (x,y)=(0,0)
				var lat = this.valueFor('latitude', node.data, null);
				var lon = this.valueFor('longitude', node.data, null);

				// Find pixel x/y from lon/lat
				var px = {x:0,y:0};
				if (lat != null && lon != null) {
					px = this._layer.getContentPixelForLonLat(lon,lat);
				}

				// Update the given node in place with these values
				node.position = [px.x,px.y];
			}, this);


			// will call renderChild for each child.
			aperture.PlotLayer.prototype.render.call(this, changeSet);

		}
	});

	ns.BaseMapNodeLayer = BaseMapNodeLayer;


	/**********************************************************************/


	var MapLayerVizletWrapper = aperture.vizlet.make( BaseMapNodeLayer );

	/**
	 * @class A root-level layer (cannot be contained in another vizlet/layer) that
	 * can be added to an OpenLayers v2.x map. Layers of this type contain a {@link #olLayer}
	 * member which is a valid OpenLayers layer and can be added to any OL map.
	 *
	 * @example
	 *
	 * var mapLayer = new aperture.geo.ol2.MapLayer();
	 * mapLayer.map('latitude').to('lat');
	 * mapLayer.map('longitude').to('lon');
	 * myOLMap.addLayer( mapLayer.olLayer );
	 *
	 * @name aperture.geo.OL2MapLayer
	 * @augments aperture.geo.BaseMapNodeLayer
	 * @constructs
	 * @requires OpenLayers
	 */
	var MapNodeLayer = function(spec, mappings) {
		// Create OL layer that our layer will contain
		var olLayer = new DivOpenLayer('aperture-openlayers-bridge', {});

		spec = aperture.util.extend(spec || {}, {
			elem: olLayer.contentFrame,
			olLayer: olLayer
		});

		// Create Aperture MapLayer layer itself
		var self = MapLayerVizletWrapper(spec, mappings);

		// When ol layer's frame changes, redraw owner Aperture layer
		olLayer.onFrameChange = function() {
			self.all().redraw();
		}

		// Expose ol layer via member "olLayer"
		self.olLayer = olLayer;

		return self;
	};

	ns.ol = {
		MapNodeLayer: MapNodeLayer
	};

	return ns;
}(aperture.geo || {}));