'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var PointerTracker = _interopDefault(require('pointer-tracker'));

function styleInject(css, ref) {
  if ( ref === void 0 ) ref = {};
  var insertAt = ref.insertAt;

  if (!css || typeof document === 'undefined') { return; }

  var head = document.head || document.getElementsByTagName('head')[0];
  var style = document.createElement('style');
  style.type = 'text/css';

  if (insertAt === 'top') {
    if (head.firstChild) {
      head.insertBefore(style, head.firstChild);
    } else {
      head.appendChild(style);
    }
  } else {
    head.appendChild(style);
  }

  if (style.styleSheet) {
    style.styleSheet.cssText = css;
  } else {
    style.appendChild(document.createTextNode(css));
  }
}

var css = "pinch-zoom {\r\n  display: block;\r\n  overflow: hidden;\r\n  touch-action: none;\r\n  --scale: 1;\r\n  --x: 0;\r\n  --y: 0;\r\n}\r\n\r\npinch-zoom > * {\r\n  transform: translate(var(--x), var(--y)) scale(var(--scale));\r\n  transform-origin: 0 0;\r\n  will-change: transform;\r\n}\r\n";
styleInject(css);

const minScaleAttr = 'min-scale';
const maxScaleAttr = 'max-scale';
function getDistance(a, b) {
    if (!b)
        return 0;
    return Math.sqrt((b.clientX - a.clientX) ** 2 + (b.clientY - a.clientY) ** 2);
}
function getMidpoint(a, b) {
    if (!b)
        return a;
    return {
        clientX: (a.clientX + b.clientX) / 2,
        clientY: (a.clientY + b.clientY) / 2,
    };
}
function getAbsoluteValue(value, max) {
    if (typeof value === 'number')
        return value;
    if (value.trim().endsWith('%')) {
        return max * parseFloat(value) / 100;
    }
    return parseFloat(value);
}
// I'd rather use DOMMatrix/DOMPoint here, but the browser support isn't good enough.
// Given that, better to use something everything supports.
let cachedSvg;
function getSVG() {
    return cachedSvg || (cachedSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
}
function createMatrix() {
    return getSVG().createSVGMatrix();
}
function createPoint() {
    return getSVG().createSVGPoint();
}
const MIN_SCALE = 0.01;
const MAX_SCALE = 999;
class PinchZoom extends HTMLElement {
    constructor() {
        super();
        // Current transform.
        this._transform = createMatrix();
        // Watch for children changes.
        // Note this won't fire for initial contents,
        // so _stageElChange is also called in connectedCallback.
        new MutationObserver(() => this._stageElChange())
            .observe(this, { childList: true });
        // Watch for pointers
        const pointerTracker = new PointerTracker(this, {
            start: (pointer, event) => {
                // We only want to track 2 pointers at most
                if (pointerTracker.currentPointers.length === 2 || !this._positioningEl)
                    return false;
                event.preventDefault();
                return true;
            },
            move: (previousPointers) => {
                this._onPointerMove(previousPointers, pointerTracker.currentPointers);
            },
        });
        this.addEventListener('wheel', event => this._onWheel(event));
    }
    static get observedAttributes() { return [minScaleAttr, maxScaleAttr]; }
    async attributeChangedCallback(name, oldValue, newValue) {
        if (name === minScaleAttr) {
            if (this.scale < this.minScale) {
                this.setTransform({ scale: this.minScale });
            }
        }
        if (name === maxScaleAttr) {
            if (this.scale > this.maxScale) {
                this.setTransform({ scale: this.maxScale });
            }
        }
    }
    get minScale() {
        const attrValue = this.getAttribute(minScaleAttr);
        if (!attrValue)
            return MIN_SCALE;
        const value = parseFloat(attrValue);
        if (Number.isFinite(value))
            return Math.max(MIN_SCALE, value);
        return MIN_SCALE;
    }
    set minScale(value) {
        this.setAttribute(minScaleAttr, String(value));
    }
    get maxScale() {
        const attrValue = this.getAttribute(maxScaleAttr);
        if (!attrValue)
            return MAX_SCALE;
        const value = parseFloat(attrValue);
        if (Number.isFinite(value))
            return Math.min(MAX_SCALE, value);
        return MAX_SCALE;
    }
    set maxScale(value) {
        this.setAttribute(maxScaleAttr, String(value));
    }
    connectedCallback() {
        this._stageElChange();
    }
    get x() {
        return this._transform.e;
    }
    get y() {
        return this._transform.f;
    }
    get scale() {
        return this._transform.a;
    }
    /**
     * Change the scale, adjusting x/y by a given transform origin.
     */
    scaleTo(scale, opts = {}) {
        let { originX = 0, originY = 0, } = opts;
        const { relativeTo = 'content', allowChangeEvent = false, } = opts;
        const relativeToEl = (relativeTo === 'content' ? this._positioningEl : this);
        // No content element? Fall back to just setting scale
        if (!relativeToEl || !this._positioningEl) {
            this.setTransform({ scale, allowChangeEvent });
            return;
        }
        const rect = relativeToEl.getBoundingClientRect();
        originX = getAbsoluteValue(originX, rect.width);
        originY = getAbsoluteValue(originY, rect.height);
        if (relativeTo === 'content') {
            originX += this.x;
            originY += this.y;
        }
        else {
            const currentRect = this._positioningEl.getBoundingClientRect();
            const containerRect = this.getBoundingClientRect();
            originX -= currentRect.left - containerRect.left;
            originY -= currentRect.top - containerRect.top;
        }
        this._applyChange({
            allowChangeEvent,
            originX,
            originY,
            scaleDiff: scale / this.scale,
        });
    }
    /**
     * Update the stage with a given scale/x/y.
     */
    setTransform(opts = {}) {
        const { scale = this.scale, allowChangeEvent = false, } = opts;
        let { x = this.x, y = this.y, } = opts;
        // If we don't have an element to position, just set the value as given.
        // We'll check bounds later.
        if (!this._positioningEl) {
            this._updateTransform(scale, x, y, allowChangeEvent);
            return;
        }
        // Get current layout
        const thisBounds = this.getBoundingClientRect();
        const positioningElBounds = this._positioningEl.getBoundingClientRect();
        // Not displayed. May be disconnected or display:none.
        // Just take the values, and we'll check bounds later.
        if (!thisBounds.width || !thisBounds.height) {
            this._updateTransform(scale, x, y, allowChangeEvent);
            return;
        }
        // Create points for _positioningEl.
        let topLeft = createPoint();
        topLeft.x = positioningElBounds.left - thisBounds.left;
        topLeft.y = positioningElBounds.top - thisBounds.top;
        let bottomRight = createPoint();
        bottomRight.x = positioningElBounds.width + topLeft.x;
        bottomRight.y = positioningElBounds.height + topLeft.y;
        // Calculate the intended position of _positioningEl.
        const matrix = createMatrix()
            .translate(x, y)
            .scale(scale)
            // Undo current transform
            .multiply(this._transform.inverse());
        topLeft = topLeft.matrixTransform(matrix);
        bottomRight = bottomRight.matrixTransform(matrix);
        // Ensure _positioningEl can't move beyond out-of-bounds.
        // Correct for x
        if (topLeft.x > thisBounds.width) {
            x += thisBounds.width - topLeft.x;
        }
        else if (bottomRight.x < 0) {
            x += -bottomRight.x;
        }
        // Correct for y
        if (topLeft.y > thisBounds.height) {
            y += thisBounds.height - topLeft.y;
        }
        else if (bottomRight.y < 0) {
            y += -bottomRight.y;
        }
        this._updateTransform(scale, x, y, allowChangeEvent);
    }
    /**
     * Update transform values without checking bounds. This is only called in setTransform.
     */
    _updateTransform(scale, x, y, allowChangeEvent) {
        let newScale = scale;
        // Avoid scaling to zero
        if (newScale < this.minScale) {
            newScale = this.minScale;
            const xyDist = Math.sqrt(Math.pow(x - this.x, 2) + Math.pow(y - this.y, 2));
            const xnDist = (xyDist / newScale) * scale;
            const factor = xnDist / xyDist;
            x = this.x + factor * (x - this.x);
            y = this.y + factor * (y - this.y);
        }
        if (newScale > this.maxScale) {
            newScale = this.maxScale;
            /*const scaleDiff = (scale / this.scale);
            const xyDist = Math.sqrt(Math.pow(x - this.x, 2) + Math.pow(y - this.y, 2));
            const k = xyDist / scaleDiff;
            const newScaleDiff = (newScale / this.scale);
            const an = newScaleDiff * k;
            const factor = an / xyDist;*/
            /*const xyDist = Math.sqrt(Math.pow(x - this.x, 2) + Math.pow(y - this.y, 2));
            const xnDist = newScale * (xyDist / scale);
            const newDistFactor = xnDist / xyDist;*/
            const xyDist = Math.sqrt(Math.pow(x - this.x, 2) + Math.pow(y - this.y, 2));
            const xnDist = (xyDist / newScale) * scale;
            const factor = xnDist / xyDist;
            x = this.x + factor * (x - this.x);
            y = this.y + factor * (y - this.y);
        }
        // Round
        newScale = Math.round((newScale + Number.EPSILON) * 100) / 100;
        // Return if there's no change
        if (newScale === this.scale &&
            x === this.x &&
            y === this.y)
            return;
        this._transform.e = x;
        this._transform.f = y;
        this._transform.d = this._transform.a = newScale;
        this.style.setProperty('--x', this.x + 'px');
        this.style.setProperty('--y', this.y + 'px');
        this.style.setProperty('--scale', this.scale + '');
        if (allowChangeEvent) {
            const event = new Event('change', { bubbles: true });
            this.dispatchEvent(event);
        }
    }
    /**
     * Called when the direct children of this element change.
     * Until we have have shadow dom support across the board, we
     * require a single element to be the child of <pinch-zoom>, and
     * that's the element we pan/scale.
     */
    _stageElChange() {
        this._positioningEl = undefined;
        if (this.children.length === 0)
            return;
        this._positioningEl = this.children[0];
        if (this.children.length > 1) {
            console.warn('<pinch-zoom> must not have more than one child.');
        }
        // Do a bounds check
        this.setTransform({ allowChangeEvent: true });
    }
    _onWheel(event) {
        if (!this._positioningEl)
            return;
        event.preventDefault();
        const currentRect = this._positioningEl.getBoundingClientRect();
        let { deltaY } = event;
        const { ctrlKey, deltaMode } = event;
        if (deltaMode === 1) { // 1 is "lines", 0 is "pixels"
            // Firefox uses "lines" for some types of mouse
            deltaY *= 15;
        }
        // ctrlKey is true when pinch-zooming on a trackpad.
        const divisor = ctrlKey ? 100 : 300;
        const scaleDiff = 1 - deltaY / divisor;
        this._applyChange({
            scaleDiff,
            originX: event.clientX - currentRect.left,
            originY: event.clientY - currentRect.top,
            allowChangeEvent: true,
        });
    }
    _onPointerMove(previousPointers, currentPointers) {
        if (!this._positioningEl)
            return;
        // Combine next points with previous points
        const currentRect = this._positioningEl.getBoundingClientRect();
        // For calculating panning movement
        const prevMidpoint = getMidpoint(previousPointers[0], previousPointers[1]);
        const newMidpoint = getMidpoint(currentPointers[0], currentPointers[1]);
        // Midpoint within the element
        const originX = prevMidpoint.clientX - currentRect.left;
        const originY = prevMidpoint.clientY - currentRect.top;
        // Calculate the desired change in scale
        const prevDistance = getDistance(previousPointers[0], previousPointers[1]);
        const newDistance = getDistance(currentPointers[0], currentPointers[1]);
        const scaleDiff = prevDistance ? newDistance / prevDistance : 1;
        this._applyChange({
            originX, originY, scaleDiff,
            panX: newMidpoint.clientX - prevMidpoint.clientX,
            panY: newMidpoint.clientY - prevMidpoint.clientY,
            allowChangeEvent: true,
        });
    }
    /** Transform the view & fire a change event */
    _applyChange(opts = {}) {
        const { panX = 0, panY = 0, originX = 0, originY = 0, scaleDiff = 1, allowChangeEvent = false, } = opts;
        const matrix = createMatrix()
            // Translate according to panning.
            .translate(panX, panY)
            // Scale about the origin.
            .translate(originX, originY)
            // Apply current translate
            .translate(this.x, this.y)
            .scale(scaleDiff)
            .translate(-originX, -originY)
            // Apply current scale.
            .scale(this.scale);
        // Convert the transform into basic translate & scale.
        this.setTransform({
            allowChangeEvent,
            scale: matrix.a,
            x: matrix.e,
            y: matrix.f,
        });
    }
}

customElements.define('pinch-zoom', PinchZoom);

module.exports = PinchZoom;
