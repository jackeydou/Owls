import assert from 'node:assert/strict'
import test from 'node:test'

const messageParts = await import(
  `${new URL('../../src/shared/message-parts.ts', import.meta.url).href}?ts=${Date.now()}`
)
const browserAnnotation = await import(
  `${new URL('../../src/shared/browser-annotation.ts', import.meta.url).href}?ts=${Date.now()}`
)

function browserCommentPart(overrides = {}) {
  return {
    id: 'part_1',
    type: 'comment',
    commentId: 'comment_1',
    origin: 'browser',
    title: 'Browser comment',
    preview: 'Fix the CTA',
    content: [{ content_type: 'text', text: 'Fix the CTA' }],
    localBrowserContext: {
      pageUrl: 'https://example.test/page',
      pageTitle: 'Example Page'
    },
    ...overrides
  }
}

function artifactCommentPart(overrides = {}) {
  return {
    id: 'part_artifact',
    type: 'comment',
    commentId: 'comment_artifact',
    origin: 'artifact',
    title: 'Artifact comment',
    preview: 'Adjust this range',
    content: [{ content_type: 'text', text: 'Adjust this range' }],
    localArtifactAnnotationContext: {
      annotationId: 'comment_artifact',
      artifactKind: 'workbook',
      path: 'analysis.xlsx',
      label: 2,
      target: {
        type: 'workbook-range',
        sheetName: 'Summary',
        range: 'B2:D8'
      }
    },
    ...overrides
  }
}

test('browser comment parts preserve page titles in model projection', () => {
  const part = messageParts.normalizeMessagePart(browserCommentPart())

  assert.equal(part?.type, 'comment')
  assert.equal(part.localBrowserContext.pageTitle, 'Example Page')
  assert.match(messageParts.formatCommentAttachmentForModel(part), /Page title: Example Page/)
})

test('browser comment parts preserve frame and scroll anchor metadata', () => {
  const part = messageParts.normalizeMessagePart(
    browserCommentPart({
      localBrowserContext: {
        pageUrl: 'https://example.test/page',
        framePath: ['iframe#preview', 'iframe[aria-label="result"]'],
        frameUrl: 'https://example.test/frame',
        isFixed: true,
        scrollContainers: [
          {
            selector: 'div.scroller',
            scrollLeft: 12,
            scrollTop: 34
          }
        ]
      }
    })
  )

  assert.equal(part?.type, 'comment')
  assert.deepEqual(part.localBrowserContext.framePath, [
    'iframe#preview',
    'iframe[aria-label="result"]'
  ])
  assert.equal(part.localBrowserContext.frameUrl, 'https://example.test/frame')
  assert.equal(part.localBrowserContext.isFixed, true)
  assert.deepEqual(part.localBrowserContext.scrollContainers, [
    {
      selector: 'div.scroller',
      scrollLeft: 12,
      scrollTop: 34
    }
  ])

  const modelProjection = messageParts.formatCommentAttachmentForModel(part)
  assert.match(modelProjection, /Frame path: iframe#preview\.iframe\[aria-label="result"\]/)
  assert.match(modelProjection, /Anchor positioning: fixed/)
  assert.match(modelProjection, /Scroll containers: div\.scroller\(12,34\)/)
})

test('browser comment parts convert to committed annotations for runtime sync', () => {
  const part = messageParts.normalizeMessagePart(
    browserCommentPart({
      commentId: 'comment_browser_1',
      content: [{ content_type: 'text', text: 'Fix this browser element' }],
      localBrowserContext: {
        pageUrl: 'https://example.test/page',
        pageTitle: 'Example Page',
        targetSelector: 'button.primary',
        targetPath: 'main > button'
      },
      localBrowserCommentMetadata: {
        kind: 'element',
        markerViewportPoint: { x: 40, y: 50 },
        viewportSize: { width: 1280, height: 720 }
      },
      localBrowserScreenshot: {
        path: '/tmp/comment.png',
        mimeType: 'image/png',
        width: 400,
        height: 300,
        commentId: 'comment_browser_1',
        annotationViewportRect: { x: 20, y: 30, width: 80, height: 40 }
      }
    })
  )

  const committed = browserAnnotation.browserCommentPartToCommittedAnnotation(part, 3)

  assert.deepEqual(committed, {
    annotationId: 'comment_browser_1',
    label: 3,
    comment: 'Fix this browser element',
    anchor: {
      kind: 'element',
      pageUrl: 'https://example.test/page',
      title: 'Example Page',
      framePath: undefined,
      frameUrl: undefined,
      selector: 'button.primary',
      targetPath: 'main > button',
      targetRole: undefined,
      targetName: undefined,
      targetDescription: undefined,
      targetImmediateText: undefined,
      nearbyText: undefined,
      documentContext: undefined,
      isFixed: undefined,
      scrollContainers: undefined,
      viewportPoint: { x: 40, y: 50 },
      viewportRect: { x: 20, y: 30, width: 80, height: 40 },
      viewportSize: { width: 1280, height: 720 }
    }
  })
})

test('browser comment runtime sync drops legacy numeric frame paths', () => {
  const part = messageParts.normalizeMessagePart(
    browserCommentPart({
      localBrowserContext: {
        pageUrl: 'https://example.test/page',
        framePath: [0, 1]
      },
      localBrowserCommentMetadata: {
        kind: 'element',
        markerViewportPoint: { x: 40, y: 50 },
        viewportSize: { width: 1280, height: 720 }
      }
    })
  )

  const committed = browserAnnotation.browserCommentPartToCommittedAnnotation(part, 1)

  assert.equal(committed?.anchor.framePath, undefined)
})

test('artifact annotation comments normalize and project target context', () => {
  const part = messageParts.normalizeMessagePart(artifactCommentPart())

  assert.equal(part?.type, 'comment')
  assert.equal(part.origin, 'artifact')
  assert.deepEqual(part.localArtifactAnnotationContext, {
    annotationId: 'comment_artifact',
    artifactKind: 'workbook',
    path: 'analysis.xlsx',
    label: 2,
    target: {
      type: 'workbook-range',
      sheetName: 'Summary',
      range: 'B2:D8'
    }
  })
  const modelProjection = messageParts.formatCommentAttachmentForModel(part)
  assert.match(modelProjection, /Artifact: analysis\.xlsx \(kind=workbook\)/)
  assert.match(modelProjection, /Target: workbook-range range=B2:D8 sheet=Summary/)
})

test('artifact annotation comments reject malformed targets', () => {
  assert.equal(
    messageParts.normalizeMessagePart(
      artifactCommentPart({
        localArtifactAnnotationContext: {
          annotationId: 'comment_artifact',
          artifactKind: 'workbook',
          path: 'analysis.xlsx',
          target: {
            type: 'workbook-range',
            range: ''
          }
        }
      })
    ),
    null
  )
})

test('artifact annotation comments drop invalid label and slide indexes', () => {
  const part = messageParts.normalizeMessagePart(
    artifactCommentPart({
      localArtifactAnnotationContext: {
        annotationId: 'comment_artifact',
        artifactKind: 'presentation',
        path: 'slides.pptx',
        label: -1,
        target: {
          type: 'presentation-region',
          slideIndex: 1.5,
          rect: { x: 10, y: 20, width: 100, height: 80 }
        }
      }
    })
  )

  assert.equal(part?.type, 'comment')
  assert.equal(part.localArtifactAnnotationContext.label, undefined)
  assert.equal(part.localArtifactAnnotationContext.target.slideIndex, undefined)
})

test('browser comment screenshot normalization strips unsafe fields and rewrites comment ids', () => {
  const part = messageParts.normalizeMessagePart(
    browserCommentPart({
      localBrowserScreenshot: {
        path: '/tmp/comment.png',
        mimeType: 'image/png',
        width: 800,
        height: 600,
        commentId: 'stale_comment_id',
        cropViewportRect: { x: 0, y: 10, width: 400, height: 300 },
        cropPaddingPx: 96,
        data: 'data:image/png;base64,AAAA'
      }
    })
  )

  assert.equal(part?.type, 'comment')
  assert.equal(part.localBrowserScreenshot.commentId, 'comment_1')
  assert.deepEqual(part.localBrowserScreenshot.cropViewportRect, {
    x: 0,
    y: 10,
    width: 400,
    height: 300
  })
  assert.equal(part.localBrowserScreenshot.cropPaddingPx, 96)
  assert.equal('data' in part.localBrowserScreenshot, false)
})

test('comment screenshot normalization drops non-positive dimensions', () => {
  const part = messageParts.normalizeMessagePart(
    browserCommentPart({
      localBrowserScreenshot: {
        path: '/tmp/comment.png',
        mimeType: 'image/png',
        width: 0,
        height: 600,
        commentId: 'comment_1'
      }
    })
  )

  assert.equal(part?.type, 'comment')
  assert.equal(part.localBrowserScreenshot, undefined)
})

test('browser annotation submission requires positive viewport dimensions', () => {
  const valid = {
    annotationId: 'annotation_1',
    comment: 'Fix the CTA',
    anchor: {
      kind: 'element',
      pageUrl: 'https://example.test/page',
      viewportPoint: { x: 12, y: 24 },
      viewportSize: { width: 1280, height: 720 },
      viewportRect: { x: 10, y: 20, width: 100, height: 40 }
    }
  }

  assert.ok(browserAnnotation.parseBrowserAnnotationSubmission(valid))
  assert.equal(
    browserAnnotation.parseBrowserAnnotationSubmission({
      ...valid,
      anchor: {
        ...valid.anchor,
        viewportSize: { width: 0, height: 720 }
      }
    }),
    null
  )

  const withoutInvalidRect = browserAnnotation.parseBrowserAnnotationSubmission({
    ...valid,
    anchor: {
      ...valid.anchor,
      viewportRect: { x: 10, y: 20, width: -1, height: 40 }
    }
  })
  assert.equal(withoutInvalidRect?.anchor.viewportRect, undefined)
})

test('browser annotation submission preserves replay metadata', () => {
  const parsed = browserAnnotation.parseBrowserAnnotationSubmission({
    annotationId: 'annotation_1',
    comment: 'Fix the CTA',
    anchor: {
      kind: 'element',
      pageUrl: 'https://example.test/page',
      framePath: ['iframe#preview'],
      frameUrl: 'https://example.test/frame',
      isFixed: true,
      scrollContainers: [
        {
          selector: 'div.scroller',
          scrollLeft: 10,
          scrollTop: 20
        }
      ],
      viewportPoint: { x: 12, y: 24 },
      viewportSize: { width: 1280, height: 720 }
    }
  })

  assert.deepEqual(parsed?.anchor.framePath, ['iframe#preview'])
  assert.equal(parsed?.anchor.frameUrl, 'https://example.test/frame')
  assert.equal(parsed?.anchor.isFixed, true)
  assert.deepEqual(parsed?.anchor.scrollContainers, [
    {
      selector: 'div.scroller',
      scrollLeft: 10,
      scrollTop: 20
    }
  ])
})

test('browser annotation draft parser accepts anchors without comment text', () => {
  const parsed = browserAnnotation.parseBrowserAnnotationDraft({
    annotationId: 'annotation_1',
    anchor: {
      kind: 'region',
      pageUrl: 'https://example.test/page',
      framePath: ['iframe#preview'],
      viewportPoint: { x: 12, y: 24 },
      viewportRect: { x: 10, y: 20, width: 100, height: 40 },
      viewportSize: { width: 1280, height: 720 }
    }
  })

  assert.equal(parsed?.annotationId, 'annotation_1')
  assert.equal(parsed?.anchor.kind, 'region')
  assert.deepEqual(parsed?.anchor.framePath, ['iframe#preview'])
  assert.deepEqual(parsed?.anchor.viewportRect, { x: 10, y: 20, width: 100, height: 40 })
})

test('browser annotation URL matching follows Codex hash-tolerant behavior', () => {
  assert.equal(
    browserAnnotation.browserAnnotationUrlsMatch(
      'https://example.test/page?q=1#before',
      'https://example.test/page?q=1#after'
    ),
    true
  )
  assert.equal(
    browserAnnotation.browserAnnotationUrlsMatch(
      'https://example.test/page?q=1',
      'https://example.test/page?q=2'
    ),
    false
  )
  assert.equal(
    browserAnnotation.browserAnnotationUrlsMatch(
      'file:///tmp/owlto.html#before',
      'file:///tmp/owlto.html#after'
    ),
    true
  )
})

test('browser annotation compact screenshot rect clamps to viewport', () => {
  assert.deepEqual(
    browserAnnotation.browserAnnotationCompactScreenshotRect(
      { x: 20, y: 40, width: 100, height: 60 },
      { width: 500, height: 400 },
      50
    ),
    { x: 0, y: 0, width: 170, height: 150 }
  )
  assert.deepEqual(
    browserAnnotation.browserAnnotationCompactScreenshotRect(
      { x: 430, y: 360, width: 100, height: 80 },
      { width: 500, height: 400 },
      50
    ),
    { x: 380, y: 310, width: 120, height: 90 }
  )
  assert.equal(
    browserAnnotation.browserAnnotationCompactScreenshotRect(undefined, {
      width: 500,
      height: 400
    }),
    undefined
  )
})
