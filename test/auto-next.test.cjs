const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadApi() {
  const scriptPath = path.join(__dirname, '..', 'lngbzx-auto-next.user.js');
  try {
    return require(scriptPath);
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && error.message.includes(scriptPath)) {
      return {};
    }
    throw error;
  }
}

test('a verified natural media end clicks one explicit next target', () => {
  const { createAdvanceController } = loadApi();
  assert.equal(
    typeof createAdvanceController,
    'function',
    'the standalone userscript must expose its real controller to the test runner',
  );

  const target = { id: 'next-lesson' };
  const clicks = [];
  const scheduled = [];
  const controller = createAdvanceController({
    locateNext: () => target,
    clickNext: (value) => clicks.push(value),
    hasAdvanced: () => false,
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
  });

  controller.handleMediaEnded({ ended: true, currentTime: 120, duration: 120 });

  assert.deepEqual(clicks, [target]);
  assert.equal(scheduled.length, 1, 'the controller must verify navigation later');
  assert.equal(controller.getState().phase, 'verifying');
});

test('an unverified or premature ended signal never clicks next', () => {
  const { createAdvanceController } = loadApi();
  const clicks = [];
  const controller = createAdvanceController({
    locateNext: () => ({ id: 'next-lesson' }),
    clickNext: (value) => clicks.push(value),
    hasAdvanced: () => false,
    schedule: () => {},
  });

  controller.handleMediaEnded({ ended: false, currentTime: 120, duration: 120 });
  controller.handleMediaEnded({ ended: true, currentTime: 15, duration: 120 });
  controller.handleMediaEnded({ ended: true, currentTime: 0, duration: Number.NaN });

  assert.deepEqual(clicks, []);
  assert.equal(controller.getState().phase, 'idle');
});

test('a natural end waits for the next control to become available', () => {
  const { createAdvanceController } = loadApi();
  let target = null;
  const clicks = [];
  const scheduled = [];
  const controller = createAdvanceController({
    locateNext: () => target,
    clickNext: (value) => clicks.push(value),
    hasAdvanced: () => false,
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
  });

  controller.handleMediaEnded({ ended: true, currentTime: 90, duration: 90 });

  assert.deepEqual(clicks, []);
  assert.equal(controller.getState().phase, 'waiting');
  assert.equal(scheduled.length, 1);

  target = { id: 'next-lesson' };
  scheduled.shift().callback();

  assert.deepEqual(clicks, [target]);
  assert.equal(controller.getState().phase, 'verifying');
});

test('missing next controls stop after the configured retry limit', () => {
  const { createAdvanceController } = loadApi();
  const scheduled = [];
  const controller = createAdvanceController({
    locateNext: () => null,
    clickNext: () => assert.fail('nothing may be clicked without a target'),
    hasAdvanced: () => false,
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
    maxAttempts: 3,
  });

  controller.handleMediaEnded({ ended: true, currentTime: 45, duration: 45 });

  for (let guard = 0; guard < 10 && scheduled.length > 0; guard += 1) {
    scheduled.shift().callback();
  }

  assert.equal(scheduled.length, 0, 'no unbounded retry may remain queued');
  assert.deepEqual(controller.getState(), { phase: 'stopped', attempts: 3 });
});

test('disabling the controller cancels a pending retry cycle', () => {
  const { createAdvanceController } = loadApi();
  const clicks = [];
  const scheduled = [];
  const target = { id: 'next-lesson' };
  const controller = createAdvanceController({
    locateNext: () => target,
    clickNext: (value) => clicks.push(value),
    hasAdvanced: () => false,
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
  });

  controller.handleMediaEnded({ ended: true, currentTime: 30, duration: 30 });
  assert.equal(typeof controller.setEnabled, 'function');
  controller.setEnabled(false);
  scheduled.shift().callback();

  assert.deepEqual(clicks, [target]);
  assert.equal(controller.getState().phase, 'paused');
});

test('a confirmed route change finishes the cycle without another click', () => {
  const { createAdvanceController } = loadApi();
  let advanced = false;
  let advancedNotifications = 0;
  const clicks = [];
  const scheduled = [];
  const controller = createAdvanceController({
    locateNext: () => ({ id: 'next-lesson' }),
    clickNext: (value) => clicks.push(value),
    hasAdvanced: () => advanced,
    onAdvanced: () => {
      advancedNotifications += 1;
    },
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
  });

  controller.handleMediaEnded({ ended: true, currentTime: 75, duration: 75 });
  advanced = true;
  const verify = scheduled.shift().callback;
  verify();
  verify();

  assert.equal(clicks.length, 1);
  assert.equal(advancedNotifications, 1);
  assert.equal(controller.getState().phase, 'advanced');
});

test('each media element advances at most once while a new media element starts a fresh cycle', () => {
  const { createAdvanceController } = loadApi();
  let advanced = false;
  const clicks = [];
  const scheduled = [];
  const controller = createAdvanceController({
    locateNext: () => ({ id: 'next-lesson' }),
    clickNext: (value) => clicks.push(value),
    hasAdvanced: () => advanced,
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
  });
  const firstMedia = { ended: true, currentTime: 60, duration: 60 };
  const secondMedia = { ended: true, currentTime: 50, duration: 50 };

  controller.handleMediaEnded(firstMedia);
  advanced = true;
  scheduled.shift().callback();
  advanced = false;

  controller.handleMediaEnded(firstMedia);
  controller.handleMediaEnded(secondMedia);

  assert.equal(clicks.length, 2);
  assert.equal(controller.getState().phase, 'verifying');
  assert.equal(controller.getState().attempts, 1);
});

test('next-target selection accepts an explicit lesson control and rejects unsafe lookalikes', () => {
  const { chooseNextCandidate } = loadApi();
  assert.equal(typeof chooseNextCandidate, 'function');

  const expected = { id: 'lesson-next' };
  const result = chooseNextCandidate([
    { element: { id: 'pager-next' }, text: '下一页', tagName: 'BUTTON', visible: true },
    { element: { id: 'quiz-next' }, text: '下一题', tagName: 'BUTTON', visible: true },
    {
      element: { id: 'disabled-next' },
      text: '下一节',
      tagName: 'BUTTON',
      visible: true,
      disabled: true,
    },
    {
      element: { id: 'hidden-next' },
      text: '下一节',
      tagName: 'BUTTON',
      visible: false,
    },
    { element: expected, text: ' 下一节 ', tagName: 'BUTTON', visible: true },
  ]);

  assert.equal(result, expected);
});

test('binding the same media element twice installs only one ended listener', () => {
  const { bindMediaElement } = loadApi();
  assert.equal(typeof bindMediaElement, 'function');

  const media = new EventTarget();
  media.ended = true;
  media.currentTime = 20;
  media.duration = 20;
  let handled = 0;
  const controller = {
    handleMediaEnded(value) {
      assert.equal(value, media);
      handled += 1;
    },
  };

  assert.equal(bindMediaElement(media, controller), true);
  assert.equal(bindMediaElement(media, controller), false);
  media.dispatchEvent(new Event('ended'));

  assert.equal(handled, 1);
});

test('media ended listener uses capture phase so platform switching runs afterward', () => {
  const { bindMediaElement } = loadApi();
  const registrations = [];
  const media = {
    addEventListener(type, _listener, options) {
      registrations.push({ options, type });
    },
  };

  assert.equal(bindMediaElement(media, { handleMediaEnded: () => {} }), true);
  assert.equal(
    registrations.find((registration) => registration.type === 'ended')?.options,
    true,
  );
});

test('platform bubble-phase auto switching prevents the script from clicking next again', () => {
  const { createPageRuntime } = loadApi();
  const scheduled = [];
  const captureListeners = [];
  const bubbleListeners = [];
  const video = {
    ended: false,
    currentTime: 0,
    duration: 10,
    currentSrc: 'lesson-1.mp4',
    isConnected: true,
    getBoundingClientRect: () => ({ width: 640, height: 360 }),
    addEventListener(type, listener, capture) {
      if (type !== 'ended') return;
      (capture === true ? captureListeners : bubbleListeners).push(listener);
    },
    play: () => Promise.resolve(),
    dispatchEnded() {
      for (const listener of captureListeners) listener();
      for (const listener of bubbleListeners) listener();
    },
  };
  let platformSwitches = 0;
  video.addEventListener('ended', () => {
    platformSwitches += 1;
    video.currentSrc = 'lesson-2.mp4';
    video.ended = false;
    video.currentTime = 0;
  });
  let scriptNextClicks = 0;
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 24 }),
    click: () => {
      scriptNextClicks += 1;
    },
  };
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101' },
    setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return [video];
      return [next];
    },
  };
  const runtime = createPageRuntime({
    window: fakeWindow,
    document: fakeDocument,
    enabled: true,
    isAutomationAuthorized: () => true,
    requireUniqueMedia: true,
  });

  runtime.scan();
  video.ended = true;
  video.currentTime = 10;
  video.dispatchEnded();
  assert.equal(scriptNextClicks, 0, 'capture listener must not click during ended dispatch');
  assert.equal(scheduled.length, 1, 'ended processing should be deferred for platform switching');
  scheduled.shift().callback();

  assert.equal(platformSwitches, 1);
  assert.equal(scriptNextClicks, 0);
  assert.equal(runtime.controller.getState().phase, 'advanced');
});

function createResetEndedHarness(source = 'lesson-1.mp4') {
  const { createPageRuntime } = loadApi();
  const scheduled = [];
  const video = new EventTarget();
  video.ended = false;
  video.currentTime = 0;
  video.duration = 10;
  video.currentSrc = source;
  video.isConnected = true;
  video.getBoundingClientRect = () => ({ width: 640, height: 360 });
  video.play = () => Promise.resolve();

  let nextClicks = 0;
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 24 }),
    click: () => {
      nextClicks += 1;
    },
  };
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101' },
    setTimeout: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return [video];
      return [next];
    },
  };
  video.ownerDocument = fakeDocument;

  const runtime = createPageRuntime({
    window: fakeWindow,
    document: fakeDocument,
    allowNextClick: true,
    enabled: true,
    isAutomationAuthorized: () => true,
    requireUniqueMedia: true,
  });

  return {
    getNextClicks: () => nextClicks,
    runtime,
    scheduled,
    video,
  };
}

test('a genuine ended event advances after the platform resets the media state to zero', () => {
  const { getNextClicks, runtime, scheduled, video } = createResetEndedHarness();

  runtime.scan();
  video.currentTime = 9.5;
  video.dispatchEvent(new Event('timeupdate'));
  video.currentTime = 0;
  video.ended = false;
  video.dispatchEvent(new Event('ended'));

  assert.equal(
    scheduled.length,
    1,
    'a real end reached through natural playback must survive the platform reset',
  );
  scheduled.shift().callback();
  assert.equal(getNextClicks(), 1);
});

test('near-end evidence is discarded when the same source starts a new playback session', () => {
  const { getNextClicks, runtime, scheduled, video } = createResetEndedHarness();

  runtime.scan();
  video.currentTime = 9.5;
  video.dispatchEvent(new Event('timeupdate'));
  video.currentTime = 0;
  video.dispatchEvent(new Event('play'));
  video.ended = false;
  video.dispatchEvent(new Event('ended'));

  assert.equal(scheduled.length, 0);
  assert.equal(getNextClicks(), 0);
});

test('reset-style ended events without a stable media source never reuse progress evidence', () => {
  const { getNextClicks, runtime, scheduled, video } = createResetEndedHarness('');

  runtime.scan();
  video.currentTime = 9.5;
  video.dispatchEvent(new Event('timeupdate'));
  video.currentTime = 0;
  video.ended = false;
  video.dispatchEvent(new Event('ended'));

  assert.equal(scheduled.length, 0);
  assert.equal(getNextClicks(), 0);
});

test('near-end evidence expires instead of being reused by a much later ended event', () => {
  const originalNow = Date.now;
  let now = 100_000;
  Date.now = () => now;
  try {
    const { getNextClicks, runtime, scheduled, video } = createResetEndedHarness();

    runtime.scan();
    video.currentTime = 9.5;
    video.dispatchEvent(new Event('timeupdate'));
    now += 60_000;
    video.currentTime = 0;
    video.ended = false;
    video.dispatchEvent(new Event('ended'));

    assert.equal(scheduled.length, 0);
    assert.equal(getNextClicks(), 0);
  } finally {
    Date.now = originalNow;
  }
});

test('a stopped run cannot revive its deferred ended callback after a new run is authorized', () => {
  const { createPageRuntime } = loadApi();
  const scheduled = [];
  let authorized = true;
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101' },
    setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
  };
  const video = new EventTarget();
  video.ended = false;
  video.currentTime = 0;
  video.duration = 10;
  video.currentSrc = 'old-run.mp4';
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return [video];
      return [];
    },
  };
  const runtime = createPageRuntime({
    window: fakeWindow,
    document: fakeDocument,
    enabled: true,
    isAutomationAuthorized: () => authorized,
  });

  runtime.scan();
  video.ended = true;
  video.currentTime = 10;
  video.dispatchEvent(new Event('ended'));
  assert.equal(scheduled.length, 1);

  authorized = false;
  runtime.cancelAutomation();
  authorized = true;
  scheduled.shift().callback();

  assert.deepEqual(runtime.controller.getState(), { phase: 'idle', attempts: 0 });
  assert.equal(scheduled.length, 0);
});

test('DOM scanning returns only a visible explicit next-lesson control', () => {
  const { findNextElementInDocuments } = loadApi();
  assert.equal(typeof findNextElementInDocuments, 'function');

  function element(text, overrides = {}) {
    return {
      tagName: 'BUTTON',
      innerText: text,
      textContent: text,
      disabled: false,
      isConnected: true,
      getAttribute: () => null,
      getBoundingClientRect: () => ({ width: 100, height: 32 }),
      ...overrides,
    };
  }

  const pager = element('下一页');
  const expected = element('下一节');
  const hidden = element('下一课', {
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
  });
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll: () => [pager, expected, hidden],
  };

  assert.equal(findNextElementInDocuments([fakeDocument]), expected);
});

test('a next control hidden by an ancestor is never considered visible', () => {
  const { findNextElementInDocuments } = loadApi();
  const hiddenParent = {
    parentElement: null,
    getBoundingClientRect: () => ({ width: 100, height: 40 }),
  };
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    parentElement: hiddenParent,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 24 }),
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle(element) {
        return element === hiddenParent
          ? { display: 'none', visibility: 'visible', opacity: '1' }
          : { display: 'block', visibility: 'visible', opacity: '1' };
      },
    },
    querySelectorAll: () => [next],
  };

  assert.equal(findNextElementInDocuments([fakeDocument]), null);
});

test('accessible same-origin frame documents are included in media scans', () => {
  const { collectAccessibleDocuments } = loadApi();
  assert.equal(typeof collectAccessibleDocuments, 'function');

  const childDocument = { querySelectorAll: () => [] };
  const rootDocument = {
    querySelectorAll(selector) {
      return selector === 'iframe' ? [{ contentDocument: childDocument }] : [];
    },
  };

  assert.deepEqual(collectAccessibleDocuments(rootDocument), [rootDocument, childDocument]);
});

test('media scanning binds every newly discovered video exactly once', () => {
  const { scanAndBindMedia } = loadApi();
  assert.equal(typeof scanAndBindMedia, 'function');

  const first = new EventTarget();
  const second = new EventTarget();
  const fakeDocument = {
    querySelectorAll: () => [first, second],
  };
  const controller = { handleMediaEnded: () => {} };

  assert.equal(scanAndBindMedia([fakeDocument], controller), 2);
  assert.equal(scanAndBindMedia([fakeDocument], controller), 0);
});

test('controller state transitions are reported for the status panel', () => {
  const { createAdvanceController } = loadApi();
  const updates = [];
  const controller = createAdvanceController({
    locateNext: () => null,
    clickNext: () => {},
    hasAdvanced: () => false,
    onState: (state) => updates.push(state),
    schedule: () => {},
  });

  controller.handleMediaEnded({ ended: true, currentTime: 40, duration: 40 });

  assert.deepEqual(updates, [{ phase: 'waiting', attempts: 1 }]);
});

test('re-enabling does not revive a stale retry from an earlier cycle', () => {
  const { createAdvanceController } = loadApi();
  const clicks = [];
  const scheduled = [];
  const controller = createAdvanceController({
    locateNext: () => ({ id: 'next-lesson' }),
    clickNext: (value) => clicks.push(value),
    hasAdvanced: () => false,
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
  });

  controller.handleMediaEnded({ ended: true, currentTime: 25, duration: 25 });
  const staleRetry = scheduled.shift().callback;
  controller.setEnabled(false);
  controller.setEnabled(true);
  staleRetry();

  assert.equal(clicks.length, 1);
  assert.equal(controller.getState().phase, 'idle');
});

test('page runtime wires a real video end to one DOM click and verifies route change', () => {
  const { createPageRuntime } = loadApi();
  assert.equal(typeof createPageRuntime, 'function');

  const scheduled = [];
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=1' },
    setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
  };
  const video = new EventTarget();
  video.ended = false;
  video.currentTime = 0;
  video.duration = 10;
  let clicks = 0;
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 32 }),
    click() {
      clicks += 1;
      fakeWindow.location.href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=2';
    },
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return [video];
      return [next];
    },
  };

  const runtime = createPageRuntime({
    window: fakeWindow,
    document: fakeDocument,
    allowNextClick: true,
    enabled: true,
  });
  runtime.scan();
  video.ended = true;
  video.currentTime = 10;
  video.dispatchEvent(new Event('ended'));
  scheduled.shift().callback();

  assert.equal(clicks, 1);
  assert.equal(runtime.controller.getState().phase, 'advanced');
});

test('page runtime cannot advance or report an end without a manually active course queue', () => {
  const { createPageRuntime } = loadApi();
  const scheduled = [];
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=1' },
    setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
  };
  const video = new EventTarget();
  video.ended = false;
  video.currentTime = 0;
  video.duration = 10;
  let clicks = 0;
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 32 }),
    click: () => {
      clicks += 1;
    },
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return [video];
      return [next];
    },
  };
  let verifiedEnds = 0;
  const runtime = createPageRuntime({
    window: fakeWindow,
    document: fakeDocument,
    enabled: true,
    isAutomationAuthorized: () => false,
    onVerifiedMediaEnd: () => {
      verifiedEnds += 1;
    },
  });

  runtime.scan();
  video.ended = true;
  video.currentTime = 10;
  video.dispatchEvent(new Event('ended'));
  for (const entry of scheduled.splice(0)) entry.callback();

  assert.equal(clicks, 0);
  assert.equal(verifiedEnds, 0);
  assert.equal(runtime.controller.getState().phase, 'idle');
});

test('cancelling page automation invalidates a queued next retry and pending autoplay', () => {
  const { createPageRuntime } = loadApi();
  const scheduled = [];
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=1' },
    setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
  };
  const video = new EventTarget();
  video.ended = false;
  video.currentTime = 0;
  video.duration = 10;
  video.currentSrc = 'lesson-1.mp4';
  let clicks = 0;
  let playCalls = 0;
  video.play = () => {
    playCalls += 1;
    return Promise.resolve();
  };
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 32 }),
    click: () => {
      clicks += 1;
    },
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return [video];
      return [next];
    },
  };
  const runtime = createPageRuntime({
    window: fakeWindow,
    document: fakeDocument,
    allowNextClick: true,
    enabled: true,
    isAutomationAuthorized: () => true,
  });

  runtime.scan();
  runtime.requestPlayback();
  video.ended = true;
  video.currentTime = 10;
  video.dispatchEvent(new Event('ended'));
  scheduled.shift().callback();
  assert.equal(clicks, 1);
  assert.equal(typeof runtime.cancelAutomation, 'function');
  runtime.cancelAutomation();
  for (const entry of scheduled.splice(0)) entry.callback();
  runtime.scan();

  assert.equal(clicks, 1);
  assert.equal(playCalls, 0);
  assert.equal(runtime.controller.getState().phase, 'idle');
});

test('after a confirmed automatic advance the newly loaded video is started once', () => {
  const { createPageRuntime } = loadApi();
  const scheduled = [];
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=1' },
    setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
  };
  const firstVideo = new EventTarget();
  firstVideo.ended = false;
  firstVideo.currentTime = 0;
  firstVideo.duration = 10;
  firstVideo.currentSrc = 'lesson-1.mp4';
  let playCalls = 0;
  const secondVideo = new EventTarget();
  secondVideo.ended = false;
  secondVideo.currentTime = 0;
  secondVideo.duration = 12;
  secondVideo.currentSrc = 'lesson-2.mp4';
  secondVideo.isConnected = true;
  secondVideo.getBoundingClientRect = () => ({ width: 640, height: 360 });
  secondVideo.play = () => {
    playCalls += 1;
    return Promise.resolve();
  };
  let videos = [firstVideo];
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 32 }),
    click() {
      fakeWindow.location.href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=2';
      videos = [secondVideo];
    },
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return videos;
      return [next];
    },
  };
  const runtime = createPageRuntime({
    window: fakeWindow,
    document: fakeDocument,
    allowNextClick: true,
    enabled: true,
    autoPlay: true,
  });

  runtime.scan();
  firstVideo.ended = true;
  firstVideo.currentTime = 10;
  firstVideo.dispatchEvent(new Event('ended'));
  scheduled.shift().callback();
  runtime.scan();
  runtime.scan();

  assert.equal(playCalls, 1);
});

test('automatic playback after navigation refuses two visible candidate videos', () => {
  const { createPageRuntime } = loadApi();
  const scheduled = [];
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=1' },
    setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
  };
  const firstVideo = new EventTarget();
  firstVideo.ended = false;
  firstVideo.currentTime = 0;
  firstVideo.duration = 10;
  firstVideo.currentSrc = 'lesson-1.mp4';
  firstVideo.isConnected = true;
  firstVideo.getBoundingClientRect = () => ({ width: 640, height: 360 });
  let playCalls = 0;
  const makeNextVideo = (source) => {
    const media = new EventTarget();
    media.ended = false;
    media.currentSrc = source;
    media.isConnected = true;
    media.getBoundingClientRect = () => ({ width: 640, height: 360 });
    media.play = () => {
      playCalls += 1;
      return Promise.resolve();
    };
    return media;
  };
  const secondVideoA = makeNextVideo('lesson-2-a.mp4');
  const secondVideoB = makeNextVideo('lesson-2-b.mp4');
  let videos = [firstVideo];
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 32 }),
    click() {
      fakeWindow.location.href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=2';
      videos = [secondVideoA, secondVideoB];
    },
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return videos;
      return [next];
    },
  };
  let ambiguousSignals = 0;
  const runtime = createPageRuntime({
    window: fakeWindow,
    document: fakeDocument,
    allowNextClick: true,
    enabled: true,
    autoPlay: true,
    onPlaybackAmbiguous: () => {
      ambiguousSignals += 1;
    },
  });

  runtime.scan();
  firstVideo.ended = true;
  firstVideo.currentTime = 10;
  firstVideo.dispatchEvent(new Event('ended'));
  scheduled.shift().callback();
  runtime.scan();

  assert.equal(playCalls, 0);
  assert.equal(ambiguousSignals, 1);
});

test('control panel exposes an on-page toggle and readable retry status', () => {
  const { createControlPanel } = loadApi();
  assert.equal(typeof createControlPanel, 'function');

  function createNode(tagName) {
    const listeners = new Map();
    return {
      tagName: tagName.toUpperCase(),
      children: [],
      style: {},
      textContent: '',
      append(...nodes) {
        this.children.push(...nodes);
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      click() {
        listeners.get('click')?.();
      },
    };
  }

  const body = createNode('body');
  const fakeDocument = {
    body,
    createElement: createNode,
    getElementById: () => null,
  };
  const toggles = [];
  const panel = createControlPanel({
    document: fakeDocument,
    enabled: true,
    onToggle: (enabled) => toggles.push(enabled),
    onRescan: () => {},
  });

  assert.equal(body.children.includes(panel.root), true);
  assert.equal(panel.toggleButton.textContent, '课程内推进：开启');
  panel.toggleButton.click();
  assert.deepEqual(toggles, [false]);
  assert.equal(panel.toggleButton.textContent, '课程内推进：暂停');

  panel.updateStatus({ phase: 'waiting', attempts: 2 });
  assert.match(panel.statusElement.textContent, /等待.*2/);
});

test('browser bootstrap restores the saved toggle and persists later changes', () => {
  const { bootstrapBrowserPage } = loadApi();
  assert.equal(typeof bootstrapBrowserPage, 'function');

  function createNode(tagName) {
    const listeners = new Map();
    return {
      tagName: tagName.toUpperCase(),
      children: [],
      style: {},
      textContent: '',
      append(...nodes) {
        this.children.push(...nodes);
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      click() {
        listeners.get('click')?.();
      },
    };
  }

  const body = createNode('body');
  const stored = [];
  const intervals = [];
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    disconnect() {}
  }
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video/1' },
    MutationObserver: FakeMutationObserver,
    setTimeout: () => 1,
    setInterval: (callback, delay) => {
      intervals.push({ callback, delay });
      return 1;
    },
    clearInterval: () => {},
  };
  const fakeDocument = {
    body,
    documentElement: createNode('html'),
    defaultView: fakeWindow,
    createElement: createNode,
    getElementById: () => null,
    querySelectorAll: () => [],
  };

  const app = bootstrapBrowserPage({
    window: fakeWindow,
    document: fakeDocument,
    getValue: (_key, fallback) => false ?? fallback,
    setValue: (key, value) => stored.push({ key, value }),
  });

  assert.equal(app.panel.toggleButton.textContent, '课程内推进：暂停');
  assert.equal(intervals.length, 1);
  app.panel.toggleButton.click();
  assert.deepEqual(stored, [{ key: 'lngbzx-auto-next-enabled', value: true }]);

  const replacementBody = createNode('body');
  fakeDocument.body = replacementBody;
  app.panel.root.isConnected = false;
  intervals[0].callback();

  assert.equal(replacementBody.children.includes(app.panel.root), true);

  const nextBody = createNode('body');
  fakeDocument.body = nextBody;
  app.panel.root.isConnected = false;
  const reusedApp = bootstrapBrowserPage({ window: fakeWindow, document: fakeDocument });

  assert.equal(reusedApp, app);
  assert.equal(nextBody.children.includes(app.panel.root), true);
});

test('browser bootstrap never advances a course video before the queue button is started', () => {
  const { bootstrapBrowserPage } = loadApi();
  function createNode(tagName) {
    const listeners = new Map();
    return {
      id: '',
      tagName: tagName.toUpperCase(),
      children: [],
      style: {},
      textContent: '',
      append(...nodes) {
        this.children.push(...nodes);
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      click() {
        listeners.get('click')?.();
      },
    };
  }
  const video = new EventTarget();
  video.ended = false;
  video.currentTime = 0;
  video.duration = 10;
  video.currentSrc = 'lesson.mp4';
  video.isConnected = true;
  video.getBoundingClientRect = () => ({ width: 640, height: 360 });
  let nextClicks = 0;
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 24 }),
    click: () => {
      nextClicks += 1;
    },
  };
  const body = createNode('body');
  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }
  const fakeWindow = {
    location: {
      href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101',
    },
    MutationObserver: FakeMutationObserver,
    setTimeout: () => 1,
    setInterval: () => 1,
    clearInterval: () => {},
  };
  const fakeDocument = {
    body,
    documentElement: createNode('html'),
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    createElement: createNode,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === 'iframe' || selector === '.el-dialog' || selector === 'li.course_list') {
        return [];
      }
      if (selector === 'video') return [video];
      return [next];
    },
  };
  const app = bootstrapBrowserPage({
    window: fakeWindow,
    document: fakeDocument,
    ownerId: 'tab-a',
    getValue: (_key, fallback) => fallback,
    setValue: () => {},
  });

  video.ended = true;
  video.currentTime = 10;
  video.dispatchEvent(new Event('ended'));

  assert.equal(nextClicks, 0);
  assert.equal(app.runtime.controller.getState().phase, 'idle');
});

test('browser bootstrap clicks one exact next lesson within 400ms after a verified natural end', () => {
  const { bootstrapBrowserPage } = loadApi();
  function createNode(tagName) {
    const listeners = new Map();
    return {
      id: '',
      tagName: tagName.toUpperCase(),
      children: [],
      style: {},
      textContent: '',
      append(...nodes) {
        this.children.push(...nodes);
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      click() {
        listeners.get('click')?.();
      },
    };
  }

  const href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=5273';
  const scheduled = [];
  let now = 0;
  const body = createNode('body');
  const video = new EventTarget();
  video.ended = false;
  video.currentTime = 0;
  video.duration = 10;
  video.currentSrc = 'lesson.mp4';
  video.isConnected = true;
  video.getBoundingClientRect = () => ({ width: 640, height: 360 });
  video.play = () => Promise.resolve();
  let secondPlayCalls = 0;
  const secondVideo = new EventTarget();
  secondVideo.ended = false;
  secondVideo.currentTime = 0;
  secondVideo.duration = 10;
  secondVideo.currentSrc = 'lesson-2.mp4';
  secondVideo.isConnected = true;
  secondVideo.getBoundingClientRect = () => ({ width: 640, height: 360 });
  secondVideo.play = () => {
    secondPlayCalls += 1;
    return Promise.resolve();
  };
  let videos = [video];

  let nextClicks = 0;
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 24 }),
    click: () => {
      nextClicks += 1;
      fakeWindow.location.href = `${href}&lesson=2`;
      videos = [secondVideo];
    },
  };
  const title = {
    textContent: '课程 A',
    isConnected: true,
    getBoundingClientRect: () => ({ width: 160, height: 24 }),
  };
  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }
  const fakeWindow = {
    location: { href },
    MutationObserver: FakeMutationObserver,
    setTimeout: (callback, delay) => {
      scheduled.push({ callback, runAt: now + delay });
      scheduled.sort((left, right) => left.runAt - right.runAt);
      return scheduled.length;
    },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  const fakeDocument = {
    body,
    documentElement: createNode('html'),
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    createElement: createNode,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === 'iframe' || selector === '.el-dialog') return [];
      if (selector === 'video') return videos;
      if (selector === '.video_center > .wrapper > p.title') return [title];
      if (selector === 'button, a[href], [role="button"]') return [next];
      return [];
    },
  };
  video.ownerDocument = fakeDocument;
  secondVideo.ownerDocument = fakeDocument;

  let queueSession = {
    version: 1,
    active: true,
    ownerId: 'tab-a',
    runId: 'run-1',
    phase: 'in-course',
    activeCourseId: '5273',
    expectedCourseId: '5273',
    activeCourseKey: 'course-a',
    activeCourseTitle: '课程 A',
    launchedCourseKeys: ['course-a'],
    identityVerifiedFor: href,
    videoEnteredFor: href,
    videoEnteredAt: 1,
    playbackRequestedFor: href,
  };

  bootstrapBrowserPage({
    window: fakeWindow,
    document: fakeDocument,
    ownerId: 'tab-a',
    getValue: (key, fallback) =>
      key === 'lngbzx-course-queue-v2' ? structuredClone(queueSession) : fallback,
    setValue: (key, value) => {
      if (key === 'lngbzx-course-queue-v2') queueSession = structuredClone(value);
    },
  });

  video.ended = true;
  video.currentTime = 10;
  video.dispatchEvent(new Event('ended'));

  while (scheduled.length > 0 && scheduled[0].runAt <= 400) {
    const task = scheduled.shift();
    now = task.runAt;
    task.callback();
  }

  assert.equal(nextClicks, 1);

  while (scheduled.length > 0 && scheduled[0].runAt <= 500) {
    const task = scheduled.shift();
    now = task.runAt;
    task.callback();
  }

  assert.ok(secondPlayCalls > 0, 'the next lesson should begin playback within 500ms');
});

test('executing the userscript on the target host boots the on-page controller', () => {
  function createNode(tagName) {
    const listeners = new Map();
    return {
      id: '',
      tagName: tagName.toUpperCase(),
      children: [],
      style: {},
      textContent: '',
      append(...nodes) {
        this.children.push(...nodes);
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
    };
  }

  const body = createNode('body');
  const document = {
    body,
    documentElement: createNode('html'),
    createElement: createNode,
    getElementById: () => null,
    querySelectorAll: () => [],
  };
  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }
  const window = {
    location: {
      hostname: 'zyjs.lngbzx.gov.cn',
      href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video/1',
    },
    MutationObserver: FakeMutationObserver,
    setTimeout: () => 1,
    setInterval: () => 1,
    clearInterval: () => {},
  };
  document.defaultView = window;
  const scriptPath = path.join(__dirname, '..', 'lngbzx-auto-next.user.js');
  const source = fs.readFileSync(scriptPath, 'utf8');

  vm.runInNewContext(source, {
    console,
    document,
    GM_getValue: (_key, fallback) => fallback,
    GM_setValue: () => {},
    window,
  });

  assert.equal(body.children.some((node) => node.id === 'lngbzx-auto-next-panel'), true);
});

test('videos outside the course-detail route can never trigger automatic navigation', () => {
  const { createPageRuntime } = loadApi();
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/home' },
    setTimeout: () => 1,
  };
  const video = new EventTarget();
  video.ended = true;
  video.currentTime = 10;
  video.duration = 10;
  let clicks = 0;
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 32 }),
    click: () => {
      clicks += 1;
    },
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return [video];
      return [next];
    },
  };

  const runtime = createPageRuntime({ window: fakeWindow, document: fakeDocument, enabled: true });
  runtime.scan();
  video.dispatchEvent(new Event('ended'));

  assert.equal(clicks, 0);
});

test('a transient click failure is retried without escaping the ended handler', () => {
  const { createAdvanceController } = loadApi();
  const scheduled = [];
  const controller = createAdvanceController({
    locateNext: () => ({ id: 'next-lesson' }),
    clickNext: () => {
      throw new Error('target was replaced during the click');
    },
    hasAdvanced: () => false,
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
  });

  assert.doesNotThrow(() =>
    controller.handleMediaEnded({ ended: true, currentTime: 35, duration: 35 }),
  );
  assert.equal(controller.getState().phase, 'waiting');
  assert.equal(scheduled.length, 1);
});

test('a reused video element can start a new cycle when its lesson identity changes', () => {
  const { createAdvanceController } = loadApi();
  let advanced = false;
  const clicks = [];
  const scheduled = [];
  const media = { ended: true, currentTime: 30, duration: 30 };
  const controller = createAdvanceController({
    locateNext: () => ({ id: 'next-lesson' }),
    clickNext: (value) => clicks.push(value),
    hasAdvanced: () => advanced,
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
  });

  controller.handleMediaEnded(media, 'lesson-1');
  advanced = true;
  scheduled.shift().callback();
  advanced = false;
  controller.handleMediaEnded(media, 'lesson-2');

  assert.equal(clicks.length, 2);
  assert.equal(controller.getState().attempts, 1);
});

test('pausing after navigation confirmation cancels pending automatic playback', () => {
  const { createPageRuntime } = loadApi();
  const scheduled = [];
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=1' },
    setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
  };
  const firstVideo = new EventTarget();
  firstVideo.ended = false;
  firstVideo.currentTime = 0;
  firstVideo.duration = 10;
  firstVideo.currentSrc = 'lesson-1.mp4';
  let playCalls = 0;
  const secondVideo = new EventTarget();
  secondVideo.ended = false;
  secondVideo.currentSrc = 'lesson-2.mp4';
  secondVideo.play = () => {
    playCalls += 1;
    return Promise.resolve();
  };
  let videos = [firstVideo];
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 32 }),
    click() {
      fakeWindow.location.href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=2';
      videos = [secondVideo];
    },
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return videos;
      return [next];
    },
  };
  const runtime = createPageRuntime({
    window: fakeWindow,
    document: fakeDocument,
    enabled: true,
    autoPlay: true,
  });

  runtime.scan();
  firstVideo.ended = true;
  firstVideo.currentTime = 10;
  firstVideo.dispatchEvent(new Event('ended'));
  scheduled.shift().callback();
  runtime.setEnabled(false);
  runtime.scan();

  assert.equal(playCalls, 0);
});

test('a dispatched next click is never repeated while navigation is only being verified', () => {
  const { createAdvanceController } = loadApi();
  const scheduled = [];
  let clicks = 0;
  const controller = createAdvanceController({
    locateNext: () => ({ id: 'next-lesson' }),
    clickNext: () => {
      clicks += 1;
    },
    hasAdvanced: () => false,
    maxAttempts: 3,
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
  });

  controller.handleMediaEnded({ ended: true, currentTime: 80, duration: 80 });
  while (scheduled.length > 0) scheduled.shift().callback();

  assert.equal(clicks, 1);
  assert.deepEqual(controller.getState(), { phase: 'stopped', attempts: 3 });
});

test('non-interactive elements labeled as next lesson are never candidates', () => {
  const { chooseNextCandidate } = loadApi();
  const decorativeLabel = { id: 'decorative-label' };

  assert.equal(
    chooseNextCandidate([
      {
        element: decorativeLabel,
        title: '下一节',
        tagName: 'DIV',
        visible: true,
      },
    ]),
    null,
  );
});

test('multiple visible controls with the same next-lesson meaning are treated as ambiguous', () => {
  const { chooseNextCandidate } = loadApi();
  const button = { id: 'button-next' };
  const link = { id: 'link-next' };

  assert.equal(
    chooseNextCandidate([
      { element: button, text: '下一节', tagName: 'BUTTON', visible: true },
      {
        element: link,
        text: '下一节',
        tagName: 'A',
        href: '#/video_detail?id=2',
        visible: true,
      },
    ]),
    null,
  );
});

test('manual rescan can restart a stopped cycle for the last verified ended video', () => {
  const { createAdvanceController } = loadApi();
  let target = null;
  const clicks = [];
  const controller = createAdvanceController({
    locateNext: () => target,
    clickNext: (value) => clicks.push(value),
    hasAdvanced: () => false,
    maxAttempts: 1,
    schedule: () => {},
  });
  const media = { ended: true, currentTime: 55, duration: 55 };

  controller.handleMediaEnded(media, 'lesson-1');
  assert.equal(controller.getState().phase, 'stopped');
  assert.equal(typeof controller.retryLastEnded, 'function');

  target = { id: 'next-lesson' };
  assert.equal(controller.retryLastEnded(), true);

  assert.deepEqual(clicks, [target]);
  assert.equal(controller.getState().phase, 'verifying');
});

test('page rescan combines DOM rebinding with a manual retry of a stopped cycle', () => {
  const { createPageRuntime } = loadApi();
  const scheduled = [];
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=1' },
    setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
  };
  const video = new EventTarget();
  video.ended = true;
  video.currentTime = 20;
  video.duration = 20;
  let nextCandidates = [];
  let clicks = 0;
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 32 }),
    click: () => {
      clicks += 1;
    },
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return [video];
      return nextCandidates;
    },
  };
  const runtime = createPageRuntime({
    window: fakeWindow,
    document: fakeDocument,
    allowNextClick: true,
    enabled: true,
    maxAttempts: 1,
  });

  runtime.scan();
  video.dispatchEvent(new Event('ended'));
  scheduled.shift().callback();
  assert.equal(runtime.controller.getState().phase, 'stopped');

  nextCandidates = [next];
  assert.equal(typeof runtime.rescanAndRetry, 'function');
  runtime.rescanAndRetry();

  assert.equal(clicks, 1);
});

test('a video inside an iframe cannot click a next control from another document', () => {
  const { createPageRuntime } = loadApi();
  const scheduled = [];
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=1' },
    setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
  };
  let clicks = 0;
  const topNext = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 32 }),
    click: () => {
      clicks += 1;
    },
  };
  const video = new EventTarget();
  video.ended = true;
  video.currentTime = 15;
  video.duration = 15;
  const childDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return [video];
      return [];
    },
  };
  video.ownerDocument = childDocument;
  const rootDocument = {
    defaultView: childDocument.defaultView,
    querySelectorAll(selector) {
      if (selector === 'iframe') return [{ contentDocument: childDocument }];
      if (selector === 'video') return [];
      return [topNext];
    },
  };
  const runtime = createPageRuntime({
    window: fakeWindow,
    document: rootDocument,
    allowNextClick: true,
    enabled: true,
    maxAttempts: 1,
  });

  runtime.scan();
  video.dispatchEvent(new Event('ended'));
  scheduled.shift().callback();

  assert.equal(clicks, 0);
  assert.equal(runtime.controller.getState().phase, 'stopped');
});

test('strict next-lesson selection ignores a named non-whitelist control', () => {
  const { chooseNextCandidate } = loadApi();

  const exact = { id: 'exact-next' };

  assert.equal(
    chooseNextCandidate([
      {
        element: exact,
        text: '下一节',
        tagName: 'BUTTON',
        visible: true,
      },
      {
        element: { id: 'named-next' },
        text: '下一节课程二',
        tagName: 'BUTTON',
        visible: true,
      },
    ]),
    exact,
  );
});

test('next-lesson selection rejects any quiz, exam, exercise, or answering label', () => {
  const { chooseNextCandidate } = loadApi();
  for (const text of ['下一节课程测验', '下一节考试', '下一节练习', '下一节答题']) {
    assert.equal(
      chooseNextCandidate([{ element: { id: text }, text, tagName: 'BUTTON', visible: true }]),
      null,
      `${text} must never be treated as a lesson navigation control`,
    );
  }
});

test('an exact next label inside a quiz section is rejected by surrounding semantics', () => {
  const { findNextElementInDocuments } = loadApi();
  const quizSection = { textContent: '课程测验 下一节' };
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 24 }),
    closest: () => quizSection,
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll: () => [next],
  };

  assert.equal(findNextElementInDocuments([fakeDocument]), null);
});

test('same-origin iframe navigation keeps autoplay scoped to the reloaded iframe document', () => {
  const { createPageRuntime } = loadApi();
  const scheduled = [];
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=1' },
    setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
  };
  const oldVideo = new EventTarget();
  oldVideo.ended = false;
  oldVideo.currentTime = 0;
  oldVideo.duration = 10;
  oldVideo.currentSrc = 'lesson-1.mp4';
  oldVideo.isConnected = true;
  let playCalls = 0;
  const newVideo = new EventTarget();
  newVideo.ended = false;
  newVideo.currentSrc = 'lesson-2.mp4';
  newVideo.isConnected = true;
  newVideo.getBoundingClientRect = () => ({ width: 640, height: 360 });
  newVideo.play = () => {
    playCalls += 1;
    return Promise.resolve();
  };
  const frame = { contentDocument: null };
  const newChildDocument = {
    defaultView: { frameElement: frame },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return [newVideo];
      return [];
    },
  };
  newVideo.ownerDocument = newChildDocument;
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 32 }),
    click() {
      oldVideo.isConnected = false;
      frame.contentDocument = newChildDocument;
    },
  };
  const oldChildDocument = {
    defaultView: {
      frameElement: frame,
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return [oldVideo];
      return [next];
    },
  };
  oldVideo.ownerDocument = oldChildDocument;
  frame.contentDocument = oldChildDocument;
  const rootDocument = {
    defaultView: oldChildDocument.defaultView,
    querySelectorAll(selector) {
      if (selector === 'iframe') return [frame];
      return [];
    },
  };
  const runtime = createPageRuntime({
    window: fakeWindow,
    document: rootDocument,
    allowNextClick: true,
    enabled: true,
    autoPlay: true,
  });

  runtime.scan();
  oldVideo.ended = true;
  oldVideo.currentTime = 10;
  oldVideo.dispatchEvent(new Event('ended'));
  scheduled.shift().callback();
  runtime.scan();

  assert.equal(playCalls, 1);
});

test('course launch selection accepts one exact start action and ignores destructive neighbors', () => {
  const { chooseCourseLaunchCandidate } = loadApi();
  assert.equal(
    typeof chooseCourseLaunchCandidate,
    'function',
    'the course queue must expose its real safe launch selector',
  );
  const start = { id: 'start-course-a' };

  assert.equal(
    chooseCourseLaunchCandidate([
      { element: start, text: '开始学习', visible: true, disabled: false },
      { element: { id: 'cancel' }, text: '取消选课', visible: true, disabled: false },
      { element: { id: 'elect' }, text: '我要选课', visible: true, disabled: false },
    ]),
    start,
  );
  assert.equal(
    chooseCourseLaunchCandidate([
      { element: { id: 'start-1' }, text: '开始学习', visible: true, disabled: false },
      { element: { id: 'start-2' }, text: '开始学习', visible: true, disabled: false },
    ]),
    null,
    'two valid start controls in one card are ambiguous',
  );
});

test('course queue chooses the first safe unfinished selected course in DOM order', () => {
  const { chooseNextUnfinishedCourse } = loadApi();
  assert.equal(typeof chooseNextUnfinishedCourse, 'function');
  const startB = { id: 'start-b' };
  const startC = { id: 'start-c' };
  let courses = [
    { key: 'done-a', completed: true, launchElement: { id: 'start-a' } },
    { key: 'not-elected', completed: false, electiveOnly: true, launchElement: null },
    { key: 'course-b', completed: false, electiveOnly: false, launchElement: startB },
    { key: 'course-c', completed: false, electiveOnly: false, launchElement: startC },
  ];

  assert.equal(chooseNextUnfinishedCourse(courses, []).key, 'course-b');
  assert.equal(chooseNextUnfinishedCourse(courses, ['course-b']).key, 'course-c');
  assert.equal(
    chooseNextUnfinishedCourse(
      [
        { key: 'uncertain', completed: false, electiveOnly: false, launchElement: null },
        ...courses.slice(2),
      ],
      [],
    ),
    null,
    'an uncertain first selected course must block instead of being skipped',
  );
});

test('course queue persists launching state before one click and repeated scans never relaunch it', () => {
  const { createCourseQueueController } = loadApi();
  assert.equal(typeof createCourseQueueController, 'function');
  const start = { id: 'start-a' };
  const events = [];
  let storedSession = null;
  const options = {
    createRunId: () => 'run-1',
    getHref: () => 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course',
    inspectCourseList: () => ({
      ready: true,
      courses: [
        { key: 'course-a', title: '课程 A', completed: false, electiveOnly: false, launchElement: start },
      ],
    }),
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
      events.push(`save:${value.phase}:${value.activeCourseKey || ''}`);
    },
    clickLaunch: (element) => events.push(`click:${element.id}`),
    now: () => 1000,
  };
  const controller = createCourseQueueController(options);

  assert.equal(controller.start().action, 'launched');
  controller.scan();
  controller.scan();
  createCourseQueueController(options).scan();

  assert.deepEqual(events.slice(0, 2), ['save:ready:', 'save:launching:course-a']);
  assert.equal(events.filter((event) => event === 'click:start-a').length, 1);
  assert.equal(storedSession.phase, 'launching');
  assert.equal(storedSession.activeCourseKey, 'course-a');
});

test('a manually started queue times out if the course list never becomes ready', () => {
  const { createCourseQueueController } = loadApi();
  let now = 1000;
  let storedSession = null;
  const controller = createCourseQueueController({
    createRunId: () => 'run-1',
    getHref: () => 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course',
    inspectCourseList: () => ({ ready: false, courses: [] }),
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    now: () => now,
    launchTimeoutMs: 5000,
  });

  assert.equal(controller.start().action, 'waiting-list');
  now = 7000;
  assert.equal(controller.scan().action, 'blocked');
  assert.equal(storedSession.active, false);
  assert.equal(storedSession.blockedReason, 'course-list-timeout');
});

test('course queue launches the next course only after the matching detail page reports 100 percent', () => {
  const { createCourseQueueController } = loadApi();
  const startA = { id: 'start-a' };
  const startB = { id: 'start-b' };
  let href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course';
  let now = 1000;
  let storedSession = null;
  let detailCompleted = false;
  const clicks = [];
  const navigations = [];
  const controller = createCourseQueueController({
    createRunId: () => 'run-1',
    getHref: () => href,
    inspectCourseList: () => ({
      ready: true,
      courses: [
        {
          key: 'course-a',
          title: '课程 A',
          completed: false,
          electiveOnly: false,
          launchElement: startA,
        },
        { key: 'course-b', title: '课程 B', completed: false, electiveOnly: false, launchElement: startB },
      ],
    }),
    inspectCourseDetail: () => ({ ready: true, completed: detailCompleted, launchElement: null }),
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    clickLaunch: (element) => clicks.push(element.id),
    goToCourseCompletionCheck: (courseId) => navigations.push(`detail:${courseId}`),
    returnToCourseList: () => navigations.push('list'),
    now: () => now,
  });

  controller.start();
  href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101';
  controller.scan();
  assert.equal(storedSession.phase, 'in-course');
  controller.noteVerifiedMediaEnd();
  assert.equal(typeof controller.beginCompletionVerification, 'function');
  assert.equal(controller.beginCompletionVerification().action, 'verifying-completion');
  assert.deepEqual(navigations, ['detail:101']);

  href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/course_detail?id=101&typeInfo=1';
  now = 10000;
  assert.equal(controller.scan().action, 'waiting-completion');
  assert.deepEqual(clicks, ['start-a']);

  detailCompleted = true;
  assert.equal(controller.scan().action, 'returning-to-list');
  assert.deepEqual(navigations, ['detail:101', 'list']);

  href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course';
  assert.equal(controller.scan().action, 'launched');
  assert.deepEqual(clicks, ['start-a', 'start-b']);
  assert.equal(storedSession.activeCourseKey, 'course-b');
});

test('completion verification rejects a null verified-end timestamp', () => {
  const { createCourseQueueController } = loadApi();
  let storedSession = {
    version: 1,
    active: true,
    ownerId: 'tab-a',
    runId: 'run-a',
    phase: 'in-course',
    activeCourseId: '101',
    activeCourseKey: 'course-a',
    lastVerifiedEndAt: null,
    launchedCourseKeys: ['course-a'],
  };
  let navigations = 0;
  const controller = createCourseQueueController({
    ownerId: 'tab-a',
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    goToCourseCompletionCheck: () => {
      navigations += 1;
    },
    now: () => 1000,
  });

  assert.equal(controller.beginCompletionVerification().action, 'blocked');
  assert.equal(storedSession.blockedReason, 'completion-without-verified-end');
  assert.equal(navigations, 0);
});

test('course queue safely advances pagination after every visible course on a page was launched', () => {
  const { createCourseQueueController } = loadApi();
  const pageNext = { id: 'page-next' };
  const startB = { id: 'start-b' };
  let inspection = {
    ready: true,
    courses: [
      { key: 'course-a', completed: false, electiveOnly: false, launchElement: { id: 'start-a' } },
    ],
    listFingerprint: 'course-a',
    nextPageElement: pageNext,
    pageMarker: '1',
  };
  let storedSession = {
    version: 1,
    active: true,
    runId: 'run-1',
    phase: 'returning-to-list',
    activeCourseId: '101',
    activeCourseKey: 'course-a',
    activeCourseTitle: '课程 A',
    launchedCourseKeys: ['course-a'],
    returningStartedAt: 1000,
  };
  const clicks = [];
  const controller = createCourseQueueController({
    getHref: () => 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course',
    inspectCourseList: () => inspection,
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    clickLaunch: (element) => clicks.push(element.id),
    now: () => 2000,
  });

  assert.equal(controller.scan().action, 'paging-list');
  assert.deepEqual(clicks, ['page-next']);
  assert.equal(storedSession.phase, 'paging-list');

  inspection = {
    ready: true,
    courses: [
      { key: 'course-b', title: '课程 B', completed: false, electiveOnly: false, launchElement: startB },
    ],
    listFingerprint: 'course-b',
    nextPageElement: null,
    pageMarker: '2',
  };
  assert.equal(controller.scan().action, 'waiting-list-page');
  assert.equal(controller.scan().action, 'launched');
  assert.deepEqual(clicks, ['page-next', 'start-b']);
  assert.equal(storedSession.activeCourseKey, 'course-b');
});

test('pagination waits for a stable non-empty new fingerprint instead of trusting the page marker', () => {
  const { createCourseQueueController } = loadApi();
  const startB = { id: 'start-b' };
  let inspection = {
    ready: true,
    courses: [{ key: 'course-a', completed: false, electiveOnly: false, launchElement: null }],
    listFingerprint: 'course-a',
    pageMarker: '2',
  };
  let storedSession = {
    version: 1,
    active: true,
    runId: 'run-1',
    phase: 'paging-list',
    launchedCourseKeys: ['course-a'],
    previousListFingerprint: 'course-a',
    previousPageMarker: '1',
    pageStartedAt: 1000,
  };
  const clicks = [];
  const controller = createCourseQueueController({
    getHref: () => 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course',
    inspectCourseList: () => inspection,
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    clickLaunch: (element) => clicks.push(element.id),
    now: () => 2000,
  });

  assert.equal(controller.scan().action, 'waiting-list-page');
  assert.deepEqual(clicks, [], 'a changed page number with old cards must never turn the page again');

  inspection = {
    ready: true,
    courses: [
      { key: 'course-b', title: '课程 B', completed: false, electiveOnly: false, launchElement: startB },
    ],
    listFingerprint: 'course-b',
    pageMarker: '2',
  };
  assert.equal(controller.scan().action, 'waiting-list-page');
  assert.deepEqual(clicks, []);
  assert.equal(controller.scan().action, 'launched');
  assert.deepEqual(clicks, ['start-b']);
});

test('pagination waits for the page marker even when new cards become stable first', () => {
  const { createCourseQueueController } = loadApi();
  const startB = { id: 'start-b' };
  let pageMarker = '1';
  const inspection = () => ({
    ready: true,
    courses: [
      { key: 'course-b', title: '课程 B', completed: false, electiveOnly: false, launchElement: startB },
    ],
    listFingerprint: 'course-b',
    pageMarker,
  });
  let storedSession = {
    version: 1,
    active: true,
    runId: 'run-1',
    phase: 'paging-list',
    launchedCourseKeys: ['course-a'],
    previousListFingerprint: 'course-a',
    previousPageMarker: '1',
    pageStartedAt: 1000,
  };
  const clicks = [];
  const controller = createCourseQueueController({
    getHref: () => 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course',
    inspectCourseList: inspection,
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    clickLaunch: (element) => clicks.push(element.id),
    now: () => 2000,
  });

  assert.equal(controller.scan().action, 'waiting-list-page');
  assert.equal(controller.scan().action, 'waiting-list-page');
  assert.deepEqual(clicks, []);
  pageMarker = '2';
  assert.equal(controller.scan().action, 'launched');
  assert.deepEqual(clicks, ['start-b']);
});

test('pagination rejects oscillating content and blocks a reused course fingerprint', () => {
  const { createCourseQueueController } = loadApi();
  let fingerprint = 'course-b';
  let storedSession = {
    version: 1,
    active: true,
    runId: 'run-1',
    phase: 'paging-list',
    launchedCourseKeys: ['course-a'],
    coursePageMarkers: { 'course-a': '1' },
    previousListFingerprint: 'old-page',
    pageStartedAt: 1000,
  };
  const clicks = [];
  const controller = createCourseQueueController({
    getHref: () => 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course',
    inspectCourseList: () => ({
      ready: true,
      courses: [
        {
          key: fingerprint,
          completed: false,
          electiveOnly: false,
          launchElement: { id: `start-${fingerprint}` },
        },
      ],
      listFingerprint: fingerprint,
      pageMarker: '2',
    }),
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    clickLaunch: (element) => clicks.push(element.id),
    now: () => 2000,
  });

  assert.equal(controller.scan().action, 'waiting-list-page');
  fingerprint = 'course-c';
  assert.equal(controller.scan().action, 'waiting-list-page');
  fingerprint = 'course-b';
  assert.equal(controller.scan().action, 'waiting-list-page');
  assert.deepEqual(clicks, []);

  fingerprint = 'course-a';
  assert.equal(controller.scan().action, 'waiting-list-page');
  assert.equal(controller.scan().action, 'blocked');
  assert.equal(storedSession.blockedReason, 'course-fingerprint-reused');
  assert.deepEqual(clicks, []);
});

test('pagination revisits a known page and skips its finished course before launching the next one', () => {
  const { createCourseQueueController } = loadApi();
  const startC = { id: 'start-c' };
  const inspection = {
    ready: true,
    courses: [
      { key: 'course-b', completed: false, electiveOnly: false, launchElement: { id: 'start-b' } },
      { key: 'course-c', completed: false, electiveOnly: false, launchElement: startC },
    ],
    listFingerprint: 'course-b\ncourse-c',
    pageMarker: '2',
  };
  let storedSession = {
    version: 1,
    active: true,
    runId: 'run-1',
    phase: 'paging-list',
    launchedCourseKeys: ['course-a', 'course-b'],
    coursePageMarkers: { 'course-a': '1', 'course-b': '2' },
    previousListFingerprint: 'course-a',
    previousPageMarker: '1',
    pageStartedAt: 1000,
  };
  const clicks = [];
  const controller = createCourseQueueController({
    getHref: () => 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course',
    inspectCourseList: () => inspection,
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    clickLaunch: (element) => clicks.push(element.id),
    now: () => 2000,
  });

  assert.equal(controller.scan().action, 'waiting-list-page');
  assert.equal(controller.scan().action, 'launched');
  assert.deepEqual(clicks, ['start-c']);
  assert.equal(storedSession.activeCourseKey, 'course-c');
  assert.equal(storedSession.coursePageMarkers['course-c'], '2');
});

test('pagination waits for the page marker when new cards contain an already launched key', () => {
  const { createCourseQueueController } = loadApi();
  const startC = { id: 'start-c' };
  let pageMarker = '1';
  const inspection = () => ({
    ready: true,
    courses: [
      { key: 'course-b', completed: false, electiveOnly: false, launchElement: { id: 'start-b' } },
      { key: 'course-c', completed: false, electiveOnly: false, launchElement: startC },
    ],
    listFingerprint: 'course-b\ncourse-c',
    pageMarker,
  });
  let storedSession = {
    version: 1,
    active: true,
    runId: 'run-1',
    phase: 'paging-list',
    launchedCourseKeys: ['course-a', 'course-b'],
    coursePageMarkers: { 'course-a': '1', 'course-b': '2' },
    previousListFingerprint: 'course-a',
    previousPageMarker: '1',
    pageStartedAt: 1000,
  };
  const clicks = [];
  const controller = createCourseQueueController({
    getHref: () => 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course',
    inspectCourseList: inspection,
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    clickLaunch: (element) => clicks.push(element.id),
    now: () => 2000,
  });

  assert.equal(controller.scan().action, 'waiting-list-page');
  assert.equal(controller.scan().action, 'waiting-list-page');
  assert.deepEqual(clicks, []);

  pageMarker = '2';
  assert.equal(controller.scan().action, 'launched');
  assert.deepEqual(clicks, ['start-c']);
});

test('a scoped empty unfinished list must remain stable before the completed queue is done', () => {
  const { createCourseQueueController } = loadApi();
  let now = 1000;
  let emptyCandidate = true;
  let storedSession = {
    version: 1,
    active: true,
    runId: 'run-1',
    phase: 'returning-to-list',
    activeCourseId: '101',
    activeCourseKey: 'course-a',
    launchedCourseKeys: ['course-a'],
    returningStartedAt: 1000,
    emptyListObservedAt: null,
  };
  const controller = createCourseQueueController({
    getHref: () => 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course',
    inspectCourseList: () => ({ ready: false, courses: [], emptyCandidate }),
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    now: () => now,
    emptyListStableMs: 10000,
  });

  assert.equal(controller.scan().action, 'waiting-empty-list');
  now = 5000;
  emptyCandidate = false;
  assert.equal(controller.scan().action, 'waiting-list');
  assert.equal(storedSession.emptyListObservedAt, null);
  now = 6000;
  emptyCandidate = true;
  assert.equal(controller.scan().action, 'waiting-empty-list');
  now = 15999;
  assert.equal(controller.scan().action, 'waiting-empty-list');
  assert.equal(storedSession.active, true);
  now = 16000;
  assert.equal(controller.scan().action, 'done');
  assert.equal(storedSession.active, false);
  assert.equal(storedSession.phase, 'done');
});

test('a course disappearing from the list is never completion evidence', () => {
  const { createCourseQueueController } = loadApi();
  const startA = { id: 'start-a' };
  const startB = { id: 'start-b' };
  let href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course';
  let now = 1000;
  let storedSession = null;
  let courses = [
    { key: 'course-a', completed: false, electiveOnly: false, launchElement: startA },
    { key: 'course-b', completed: false, electiveOnly: false, launchElement: startB },
  ];
  const clicks = [];
  const controller = createCourseQueueController({
    createRunId: () => 'run-1',
    getHref: () => href,
    inspectCourseList: () => ({ ready: true, courses }),
    inspectCourseDetail: () => ({ ready: true, completed: false, launchElement: null }),
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    clickLaunch: (element) => clicks.push(element.id),
    goToCourseCompletionCheck: () => {},
    returnToCourseList: () => {},
    now: () => now,
    completionTimeoutMs: 5000,
  });

  controller.start();
  href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101';
  controller.scan();
  controller.noteVerifiedMediaEnd();
  controller.beginCompletionVerification();
  href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course';
  courses = courses.slice(1);

  now = 5000;
  assert.equal(controller.scan().action, 'waiting-completion');
  assert.deepEqual(clicks, ['start-a']);
  now = 7000;
  assert.equal(controller.scan().action, 'blocked');
  assert.deepEqual(clicks, ['start-a']);
  assert.equal(storedSession.active, false);
  assert.equal(storedSession.blockedReason, 'completion-not-confirmed');
});

test('course detail launch and initial playback are each issued once for an active queue', () => {
  const { createCourseQueueController } = loadApi();
  const detailStart = { id: 'detail-start' };
  let href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/course_detail?id=101&typeInfo=1';
  let storedSession = {
    version: 1,
    active: true,
    runId: 'run-1',
    phase: 'launching',
    activeCourseKey: 'course-a',
    launchedCourseKeys: ['course-a'],
  };
  const clicks = [];
  let playbackRequests = 0;
  const controller = createCourseQueueController({
    getHref: () => href,
    inspectCourseDetail: () => ({ ready: true, launchElement: detailStart }),
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    clickLaunch: (element) => clicks.push(element.id),
    requestPlayback: () => {
      playbackRequests += 1;
    },
    now: () => 1000,
  });

  controller.scan();
  controller.scan();
  assert.deepEqual(clicks, ['detail-start']);
  assert.equal(storedSession.phase, 'in-course');

  href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101&typeInfo=1';
  controller.scan();
  controller.scan();
  assert.equal(playbackRequests, 1);
});

test('course detail launch blocks when the server never navigates to a player', () => {
  const { createCourseQueueController } = loadApi();
  const href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/course_detail?id=101&typeInfo=1';
  let now = 1000;
  let storedSession = {
    version: 1,
    active: true,
    runId: 'run-1',
    phase: 'launching',
    activeCourseKey: 'course-a',
    launchedCourseKeys: ['course-a'],
  };
  let clicks = 0;
  const controller = createCourseQueueController({
    getHref: () => href,
    inspectCourseDetail: () => ({ ready: true, launchElement: { id: 'detail-start' } }),
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    clickLaunch: () => {
      clicks += 1;
    },
    now: () => now,
    launchTimeoutMs: 5000,
  });

  assert.equal(controller.scan().action, 'launched-detail');
  assert.equal(clicks, 1);
  now = 5999;
  assert.equal(controller.scan().action, 'waiting-navigation');
  assert.equal(clicks, 1);
  now = 7000;
  assert.equal(controller.scan().action, 'blocked');
  assert.equal(storedSession.active, false);
  assert.equal(storedSession.blockedReason, 'course-detail-navigation-timeout');
  assert.equal(clicks, 1);
});

test('an active queue times out safely when the course player never appears', () => {
  const { createCourseQueueController } = loadApi();
  const href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101';
  let now = 1000;
  let storedSession = {
    version: 1,
    active: true,
    runId: 'run-1',
    phase: 'in-course',
    activeCourseId: '101',
    expectedCourseId: '101',
    activeCourseKey: 'course-a',
    launchedCourseKeys: ['course-a'],
  };
  let playbackRequests = 0;
  const controller = createCourseQueueController({
    getHref: () => href,
    inspectPlayback: () => ({ ready: false, ambiguous: false }),
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    requestPlayback: () => {
      playbackRequests += 1;
    },
    now: () => now,
    launchTimeoutMs: 5000,
  });

  assert.equal(controller.scan().action, 'waiting-video');
  now = 7000;
  assert.equal(controller.scan().action, 'blocked');
  assert.equal(storedSession.active, false);
  assert.equal(storedSession.blockedReason, 'video-player-timeout');
  assert.equal(playbackRequests, 0);
});

test('course queue can be stopped without a stale scan clicking another course', () => {
  const { createCourseQueueController } = loadApi();
  let storedSession = null;
  const clicks = [];
  const controller = createCourseQueueController({
    createRunId: () => 'run-1',
    getHref: () => 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course',
    inspectCourseList: () => ({
      ready: true,
      courses: [
        {
          key: 'course-a',
          completed: false,
          electiveOnly: false,
          launchElement: { id: 'start-a' },
        },
      ],
    }),
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    clickLaunch: (element) => clicks.push(element.id),
    now: () => 1000,
  });

  controller.start();
  controller.stop();
  controller.scan();

  assert.deepEqual(clicks, ['start-a']);
  assert.equal(storedSession.active, false);
  assert.equal(storedSession.phase, 'idle');
});

test('an owned queue can fail closed when the runtime cannot identify one player', () => {
  const { createCourseQueueController } = loadApi();
  let storedSession = {
    version: 1,
    active: true,
    ownerId: 'tab-a',
    runId: 'run-a',
    phase: 'in-course',
    activeCourseId: '101',
    activeCourseKey: 'course-a',
    launchedCourseKeys: ['course-a'],
  };
  const controller = createCourseQueueController({
    ownerId: 'tab-a',
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    now: () => 1000,
  });

  assert.equal(typeof controller.stopWithReason, 'function');
  assert.equal(controller.stopWithReason('video-player-ambiguous').action, 'blocked');
  assert.equal(storedSession.active, false);
  assert.equal(storedSession.blockedReason, 'video-player-ambiguous');
});

test('a course queue owned by another tab cannot scan, play, or click', () => {
  const { createCourseQueueController } = loadApi();
  const original = {
    version: 1,
    active: true,
    ownerId: 'tab-a',
    runId: 'run-a',
    phase: 'launching',
    activeCourseKey: 'course-a',
    launchedCourseKeys: ['course-a'],
    launchStartedAt: 1000,
  };
  let storedSession = structuredClone(original);
  let href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101';
  let clicks = 0;
  let playbackRequests = 0;
  const controller = createCourseQueueController({
    ownerId: 'tab-b',
    getHref: () => href,
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    clickLaunch: () => {
      clicks += 1;
    },
    requestPlayback: () => {
      playbackRequests += 1;
    },
    now: () => 1000,
  });

  assert.equal(controller.scan().action, 'foreign-owner');
  href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course';
  assert.equal(controller.start().action, 'foreign-owner');
  assert.equal(controller.stop().action, 'foreign-owner');
  assert.equal(clicks, 0);
  assert.equal(playbackRequests, 0);
  assert.deepEqual(storedSession, original);
});

test('an expired owner session still cannot be taken over implicitly', () => {
  const { createCourseQueueController } = loadApi();
  let now = 2000;
  const original = {
    version: 1,
    active: true,
    ownerId: 'tab-a',
    ownerHeartbeatAt: 1000,
    runId: 'run-a',
    phase: 'launching',
    activeCourseKey: 'course-a',
    launchedCourseKeys: ['course-a'],
    launchStartedAt: 1000,
  };
  let storedSession = structuredClone(original);
  const shared = {
    getHref: () => 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course',
    inspectCourseList: () => ({ ready: false, courses: [] }),
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    now: () => now,
    ownerLeaseMs: 5000,
  };
  const newController = createCourseQueueController({
    ...shared,
    ownerId: 'tab-b',
    createRunId: () => 'run-b',
  });

  assert.equal(newController.start().action, 'foreign-owner');
  now = 7001;
  assert.equal(newController.start().action, 'foreign-owner');
  assert.deepEqual(storedSession, original);
});

test('a newly opened matching player tab can claim one bounded launching handoff', () => {
  const { createCourseQueueController } = loadApi();
  let now = 2000;
  let storedSession = {
    version: 1,
    active: true,
    ownerId: 'list-tab',
    ownerHeartbeatAt: 1500,
    runId: 'run-a',
    phase: 'launching',
    activeCourseId: null,
    expectedCourseId: null,
    activeCourseKey: 'course-a',
    activeCourseTitle: '课程 A',
    launchSourceHref: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course',
    launchStartedAt: 1000,
    launchedCourseKeys: ['course-a'],
  };
  let playbackRequests = 0;
  const shared = {
    getHref: () => 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101',
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    now: () => now,
    launchTimeoutMs: 5000,
  };
  const listController = createCourseQueueController({ ...shared, ownerId: 'list-tab' });
  const playerController = createCourseQueueController({
    ...shared,
    ownerId: 'player-tab',
    allowLaunchHandoff: true,
    getLaunchHandoffSourceOwnerId: () => 'list-tab',
    inspectActiveCourseIdentity: () => ({ ready: true, ambiguous: false, title: '课程 A' }),
    requestPlayback: () => {
      playbackRequests += 1;
    },
  });

  assert.equal(playerController.scan().action, 'playback-requested');
  assert.equal(storedSession.ownerId, 'player-tab');
  assert.equal(storedSession.runId, 'run-a');
  assert.equal(storedSession.activeCourseId, '101');
  assert.equal(storedSession.phase, 'in-course');
  assert.equal(playbackRequests, 1);
  const claimed = structuredClone(storedSession);

  assert.equal(listController.scan().action, 'foreign-owner');
  assert.equal(listController.stop().action, 'foreign-owner');
  assert.deepEqual(storedSession, claimed);

  now = 8000;
  storedSession = {
    ...claimed,
    ownerId: 'list-tab',
    phase: 'launching',
    activeCourseId: null,
    expectedCourseId: null,
    launchStartedAt: 1000,
    handoffClaimedAt: null,
  };
  assert.equal(playerController.scan().action, 'foreign-owner');
  assert.equal(storedSession.ownerId, 'list-tab', 'an expired launch cannot be claimed');
});

test('a mismatched rendered course title blocks before any player action', () => {
  const { createCourseQueueController } = loadApi();
  let storedSession = {
    version: 1,
    active: true,
    ownerId: 'tab-a',
    runId: 'run-a',
    phase: 'launching',
    activeCourseId: '101',
    expectedCourseId: '101',
    activeCourseKey: 'course-a',
    activeCourseTitle: '课程 A',
    launchStartedAt: 1000,
    launchedCourseKeys: ['course-a'],
  };
  let playbackRequests = 0;
  let dialogClicks = 0;
  const controller = createCourseQueueController({
    ownerId: 'tab-a',
    getHref: () => 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101',
    inspectActiveCourseIdentity: () => ({
      ready: true,
      ambiguous: false,
      title: '课程 B',
    }),
    inspectContinueLearningDialog: () => ({ present: true, target: { id: 'confirm' } }),
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    clickLaunch: () => {
      dialogClicks += 1;
    },
    requestPlayback: () => {
      playbackRequests += 1;
    },
    now: () => 2000,
  });

  assert.equal(controller.scan().action, 'blocked');
  assert.equal(storedSession.blockedReason, 'course-title-mismatch');
  assert.equal(dialogClicks, 0);
  assert.equal(playbackRequests, 0);
});

test('course card DOM adapter scopes start learning to one card and recognizes strict 100 percent completion', () => {
  const { describeCourseCard } = loadApi();
  assert.equal(typeof describeCourseCard, 'function');
  const visible = (textContent) => ({
    textContent,
    innerText: textContent,
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 24 }),
  });
  const start = visible('开始学习');
  const cancel = visible('取消选课');
  const progressText = { textContent: '100%' };
  const progressBar = { style: { width: '100%' } };
  const progress = {
    isConnected: true,
    getBoundingClientRect: () => ({ width: 320, height: 16 }),
    getAttribute(name) {
      return { role: 'progressbar', 'aria-valuemax': '100', 'aria-valuenow': '100' }[name] || null;
    },
    querySelector(selector) {
      if (selector === '.el-progress-bar__inner') return progressBar;
      if (selector === '.el-progress__text') return progressText;
      return null;
    },
  };
  const title = { textContent: '会议接待礼仪——会前准备' };
  const timer = { textContent: '2025-02-19' };
  const image = { currentSrc: 'https://cdn.example/course-a.png', src: '' };
  const card = {
    querySelector(selector) {
      if (selector === '.course_list_right_title') return title;
      if (selector === '.timer') return timer;
      if (selector === '.course_cover img, img') return image;
      if (selector === '.foter .el-progress[role="progressbar"]') return progress;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.SaveButton > .Save') return [start, cancel];
      return [];
    },
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
  };

  const result = describeCourseCard(card, fakeDocument);

  assert.equal(result.title, '会议接待礼仪——会前准备');
  assert.match(result.key, /会议接待礼仪/);
  assert.equal(result.completed, true);
  assert.equal(result.launchElement, start);
  assert.equal(result.electiveOnly, false);
});

test('course list DOM adapter only becomes ready on the unfinished-course view', () => {
  const { inspectCourseListDocument } = loadApi();
  assert.equal(typeof inspectCourseListDocument, 'function');
  const header = { textContent: '未完成课程' };
  const card = {
    querySelector(selector) {
      if (selector === '.course_list_right_title') return { textContent: '课程 A' };
      if (selector === '.timer') return { textContent: '2025-02-19' };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.SaveButton > .Save') {
        return [
          {
            textContent: '开始学习',
            innerText: '开始学习',
            disabled: false,
            isConnected: true,
            getAttribute: () => null,
            getBoundingClientRect: () => ({ width: 80, height: 24 }),
          },
        ];
      }
      return [];
    },
  };
  const fakeDocument = {
    body: { textContent: '未完成课程 共 1 门课程' },
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelector: (selector) => (selector === '.top_header' ? header : null),
    querySelectorAll: (selector) => (selector === 'li.course_list' ? [card] : []),
  };

  assert.deepEqual(inspectCourseListDocument(fakeDocument).ready, true);
  header.textContent = '已完成课程';
  assert.deepEqual(inspectCourseListDocument(fakeDocument), { ready: false, courses: [] });
});

test('an unrelated empty-state message cannot make an unfinished course list ready', () => {
  const { inspectCourseListDocument } = loadApi();
  const fakeDocument = {
    body: { textContent: '消息中心：暂无数据' },
    querySelector(selector) {
      if (selector === '.top_header') return { textContent: '未完成课程' };
      return null;
    },
    querySelectorAll: () => [],
  };

  assert.deepEqual(inspectCourseListDocument(fakeDocument), { ready: false, courses: [] });
});

test('a temporarily empty course container remains unready while the list is loading', () => {
  const { inspectCourseListDocument } = loadApi();
  const listContainer = { querySelectorAll: () => [] };
  const fakeDocument = {
    querySelector(selector) {
      if (selector === '.top_header') return { textContent: '未完成课程' };
      if (selector === 'ul.course') return listContainer;
      return null;
    },
    querySelectorAll: () => [],
  };

  assert.deepEqual(inspectCourseListDocument(fakeDocument), {
    ready: false,
    courses: [],
    emptyCandidate: false,
  });
});

test('only an explicit scoped zero-course count can confirm an empty unfinished list', () => {
  const { inspectCourseListDocument } = loadApi();
  const countSpan = { textContent: '0' };
  const countState = {
    textContent: '共 0 门课程',
    isConnected: true,
    getBoundingClientRect: () => ({ width: 120, height: 24 }),
    querySelector: (selector) => (selector === ':scope > span' || selector === 'span' ? countSpan : null),
  };
  const noCourse = {
    textContent: '暂无课程信息',
    isConnected: true,
    getBoundingClientRect: () => ({ width: 240, height: 60 }),
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelector(selector) {
      if (selector === '.top_header') return { textContent: '未完成课程' };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.content_right > .optional .optional_left > .state.fl') return [countState];
      if (selector === '.content_right > .van-noText') return [noCourse];
      return [];
    },
  };

  assert.deepEqual(inspectCourseListDocument(fakeDocument), {
    ready: false,
    courses: [],
    emptyCandidate: true,
  });
});

test('course detail DOM adapter accepts only one exact start action and never elective', () => {
  const { inspectCourseDetailDocument } = loadApi();
  assert.equal(typeof inspectCourseDetailDocument, 'function');
  const start = {
    textContent: '开始学习',
    innerText: '开始学习',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 24 }),
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll: () => [start],
  };

  assert.equal(inspectCourseDetailDocument(fakeDocument).launchElement, start);
  start.textContent = '我要选课';
  start.innerText = '我要选课';
  assert.equal(inspectCourseDetailDocument(fakeDocument).launchElement, null);
});

test('course detail completion requires matching aria, bar width, and visible 100 percent text', () => {
  const { inspectCourseDetailDocument } = loadApi();
  let text = '99%';
  let textHidden = false;
  let barHidden = false;
  const progressText = {
    textContent: text,
    isConnected: true,
    getBoundingClientRect: () => ({ width: 40, height: 16 }),
  };
  const progressBar = {
    style: { width: '100%' },
    isConnected: true,
    getBoundingClientRect: () => ({ width: 320, height: 8 }),
  };
  const progress = {
    isConnected: true,
    getBoundingClientRect: () => ({ width: 320, height: 16 }),
    getAttribute(name) {
      return { 'aria-valuemax': '100', 'aria-valuenow': '100' }[name] || null;
    },
    querySelector(selector) {
      if (selector === '.el-progress-bar__inner') return progressBar;
      if (selector === '.el-progress__text') return progressText;
      return null;
    },
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: (element) => ({
        display:
          (element === progressText && textHidden) || (element === progressBar && barHidden)
            ? 'none'
            : 'block',
        visibility: 'visible',
        opacity: '1',
      }),
    },
    querySelector: () => null,
    querySelectorAll: (selector) =>
      selector === '.center_header .foter .el-progress[role="progressbar"]' ? [progress] : [],
  };

  assert.equal(inspectCourseDetailDocument(fakeDocument).completed, false);
  text = '100%';
  progressText.textContent = text;
  assert.equal(inspectCourseDetailDocument(fakeDocument).completed, true);
  textHidden = true;
  assert.equal(inspectCourseDetailDocument(fakeDocument).completed, false);
  textHidden = false;
  barHidden = true;
  assert.equal(inspectCourseDetailDocument(fakeDocument).completed, false);
});

test('course detail completion rejects multiple visible progress components as ambiguous', () => {
  const { inspectCourseDetailDocument } = loadApi();
  function completeProgress() {
    const bar = {
      style: { width: '100%' },
      isConnected: true,
      getBoundingClientRect: () => ({ width: 320, height: 8 }),
    };
    const text = {
      textContent: '100%',
      isConnected: true,
      getBoundingClientRect: () => ({ width: 40, height: 16 }),
    };
    return {
      isConnected: true,
      getBoundingClientRect: () => ({ width: 320, height: 16 }),
      getAttribute: (name) => ({ 'aria-valuemax': '100', 'aria-valuenow': '100' })[name] || null,
      querySelector: (selector) =>
        selector === '.el-progress-bar__inner'
          ? bar
          : selector === '.el-progress__text'
            ? text
            : null,
    };
  }
  const progress = [completeProgress(), completeProgress()];
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelector: () => null,
    querySelectorAll: (selector) =>
      selector === '.center_header .foter .el-progress[role="progressbar"]' ? progress : [],
  };

  const result = inspectCourseDetailDocument(fakeDocument);
  assert.equal(result.ready, false);
  assert.equal(result.completed, false);
});

test('course identity adapter reads one visible title from each supported course route', () => {
  const { inspectActiveCourseIdentityInDocuments } = loadApi();
  const title = {
    textContent: '课程 A',
    isConnected: true,
    getBoundingClientRect: () => ({ width: 240, height: 28 }),
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === '.center_header .course_title') return [title];
      if (selector === '.video_center > .wrapper > p.title') return [title];
      return [];
    },
  };

  assert.deepEqual(
    inspectActiveCourseIdentityInDocuments(
      [fakeDocument],
      'https://zyjs.lngbzx.gov.cn/pc/index.html#/course_detail?id=101',
    ),
    { ready: true, ambiguous: false, title: '课程 A' },
  );
  assert.deepEqual(
    inspectActiveCourseIdentityInDocuments(
      [fakeDocument],
      'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_play?course_id=101',
    ),
    { ready: true, ambiguous: false, title: '课程 A' },
  );
});

test('video_play reports a verified end without clicking a page next control by default', () => {
  const { createPageRuntime } = loadApi();
  const scheduled = [];
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_play?course_id=101' },
    setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
  };
  const video = new EventTarget();
  video.ended = false;
  video.currentTime = 0;
  video.duration = 10;
  video.currentSrc = 'course-a.mp4';
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 32 }),
    click: () => assert.fail('production runtime must never click a generic next control'),
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return [video];
      return [next];
    },
  };
  let verifiedEnds = 0;
  const runtime = createPageRuntime({
    window: fakeWindow,
    document: fakeDocument,
    enabled: true,
    onVerifiedMediaEnd: () => {
      verifiedEnds += 1;
    },
  });

  runtime.scan();
  video.ended = true;
  video.currentTime = 10;
  video.dispatchEvent(new Event('ended'));

  assert.equal(verifiedEnds, 1);
  scheduled.shift().callback();
  assert.equal(runtime.controller.getState().phase, 'waiting');
});

test('an initial playback request only plays one uniquely discovered video once', () => {
  const { createPageRuntime } = loadApi();
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101' },
    setTimeout: () => 1,
  };
  let playCalls = 0;
  let mutedAtPlay = false;
  const video = new EventTarget();
  video.ended = false;
  video.muted = false;
  video.currentSrc = 'course-a.mp4';
  video.isConnected = true;
  video.getBoundingClientRect = () => ({ width: 640, height: 360 });
  video.play = () => {
    playCalls += 1;
    mutedAtPlay = video.muted;
    return Promise.resolve();
  };
  const fakeDocument = {
    defaultView: fakeWindow,
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return [video];
      return [];
    },
  };
  const runtime = createPageRuntime({
    window: fakeWindow,
    document: fakeDocument,
    enabled: true,
  });

  assert.equal(typeof runtime.requestPlayback, 'function');
  runtime.requestPlayback();
  runtime.scan();
  runtime.scan();

  assert.equal(playCalls, 1);
  assert.equal(mutedAtPlay, true);
});

test('control panel exposes a manual start and stop button for continuous course learning', () => {
  const { createControlPanel } = loadApi();
  function createNode(tagName) {
    const listeners = new Map();
    return {
      tagName: tagName.toUpperCase(),
      children: [],
      style: {},
      textContent: '',
      append(...nodes) {
        this.children.push(...nodes);
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      click() {
        listeners.get('click')?.();
      },
    };
  }
  const body = createNode('body');
  const queueToggles = [];
  const panel = createControlPanel({
    document: { body, createElement: createNode },
    enabled: true,
    queueActive: false,
    onToggle: () => {},
    onQueueToggle: (active) => queueToggles.push(active),
    onRescan: () => {},
  });

  assert.equal(panel.queueButton.textContent, '开始连续学习');
  panel.queueButton.click();
  assert.deepEqual(queueToggles, [true]);
  assert.equal(panel.queueButton.textContent, '停止连续学习');
  panel.queueButton.click();
  assert.deepEqual(queueToggles, [true, false]);
});

test('continue-learning confirmation is scoped to one exact visible dialog button', () => {
  const { findContinueLearningConfirmInDocuments } = loadApi();
  assert.equal(typeof findContinueLearningConfirmInDocuments, 'function');
  const confirm = {
    textContent: '确 定',
    innerText: '确 定',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 24 }),
  };
  const dialog = {
    textContent: '是否继续学习？ 取 消 确 定',
    getBoundingClientRect: () => ({ width: 400, height: 240 }),
    querySelector(selector) {
      if (selector === '.el-dialog__title') return { textContent: '是否继续学习？' };
      if (selector === '.el-dialog__body') return { textContent: '' };
      return null;
    },
    querySelectorAll: () => [confirm],
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === '.el-dialog') return [dialog];
      return [];
    },
  };

  assert.equal(findContinueLearningConfirmInDocuments([fakeDocument]), confirm);
  dialog.textContent = '课程测验 确 定';
  assert.equal(findContinueLearningConfirmInDocuments([fakeDocument]), null);
});

test('a quiz dialog containing continue-learning words is never confirmed', () => {
  const {
    findContinueLearningConfirmInDocuments,
    inspectContinueLearningDialogsInDocuments,
  } = loadApi();
  const confirm = {
    textContent: '确定',
    innerText: '确定',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 24 }),
  };
  const title = { textContent: '课程测验' };
  const body = { textContent: '是否继续学习本次测验？' };
  const dialog = {
    textContent: '课程测验 是否继续学习本次测验？ 确定',
    getBoundingClientRect: () => ({ width: 400, height: 240 }),
    querySelector(selector) {
      if (selector === '.el-dialog__title') return title;
      if (selector === '.el-dialog__body') return body;
      return null;
    },
    querySelectorAll: () => [confirm],
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll: (selector) => (selector === '.el-dialog' ? [dialog] : []),
  };

  assert.equal(findContinueLearningConfirmInDocuments([fakeDocument]), null);
  assert.equal(typeof inspectContinueLearningDialogsInDocuments, 'function');
  assert.deepEqual(inspectContinueLearningDialogsInDocuments([fakeDocument]), {
    ambiguous: false,
    present: true,
    target: null,
    unsafe: true,
  });
});

test('an active course queue waits for the continue dialog to disappear before playback', () => {
  const { createCourseQueueController } = loadApi();
  const confirm = { id: 'continue-confirm' };
  const href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101';
  let dialogPresent = true;
  let storedSession = {
    version: 1,
    active: true,
    runId: 'run-1',
    phase: 'in-course',
    activeCourseId: '101',
    expectedCourseId: '101',
    activeCourseKey: 'course-a',
    launchedCourseKeys: ['course-a'],
  };
  const clicks = [];
  let playbackRequests = 0;
  const controller = createCourseQueueController({
    getHref: () => href,
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    inspectContinueLearningDialog: () => ({
      present: dialogPresent,
      target: dialogPresent ? confirm : null,
    }),
    clickLaunch: (element) => clicks.push(element.id),
    requestPlayback: () => {
      playbackRequests += 1;
    },
    now: () => 1000,
  });

  assert.equal(controller.scan().action, 'confirming-continue');
  assert.equal(controller.scan().action, 'confirming-continue');
  assert.equal(playbackRequests, 0);
  dialogPresent = false;
  assert.equal(controller.scan().action, 'playback-requested');
  assert.equal(controller.scan().action, 'in-course');

  assert.deepEqual(clicks, ['continue-confirm']);
  assert.equal(playbackRequests, 1);
});

test('a continue dialog that remains open times out and deactivates the queue', () => {
  const { createCourseQueueController } = loadApi();
  const confirm = { id: 'continue-confirm' };
  const href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101';
  let now = 1000;
  let storedSession = {
    version: 1,
    active: true,
    runId: 'run-1',
    phase: 'in-course',
    activeCourseId: '101',
    expectedCourseId: '101',
    activeCourseKey: 'course-a',
    launchedCourseKeys: ['course-a'],
  };
  let playbackRequests = 0;
  const controller = createCourseQueueController({
    getHref: () => href,
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    inspectContinueLearningDialog: () => ({ present: true, target: confirm }),
    clickLaunch: () => {},
    requestPlayback: () => {
      playbackRequests += 1;
    },
    now: () => now,
    confirmTimeoutMs: 5000,
  });

  assert.equal(controller.scan().action, 'confirming-continue');
  now = 7000;
  assert.equal(controller.scan().action, 'blocked');
  assert.equal(storedSession.active, false);
  assert.equal(storedSession.blockedReason, 'continue-confirm-timeout');
  assert.equal(playbackRequests, 0);
});

test('browser bootstrap starts the first list course from the manual queue button and stores the session', () => {
  const { bootstrapBrowserPage } = loadApi();
  function createNode(tagName) {
    const listeners = new Map();
    return {
      tagName: tagName.toUpperCase(),
      children: [],
      style: {},
      textContent: '',
      append(...nodes) {
        this.children.push(...nodes);
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      click() {
        listeners.get('click')?.();
      },
    };
  }
  let courseClicks = 0;
  const start = {
    textContent: '开始学习',
    innerText: '开始学习',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 24 }),
    click: () => {
      courseClicks += 1;
    },
  };
  const card = {
    querySelector(selector) {
      if (selector === '.course_list_right_title') return { textContent: '课程 A' };
      if (selector === '.timer') return { textContent: '2025-02-19' };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.SaveButton > .Save') return [start];
      return [];
    },
  };
  const body = createNode('body');
  body.textContent = '未完成课程 共 1 门课程';
  const store = new Map();
  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }
  const fakeWindow = {
    location: {
      hostname: 'zyjs.lngbzx.gov.cn',
      href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course',
      hash: '#/study_center/my_course',
    },
    MutationObserver: FakeMutationObserver,
    setTimeout: () => 1,
    setInterval: () => 1,
    clearInterval: () => {},
  };
  const fakeDocument = {
    body,
    documentElement: createNode('html'),
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    createElement: createNode,
    querySelector: (selector) =>
      selector === '.top_header' ? { textContent: '未完成课程' } : null,
    querySelectorAll(selector) {
      if (selector === 'li.course_list') return [card];
      return [];
    },
  };

  const app = bootstrapBrowserPage({
    window: fakeWindow,
    document: fakeDocument,
    getValue: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
    setValue: (key, value) => store.set(key, structuredClone(value)),
  });

  app.panel.queueButton.click();

  assert.equal(courseClicks, 1);
  assert.equal(app.courseQueue.isActive(), true);
  assert.equal(store.get('lngbzx-course-queue-v2').phase, 'launching');
  assert.equal(app.panel.queueButton.textContent, '停止连续学习');
});

test('course card key stays stable when the same cover image loads through a different URL', () => {
  const { describeCourseCard } = loadApi();
  const title = { textContent: '课程 A' };
  const timer = { textContent: '2025-02-19' };
  let imageSource = 'https://cdn.example/a.png?token=first';
  const start = {
    textContent: '开始学习',
    innerText: '开始学习',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 24 }),
  };
  const card = {
    querySelector(selector) {
      if (selector === '.course_list_right_title') return title;
      if (selector === '.timer') return timer;
      if (selector === '.course_cover img, img') return { currentSrc: imageSource };
      return null;
    },
    querySelectorAll: () => [start],
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
  };

  const firstKey = describeCourseCard(card, fakeDocument).key;
  imageSource = 'https://cdn.example/a.png?token=second';

  assert.equal(describeCourseCard(card, fakeDocument).key, firstKey);
});

test('course card id extraction ignores Vue style hashes and rejects conflicting ids', () => {
  const { courseIdFromCourseCard } = loadApi();
  const attributes = new Map([['data-v-ab5f8395', '']]);
  const card = {
    getAttribute: (name) => attributes.get(name) || null,
    querySelectorAll: () => [],
  };

  assert.equal(courseIdFromCourseCard(card), null);
  attributes.set('data-course-id', '101');
  assert.equal(courseIdFromCourseCard(card), '101');
  attributes.set('data-courseid', '202');
  assert.equal(courseIdFromCourseCard(card), null);
});

test('an elective label cannot hide two ambiguous start actions in the same course card', () => {
  const { describeCourseCard } = loadApi();
  const action = (textContent) => ({
    textContent,
    innerText: textContent,
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 24 }),
  });
  const card = {
    querySelector: (selector) =>
      selector === '.course_list_right_title' ? { textContent: '课程 A' } : null,
    querySelectorAll: () => [action('开始学习'), action('开始学习'), action('我要选课')],
  };
  const result = describeCourseCard(card, {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
  });

  assert.equal(result.launchElement, null);
  assert.equal(result.electiveOnly, false);
});

test('course id parsing accepts one numeric id on known routes and rejects ambiguous or unknown routes', () => {
  const { courseIdFromHref } = loadApi();
  assert.equal(typeof courseIdFromHref, 'function');

  assert.equal(
    courseIdFromHref('https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101&typeInfo=1'),
    '101',
  );
  assert.equal(
    courseIdFromHref('https://zyjs.lngbzx.gov.cn/pc/index.html#/video_play?course_id=202'),
    '202',
  );
  assert.equal(
    courseIdFromHref('https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail/?id=303'),
    '303',
  );
  assert.equal(
    courseIdFromHref('https://zyjs.lngbzx.gov.cn/pc/index.html#/video_play/?course_id=404'),
    '404',
  );
  assert.equal(
    courseIdFromHref('https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101&id=202'),
    null,
  );
  assert.equal(
    courseIdFromHref('https://zyjs.lngbzx.gov.cn/pc/index.html#/study_center/my_course?id=101'),
    null,
  );
});

test('an active queue blocks when navigation changes to a different course id', () => {
  const { createCourseQueueController } = loadApi();
  let href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101';
  let storedSession = {
    version: 1,
    active: true,
    runId: 'run-1',
    phase: 'launching',
    activeCourseKey: 'course-a',
    launchedCourseKeys: ['course-a'],
  };
  const controller = createCourseQueueController({
    getHref: () => href,
    loadSession: () => storedSession,
    saveSession: (value) => {
      storedSession = structuredClone(value);
    },
    requestPlayback: () => {},
    now: () => 1000,
  });

  controller.scan();
  assert.equal(storedSession.activeCourseId, '101');
  href = 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=202';

  assert.equal(controller.scan().action, 'blocked');
  assert.equal(storedSession.blockedReason, 'course-id-changed');
});

test('multiple visible videos cannot trigger an ended cycle when uniqueness is required', () => {
  const { createPageRuntime } = loadApi();
  const fakeWindow = {
    location: { href: 'https://zyjs.lngbzx.gov.cn/pc/index.html#/video_detail?id=101' },
    setTimeout: () => 1,
  };
  const videoA = new EventTarget();
  const videoB = new EventTarget();
  for (const video of [videoA, videoB]) {
    video.ended = true;
    video.currentTime = 10;
    video.duration = 10;
    video.currentSrc = `${video === videoA ? 'a' : 'b'}.mp4`;
    video.isConnected = true;
    video.getBoundingClientRect = () => ({ width: 640, height: 360 });
  }
  const next = {
    tagName: 'BUTTON',
    innerText: '下一节',
    textContent: '下一节',
    disabled: false,
    isConnected: true,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 32 }),
    click: () => assert.fail('ambiguous media must never navigate'),
  };
  const fakeDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') return [];
      if (selector === 'video') return [videoA, videoB];
      return [next];
    },
  };
  let ambiguousSignals = 0;
  const runtime = createPageRuntime({
    window: fakeWindow,
    document: fakeDocument,
    enabled: true,
    requireUniqueMedia: true,
    onMediaAmbiguous: () => {
      ambiguousSignals += 1;
    },
  });

  runtime.scan();
  videoA.dispatchEvent(new Event('ended'));

  assert.equal(ambiguousSignals, 1);
  assert.equal(runtime.controller.getState().phase, 'idle');
});
