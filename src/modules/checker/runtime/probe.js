// Injected into an assembled page by the Checker: reports what the viewer sees at the current time,
// of one element for the anchor contract, and of the whole page for the Checker's own rules.
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

  /** The element's opacity times its ancestors', or 0 when it or an ancestor is hidden. */
  function effectiveOpacity(element) {
    var opacity = 1;

    for (var node = element; node && node.nodeType === 1; node = node.parentElement) {
      var style = getComputedStyle(node);

      if (style.display === "none" || style.visibility === "hidden") {
        return 0;
      }

      opacity *= Number(style.opacity);
    }

    return opacity;
  }

  function isInFrame(rect, width, height) {
    return rect.right > 0 && rect.bottom > 0 && rect.left < width && rect.top < height;
  }

  window.__mbProbe = function (id, width, height) {
    var matches = document.querySelectorAll("#" + CSS.escape(id));
    var element = matches[0];

    if (!element) {
      return { count: 0 };
    }

    var opacity = effectiveOpacity(element);
    var lines = linesIn(element);
    var progress = lines.length === 0 ? 1 : Math.max.apply(null, lines.map(drawn));
    var rect = element.getBoundingClientRect();
    var sized = isGeometry(element) ? rect.width > 1 || rect.height > 1 : rect.width > 1 && rect.height > 1;
    var inFrame = sized && isInFrame(rect, width, height);

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

  /** Raster images; the frame's inline icons are `svg.mb-icon`. */
  var IMAGES = "img, video, canvas, image";

  /** An icon or image covering at least this share of the frame is a background or a texture, not an image. */
  var FRAME_COVER = 0.8;

  /** An icon or image overlaps text when they share more than this share of the smaller one. */
  var OVERLAP_SHARE = 0.15;

  /** At or above this effective opacity, an element counts for the overlap rule (as for the anchor contract). */
  var SHOWN = 0.3;

  var SKIPPED = "script, style, template, head, title, defs, marker, symbol, clipPath, mask";

  function elements() {
    return Array.prototype.filter.call(document.body.querySelectorAll("*"), function (element) {
      return !element.closest(SKIPPED);
    });
  }

  function compositionOf(element) {
    var composition = element.closest("[data-composition-id]");

    return composition ? composition.getAttribute("data-composition-id") : null;
  }

  /** A unit's `#root`, which its Scene code is written into, as mounted in the page. */
  function isUnitRoot(node) {
    return node.id === "root" || !!(node.parentElement && node.parentElement.hasAttribute("data-composition-id"));
  }

  /** A CSS selector for the element as the unit's Scene code sees it: from the nearest unique id, or from its `#root`. */
  function selectorOf(element) {
    var steps = [];

    for (var node = element; node && node.nodeType === 1; node = node.parentElement) {
      if (node.id && node.id !== "root" && document.querySelectorAll("#" + CSS.escape(node.id)).length === 1) {
        steps.unshift("#" + CSS.escape(node.id));
        break;
      }

      if (isUnitRoot(node) || node.hasAttribute("data-composition-id")) {
        steps.unshift("#root");
        break;
      }

      steps.unshift(stepOf(node));
    }

    return steps.join(" > ");
  }

  /** `tag.class`, preferring a class of the Scene code's own over the frame's `mb-*`, numbered when siblings share it. */
  function stepOf(node) {
    var classes = Array.prototype.slice.call(node.classList);
    var own =
      classes.filter(function (name) {
        return name.indexOf("mb-") !== 0;
      })[0] || classes[0];
    var tag = node.tagName.toLowerCase();
    var step = own ? tag + "." + CSS.escape(own) : tag;
    var parent = node.parentElement;

    if (!parent || parent.querySelectorAll(":scope > " + step).length < 2) {
      return step;
    }

    var sameTag = Array.prototype.filter.call(parent.children, function (sibling) {
      return sibling.tagName === node.tagName;
    });

    return step + ":nth-of-type(" + (sameTag.indexOf(node) + 1) + ")";
  }

  function area(rect) {
    return Math.max(0, rect.width) * Math.max(0, rect.height);
  }

  function intersection(a, b) {
    var width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    var height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);

    return width > 0 && height > 0 ? width * height : 0;
  }

  function coversFrame(rect, width, height) {
    return intersection(rect, { left: 0, top: 0, right: width, bottom: height }) >= FRAME_COVER * width * height;
  }

  function ownTextNodes(element) {
    return Array.prototype.filter.call(element.childNodes, function (node) {
      return node.nodeType === 3 && node.textContent.trim() !== "";
    });
  }

  /** The boxes of the element's own text, line by line. */
  function textRects(element) {
    return ownTextNodes(element).reduce(function (rects, node) {
      var range = document.createRange();

      range.selectNodeContents(node);

      return rects.concat(
        Array.prototype.filter.call(range.getClientRects(), function (rect) {
          return area(rect) > 0;
        }),
      );
    }, []);
  }

  function shown(element, rect, width, height) {
    return effectiveOpacity(element) >= SHOWN && area(rect) > 1 && isInFrame(rect, width, height) && !clippedAway(element);
  }

  function isDeliberateLayering(element) {
    return !!element.closest("[data-layout-allow-overlap]");
  }

  function iconsAndImages(all, width, height) {
    return all
      .map(function (element) {
        var kind = element.matches("svg.mb-icon") ? "icon" : element.matches(IMAGES) && !element.closest(".mb-icon") ? "image" : null;

        return { element: element, kind: kind, rect: element.getBoundingClientRect() };
      })
      .filter(function (media) {
        return media.kind && shown(media.element, media.rect, width, height) && !coversFrame(media.rect, width, height);
      });
  }

  function texts(all, width, height) {
    return all
      .map(function (element) {
        return { element: element, rects: textRects(element) };
      })
      .filter(function (text) {
        return text.rects.length > 0 && shown(text.element, text.element.getBoundingClientRect(), width, height);
      });
  }

  /** Icons and images laid over text, unless either is marked as deliberate layering. */
  function overlaps(all, width, height) {
    var found = [];
    var allTexts = texts(all, width, height);

    iconsAndImages(all, width, height).forEach(function (media) {
      allTexts.forEach(function (text) {
        var a = media.element;
        var b = text.element;

        if (a.contains(b) || b.contains(a) || compositionOf(a) !== compositionOf(b) || isDeliberateLayering(a) || isDeliberateLayering(b)) {
          return;
        }

        var shared = text.rects.reduce(function (total, rect) {
          return total + intersection(media.rect, rect);
        }, 0);
        var textArea = text.rects.reduce(function (total, rect) {
          return total + area(rect);
        }, 0);

        if (shared > OVERLAP_SHARE * Math.min(area(media.rect), textArea)) {
          found.push({
            kind: media.kind,
            selector: selectorOf(a),
            text: ownTextNodes(b)
              .map(function (node) {
                return node.textContent;
              })
              .join(" ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 60),
            textSelector: selectorOf(b),
            composition: compositionOf(a),
          });
        }
      });
    });

    return found;
  }

  /** Whether the element paints a texture: a pattern, a blend, a filter or noise rather than content. */
  function paintsTexture(element) {
    var style = getComputedStyle(element);

    return (
      element.classList.contains("mb-texture") ||
      style.backgroundImage !== "none" ||
      style.mixBlendMode !== "normal" ||
      /url\(/.test(style.filter) ||
      element.matches(IMAGES) ||
      !!element.querySelector("feTurbulence, pattern, image, img, canvas")
    );
  }

  /** What is painted at each of a grid of points, top first, pointer-events: none included. */
  function stacksAt(width, height) {
    var restores = elements()
      .filter(function (element) {
        return getComputedStyle(element).pointerEvents === "none";
      })
      .map(function (element) {
        var previous = element.style.getPropertyValue("pointer-events");
        var priority = element.style.getPropertyPriority("pointer-events");

        element.style.setProperty("pointer-events", "auto", "important");

        return function () {
          if (previous) {
            element.style.setProperty("pointer-events", previous, priority);
          } else {
            element.style.removeProperty("pointer-events");
          }
        };
      });
    var stacks = [];

    [1 / 6, 1 / 2, 5 / 6].forEach(function (y) {
      [1 / 6, 1 / 2, 5 / 6].forEach(function (x) {
        stacks.push(document.elementsFromPoint(width * x, height * y));
      });
    });
    restores.forEach(function (restore) {
      restore();
    });

    return stacks;
  }

  /** Not content: the page, a composition's mount, or the frame's background. */
  function isBackdrop(element) {
    return element === document.documentElement || element === document.body || element.hasAttribute("data-composition-id") || element.classList.contains("mb-bg");
  }

  /** Whether the element is painted over some of the frame's content, as an overlay is. */
  function isOverContent(element, stacks) {
    return stacks.some(function (stack) {
      var index = stack.indexOf(element);

      return (
        index >= 0 &&
        stack.slice(index + 1).some(function (below) {
          return !below.contains(element) && !element.contains(below) && !isBackdrop(below) && effectiveOpacity(below) > 0.05;
        })
      );
    });
  }

  /** Texture overlays: textless layers over most of the frame, painted above its content. */
  function textures(all, width, height) {
    var candidates = all.filter(function (element) {
      return (
        !isBackdrop(element) &&
        element.textContent.trim() === "" &&
        effectiveOpacity(element) > 0 &&
        coversFrame(element.getBoundingClientRect(), width, height) &&
        paintsTexture(element)
      );
    });

    if (candidates.length === 0) {
      return [];
    }

    var stacks = stacksAt(width, height);

    return candidates
      .filter(function (element) {
        return isOverContent(element, stacks);
      })
      .map(function (element) {
        return { selector: selectorOf(element), opacity: effectiveOpacity(element), composition: compositionOf(element) };
      });
  }

  /** What the Checker's own rules look for at the current time: icons or images over text, and texture overlays. */
  window.__mbRules = function (width, height) {
    var all = elements();

    return { overlaps: overlaps(all, width, height), textures: textures(all, width, height) };
  };
})();
