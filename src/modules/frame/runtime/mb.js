// The frame's motion helpers, `MB.*`, which Scene code calls inside the page. Loaded once by the root
// page after GSAP; reads window.MB_DATA, which the Assembler injects: each unit's duration and the
// anchor time of every Storyboard element, in seconds from the unit's start.
(function () {
  "use strict";

  if (window.MB) {
    return;
  }

  /** Reveals and draw-ons start this early, so an element lands on its word rather than after it. */
  var LEAD = 0.05;

  /** Entrance styles for MB.reveal: [from, to]. */
  var STYLES = {
    rise: [{ opacity: 0, y: 48 }, { opacity: 1, y: 0 }],
    drop: [{ opacity: 0, y: -48 }, { opacity: 1, y: 0 }],
    left: [{ opacity: 0, x: -80 }, { opacity: 1, x: 0 }],
    right: [{ opacity: 0, x: 80 }, { opacity: 1, x: 0 }],
    pop: [{ opacity: 0, scale: 0.82 }, { opacity: 1, scale: 1 }],
    fade: [{ opacity: 0 }, { opacity: 1 }],
    blur: [{ opacity: 0, filter: "blur(14px)", scale: 1.04 }, { opacity: 1, filter: "blur(0px)", scale: 1 }],
    wipe: [{ clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)" }],
  };

  function data() {
    return window.MB_DATA;
  }

  function all(target) {
    if (typeof target === "string") {
      return Array.prototype.slice.call(document.querySelectorAll(target));
    }

    if (target.length !== undefined) {
      return Array.prototype.slice.call(target);
    }

    return [target];
  }

  function one(target) {
    if (typeof target === "string") {
      var element = document.querySelector(target);

      if (!element) {
        throw new Error("MB: no element matches " + target);
      }

      return element;
    }

    return target;
  }

  /** The element's box inside an ancestor, ignoring transforms, so it is safe while entrances hold elements offset. */
  function boxWithin(element, ancestor) {
    var x = 0;
    var y = 0;

    for (var node = element; node && node !== ancestor; node = node.offsetParent) {
      x += node.offsetLeft;
      y += node.offsetTop;
    }

    return { x: x, y: y, w: element.offsetWidth, h: element.offsetHeight };
  }

  /** Where the line from a box's centre towards (toX, toY) leaves the box, `gap` px out. */
  function edgePoint(box, toX, toY, gap) {
    var cx = box.x + box.w / 2;
    var cy = box.y + box.h / 2;
    var dx = toX - cx;
    var dy = toY - cy;
    var sx = dx === 0 ? Infinity : (box.w / 2 + gap) / Math.abs(dx);
    var sy = dy === 0 ? Infinity : (box.h / 2 + gap) / Math.abs(dy);
    var s = Math.min(sx, sy);

    return { x: cx + dx * s, y: cy + dy * s };
  }

  window.MB = {
    /** The frame contract this runtime implements. */
    version: data().contractVersion,

    /** A unit's timing: `at(id)` is the anchor of DOM id `<sceneId>-<elementId>`, in seconds from the unit's start. */
    scene: function (unitId) {
      var unit = data().units[unitId];

      if (!unit) {
        throw new Error("MB: unknown unit " + unitId);
      }

      return {
        duration: unit.duration,
        sceneStarts: unit.sceneStarts,
        at: function (id) {
          var time = unit.anchors[id];

          if (time === undefined) {
            throw new Error("MB: no anchor for " + id + " in " + unitId);
          }

          return time;
        },
      };
    },

    /** An entrance on the spoken word: it starts 50 ms early with an ease-out. Styles: rise, drop, left, right, pop, fade, blur, wipe. */
    reveal: function (tl, target, time, style, options) {
      var o = options || {};
      var motion = data().motion;
      var pair = STYLES[style || motion.reveal] || STYLES.rise;
      var to = Object.assign({}, pair[1], { duration: o.duration || motion.duration, ease: o.ease || motion.ease, stagger: o.stagger || 0 });

      tl.fromTo(target, Object.assign({}, pair[0], o.from || {}), to, Math.max(0, time - LEAD));

      return tl;
    },

    /** Draws SVG strokes on, landing like MB.reveal: 50 ms early with an ease-out. */
    draw: function (tl, target, time, options) {
      var o = options || {};
      var motion = data().motion;

      all(target).forEach(function (path) {
        var length = path.getTotalLength();

        path.style.strokeDasharray = length + " " + length;
        tl.fromTo(
          path,
          { strokeDashoffset: length },
          { strokeDashoffset: 0, duration: o.duration || 1.3 * motion.duration, ease: o.ease || motion.ease },
          Math.max(0, time - LEAD),
        );
      });

      return tl;
    },

    /**
     * Lays an SVG <path> out as a connector between two elements, measured from the layout: it runs
     * between their box edges, `gap` px out. The path's <svg class="mb-wire"> sits in the elements'
     * common container. The only way to draw a connector; call it before MB.draw.
     */
    connect: function (path, from, to, options) {
      var o = options || {};
      var gap = o.gap === undefined ? 14 : o.gap;
      var element = one(path);
      var svg = element.ownerSVGElement;
      var container = svg.parentElement;

      svg.setAttribute("width", container.offsetWidth);
      svg.setAttribute("height", container.offsetHeight);

      var a = boxWithin(one(from), container);
      var b = boxWithin(one(to), container);
      var start = edgePoint(a, b.x + b.w / 2, b.y + b.h / 2, gap);
      var end = edgePoint(b, a.x + a.w / 2, a.y + a.h / 2, gap);
      var curve = o.curve === undefined ? data().connector.curve : o.curve;
      var d = "M" + start.x + " " + start.y;

      if (curve) {
        var mid = (start.x + end.x) / 2;
        d += " C" + mid + " " + start.y + " " + mid + " " + end.y + " " + end.x + " " + end.y;
      } else {
        d += " L" + end.x + " " + end.y;
      }

      element.setAttribute("d", d);
      element.setAttribute("data-mb-connect", "");

      return element;
    },

    /** Moves an element through the centres of other elements, such as a packet along a flow. */
    travel: function (tl, target, via, time, options) {
      var o = options || {};
      var element = one(target);
      var parent = element.offsetParent;
      var points = via.map(function (stop) {
        var box = boxWithin(one(stop), parent);

        return {
          x: box.x + box.w / 2 - element.offsetWidth / 2 - element.offsetLeft,
          y: box.y + box.h / 2 - element.offsetHeight / 2 - element.offsetTop,
        };
      });
      var leg = (o.duration || 0.6 * (points.length - 1)) / (points.length - 1);

      tl.fromTo(element, { x: points[0].x, y: points[0].y, opacity: 0 }, { x: points[0].x, y: points[0].y, opacity: 1, duration: 0.2 }, Math.max(0, time - LEAD));

      for (var i = 1; i < points.length; i++) {
        tl.to(element, { x: points[i].x, y: points[i].y, duration: leg, ease: data().motion.easeInOut }, time + 0.2 + (i - 1) * leg);
      }

      return tl;
    },

    /** Counts a number up; the element's text becomes prefix + value + suffix. */
    countUp: function (tl, target, value, time, options) {
      var o = options || {};
      var element = one(target);
      var state = { value: o.from || 0 };
      var decimals = o.decimals || 0;

      function format(v) {
        return (o.prefix || "") + Number(v).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + (o.suffix || "");
      }

      element.textContent = format(state.value);
      tl.fromTo(
        state,
        { value: o.from || 0 },
        {
          value: value,
          duration: o.duration || 1.2,
          ease: o.ease || "power2.out",
          onUpdate: function () {
            element.textContent = format(state.value);
          },
        },
        time,
      );

      return tl;
    },

    /** Types an element's text on, character by character. */
    type: function (tl, target, time, options) {
      var o = options || {};
      var element = one(target);
      var text = element.textContent;
      var state = { count: 0 };

      element.textContent = "";
      tl.fromTo(
        state,
        { count: 0 },
        {
          count: text.length,
          duration: o.duration || Math.max(0.4, text.length * 0.035),
          ease: "none",
          onUpdate: function () {
            element.textContent = text.slice(0, Math.round(state.count));
          },
        },
        time,
      );

      return tl;
    },

    /** A brief emphasis: a scale bump in the accent color, then it settles. */
    emphasize: function (tl, target, time, options) {
      var o = options || {};
      var motion = data().motion;

      tl.to(target, { scale: o.scale || 1.08, color: o.color || "var(--accent)", duration: 0.2, ease: "power2.out" }, time);
      tl.to(target, { scale: 1, duration: 0.4, ease: motion.ease }, time + 0.2);

      return tl;
    },
  };
})();
