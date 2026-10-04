// Injected into an assembled page by the Checker: reports what the viewer sees of one element at the
// current time, for the anchor contract.
(function () {
  "use strict";

  /** SVG shapes that draw a line: a connector is one of these, laid out by MB.connect. */
  var GEOMETRY = "path, line, polyline";

  /** How much of a stroke is drawn on, 0 to 1, from its dash offset; 1 when it isn't dashed. */
  function drawn(shape) {
    var style = getComputedStyle(shape);
    var length = shape.getTotalLength();
    var offset = Math.abs(parseFloat(style.strokeDashoffset) || 0);

    if (length <= 0 || !style.strokeDasharray || style.strokeDasharray === "none") {
      return 1;
    }

    return 1 - Math.min(1, offset / length);
  }

  /** Whether a clip-path inset hides the element entirely, as a wipe does before it starts. */
  function clippedAway(element) {
    var inset = /^inset\(([^)]*)\)/.exec(getComputedStyle(element).clipPath);

    if (!inset) {
      return false;
    }

    var parts = inset[1].split(/\s+/).filter(function (part) {
      return /%$/.test(part);
    });
    var sides = parts.map(parseFloat);
    var top = sides[0] || 0;
    var right = sides.length > 1 ? sides[1] : top;
    var bottom = sides.length > 2 ? sides[2] : top;
    var left = sides.length > 3 ? sides[3] : right;

    return top + bottom >= 100 || left + right >= 100;
  }

  function isGeometry(element) {
    return typeof element.getTotalLength === "function" && element.matches(GEOMETRY);
  }

  /** Lines drawn in the element, leaving out icons and marker or gradient definitions. */
  function linesIn(element) {
    var shapes = Array.prototype.slice.call(element.querySelectorAll(GEOMETRY));

    if (isGeometry(element)) {
      shapes.unshift(element);
    }

    return shapes.filter(function (shape) {
      return !shape.closest("defs, marker, symbol, clipPath, mask, .mb-icon");
    });
  }

  window.__mbProbe = function (id, width, height) {
    var matches = document.querySelectorAll("#" + CSS.escape(id));
    var element = matches[0];

    if (!element) {
      return { count: 0 };
    }

    var opacity = 1;

    for (var node = element; node && node.nodeType === 1; node = node.parentElement) {
      var style = getComputedStyle(node);

      if (style.display === "none" || style.visibility === "hidden") {
        opacity = 0;
        break;
      }

      opacity *= Number(style.opacity);
    }

    var lines = linesIn(element);
    var progress = lines.length === 0 ? 1 : Math.max.apply(null, lines.map(drawn));
    var rect = element.getBoundingClientRect();
    var sized = isGeometry(element) ? rect.width > 1 || rect.height > 1 : rect.width > 1 && rect.height > 1;
    var inFrame = sized && rect.right > 0 && rect.bottom > 0 && rect.left < width && rect.top < height;

    return {
      count: matches.length,
      opacity: opacity,
      drawn: progress,
      inFrame: inFrame,
      visible: opacity >= 0.3 && progress >= 0.3 && inFrame && !clippedAway(element),
      handDrawnLines: lines.filter(function (shape) {
        return !shape.hasAttribute("data-mb-connect");
      }).length,
    };
  };
})();
