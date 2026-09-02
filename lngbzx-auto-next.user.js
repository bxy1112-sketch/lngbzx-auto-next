// ==UserScript==
// @name         辽宁干部在线学习网：合规连续学习（恢复版）
// @namespace    local.codex.lngbzx.recovery.20260825
// @version      3.0.2
// @description  从精确“我的课程”入口手动启动；真实结束后安全进入唯一下一节，自动静音并自恢复面板。
// @homepageURL  https://github.com/bxy1112-sketch/lngbzx-auto-next
// @supportURL   https://github.com/bxy1112-sketch/lngbzx-auto-next/issues
// @downloadURL  https://raw.githubusercontent.com/bxy1112-sketch/lngbzx-auto-next/main/lngbzx-auto-next.user.js
// @updateURL    https://raw.githubusercontent.com/bxy1112-sketch/lngbzx-auto-next/main/lngbzx-auto-next.user.js
// @match        https://zyjs.lngbzx.gov.cn/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// ==/UserScript==

(function attachAutoNext(globalObject, factory) {
  'use strict';

  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    window.location.hostname === 'zyjs.lngbzx.gov.cn'
  ) {
    globalObject.LngbzxAutoNext = api;
    const boot = () =>
      api.bootstrapBrowserPage({
        window,
        document,
        getValue:
          typeof GM_getValue === 'function' ? (key, fallback) => GM_getValue(key, fallback) : undefined,
        setValue: typeof GM_setValue === 'function' ? (key, value) => GM_setValue(key, value) : undefined,
      });

    if (document.body) {
      boot();
    } else {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  'use strict';

  const boundMediaElements = new WeakSet();
  const observedMediaProgress = new WeakMap();
  const mediaEndEvidenceMaxAgeMs = 30_000;

  function isVerifiedMediaEnd(media) {
    if (!media || media.ended !== true) return false;

    const duration = Number(media.duration);
    const currentTime = Number(media.currentTime);
    return (
      Number.isFinite(duration) &&
      duration > 0 &&
      Number.isFinite(currentTime) &&
      currentTime >= Math.max(0, duration - 2)
    );
  }

  function mediaSourceKey(media) {
    return String(media?.currentSrc || media?.src || '');
  }

  function observeMediaProgress(media) {
    const duration = Number(media?.duration);
    const currentTime = Number(media?.currentTime);
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !Number.isFinite(currentTime) ||
      currentTime < 0
    ) {
      return;
    }

    const source = mediaSourceKey(media);
    if (!source) {
      observedMediaProgress.delete(media);
      return;
    }

    const previous = observedMediaProgress.get(media);
    if (
      !previous ||
      previous.source !== source ||
      Math.abs(previous.duration - duration) > 0.5
    ) {
      observedMediaProgress.set(media, {
        duration,
        maxCurrentTime: currentTime,
        observedAt: Date.now(),
        source,
      });
      return;
    }

    if (currentTime > previous.maxCurrentTime) {
      previous.maxCurrentTime = currentTime;
      previous.observedAt = Date.now();
    }
  }

  function verifiedMediaEndSnapshot(media) {
    if (isVerifiedMediaEnd(media)) {
      const snapshot = {
        ended: true,
        currentTime: Number(media.currentTime),
        duration: Number(media.duration),
      };
      observedMediaProgress.delete(media);
      return snapshot;
    }

    const observed = observedMediaProgress.get(media);
    const duration = Number(media?.duration);
    const source = mediaSourceKey(media);
    if (
      !observed ||
      !source ||
      observed.source !== source ||
      !Number.isFinite(duration) ||
      Math.abs(observed.duration - duration) > 0.5 ||
      Date.now() - observed.observedAt > mediaEndEvidenceMaxAgeMs ||
      observed.maxCurrentTime < Math.max(0, observed.duration - 2)
    ) {
      return media;
    }

    const snapshot = {
      ended: true,
      currentTime: observed.maxCurrentTime,
      duration: observed.duration,
    };
    observedMediaProgress.delete(media);
    return snapshot;
  }

  function normalizeLabel(value) {
    return String(value || '')
      .replace(/\s+/g, '')
      .replace(/[：:。.!！?？]+$/g, '');
  }

  function scoreNextCandidate(candidate) {
    if (!candidate || !candidate.element || candidate.visible === false) return -1;
    if (candidate.disabled === true || String(candidate.ariaDisabled) === 'true') return -1;

    const tagName = String(candidate.tagName || '').toUpperCase();
    const role = String(candidate.role || '').toLowerCase();
    const interactive =
      tagName === 'BUTTON' || (tagName === 'A' && Boolean(candidate.href)) || role === 'button';
    if (!interactive) return -1;
    if (
      tagName === 'A' &&
      !/#\/(?:video_detail|video_play|course_detail)(?:[/?]|$)/.test(
        String(candidate.href || ''),
      )
    ) {
      return -1;
    }

    const labels = [candidate.text, candidate.ariaLabel, candidate.title]
      .map(normalizeLabel)
      .filter(Boolean);
    if (
      labels.some((label) => /下一页|下页|下一题|下一步|下一章题|测验|测试|考试|答题|问答|练习|作业/.test(label)) ||
      /测验|测试|考试|答题|问答|练习|作业|quiz|exam|exercise|question/i.test(
        String(candidate.href || ''),
      ) ||
      /测验|测试|考试|答题|问答|练习|作业|quiz|exam|exercise|question/i.test(
        normalizeLabel(candidate.contextText),
      )
    ) {
      return -1;
    }

    const exactLabels = new Set([
      '下一节',
      '下一课',
      '下一讲',
      '下一章节',
      '下一个视频',
      '下一视频',
      '播放下一节',
      '播放下一课',
    ]);
    const score = labels.some((label) => exactLabels.has(label)) ? 100 : -1;
    if (score < 0) return -1;

    return score;
  }

  function chooseNextCandidate(candidates) {
    const ranked = (candidates || [])
      .map((candidate) => ({ candidate, score: scoreNextCandidate(candidate) }))
      .filter((entry) => entry.score >= 90)
      .sort((left, right) => right.score - left.score);

    if (ranked.length !== 1) return null;
    return ranked[0].candidate.element;
  }

  function chooseCourseLaunchCandidate(candidates) {
    const allowed = (candidates || []).filter((candidate) => {
      if (!candidate?.element || candidate.visible === false || candidate.disabled === true) return false;
      if (String(candidate.ariaDisabled) === 'true') return false;
      const labels = [candidate.text, candidate.ariaLabel, candidate.title]
        .map(normalizeLabel)
        .filter(Boolean);
      if (labels.some((label) => /取消选课|退选|删除|我要选课/.test(label))) return false;
      return labels.some((label) => label === '开始学习');
    });

    return allowed.length === 1 ? allowed[0].element : null;
  }

  function chooseNextUnfinishedCourse(courses, launchedCourseKeys) {
    const launched = new Set(launchedCourseKeys || []);
    const keys = new Set();
    for (const course of courses || []) {
      if (!course?.key || keys.has(course.key)) return null;
      keys.add(course.key);
    }

    for (const course of courses || []) {
      if (course.completed === true || course.electiveOnly === true || launched.has(course.key)) {
        continue;
      }
      if (!course.launchElement) return null;
      return course;
    }
    return null;
  }

  function courseRouteKind(value) {
    const href = String(value || '');
    if (/#\/study_center\/my_course(?:[/?]|$)/.test(href)) return 'my-course';
    if (/#\/course_detail(?:[/?]|$)/.test(href)) return 'course-detail';
    if (/#\/video_detail(?:[/?]|$)/.test(href)) return 'video-detail';
    if (/#\/video_play(?:[/?]|$)/.test(href)) return 'video-play';
    return 'other';
  }

  function courseIdFromHref(value) {
    const href = String(value || '');
    const hashIndex = href.indexOf('#');
    if (hashIndex < 0) return null;
    const hash = href.slice(hashIndex + 1);
    const questionIndex = hash.indexOf('?');
    const path = (questionIndex >= 0 ? hash.slice(0, questionIndex) : hash).replace(/\/+$/, '');
    const query = questionIndex >= 0 ? hash.slice(questionIndex + 1) : '';
    const key =
      path === '/course_detail' || path === '/video_detail'
        ? 'id'
        : path === '/video_play'
          ? 'course_id'
          : null;
    if (!key) return null;
    const values = new URLSearchParams(query).getAll(key);
    return values.length === 1 && /^\d+$/.test(values[0]) ? values[0] : null;
  }

  function createCourseQueueController(options) {
    const completionTimeoutMs = Number.isFinite(options.completionTimeoutMs)
      ? options.completionTimeoutMs
      : 90000;
    const launchTimeoutMs = Number.isFinite(options.launchTimeoutMs)
      ? options.launchTimeoutMs
      : 30000;
    const confirmTimeoutMs = Number.isFinite(options.confirmTimeoutMs)
      ? options.confirmTimeoutMs
      : 15000;
    const emptyListStableMs = Number.isFinite(options.emptyListStableMs)
      ? options.emptyListStableMs
      : 10000;
    const hasExplicitOwner = Boolean(options.ownerId);
    const ownerId = hasExplicitOwner ? String(options.ownerId) : 'single-context';
    const allowLaunchHandoff = options.allowLaunchHandoff === true;
    let enabled = options.enabled !== false;

    function now() {
      return typeof options.now === 'function' ? Number(options.now()) : Date.now();
    }

    function emptySession() {
      return {
        version: 1,
        active: false,
        ownerId,
        runId: null,
        phase: 'idle',
        activeCourseKey: null,
        launchedCourseKeys: [],
        coursePageMarkers: {},
      };
    }

    function loadSession() {
      const value = options.loadSession?.();
      if (!value || value.version !== 1) return emptySession();
      return {
        ...value,
        ownerId:
          typeof value.ownerId === 'string'
            ? value.ownerId
            : hasExplicitOwner
              ? null
              : ownerId,
        launchedCourseKeys: Array.isArray(value.launchedCourseKeys)
          ? [...new Set(value.launchedCourseKeys)]
          : [],
        coursePageMarkers:
          value.coursePageMarkers && typeof value.coursePageMarkers === 'object'
            ? { ...value.coursePageMarkers }
            : {},
      };
    }

    function saveSession(value) {
      options.saveSession?.(value);
      options.onState?.({ ...value });
      return value;
    }

    function owns(session) {
      return session?.active === true && session.ownerId === ownerId;
    }

    function sameOwnedRun(session) {
      const latest = loadSession();
      return owns(latest) && Boolean(session?.runId) && latest.runId === session.runId;
    }

    function claimBoundedLaunchHandoff(session) {
      if (!allowLaunchHandoff || session?.active !== true || session.phase !== 'launching') {
        return null;
      }
      if (session.handoffClaimedAt != null) return null;
      const launchAge = now() - Number(session.launchStartedAt || 0);
      if (launchAge < 0 || launchAge >= launchTimeoutMs) return null;
      if (courseRouteKind(session.launchSourceHref) !== 'my-course') return null;
      const sourceOwnerId = String(options.getLaunchHandoffSourceOwnerId?.() || '');
      if (!sourceOwnerId || sourceOwnerId !== session.ownerId) return null;
      const href = String(options.getHref?.() || '');
      const route = courseRouteKind(href);
      if (route !== 'course-detail' && route !== 'video-detail' && route !== 'video-play') {
        return null;
      }
      const courseId = courseIdFromHref(href);
      if (!courseId) return null;
      const expectedCourseId = session.activeCourseId || session.expectedCourseId;
      if (expectedCourseId && expectedCourseId !== courseId) return null;
      return saveSession({
        ...session,
        ownerId,
        handoffClaimedAt: now(),
        handoffFromOwnerId: session.ownerId || null,
      });
    }

    function block(session, reason) {
      saveSession({
        ...session,
        active: false,
        phase: 'blocked',
        blockedAt: now(),
        blockedReason: reason,
      });
      return { action: 'blocked', reason };
    }

    function settleScopedEmptyList(session, inspection) {
      if (inspection?.emptyCandidate !== true) {
        if (typeof session.emptyListObservedAt === 'number') {
          saveSession({ ...session, emptyListObservedAt: null });
        }
        return null;
      }
      if (
        typeof session.emptyListObservedAt !== 'number' ||
        !Number.isFinite(session.emptyListObservedAt)
      ) {
        saveSession({ ...session, emptyListObservedAt: now() });
        return { action: 'waiting-empty-list' };
      }
      if (now() - Number(session.emptyListObservedAt) < emptyListStableMs) {
        return { action: 'waiting-empty-list' };
      }
      saveSession({
        ...session,
        active: false,
        phase: 'done',
        activeCourseId: null,
        activeCourseKey: null,
        emptyListObservedAt: null,
      });
      return { action: 'done' };
    }

    function launchNext(session, inspection) {
      if (!inspection?.ready) {
        return settleScopedEmptyList(session, inspection) || { action: 'waiting-list' };
      }
      if (session.emptyListObservedAt) {
        session = saveSession({ ...session, emptyListObservedAt: null });
      }
      const courses = Array.isArray(inspection.courses) ? inspection.courses : [];
      const nextCourse = chooseNextUnfinishedCourse(courses, session.launchedCourseKeys);
      if (!nextCourse) {
        const unresolved = courses.some(
          (course) =>
            course?.completed !== true &&
            course?.electiveOnly !== true &&
            !session.launchedCourseKeys.includes(course?.key),
        );
        if (unresolved) return block(session, 'course-entry-ambiguous');
        if (inspection.paginationAmbiguous === true) {
          return block(session, 'course-pagination-ambiguous');
        }
        if (inspection.nextPageElement) {
          if (!inspection.pageMarker) {
            return block(session, 'course-pagination-marker-missing');
          }
          const pagingSession = saveSession({
            ...session,
            phase: 'paging-list',
            pageStartedAt: now(),
            previousListFingerprint:
              inspection.listFingerprint || courses.map((course) => course?.key || '').join('\n'),
            previousPageMarker: inspection.pageMarker || null,
            pendingListFingerprint: null,
            pendingListStableCount: 0,
          });
          if (!sameOwnedRun(pagingSession)) return { action: 'foreign-owner' };
          try {
            options.clickLaunch?.(inspection.nextPageElement);
          } catch (_error) {
            return block(pagingSession, 'course-page-next-failed');
          }
          return { action: 'paging-list' };
        }
        saveSession({
          ...session,
          active: false,
          phase: 'done',
          activeCourseId: null,
          activeCourseKey: null,
        });
        return { action: 'done' };
      }

      const nextSession = {
        ...session,
        phase: 'launching',
        activeCourseId: nextCourse.courseId || null,
        expectedCourseId: nextCourse.courseId || null,
        activeCourseKey: nextCourse.key,
        activeCourseTitle: nextCourse.title || '',
        launchSourceHref: String(options.getHref?.() || ''),
        launchStartedAt: now(),
        launchedCourseKeys: [...session.launchedCourseKeys, nextCourse.key],
        coursePageMarkers: {
          ...(session.coursePageMarkers || {}),
          ...(inspection.pageMarker ? { [nextCourse.key]: String(inspection.pageMarker) } : {}),
        },
        continueConfirmedFor: null,
        continueConfirmPendingFor: null,
        continueConfirmStartedAt: null,
        detailLaunchIssuedFor: null,
        detailEnteredAt: null,
        identityVerifiedFor: null,
        lastVerifiedEndAt: null,
        playbackRequestedFor: null,
      };
      const launchingSession = saveSession(nextSession);
      if (!sameOwnedRun(launchingSession)) return { action: 'foreign-owner' };
      try {
        options.clickLaunch?.(nextCourse.launchElement);
      } catch (_error) {
        return block(launchingSession, 'course-launch-failed');
      }
      return { action: 'launched', courseKey: nextCourse.key };
    }

    function scanCourseList(session) {
      const inspection = options.inspectCourseList?.() || { ready: false, courses: [] };
      if (session.phase === 'ready') return launchNext(session, inspection);
      if (session.phase === 'launching') return { action: 'waiting-navigation' };
      if (session.phase === 'paging-list') {
        const courses = Array.isArray(inspection.courses) ? inspection.courses : [];
        if (!inspection.ready || courses.length === 0) return { action: 'waiting-list-page' };
        const fingerprint =
          inspection.listFingerprint ||
          courses.map((course) => course?.key || '').join('\n');
        if (!fingerprint || fingerprint === session.previousListFingerprint) {
          return { action: 'waiting-list-page' };
        }
        if (session.pendingListFingerprint !== fingerprint) {
          saveSession({
            ...session,
            pendingListFingerprint: fingerprint,
            pendingListStableCount: 1,
          });
          return { action: 'waiting-list-page' };
        }
        if (Number(session.pendingListStableCount || 0) < 2) {
          session = saveSession({
            ...session,
            pendingListStableCount: Number(session.pendingListStableCount || 0) + 1,
          });
        }
        const currentMarker = inspection.pageMarker ? String(inspection.pageMarker) : null;
        if (!currentMarker || currentMarker === String(session.previousPageMarker || '')) {
          return { action: 'waiting-list-page' };
        }
        const launchedOnCandidatePage = courses.filter(
          (course) => course?.key && session.launchedCourseKeys.includes(course.key),
        );
        if (launchedOnCandidatePage.length > 0) {
          const reusedKey = launchedOnCandidatePage.some(
            (course) =>
              !session.coursePageMarkers?.[course.key] ||
              String(session.coursePageMarkers[course.key]) !== currentMarker,
          );
          if (reusedKey) return block(session, 'course-fingerprint-reused');
        }
        const readySession = saveSession({
          ...session,
          phase: 'ready',
          listStartedAt: now(),
          previousListFingerprint: null,
          previousPageMarker: null,
          pendingListFingerprint: null,
          pendingListStableCount: 0,
        });
        return launchNext(readySession, inspection);
      }
      if (session.phase === 'verifying-completion') {
        return { action: 'waiting-completion' };
      }
      if (session.phase === 'returning-to-list') {
        if (!inspection.ready) {
          return settleScopedEmptyList(session, inspection) || { action: 'waiting-list' };
        }
        const readySession = saveSession({
          ...session,
          phase: 'ready',
          activeCourseId: null,
          expectedCourseId: null,
          activeCourseKey: null,
          activeCourseTitle: '',
          lastVerifiedEndAt: null,
          verificationStartedAt: null,
          emptyListObservedAt: null,
        });
        return launchNext(readySession, inspection);
      }
      if (session.phase === 'in-course') {
        return block(session, 'course-left-before-completion');
      }
      return { action: 'none' };
    }

    function markInCourse(session) {
      if (session.phase === 'in-course') return session;
      return saveSession({
        ...session,
        phase: 'in-course',
        enteredCourseAt: now(),
      });
    }

    function enterCourse(session, href) {
      const courseId = courseIdFromHref(href);
      if (!courseId) return { result: block(session, 'course-id-invalid'), session: null };
      const expectedCourseId = session.activeCourseId || session.expectedCourseId;
      if (expectedCourseId && expectedCourseId !== courseId) {
        return { result: block(session, 'course-id-changed'), session: null };
      }
      if (!expectedCourseId && session.phase !== 'launching') {
        return { result: block(session, 'course-id-unbound'), session: null };
      }
      const identified = session.activeCourseId
        ? session
        : saveSession({ ...session, activeCourseId: courseId, expectedCourseId: courseId });
      return { result: null, session: markInCourse(identified) };
    }

    function validateActiveCourseIdentity(session, href, enteredAt) {
      if (typeof options.inspectActiveCourseIdentity !== 'function') {
        return { result: null, session };
      }
      if (!session.activeCourseTitle) {
        return { result: block(session, 'course-title-unbound'), session: null };
      }
      if (session.identityVerifiedFor === href) return { result: null, session };
      const inspection = options.inspectActiveCourseIdentity(href) || {
        ready: false,
        ambiguous: false,
        title: '',
      };
      if (inspection.ambiguous === true) {
        return { result: block(session, 'course-title-ambiguous'), session: null };
      }
      if (inspection.ready !== true) {
        if (now() - Number(enteredAt || 0) >= launchTimeoutMs) {
          return { result: block(session, 'course-title-timeout'), session: null };
        }
        return { result: { action: 'waiting-course-title' }, session: null };
      }
      if (
        !normalizeLabel(inspection.title) ||
        normalizeLabel(inspection.title) !== normalizeLabel(session.activeCourseTitle)
      ) {
        return { result: block(session, 'course-title-mismatch'), session: null };
      }
      return {
        result: null,
        session: saveSession({ ...session, identityVerifiedFor: href }),
      };
    }

    function scanCompletionDetail(session, href) {
      const courseId = courseIdFromHref(href);
      if (!courseId || !session.activeCourseId || courseId !== session.activeCourseId) {
        return block(session, 'completion-course-id-mismatch');
      }
      const inspection = options.inspectCourseDetail?.() || {
        ready: false,
        completed: false,
        launchElement: null,
      };
      if (!inspection.ready || inspection.completed !== true) {
        return { action: 'waiting-completion' };
      }
      const returning = saveSession({
        ...session,
        phase: 'returning-to-list',
        completionVerifiedAt: now(),
        returningStartedAt: now(),
      });
      if (!sameOwnedRun(returning)) return { action: 'foreign-owner' };
      try {
        options.returnToCourseList?.();
      } catch (_error) {
        return block(returning, 'return-to-list-failed');
      }
      return { action: 'returning-to-list' };
    }

    function scanCourseDetail(session, href) {
      if (session.phase === 'verifying-completion') {
        return scanCompletionDetail(session, href);
      }
      if (session.phase !== 'launching' && session.phase !== 'in-course') {
        return block(session, 'unexpected-course-detail');
      }
      const entered = enterCourse(session, href);
      if (entered.result) return entered.result;
      let inCourse = entered.session;
      if (!inCourse.detailEnteredAt) {
        inCourse = saveSession({ ...inCourse, detailEnteredAt: now() });
      }
      const identity = validateActiveCourseIdentity(
        inCourse,
        href,
        inCourse.detailEnteredAt,
      );
      if (identity.result) return identity.result;
      inCourse = identity.session;
      if (inCourse.detailLaunchIssuedFor === href) {
        if (now() - Number(inCourse.detailLaunchClickedAt || 0) >= launchTimeoutMs) {
          return block(inCourse, 'course-detail-navigation-timeout');
        }
        return { action: 'waiting-navigation' };
      }
      const inspection = options.inspectCourseDetail?.() || { ready: false, launchElement: null };
      if (!inspection.ready) {
        if (now() - Number(inCourse.detailEnteredAt || 0) >= launchTimeoutMs) {
          return block(inCourse, 'course-detail-timeout');
        }
        return { action: 'waiting-detail' };
      }
      if (!inspection.launchElement) return block(inCourse, 'course-detail-entry-ambiguous');

      const clickedSession = saveSession({
        ...inCourse,
        detailLaunchIssuedFor: href,
        detailLaunchClickedAt: now(),
      });
      if (!sameOwnedRun(clickedSession)) return { action: 'foreign-owner' };
      try {
        options.clickLaunch?.(inspection.launchElement);
      } catch (_error) {
        return block(clickedSession, 'course-detail-launch-failed');
      }
      return { action: 'launched-detail' };
    }

    function inspectContinueDialog() {
      const directInspection = options.inspectContinueLearningDialog?.();
      if (directInspection) return directInspection;
      const target = options.locateContinueLearningConfirm?.() || null;
      return { present: Boolean(target), target };
    }

    function scanVideo(session, href) {
      if (session.phase !== 'launching' && session.phase !== 'in-course') {
        return block(session, 'unexpected-video-route');
      }
      const entered = enterCourse(session, href);
      if (entered.result) return entered.result;
      let inCourse = entered.session;
      if (inCourse.videoEnteredFor !== href) {
        inCourse = saveSession({
          ...inCourse,
          videoEnteredFor: href,
          videoEnteredAt: now(),
        });
      }
      const identity = validateActiveCourseIdentity(inCourse, href, inCourse.videoEnteredAt);
      if (identity.result) return identity.result;
      inCourse = identity.session;
      const continueInspection = inspectContinueDialog();
      if (continueInspection.unsafe === true || continueInspection.ambiguous === true) {
        return block(inCourse, 'continue-dialog-unsafe');
      }

      if (inCourse.continueConfirmPendingFor) {
        if (inCourse.continueConfirmPendingFor !== href) {
          return block(inCourse, 'continue-confirm-route-changed');
        }
        if (continueInspection.present === true) {
          if (now() - Number(inCourse.continueConfirmStartedAt || 0) >= confirmTimeoutMs) {
            return block(inCourse, 'continue-confirm-timeout');
          }
          return { action: 'confirming-continue' };
        }
        inCourse = saveSession({
          ...inCourse,
          continueConfirmedFor: href,
          continueConfirmPendingFor: null,
          continueConfirmStartedAt: null,
          playbackRequestedFor: null,
        });
      }

      if (continueInspection.present === true) {
        if (!continueInspection.target) return block(inCourse, 'continue-dialog-ambiguous');
        const confirmingSession = saveSession({
          ...inCourse,
          continueConfirmPendingFor: href,
          continueConfirmStartedAt: now(),
          playbackRequestedFor: null,
        });
        if (!sameOwnedRun(confirmingSession)) return { action: 'foreign-owner' };
        try {
          options.clickLaunch?.(continueInspection.target);
        } catch (_error) {
          return block(confirmingSession, 'continue-confirm-failed');
        }
        return { action: 'confirming-continue' };
      }

      if (typeof options.inspectPlayback === 'function') {
        const playbackInspection = options.inspectPlayback() || {
          ready: false,
          ambiguous: false,
        };
        if (playbackInspection.ambiguous === true) {
          return block(inCourse, 'video-player-ambiguous');
        }
        if (playbackInspection.ready !== true) {
          if (now() - Number(inCourse.videoEnteredAt || 0) >= launchTimeoutMs) {
            return block(inCourse, 'video-player-timeout');
          }
          return { action: 'waiting-video' };
        }
      }

      if (inCourse.playbackRequestedFor === href) return { action: 'in-course' };
      const playbackSession = saveSession({ ...inCourse, playbackRequestedFor: href });
      if (!sameOwnedRun(playbackSession)) return { action: 'foreign-owner' };
      options.requestPlayback?.();
      return { action: 'playback-requested' };
    }

    function phaseTimedOut(session) {
      if (
        session.phase === 'launching' &&
        now() - Number(session.launchStartedAt || 0) >= launchTimeoutMs
      ) {
        return block(session, 'course-launch-timeout');
      }
      if (
        session.phase === 'ready' &&
        now() - Number(session.listStartedAt || 0) >= launchTimeoutMs
      ) {
        return block(session, 'course-list-timeout');
      }
      if (
        session.phase === 'verifying-completion' &&
        now() - Number(session.verificationStartedAt || 0) >= completionTimeoutMs
      ) {
        return block(session, 'completion-not-confirmed');
      }
      if (
        session.phase === 'returning-to-list' &&
        now() - Number(session.returningStartedAt || 0) >= launchTimeoutMs
      ) {
        return block(session, 'return-to-list-timeout');
      }
      if (
        session.phase === 'paging-list' &&
        now() - Number(session.pageStartedAt || 0) >= launchTimeoutMs
      ) {
        return block(session, 'course-page-next-timeout');
      }
      return null;
    }

    function scan() {
      if (!enabled) return { action: 'paused' };
      let session = loadSession();
      if (!session.active) return { action: 'none' };
      if (!owns(session)) {
        const claimed = claimBoundedLaunchHandoff(session);
        if (!claimed) return { action: 'foreign-owner' };
        session = claimed;
      }
      if (session.phase === 'blocked' || session.phase === 'done' || session.phase === 'idle') {
        return { action: 'none' };
      }
      const timeoutResult = phaseTimedOut(session);
      if (timeoutResult) return timeoutResult;

      const href = String(options.getHref?.() || '');
      const route = courseRouteKind(href);
      if (route === 'my-course') return scanCourseList(session);
      if (route === 'course-detail') return scanCourseDetail(session, href);
      if (route === 'video-detail' || route === 'video-play') return scanVideo(session, href);
      if (session.phase === 'launching') return { action: 'waiting-navigation' };
      if (session.phase === 'verifying-completion') return { action: 'waiting-completion' };
      if (session.phase === 'returning-to-list') return { action: 'waiting-list' };
      if (session.phase === 'paging-list') return { action: 'waiting-list-page' };
      return block(session, 'course-route-left');
    }

    function start() {
      if (!enabled || courseRouteKind(options.getHref?.()) !== 'my-course') {
        return { action: enabled ? 'wrong-route' : 'paused' };
      }
      const currentSession = loadSession();
      if (currentSession.active && currentSession.ownerId !== ownerId) {
        return { action: 'foreign-owner' };
      }
      if (owns(currentSession)) return { action: 'already-active' };

      const session = saveSession({
        version: 1,
        active: true,
        ownerId,
        runId: options.createRunId?.() || String(now()),
        phase: 'ready',
        listStartedAt: now(),
        activeCourseId: null,
        activeCourseKey: null,
        activeCourseTitle: '',
        launchedCourseKeys: [],
        coursePageMarkers: {},
        startedAt: now(),
      });
      return launchNext(session, options.inspectCourseList?.() || { ready: false, courses: [] });
    }

    function beginCompletionVerification() {
      if (!enabled) return { action: 'paused' };
      const session = loadSession();
      if (!owns(session) || session.phase !== 'in-course') return { action: 'none' };
      if (
        typeof session.lastVerifiedEndAt !== 'number' ||
        !Number.isFinite(session.lastVerifiedEndAt)
      ) {
        return block(session, 'completion-without-verified-end');
      }
      if (!session.activeCourseId) return block(session, 'completion-course-id-missing');
      const verifying = saveSession({
        ...session,
        phase: 'verifying-completion',
        verificationStartedAt: now(),
      });
      if (!sameOwnedRun(verifying)) return { action: 'foreign-owner' };
      try {
        options.goToCourseCompletionCheck?.(session.activeCourseId);
      } catch (_error) {
        return block(verifying, 'completion-check-navigation-failed');
      }
      return { action: 'verifying-completion' };
    }

    function noteVerifiedMediaEnd() {
      const session = loadSession();
      if (!owns(session) || session.phase !== 'in-course') return { action: 'none' };
      saveSession({ ...session, lastVerifiedEndAt: now() });
      return { action: 'recorded-end' };
    }

    function stop() {
      const session = loadSession();
      if (session.active === true && !owns(session)) return { action: 'foreign-owner' };
      saveSession({
        ...session,
        active: false,
        ownerId,
        phase: 'idle',
        activeCourseId: null,
        activeCourseKey: null,
        stoppedAt: now(),
      });
      return { action: 'stopped' };
    }

    function stopWithReason(reason) {
      const session = loadSession();
      if (!owns(session)) return { action: session.active ? 'foreign-owner' : 'none' };
      return block(session, String(reason || 'runtime-safety-stop'));
    }

    return {
      beginCompletionVerification,
      getSession: loadSession,
      isActive: () => owns(loadSession()),
      noteVerifiedMediaEnd,
      reportCourseTerminal: beginCompletionVerification,
      scan,
      setEnabled: (value) => {
        enabled = Boolean(value);
      },
      start,
      stop,
      stopWithReason,
    };
  }

  function bindMediaElement(media, controller) {
    if (!media || typeof media.addEventListener !== 'function') return false;
    if (boundMediaElements.has(media)) return false;

    boundMediaElements.add(media);
    const clearObservedProgress = () => observedMediaProgress.delete(media);
    media.addEventListener('emptied', clearObservedProgress, true);
    media.addEventListener('loadstart', clearObservedProgress, true);
    media.addEventListener(
      'play',
      () => {
        const currentTime = Number(media.currentTime);
        if (Number.isFinite(currentTime) && currentTime < 2) clearObservedProgress();
      },
      true,
    );
    media.addEventListener('timeupdate', () => observeMediaProgress(media), true);
    media.addEventListener(
      'ended',
      () => {
        observeMediaProgress(media);
        controller.handleMediaEnded(media, verifiedMediaEndSnapshot(media));
      },
      true,
    );
    return true;
  }

  function isElementVisible(element, ownerDocument) {
    if (!element || element.isConnected === false) return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;

    const view = ownerDocument?.defaultView;
    for (let current = element; current; current = current.parentElement) {
      if (current.hidden === true) return false;
      const style = view?.getComputedStyle?.(current);
      if (!style) continue;
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number.parseFloat(style.opacity) === 0
      ) {
        return false;
      }
    }
    return true;
  }

  function describeElement(element, ownerDocument) {
    return {
      element,
      text: element.innerText || element.textContent || '',
      ariaLabel: element.getAttribute?.('aria-label'),
      title: element.getAttribute?.('title'),
      ariaDisabled: element.getAttribute?.('aria-disabled'),
      disabled: element.disabled === true,
      contextText:
        element.closest?.('li, [class*="chapter"], [class*="section"], [class*="lesson"]')
          ?.textContent || '',
      href: element.getAttribute?.('href'),
      role: element.getAttribute?.('role'),
      tagName: element.tagName,
      visible: isElementVisible(element, ownerDocument),
    };
  }

  function isExactProgressComplete(progress) {
    if (!progress || progress.getAttribute?.('aria-valuemax') !== '100') return false;
    if (Number(progress.getAttribute?.('aria-valuenow')) !== 100) return false;
    const width = String(progress.querySelector?.('.el-progress-bar__inner')?.style?.width || '').trim();
    const text = String(progress.querySelector?.('.el-progress__text')?.textContent || '').trim();
    return /^100(?:\.0+)?%$/.test(width) && /^100(?:\.0+)?%$/.test(text);
  }

  function isCourseUiComplete(scope) {
    return isExactProgressComplete(
      scope?.querySelector?.('.foter .el-progress[role="progressbar"]'),
    );
  }

  function isCourseDetailComplete(ownerDocument) {
    const visibleProgress = Array.from(
      ownerDocument?.querySelectorAll?.(
        '.center_header .foter .el-progress[role="progressbar"]',
      ) || [],
    ).filter((progress) => isElementVisible(progress, ownerDocument));
    if (visibleProgress.length !== 1) return false;
    const progress = visibleProgress[0];
    const bar = progress.querySelector?.('.el-progress-bar__inner');
    const text = progress.querySelector?.('.el-progress__text');
    return (
      isElementVisible(bar, ownerDocument) &&
      isElementVisible(text, ownerDocument) &&
      isExactProgressComplete(progress)
    );
  }

  function courseIdFromCourseCard(card) {
    const ids = [];
    for (const attribute of ['data-course-id', 'data-courseid']) {
      const value = String(card?.getAttribute?.(attribute) || '');
      if (/^\d+$/.test(value)) ids.push(value);
    }
    const links =
      card?.querySelectorAll?.('a[href*="#/course_detail"], a[href*="#/video_"]') || [];
    for (const link of links) {
      const value = courseIdFromHref(link.getAttribute?.('href'));
      if (value) ids.push(value);
    }
    const uniqueIds = [...new Set(ids)];
    return uniqueIds.length === 1 ? uniqueIds[0] : null;
  }

  function describeCourseCard(card, ownerDocument) {
    const title = String(card?.querySelector?.('.course_list_right_title')?.textContent || '').trim();
    const lecturer = String(
      card?.querySelector?.('.course_list_right_person > .name')?.textContent || '',
    ).trim();
    const learningHour = String(
      card?.querySelector?.('.course_list_right_state > .state > span')?.textContent || '',
    ).trim();
    const timer = String(card?.querySelector?.('.timer')?.textContent || '').trim();
    const actionElements = Array.from(
      card?.querySelectorAll?.('.SaveButton > .Save') || [],
    );
    const candidates = actionElements.map((element) => describeElement(element, ownerDocument));
    const normalizedActionLabels = candidates.flatMap((candidate) =>
      [candidate.text, candidate.ariaLabel, candidate.title].map(normalizeLabel).filter(Boolean),
    );
    const electiveOnly =
      !normalizedActionLabels.includes('开始学习') && normalizedActionLabels.includes('我要选课');

    return {
      card,
      completed: isCourseUiComplete(card),
      courseId: courseIdFromCourseCard(card),
      electiveOnly,
      key: title
        ? [title, lecturer, learningHour, timer].map(normalizeLabel).join('|')
        : null,
      launchElement: chooseCourseLaunchCandidate(candidates),
      title,
    };
  }

  function inspectCourseListDocument(ownerDocument) {
    try {
      const header = normalizeLabel(ownerDocument?.querySelector?.('.top_header')?.textContent);
      if (header !== '未完成课程') return { ready: false, courses: [] };
      const listContainer = ownerDocument?.querySelector?.('ul.course') || null;
      const cardElements = Array.from(
        listContainer?.querySelectorAll?.('li.course_list') ||
          ownerDocument?.querySelectorAll?.('li.course_list') ||
          [],
      );
      const cards = cardElements.map((card) => describeCourseCard(card, ownerDocument));
      if (cards.length === 0) {
        const visibleLoadingMask = Array.from(
          ownerDocument?.querySelectorAll?.('.el-loading-mask') || [],
        ).some((element) => isElementVisible(element, ownerDocument));
        const countStates = Array.from(
          ownerDocument?.querySelectorAll?.(
            '.content_right > .optional .optional_left > .state.fl',
          ) || [],
        );
        const courseCountState = countStates[0] || null;
        const countSpan =
          courseCountState?.querySelector?.(':scope > span') ||
          courseCountState?.querySelector?.('span') ||
          null;
        const visibleEmptyMessages = Array.from(
          ownerDocument?.querySelectorAll?.('.content_right > .van-noText') || [],
        ).filter(
          (element) =>
            isElementVisible(element, ownerDocument) &&
            normalizeLabel(element.textContent) === '暂无课程信息',
        );
        const zeroCountConfirmed =
          isElementVisible(courseCountState, ownerDocument) &&
          normalizeLabel(courseCountState.textContent) === '共0门课程' &&
          normalizeLabel(countSpan?.textContent) === '0';
        const emptyScaffoldPresent =
          Boolean(listContainer) || countStates.length > 0 || visibleEmptyMessages.length > 0;
        if (!emptyScaffoldPresent) return { ready: false, courses: [] };
        return {
          ready: false,
          courses: [],
          emptyCandidate:
            zeroCountConfirmed &&
            visibleEmptyMessages.length === 1 &&
            !ownerDocument?.querySelector?.('.content_right > .content_course') &&
            !visibleLoadingMask,
        };
      }
      const nextPageCandidates = Array.from(
        ownerDocument?.querySelectorAll?.('.el-pagination .btn-next') || [],
      ).filter(
        (element) =>
          isElementVisible(element, ownerDocument) &&
          element.disabled !== true &&
          String(element.getAttribute?.('aria-disabled')) !== 'true' &&
          !element.classList?.contains?.('disabled') &&
          !element.classList?.contains?.('is-disabled'),
      );
      const activePage = normalizeLabel(
        ownerDocument?.querySelector?.('.el-pagination .number.active')?.textContent,
      );
      return {
        ready: true,
        courses: cards,
        listFingerprint: cards.map((course) => course.key || '').join('\n'),
        nextPageElement: nextPageCandidates.length === 1 ? nextPageCandidates[0] : null,
        pageMarker: activePage || null,
        paginationAmbiguous: nextPageCandidates.length > 1,
      };
    } catch (_error) {
      return { ready: false, courses: [] };
    }
  }

  function inspectCourseDetailDocument(ownerDocument) {
    try {
      const elements = Array.from(ownerDocument?.querySelectorAll?.('.select_course') || []);
      const candidates = elements.map((element) => describeElement(element, ownerDocument));
      const visibleProgress = Array.from(
        ownerDocument?.querySelectorAll?.(
          '.center_header .foter .el-progress[role="progressbar"]',
        ) || [],
      ).filter((progress) => isElementVisible(progress, ownerDocument));
      return {
        ready: visibleProgress.length <= 1 && (elements.length > 0 || visibleProgress.length === 1),
        completed: isCourseDetailComplete(ownerDocument),
        launchElement: chooseCourseLaunchCandidate(candidates),
      };
    } catch (_error) {
      return { ready: false, completed: false, launchElement: null };
    }
  }

  function inspectContinueLearningDialogsInDocuments(documents) {
    const matches = [];
    const unsafeWords = /测验|测试|考试|答题|问答|练习|作业|quiz|exam|exercise|question/i;
    let unsafe = false;
    let ambiguous = false;
    for (const ownerDocument of documents || []) {
      try {
        for (const dialog of ownerDocument.querySelectorAll('.el-dialog')) {
          if (!isElementVisible(dialog, ownerDocument)) continue;
          const dialogText = normalizeLabel(dialog.textContent);
          if (unsafeWords.test(dialogText)) {
            unsafe = true;
            continue;
          }
          const titleText = normalizeLabel(
            dialog.querySelector?.('.el-dialog__title')?.textContent,
          );
          const bodyText = normalizeLabel(dialog.querySelector?.('.el-dialog__body')?.textContent);
          const mentionsContinue = /是否继续学习/.test(titleText + bodyText + dialogText);
          if (!mentionsContinue) continue;
          if (titleText !== '是否继续学习' && bodyText !== '是否继续学习') {
            unsafe = true;
            continue;
          }
          const buttons = Array.from(dialog.querySelectorAll('button, [role="button"]')).filter(
            (button) =>
              isElementVisible(button, ownerDocument) &&
              button.disabled !== true &&
              String(button.getAttribute?.('aria-disabled')) !== 'true' &&
              normalizeLabel(button.innerText || button.textContent) === '确定',
          );
          if (buttons.length !== 1) {
            ambiguous = true;
            continue;
          }
          matches.push(buttons[0]);
        }
      } catch (_error) {
        // Ignore documents being replaced while the dialog is rendered.
      }
    }
    if (matches.length > 1) ambiguous = true;
    return {
      ambiguous,
      present: unsafe || ambiguous || matches.length > 0,
      target: !unsafe && !ambiguous && matches.length === 1 ? matches[0] : null,
      unsafe,
    };
  }

  function findContinueLearningConfirmInDocuments(documents) {
    return inspectContinueLearningDialogsInDocuments(documents).target;
  }

  function findNextElementInDocuments(documents) {
    const candidates = [];
    for (const ownerDocument of documents || []) {
      try {
        const elements = ownerDocument.querySelectorAll(
          'button, a[href], [role="button"]',
        );
        for (const element of elements) {
          candidates.push(describeElement(element, ownerDocument));
        }
      } catch (_error) {
        // Ignore transient or cross-origin document access failures.
      }
    }
    return chooseNextCandidate(candidates);
  }

  function collectAccessibleDocuments(rootDocument) {
    const documents = [];
    const seen = new Set();

    function visit(ownerDocument) {
      if (!ownerDocument || seen.has(ownerDocument)) return;
      seen.add(ownerDocument);
      documents.push(ownerDocument);
      try {
        for (const frame of ownerDocument.querySelectorAll('iframe')) {
          visit(frame.contentDocument);
        }
      } catch (_error) {
        // Cross-origin frames are intentionally left untouched.
      }
    }

    visit(rootDocument);
    return documents;
  }

  function scanAndBindMedia(documents, controller) {
    let boundCount = 0;
    for (const ownerDocument of documents || []) {
      try {
        for (const media of ownerDocument.querySelectorAll('video')) {
          if (bindMediaElement(media, controller)) boundCount += 1;
        }
      } catch (_error) {
        // Ignore documents that are being replaced during route changes.
      }
    }
    return boundCount;
  }

  function inspectPlaybackInDocuments(documents) {
    const visibleMedia = [];
    for (const ownerDocument of documents || []) {
      try {
        for (const media of ownerDocument.querySelectorAll('video')) {
          if (typeof media.play === 'function' && isElementVisible(media, ownerDocument)) {
            visibleMedia.push(media);
          }
        }
      } catch (_error) {
        // A replacing or cross-origin document is not counted as a playable course video.
      }
    }
    return {
      ambiguous: visibleMedia.length > 1,
      ready: visibleMedia.length === 1,
    };
  }

  function inspectActiveCourseIdentityInDocuments(documents, href) {
    const route = courseRouteKind(href);
    const selector =
      route === 'course-detail'
        ? '.center_header .course_title'
        : route === 'video-detail' || route === 'video-play'
          ? '.video_center > .wrapper > p.title'
          : null;
    if (!selector) return { ready: false, ambiguous: false, title: '' };
    const matches = [];
    for (const ownerDocument of documents || []) {
      try {
        for (const element of ownerDocument.querySelectorAll(selector)) {
          const title = String(element.textContent || '').trim();
          if (title && isElementVisible(element, ownerDocument)) matches.push(title);
        }
      } catch (_error) {
        // A replacing or cross-origin document cannot verify the active course identity.
      }
    }
    return {
      ready: matches.length === 1,
      ambiguous: matches.length > 1,
      title: matches.length === 1 ? matches[0] : '',
    };
  }

  function createPageRuntime(options) {
    const pageWindow = options.window;
    const rootDocument = options.document;
    const allowNextClick = options.allowNextClick === true;
    let cycleOrigin = null;
    let autoStartPending = false;
    let initialPlaybackPending = false;
    let enabled = options.enabled !== false;
    let settleGeneration = 0;

    function isAutomationAuthorized() {
      return enabled && (options.isAutomationAuthorized?.() ?? true) === true;
    }

    function mediaSource(media) {
      return String(media?.currentSrc || media?.src || '');
    }

    function isSupportedVideoRoute() {
      return /#\/(?:video_detail|video_play)(?:[/?]|$)/.test(String(pageWindow.location.href));
    }

    function documents() {
      return collectAccessibleDocuments(rootDocument);
    }

    function isUniqueCourseMedia(media) {
      if (options.requireUniqueMedia !== true) return true;
      const visibleMedia = [];
      for (const ownerDocument of documents()) {
        try {
          for (const candidate of ownerDocument.querySelectorAll('video')) {
            if (isElementVisible(candidate, ownerDocument)) visibleMedia.push(candidate);
          }
        } catch (_error) {
          // Ignore a transient frame replacement and fail closed below.
        }
      }
      if (visibleMedia.length === 1 && visibleMedia[0] === media) return true;
      options.onMediaAmbiguous?.();
      return false;
    }

    function frameElementFor(ownerDocument) {
      try {
        return ownerDocument?.defaultView?.frameElement || null;
      } catch (_error) {
        return null;
      }
    }

    function resolvedCycleDocument() {
      if (!cycleOrigin) return rootDocument;
      if (cycleOrigin.frameElement) {
        try {
          return cycleOrigin.frameElement.contentDocument || cycleOrigin.document;
        } catch (_error) {
          return cycleOrigin.document;
        }
      }
      return cycleOrigin.document || rootDocument;
    }

    function cycleDocuments() {
      return [resolvedCycleDocument()];
    }

    function collectPlayableMedia(ownerDocuments, predicate = () => true) {
      const playableMedia = [];
      for (const ownerDocument of ownerDocuments || []) {
        try {
          for (const media of ownerDocument.querySelectorAll('video')) {
            if (
              typeof media.play === 'function' &&
              !media.ended &&
              isElementVisible(media, ownerDocument) &&
              predicate(media)
            ) {
              playableMedia.push(media);
            }
          }
        } catch (_error) {
          // Ignore a document that is being replaced and fail closed for this scan.
        }
      }
      return playableMedia;
    }

    function playUniqueMedia(playableMedia) {
      if (playableMedia.length > 1) {
        options.onPlaybackAmbiguous?.();
        return 'ambiguous';
      }
      if (playableMedia.length === 0) return 'waiting';
      try {
        const media = playableMedia[0];
        media.muted = true;
        const playResult = media.play();
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(() => options.onAutoPlayBlocked?.());
        }
      } catch (_error) {
        options.onAutoPlayBlocked?.();
      }
      return 'played';
    }

    const controller = createAdvanceController({
      enabled,
      isAuthorized: isAutomationAuthorized,
      locateNext: () =>
        allowNextClick ? findNextElementInDocuments(cycleDocuments()) : null,
      clickNext: (target) => {
        if (!allowNextClick) throw new Error('next-click-disabled');
        target.click();
      },
      hasAdvanced: () =>
        Boolean(
          cycleOrigin &&
            (pageWindow.location.href !== cycleOrigin.href ||
              resolvedCycleDocument() !== cycleOrigin.document ||
              cycleOrigin.media.isConnected === false ||
              mediaSource(cycleOrigin.media) !== cycleOrigin.source),
        ),
      maxAttempts: options.maxAttempts,
      onAdvanced: () => {
        autoStartPending = isAutomationAuthorized() && options.autoPlay !== false;
        if (typeof options.onAdvanced === 'function') options.onAdvanced();
      },
      onState: options.onState,
      retryDelays: options.retryDelays,
      schedule: (callback, delay) => pageWindow.setTimeout(callback, delay),
    });

    const endedController = {
      handleMediaEnded(media, verificationMedia = media) {
        if (!isAutomationAuthorized()) return;
        if (!isSupportedVideoRoute()) return;
        if (!isUniqueCourseMedia(media)) return;
        if (!isVerifiedMediaEnd(verificationMedia)) return;
        const originDocument = media.ownerDocument || rootDocument;
        const capturedOrigin = {
          document: originDocument,
          frameElement: frameElementFor(originDocument),
          href: pageWindow.location.href,
          media,
          source: mediaSource(media),
        };
        const verifiedEnd = {
          ended: true,
          currentTime: Number(verificationMedia.currentTime),
          duration: Number(verificationMedia.duration),
        };
        const capturedGeneration = settleGeneration;
        options.onVerifiedMediaEnd?.(media);
        pageWindow.setTimeout(() => {
          if (capturedGeneration !== settleGeneration) return;
          if (!isAutomationAuthorized()) return;
          cycleOrigin = capturedOrigin;
          controller.handleMediaEnded(
            media,
            `${capturedOrigin.href}|${capturedOrigin.source}`,
            verifiedEnd,
          );
        }, Number.isFinite(options.endedSettleDelayMs) ? options.endedSettleDelayMs : 1000);
      },
    };

    function scan() {
      const accessibleDocuments = documents();
      const boundCount = scanAndBindMedia(accessibleDocuments, endedController);

      if (!isAutomationAuthorized()) {
        autoStartPending = false;
        initialPlaybackPending = false;
        controller.cancelPending();
        return boundCount;
      }

      if (initialPlaybackPending) {
        const playResult = playUniqueMedia(collectPlayableMedia(accessibleDocuments));
        if (playResult !== 'waiting') {
          initialPlaybackPending = false;
        }
      }

      if (autoStartPending) {
        const playbackDocument = resolvedCycleDocument();
        const playbackDocuments = accessibleDocuments.filter(
          (ownerDocument) => ownerDocument === playbackDocument,
        );
        const playableMedia = collectPlayableMedia(
          playbackDocuments,
          (media) => media !== cycleOrigin?.media || mediaSource(media) !== cycleOrigin?.source,
        );
        const playResult = playUniqueMedia(playableMedia);
        if (playResult !== 'waiting') {
          autoStartPending = false;
        }
      }

      return boundCount;
    }

    function rescanAndRetry() {
      const boundCount = scan();
      return { boundCount, retried: isAutomationAuthorized() && controller.retryLastEnded() };
    }

    function cancelAutomation() {
      settleGeneration += 1;
      autoStartPending = false;
      initialPlaybackPending = false;
      controller.cancelPending();
    }

    return {
      cancelAutomation,
      controller,
      requestPlayback: () => {
        if (isAutomationAuthorized() && isSupportedVideoRoute()) initialPlaybackPending = true;
      },
      rescanAndRetry,
      scan,
      setEnabled: (value) => {
        enabled = Boolean(value);
        if (!enabled) {
          settleGeneration += 1;
          autoStartPending = false;
          initialPlaybackPending = false;
        }
        controller.setEnabled(enabled);
      },
    };
  }

  function createControlPanel(options) {
    const ownerDocument = options.document;
    const root = ownerDocument.createElement('section');
    root.id = 'lngbzx-auto-next-panel';
    root.style.cssText = [
      'position:fixed',
      'right:18px',
      'bottom:18px',
      'z-index:2147483647',
      'width:290px',
      'box-sizing:border-box',
      'padding:14px',
      'border:1px solid rgba(15,23,42,.16)',
      'border-radius:12px',
      'background:rgba(255,255,255,.97)',
      'box-shadow:0 12px 32px rgba(15,23,42,.22)',
      'color:#0f172a',
      'font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');

    const title = ownerDocument.createElement('strong');
    title.textContent = '合规连续学习';
    title.style.cssText = 'display:block;margin-bottom:6px;font-size:14px';

    const statusElement = ownerDocument.createElement('div');
    statusElement.textContent = '状态：等待播放器';
    statusElement.style.cssText = 'min-height:40px;color:#334155;word-break:break-word';

    const note = ownerDocument.createElement('div');
    note.textContent = '手动启动一次；仅按真实视频结束推进，不修改学习进度。';
    note.style.cssText = 'margin:6px 0 10px;color:#64748b;font-size:12px';

    const actions = ownerDocument.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';

    const toggleButton = ownerDocument.createElement('button');
    toggleButton.type = 'button';
    toggleButton.style.cssText =
      'flex:1;min-width:120px;padding:7px 9px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer';

    const rescanButton = ownerDocument.createElement('button');
    rescanButton.type = 'button';
    rescanButton.textContent = '重新检测';
    rescanButton.style.cssText =
      'padding:7px 9px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;cursor:pointer';

    const queueButton = ownerDocument.createElement('button');
    queueButton.type = 'button';
    queueButton.style.cssText =
      'width:100%;padding:8px 9px;border:0;border-radius:8px;background:#b91c1c;color:#fff;cursor:pointer';

    let enabled = options.enabled !== false;
    let queueActive = options.queueActive === true;

    function renderToggle() {
      toggleButton.textContent = enabled ? '课程内推进：开启' : '课程内推进：暂停';
      toggleButton.style.background = enabled ? '#2563eb' : '#64748b';
    }

    function renderQueue() {
      queueButton.textContent = queueActive ? '停止连续学习' : '开始连续学习';
      queueButton.style.background = queueActive ? '#64748b' : '#b91c1c';
    }

    function updateStatus(state) {
      const attempts = Number(state?.attempts || 0);
      const messages = {
        advanced: '状态：已进入下一节，等待播放器',
        idle: '状态：等待视频正常播放结束',
        paused: '状态：课程内自动推进已暂停',
        stopped: `状态：未确认进入新视频（核验 ${attempts} 次），准备核验课程详情`,
        verifying: `状态：等待确认平台是否已切到下一节（第 ${attempts} 次）`,
        waiting: `状态：等待平台自动切到下一节（第 ${attempts} 次检测）`,
      };
      const nextText = messages[state?.phase] || '状态：等待播放器';
      if (statusElement.textContent !== nextText) statusElement.textContent = nextText;
    }

    function updateQueueStatus(state) {
      const titleText = state?.activeCourseTitle ? `“${state.activeCourseTitle}”` : '当前课程';
      const blockedMessages = {
        'completion-not-confirmed': '平台未在限定时间内明确显示当前课程 100%',
        'completion-check-navigation-failed': '无法打开课程完成核验页，已停止',
        'completion-course-id-mismatch': '完成核验页的课程 ID 不一致，已停止',
        'continue-confirm-failed': '继续学习确认失败，请手动处理',
        'continue-confirm-timeout': '继续学习弹窗点击后未消失，已停止',
        'continue-dialog-unsafe': '检测到测验或不明确弹窗，已停止',
        'course-detail-entry-ambiguous': '课程详情入口不明确，已停止',
        'course-detail-launch-failed': '课程详情“开始学习”点击失败，已停止',
        'course-detail-navigation-timeout': '点击“开始学习”后服务器未打开播放器，已停止',
        'course-detail-timeout': '课程详情未在限定时间内加载，已停止',
        'course-entry-ambiguous': '课程列表入口不明确，已停止',
        'course-fingerprint-reused': '课程列表存在无法唯一区分的重复课程，已停止',
        'course-id-changed': '打开的课程 ID 与当前队列不一致，已停止',
        'course-id-invalid': '当前课程页面缺少有效课程 ID，已停止',
        'course-list-timeout': '未完成课程列表未在限定时间内加载，已停止',
        'course-launch-failed': '课程启动失败，已停止',
        'course-launch-timeout': '课程页面未能打开，已停止',
        'course-page-next-timeout': '课程列表翻页未生效，已停止',
        'course-pagination-ambiguous': '无法唯一识别分页“下一页”，已停止',
        'course-pagination-marker-missing': '课程列表页码不明确，已停止',
        'course-title-ambiguous': '无法唯一识别当前课程标题，已停止',
        'course-title-mismatch': '当前页面课程标题与队列不一致，已停止',
        'course-title-timeout': '当前课程标题未在限定时间内加载，已停止',
        'course-title-unbound': '课程列表标题缺失，无法安全绑定，已停止',
        'return-to-list-failed': '无法返回我的课程，请手动返回',
        'return-to-list-timeout': '返回我的课程超时，已停止',
        'video-player-ambiguous': '检测到多个可见播放器，已停止',
        'video-player-timeout': '课程播放器未在限定时间内出现，已停止',
      };
      const messages = {
        blocked: `状态：${blockedMessages[state?.blockedReason] || '连续学习已停止，请手动检查'}`,
        done: '状态：当前未完成课程列表已处理完',
        'in-course': `状态：正在学习${titleText}`,
        launching: `状态：正在打开${titleText}`,
        'paging-list': '状态：正在切换课程列表下一页',
        ready: '状态：准备启动下一门未完成课程',
        'returning-to-list': '状态：课程已明确完成，正在返回“我的课程”',
        'verifying-completion': `状态：正在课程详情核验${titleText}是否为 100%`,
      };
      if (messages[state?.phase] && statusElement.textContent !== messages[state.phase]) {
        statusElement.textContent = messages[state.phase];
      }
    }

    function setEnabled(value) {
      enabled = Boolean(value);
      renderToggle();
      if (!enabled) updateStatus({ phase: 'paused', attempts: 0 });
    }

    toggleButton.addEventListener('click', () => {
      setEnabled(!enabled);
      options.onToggle(enabled);
    });
    rescanButton.addEventListener('click', () => options.onRescan());
    queueButton.addEventListener('click', () => {
      queueActive = !queueActive;
      renderQueue();
      options.onQueueToggle?.(queueActive);
    });

    renderToggle();
    renderQueue();
    actions.append(queueButton, toggleButton, rescanButton);
    root.append(title, statusElement, note, actions);
    ownerDocument.body.append(root);

    return {
      root,
      queueButton,
      setEnabled,
      setQueueActive: (value) => {
        queueActive = Boolean(value);
        renderQueue();
      },
      statusElement,
      toggleButton,
      updateQueueStatus,
      updateStatus,
    };
  }

  function bootstrapBrowserPage(options) {
    const pageWindow = options.window;
    const ownerDocument = options.document;
    if (pageWindow.__lngbzxAutoNextApp) {
      pageWindow.__lngbzxAutoNextApp.ensurePanelMounted?.();
      return pageWindow.__lngbzxAutoNextApp;
    }

    const settingKey = 'lngbzx-auto-next-enabled';
    const queueSessionKey = 'lngbzx-course-queue-v2';
    const getValue = options.getValue || ((_key, fallback) => fallback);
    const setValue = options.setValue || (() => {});
    const enabled = Boolean(getValue(settingKey, true));
    let runtime;
    let courseQueue;
    let scanQueued = false;
    function createToken() {
      return (
        pageWindow.crypto?.randomUUID?.() ||
        Date.now() + '-' + Math.random().toString(36).slice(2)
      );
    }

    function getTabOwnerId() {
      if (options.ownerId) return String(options.ownerId);
      if (pageWindow.__lngbzxCourseQueueOwnerId) return pageWindow.__lngbzxCourseQueueOwnerId;
      const value = createToken();
      pageWindow.__lngbzxCourseQueueOwnerId = value;
      return value;
    }

    const tabOwnerId = getTabOwnerId();
    const savedQueue = getValue(queueSessionKey, null);

    const panel = createControlPanel({
      document: ownerDocument,
      enabled,
      queueActive:
        savedQueue?.version === 1 &&
        savedQueue?.active === true &&
        savedQueue?.ownerId === tabOwnerId,
      onQueueToggle: (active) => {
        if (!courseQueue) return;
        if (active) {
          const result = courseQueue.start();
          if (
            result.action === 'wrong-route' ||
            result.action === 'paused' ||
            result.action === 'foreign-owner'
          ) {
            panel.setQueueActive(false);
            panel.statusElement.textContent =
              result.action === 'wrong-route'
                ? '状态：请先进入“我的课程”的未完成课程列表'
                : result.action === 'foreign-owner'
                  ? '状态：另一标签页正在连续学习；请在原标签页停止后再试'
                  : '状态：请先开启课程内推进';
          }
        } else {
          courseQueue.stop();
          runtime?.cancelAutomation();
        }
      },
      onRescan: () => {
        courseQueue?.scan();
        runtime?.rescanAndRetry();
      },
      onToggle: (nextEnabled) => {
        runtime?.setEnabled(nextEnabled);
        courseQueue?.setEnabled(nextEnabled);
        setValue(settingKey, nextEnabled);
      },
    });
    panel.root.setAttribute?.('data-queue-owner-id', tabOwnerId);
    panel.root.__lngbzxQueueOwnerId = tabOwnerId;

    function ensurePanelMounted() {
      const body = ownerDocument.body;
      if (!body) return false;
      const alreadyMounted =
        panel.root.isConnected === true ||
        panel.root.parentNode === body ||
        body.contains?.(panel.root) === true ||
        body.children?.includes?.(panel.root) === true;
      if (!alreadyMounted) body.append(panel.root);
      return true;
    }

    function runScan() {
      ensurePanelMounted();
      courseQueue?.scan();
      if (courseQueue?.isActive() !== true) runtime?.cancelAutomation();
      runtime?.scan();
      panel.setQueueActive(courseQueue?.isActive() === true);
      const session = courseQueue?.getSession();
      if (session?.active === true && courseQueue?.isActive() !== true) {
        panel.statusElement.textContent = '状态：另一标签页正在连续学习';
      } else {
        panel.updateQueueStatus(session);
      }
    }

    function queueScan() {
      if (scanQueued) return;
      scanQueued = true;
      pageWindow.setTimeout(() => {
        scanQueued = false;
        runScan();
      }, 100);
    }

    runtime = createPageRuntime({
      window: pageWindow,
      document: ownerDocument,
      allowNextClick: true,
      endedSettleDelayMs: 350,
      enabled,
      autoPlay: true,
      isAutomationAuthorized: () => courseQueue?.isActive() === true,
      requireUniqueMedia: true,
      onAdvanced: queueScan,
      onAutoPlayBlocked: () => {
        panel.statusElement.textContent = '状态：已进入下一节，请手动点击播放（浏览器阻止了自动播放）';
      },
      onPlaybackAmbiguous: () => {
        courseQueue?.stopWithReason('video-player-ambiguous');
      },
      onMediaAmbiguous: () => {
        courseQueue?.stopWithReason('video-player-ambiguous');
      },
      onState: (state) => {
        panel.updateStatus(state);
        if (state?.phase === 'stopped' && courseQueue?.isActive()) {
          courseQueue.beginCompletionVerification();
        }
      },
      onVerifiedMediaEnd: () => courseQueue?.noteVerifiedMediaEnd(),
    });

    courseQueue = createCourseQueueController({
      allowLaunchHandoff: true,
      clickLaunch: (target) => target.click(),
      createRunId: () =>
        pageWindow.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2),
      enabled,
      getHref: () => pageWindow.location.href,
      getLaunchHandoffSourceOwnerId: () => {
        try {
          const openerPanel = pageWindow.opener?.document?.getElementById?.(
            'lngbzx-auto-next-panel',
          );
          return (
            openerPanel?.getAttribute?.('data-queue-owner-id') ||
            openerPanel?.__lngbzxQueueOwnerId ||
            null
          );
        } catch (_error) {
          return null;
        }
      },
      inspectCourseDetail: () => inspectCourseDetailDocument(ownerDocument),
      inspectCourseList: () => inspectCourseListDocument(ownerDocument),
      inspectActiveCourseIdentity: (href) =>
        inspectActiveCourseIdentityInDocuments(
          collectAccessibleDocuments(ownerDocument),
          href,
        ),
      inspectPlayback: () =>
        inspectPlaybackInDocuments(collectAccessibleDocuments(ownerDocument)),
      loadSession: () => getValue(queueSessionKey, null),
      inspectContinueLearningDialog: () =>
        inspectContinueLearningDialogsInDocuments(collectAccessibleDocuments(ownerDocument)),
      goToCourseCompletionCheck: (courseId) => {
        pageWindow.location.hash =
          '#/course_detail?id=' + encodeURIComponent(courseId) + '&typeInfo=1';
      },
      onState: (state) => {
        if (state?.active !== true) runtime?.cancelAutomation();
        panel.setQueueActive(state?.active === true);
        panel.updateQueueStatus(state);
      },
      ownerId: tabOwnerId,
      requestPlayback: () => runtime.requestPlayback(),
      returnToCourseList: () => {
        pageWindow.location.hash = '#/study_center/my_course';
      },
      saveSession: (value) => setValue(queueSessionKey, value),
    });

    panel.updateStatus({ phase: enabled ? 'idle' : 'paused', attempts: 0 });
    runScan();

    const MutationObserverClass = options.MutationObserver || pageWindow.MutationObserver;
    const observer = MutationObserverClass
      ? new MutationObserverClass((records) => {
          const mutations = Array.from(records || []);
          const onlyPanelMutations =
            mutations.length > 0 &&
            mutations.every(
              (record) =>
                record?.target === panel.root || panel.root.contains?.(record?.target) === true,
            );
          if (!onlyPanelMutations) queueScan();
        })
      : { disconnect() {}, observe() {} };
    observer.observe(ownerDocument.documentElement, { childList: true, subtree: true });

    const intervalId = pageWindow.setInterval(runScan, 3000);
    const releaseQueueOwnership = () => {
      if (courseQueue?.isActive() === true) courseQueue.stop();
      runtime?.cancelAutomation();
    };
    pageWindow.addEventListener?.('pagehide', releaseQueueOwnership);
    const app = {
      courseQueue,
      ensurePanelMounted,
      panel,
      runtime,
      destroy() {
        observer.disconnect();
        pageWindow.clearInterval(intervalId);
        pageWindow.removeEventListener?.('pagehide', releaseQueueOwnership);
        releaseQueueOwnership();
        courseQueue.setEnabled(false);
        runtime.setEnabled(false);
      },
    };
    pageWindow.__lngbzxAutoNextApp = app;
    return app;
  }

  function createAdvanceController(options) {
    const maxAttempts = Number.isInteger(options.maxAttempts) ? options.maxAttempts : 6;
    const retryDelays = options.retryDelays || [1500, 3000, 6000, 12000, 20000, 30000];
    const state = { phase: 'idle', attempts: 0 };
    const handledMedia = new WeakMap();
    let enabled = options.enabled !== false;
    let cycleId = 0;
    let clickIssued = false;
    let lastEndedMedia = null;

    function setPhase(phase) {
      state.phase = phase;
      if (typeof options.onState === 'function') options.onState({ ...state });
    }

    function scheduleRetry() {
      const delayIndex = Math.min(state.attempts - 1, retryDelays.length - 1);
      const scheduledCycle = cycleId;
      options.schedule(() => {
        if (scheduledCycle !== cycleId) return;
        attemptAdvance();
      }, retryDelays[delayIndex]);
    }

    function attemptAdvance() {
      if (state.phase === 'advanced') return;

      if (typeof options.isAuthorized === 'function' && options.isAuthorized() !== true) {
        cancelPending();
        return;
      }

      if (!enabled) {
        setPhase('paused');
        return;
      }

      if (options.hasAdvanced()) {
        setPhase('advanced');
        if (typeof options.onAdvanced === 'function') options.onAdvanced();
        return;
      }

      if (state.attempts >= maxAttempts) {
        setPhase('stopped');
        return;
      }

      state.attempts += 1;

      if (clickIssued) {
        if (state.attempts >= maxAttempts) {
          setPhase('stopped');
          return;
        }
        setPhase('verifying');
        scheduleRetry();
        return;
      }

      const target = options.locateNext();
      if (!target) {
        if (state.attempts >= maxAttempts) {
          setPhase('stopped');
          return;
        }
        setPhase('waiting');
        scheduleRetry();
        return;
      }

      try {
        options.clickNext(target);
        clickIssued = true;
        if (options.hasAdvanced()) {
          setPhase('advanced');
          if (typeof options.onAdvanced === 'function') options.onAdvanced();
          return;
        }
        setPhase('verifying');
        scheduleRetry();
      } catch (_error) {
        if (state.attempts >= maxAttempts) {
          setPhase('stopped');
          return;
        }
        setPhase('waiting');
        scheduleRetry();
      }
    }

    function handleMediaEnded(media, mediaIdentity = media, verificationMedia = media) {
      if (!enabled) return;
      if (!isVerifiedMediaEnd(verificationMedia)) return;
      if (handledMedia.get(media) === mediaIdentity) return;

      handledMedia.set(media, mediaIdentity);
      lastEndedMedia = verificationMedia;
      cycleId += 1;
      clickIssued = false;
      state.phase = 'idle';
      state.attempts = 0;
      attemptAdvance();
    }

    function retryLastEnded() {
      if (!enabled || state.phase !== 'stopped' || !isVerifiedMediaEnd(lastEndedMedia)) return false;

      cycleId += 1;
      clickIssued = false;
      state.phase = 'idle';
      state.attempts = 0;
      attemptAdvance();
      return true;
    }

    function setEnabled(value) {
      enabled = Boolean(value);
      cycleId += 1;
      if (enabled) state.attempts = 0;
      setPhase(enabled ? 'idle' : 'paused');
    }

    function cancelPending() {
      const nextPhase = enabled ? 'idle' : 'paused';
      const changed =
        state.phase !== nextPhase ||
        state.attempts !== 0 ||
        clickIssued === true ||
        lastEndedMedia !== null;
      cycleId += 1;
      clickIssued = false;
      lastEndedMedia = null;
      state.attempts = 0;
      if (changed) setPhase(nextPhase);
      else state.phase = nextPhase;
    }

    return {
      cancelPending,
      getState: () => ({ ...state }),
      handleMediaEnded,
      retryLastEnded,
      setEnabled,
    };
  }

  return {
    bindMediaElement,
    bootstrapBrowserPage,
    chooseCourseLaunchCandidate,
    chooseNextCandidate,
    chooseNextUnfinishedCourse,
    collectAccessibleDocuments,
    createControlPanel,
    createAdvanceController,
    createCourseQueueController,
    createPageRuntime,
    courseIdFromHref,
    courseIdFromCourseCard,
    courseRouteKind,
    describeCourseCard,
    findContinueLearningConfirmInDocuments,
    findNextElementInDocuments,
    inspectCourseDetailDocument,
    inspectActiveCourseIdentityInDocuments,
    inspectCourseListDocument,
    inspectContinueLearningDialogsInDocuments,
    inspectPlaybackInDocuments,
    isCourseUiComplete,
    isVerifiedMediaEnd,
    scanAndBindMedia,
  };
});
