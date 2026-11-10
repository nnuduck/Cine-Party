import test from 'node:test';
import assert from 'node:assert/strict';

test('BackButton state transitions for poster viewer', () => {
  // Simulate Telegram BackButton mock
  const handlers = new Set();
  let isVisible = false;

  const mockTg = {
    BackButton: {
      show() { isVisible = true; },
      hide() { isVisible = false; },
      onClick(fn) { handlers.add(fn); },
      offClick(fn) { handlers.delete(fn); },
    },
  };

  let currentOverlay = { id: 'sheet-1' };
  let backButtonBound = false;
  let activePosterViewer = null;

  function closeSheet() {
    currentOverlay = null;
    mockTg.BackButton.hide();
    if (backButtonBound) {
      mockTg.BackButton.offClick(closeSheet);
      backButtonBound = false;
    }
  }

  function openSheet() {
    currentOverlay = { id: 'sheet-1' };
    mockTg.BackButton.show();
    if (!backButtonBound) {
      mockTg.BackButton.onClick(closeSheet);
      backButtonBound = true;
    }
  }

  function openPosterViewer() {
    activePosterViewer = { id: 'viewer-1' };
    if (mockTg.BackButton) {
      if (backButtonBound) {
        mockTg.BackButton.offClick(closeSheet);
        backButtonBound = false;
      }
      mockTg.BackButton.show();
      mockTg.BackButton.onClick(closePosterViewer);
    }
  }

  function closePosterViewer() {
    activePosterViewer = null;
    if (mockTg.BackButton) {
      mockTg.BackButton.offClick(closePosterViewer);
      if (currentOverlay) {
        if (!backButtonBound) {
          mockTg.BackButton.onClick(closeSheet);
          backButtonBound = true;
        }
        mockTg.BackButton.show();
      } else {
        mockTg.BackButton.hide();
      }
    }
  }

  // 1. Initial state: no sheet, no viewer
  assert.equal(isVisible, false);
  assert.equal(handlers.size, 0);

  // 2. Open Detail Sheet
  openSheet();
  assert.equal(isVisible, true);
  assert.equal(handlers.size, 1);
  assert.ok(handlers.has(closeSheet));

  // 3. Open Poster Viewer from Detail Sheet
  openPosterViewer();
  assert.equal(isVisible, true);
  assert.equal(handlers.size, 1);
  assert.ok(handlers.has(closePosterViewer));
  assert.ok(!handlers.has(closeSheet));

  // 4. Close Poster Viewer
  closePosterViewer();
  assert.equal(isVisible, true); // Still true because detail sheet is still open!
  assert.equal(handlers.size, 1);
  assert.ok(handlers.has(closeSheet));
  assert.ok(!handlers.has(closePosterViewer));

  // 5. Close Detail Sheet
  closeSheet();
  assert.equal(isVisible, false);
  assert.equal(handlers.size, 0);
});
