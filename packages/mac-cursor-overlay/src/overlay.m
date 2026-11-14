#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <QuartzCore/QuartzCore.h>
#import <dispatch/dispatch.h>
#import <math.h>
#import <stdbool.h>
#import <stdint.h>

typedef struct {
  double x;
  double y;
} OwltoPoint;

typedef struct {
  double x;
  double y;
  double width;
  double height;
} OwltoRect;

typedef struct {
  bool has_window;
  bool window_visible;
  bool cursor_visible;
  bool debug_backdrop_visible;
  int level;
  OwltoRect bounds;
  OwltoPoint cursor_position;
} OwltoOverlayState;

typedef NS_ENUM(NSInteger, OwltoOverlayLevel) {
  OwltoOverlayLevelNormal = 0,
  OwltoOverlayLevelFloating = 1,
  OwltoOverlayLevelTornOffMenu = 2,
  OwltoOverlayLevelModalPanel = 3,
  OwltoOverlayLevelMainMenu = 4,
  OwltoOverlayLevelStatus = 5,
  OwltoOverlayLevelPopUpMenu = 6,
  OwltoOverlayLevelScreenSaver = 7
};

static const CGFloat kOwltoCursorSize = 24.0;
static const CGFloat kOwltoDebugHudInset = 16.0;
static const CGFloat kOwltoCursorForwardAngle = 0.0;
static const CGPoint kOwltoCursorHotspot = { 5.0, 3.5 };
static NSString *const kOwltoClickRippleLayerName = @"owlto-click-ripple";

@interface OwltoCursorOverlayView : NSView
@end

@implementation OwltoCursorOverlayView

- (BOOL)isFlipped {
  return YES;
}

@end

@interface OwltoCursorOverlayManager : NSObject

@property(nonatomic, strong) NSPanel *window;
@property(nonatomic, strong) OwltoCursorOverlayView *view;
@property(nonatomic, strong) CALayer *rootLayer;
@property(nonatomic, strong) CALayer *debugBackdropLayer;
@property(nonatomic, strong) CATextLayer *debugTextLayer;
@property(nonatomic, strong) CAShapeLayer *cursorLayer;
@property(nonatomic, assign) NSInteger level;
@property(nonatomic, assign) CGRect bounds;
@property(nonatomic, assign) CGPoint cursorPosition;
@property(nonatomic, assign) CGFloat cursorHeading;
@property(nonatomic, assign) BOOL cursorVisible;
@property(nonatomic, assign) BOOL debugBackdropVisible;
@property(nonatomic, assign) NSInteger attachedWindowId;

+ (instancetype)sharedManager;
- (BOOL)showWithBounds:(CGRect)bounds level:(NSInteger)level;
- (BOOL)hideOverlay;
- (BOOL)setBoundsRect:(CGRect)bounds;
- (BOOL)setWindowLevel:(NSInteger)level;
- (BOOL)setAttachedWindowIdValue:(NSInteger)windowId;
- (BOOL)jumpCursorTo:(CGPoint)point;
- (BOOL)flashClickAt:(CGPoint)point;
- (void)applyCursorPoseAt:(CGPoint)point;
- (BOOL)setCursorVisibleValue:(BOOL)visible;
- (BOOL)setCursorPressedValue:(BOOL)pressed;
- (BOOL)setDebugBackdropVisible:(BOOL)visible label:(NSString *)label;
- (void)removeClickRipples;
- (OwltoOverlayState)overlayState;
- (BOOL)disposeOverlay;

@end

static void OwltoRunOnMainThreadSync(dispatch_block_t block) {
  if ([NSThread isMainThread]) {
    block();
    return;
  }
  dispatch_sync(dispatch_get_main_queue(), block);
}

static NSInteger OwltoWindowLevelForOverlayLevel(NSInteger level) {
  switch (level) {
    case OwltoOverlayLevelNormal:
      return CGWindowLevelForKey(kCGNormalWindowLevelKey);
    case OwltoOverlayLevelFloating:
      return CGWindowLevelForKey(kCGFloatingWindowLevelKey);
    case OwltoOverlayLevelTornOffMenu:
      return CGWindowLevelForKey(kCGTornOffMenuWindowLevelKey);
    case OwltoOverlayLevelModalPanel:
      return CGWindowLevelForKey(kCGModalPanelWindowLevelKey);
    case OwltoOverlayLevelMainMenu:
      return CGWindowLevelForKey(kCGMainMenuWindowLevelKey);
    case OwltoOverlayLevelStatus:
      return CGWindowLevelForKey(kCGStatusWindowLevelKey);
    case OwltoOverlayLevelPopUpMenu:
      return CGWindowLevelForKey(kCGPopUpMenuWindowLevelKey);
    case OwltoOverlayLevelScreenSaver:
      return CGWindowLevelForKey(kCGScreenSaverWindowLevelKey);
    default:
      return CGWindowLevelForKey(kCGFloatingWindowLevelKey);
  }
}

static CGPathRef OwltoCreateCursorPath(void) {
  CGMutablePathRef path = CGPathCreateMutable();
  CGPathMoveToPoint(path, NULL, 5.0, 3.5);
  CGPathAddLineToPoint(path, NULL, 5.0, 21.5);
  CGPathAddLineToPoint(path, NULL, 10.3, 16.3);
  CGPathAddLineToPoint(path, NULL, 13.35, 23.1);
  CGPathAddLineToPoint(path, NULL, 16.35, 21.75);
  CGPathAddLineToPoint(path, NULL, 13.3, 14.95);
  CGPathAddLineToPoint(path, NULL, 20.6, 14.95);
  CGPathCloseSubpath(path);
  return path;
}

static void OwltoApplyDisabledActions(void (^block)(void)) {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  block();
  [CATransaction commit];
}

static CGFloat OwltoIntersectionArea(CGRect a, CGRect b) {
  CGRect intersection = CGRectIntersection(a, b);
  if (CGRectIsNull(intersection) || CGRectIsEmpty(intersection)) {
    return 0.0;
  }
  return intersection.size.width * intersection.size.height;
}

static CGRect OwltoCocoaRectFromQuartzRect(CGRect quartzRect) {
  NSArray<NSScreen *> *screens = NSScreen.screens;
  NSScreen *bestScreen = nil;
  CGRect bestQuartzFrame = CGRectZero;
  CGFloat bestArea = 0.0;

  for (NSScreen *screen in screens) {
    NSNumber *screenNumber = screen.deviceDescription[@"NSScreenNumber"];
    if (screenNumber == nil) {
      continue;
    }
    CGDirectDisplayID displayId = (CGDirectDisplayID) screenNumber.unsignedIntValue;
    CGRect displayQuartzFrame = CGDisplayBounds(displayId);
    CGFloat area = OwltoIntersectionArea(quartzRect, displayQuartzFrame);
    if (area > bestArea) {
      bestArea = area;
      bestScreen = screen;
      bestQuartzFrame = displayQuartzFrame;
    }
  }

  if (bestScreen == nil) {
    bestScreen = NSScreen.mainScreen;
    NSNumber *screenNumber = bestScreen.deviceDescription[@"NSScreenNumber"];
    CGDirectDisplayID displayId = screenNumber != nil ? (CGDirectDisplayID) screenNumber.unsignedIntValue : CGMainDisplayID();
    bestQuartzFrame = CGDisplayBounds(displayId);
  }

  CGRect screenFrame = bestScreen.frame;
  CGFloat localX = quartzRect.origin.x - bestQuartzFrame.origin.x;
  CGFloat localTopY = quartzRect.origin.y - bestQuartzFrame.origin.y;
  return CGRectMake(
    screenFrame.origin.x + localX,
    CGRectGetMaxY(screenFrame) - localTopY - quartzRect.size.height,
    quartzRect.size.width,
    quartzRect.size.height
  );
}

@implementation OwltoCursorOverlayManager

+ (instancetype)sharedManager {
  static OwltoCursorOverlayManager *manager = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    manager = [[OwltoCursorOverlayManager alloc] init];
    manager.level = OwltoOverlayLevelFloating;
    manager.bounds = CGRectMake(0.0, 0.0, 1.0, 1.0);
    manager.cursorPosition = CGPointMake(-200.0, -200.0);
    manager.cursorHeading = kOwltoCursorForwardAngle;
    manager.attachedWindowId = 0;
  });
  return manager;
}

- (void)ensureWindowIfNeeded {
  if (self.window != nil) {
    return;
  }

  NSUInteger styleMask = NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel;
  NSPanel *window = [[NSPanel alloc]
    initWithContentRect:self.bounds
              styleMask:styleMask
                backing:NSBackingStoreBuffered
                  defer:NO];

  window.floatingPanel = YES;
  window.releasedWhenClosed = NO;
  window.hidesOnDeactivate = NO;
  window.opaque = NO;
  window.hasShadow = NO;
  window.backgroundColor = [NSColor clearColor];
  window.ignoresMouseEvents = YES;
  window.level = OwltoWindowLevelForOverlayLevel(self.level);
  window.collectionBehavior =
    NSWindowCollectionBehaviorCanJoinAllSpaces |
    NSWindowCollectionBehaviorFullScreenAuxiliary |
    NSWindowCollectionBehaviorStationary;

  OwltoCursorOverlayView *view = [[OwltoCursorOverlayView alloc] initWithFrame:window.contentView.bounds];
  view.wantsLayer = YES;
  view.layer = [CALayer layer];
  view.layer.frame = view.bounds;
  view.layer.backgroundColor = NSColor.clearColor.CGColor;
  window.contentView = view;

  CALayer *debugBackdropLayer = [CALayer layer];
  debugBackdropLayer.frame = view.bounds;
  debugBackdropLayer.backgroundColor = [NSColor colorWithSRGBRed:1.0 green:0.0 blue:0.55 alpha:0.08].CGColor;
  debugBackdropLayer.borderColor = [NSColor colorWithSRGBRed:1.0 green:0.0 blue:0.55 alpha:0.75].CGColor;
  debugBackdropLayer.borderWidth = 4.0;
  debugBackdropLayer.opacity = 0.0;
  [view.layer addSublayer:debugBackdropLayer];

  CATextLayer *debugTextLayer = [CATextLayer layer];
  debugTextLayer.frame = CGRectMake(kOwltoDebugHudInset, kOwltoDebugHudInset, 360.0, 28.0);
  debugTextLayer.foregroundColor = NSColor.whiteColor.CGColor;
  debugTextLayer.backgroundColor = [NSColor colorWithSRGBRed:0.06 green:0.09 blue:0.16 alpha:0.82].CGColor;
  debugTextLayer.cornerRadius = 8.0;
  debugTextLayer.fontSize = 12.0;
  debugTextLayer.alignmentMode = kCAAlignmentLeft;
  debugTextLayer.wrapped = NO;
  debugTextLayer.opacity = 0.0;
  debugTextLayer.contentsScale = NSScreen.mainScreen.backingScaleFactor ?: 2.0;
  debugTextLayer.string = @"Cursor Overlay Debug";
  [view.layer addSublayer:debugTextLayer];

  CAShapeLayer *cursorLayer = [CAShapeLayer layer];
  cursorLayer.bounds = CGRectMake(0.0, 0.0, kOwltoCursorSize, kOwltoCursorSize);
  cursorLayer.anchorPoint = CGPointMake(0.5, 0.5);
  cursorLayer.position = self.cursorPosition;
  cursorLayer.fillColor = [NSColor colorWithSRGBRed:0.02 green:0.02 blue:0.02 alpha:1.0].CGColor;
  cursorLayer.strokeColor = NSColor.whiteColor.CGColor;
  cursorLayer.lineWidth = 2.0;
  cursorLayer.lineJoin = kCALineJoinRound;
  cursorLayer.lineCap = kCALineCapRound;
  cursorLayer.shadowColor = [NSColor colorWithSRGBRed:0.06 green:0.09 blue:0.16 alpha:1.0].CGColor;
  cursorLayer.shadowOpacity = 0.24;
  cursorLayer.shadowRadius = 8.0;
  cursorLayer.shadowOffset = CGSizeMake(0.0, 3.0);
  cursorLayer.opacity = self.cursorVisible ? 1.0 : 0.0;

  CGPathRef cursorPath = OwltoCreateCursorPath();
  cursorLayer.path = cursorPath;
  CGPathRelease(cursorPath);
  [view.layer addSublayer:cursorLayer];

  self.window = window;
  self.view = view;
  self.rootLayer = view.layer;
  self.debugBackdropLayer = debugBackdropLayer;
  self.debugTextLayer = debugTextLayer;
  self.cursorLayer = cursorLayer;

  [window orderOut:nil];
}

- (void)applyBounds:(CGRect)bounds {
  self.bounds = bounds;
  [self ensureWindowIfNeeded];
  CGRect windowFrame = OwltoCocoaRectFromQuartzRect(bounds);
  OwltoApplyDisabledActions(^{
    [self removeClickRipples];
    [self.window setFrame:windowFrame display:NO];
    self.view.frame = CGRectMake(0.0, 0.0, bounds.size.width, bounds.size.height);
    self.rootLayer.frame = self.view.bounds;
    self.debugBackdropLayer.frame = self.view.bounds;
    self.debugTextLayer.frame = CGRectMake(kOwltoDebugHudInset, kOwltoDebugHudInset, 360.0, 28.0);
  });
}

- (void)applyLevel:(NSInteger)level {
  self.level = level;
  [self ensureWindowIfNeeded];
  NSInteger effectiveLevel = self.attachedWindowId > 0 ? OwltoOverlayLevelNormal : level;
  self.window.floatingPanel = self.attachedWindowId <= 0;
  self.window.level = OwltoWindowLevelForOverlayLevel(effectiveLevel);
}

- (BOOL)showWithBounds:(CGRect)bounds level:(NSInteger)level {
  [self applyBounds:bounds];
  [self applyLevel:level];
  if (self.attachedWindowId > 0) {
    [self.window orderWindow:NSWindowAbove relativeTo:self.attachedWindowId];
  } else {
    [self.window orderFrontRegardless];
  }
  return YES;
}

- (BOOL)hideOverlay {
  [self.window orderOut:nil];
  return YES;
}

- (BOOL)setBoundsRect:(CGRect)bounds {
  [self applyBounds:bounds];
  return YES;
}

- (BOOL)setWindowLevel:(NSInteger)level {
  [self applyLevel:level];
  return YES;
}

- (BOOL)setAttachedWindowIdValue:(NSInteger)windowId {
  self.attachedWindowId = windowId > 0 ? windowId : 0;
  [self applyLevel:self.level];
  if (self.window.visible && self.attachedWindowId > 0) {
    [self.window orderWindow:NSWindowAbove relativeTo:self.attachedWindowId];
  }
  return YES;
}

- (void)applyCursorPoseAt:(CGPoint)point {
  [self ensureWindowIfNeeded];
  self.cursorPosition = point;
  self.cursorVisible = YES;
  CGFloat rotation = self.cursorHeading - kOwltoCursorForwardAngle;
  CGPoint center = CGPointMake(kOwltoCursorSize / 2.0, kOwltoCursorSize / 2.0);
  CGPoint hotspotFromCenter = CGPointMake(kOwltoCursorHotspot.x - center.x, kOwltoCursorHotspot.y - center.y);
  CGFloat cosRotation = cos(rotation);
  CGFloat sinRotation = sin(rotation);
  CGPoint rotatedHotspotFromCenter = CGPointMake(
    hotspotFromCenter.x * cosRotation - hotspotFromCenter.y * sinRotation,
    hotspotFromCenter.x * sinRotation + hotspotFromCenter.y * cosRotation
  );
  CGPoint layerPosition = CGPointMake(
    point.x - rotatedHotspotFromCenter.x,
    point.y - rotatedHotspotFromCenter.y
  );
  OwltoApplyDisabledActions(^{
    self.cursorLayer.position = layerPosition;
    self.cursorLayer.transform = CATransform3DMakeRotation(rotation, 0.0, 0.0, 1.0);
    self.cursorLayer.opacity = 1.0;
  });
}

- (BOOL)jumpCursorTo:(CGPoint)point {
  self.cursorHeading = kOwltoCursorForwardAngle;
  [self applyCursorPoseAt:point];
  return YES;
}

- (void)spawnRippleAt:(CGPoint)point scale:(CGFloat)scale duration:(CFTimeInterval)duration opacity:(CGFloat)opacity lineWidth:(CGFloat)lineWidth {
  [self ensureWindowIfNeeded];

  CAShapeLayer *rippleLayer = [CAShapeLayer layer];
  rippleLayer.name = kOwltoClickRippleLayerName;
  rippleLayer.bounds = CGRectMake(0.0, 0.0, 24.0, 24.0);
  rippleLayer.position = point;
  rippleLayer.fillColor = [NSColor colorWithSRGBRed:0.02 green:0.02 blue:0.02 alpha:opacity * 0.25].CGColor;
  rippleLayer.strokeColor = [NSColor colorWithSRGBRed:0.02 green:0.02 blue:0.02 alpha:opacity].CGColor;
  rippleLayer.lineWidth = lineWidth;
  CGPathRef ripplePath = CGPathCreateWithEllipseInRect(rippleLayer.bounds, NULL);
  rippleLayer.path = ripplePath;
  CGPathRelease(ripplePath);
  [self.rootLayer addSublayer:rippleLayer];

  CABasicAnimation *scaleAnimation = [CABasicAnimation animationWithKeyPath:@"transform.scale"];
  scaleAnimation.fromValue = @(0.2);
  scaleAnimation.toValue = @(scale);
  scaleAnimation.duration = duration;
  scaleAnimation.removedOnCompletion = YES;

  CABasicAnimation *opacityAnimation = [CABasicAnimation animationWithKeyPath:@"opacity"];
  opacityAnimation.fromValue = @(opacity);
  opacityAnimation.toValue = @(0.0);
  opacityAnimation.duration = duration;
  opacityAnimation.removedOnCompletion = YES;

  [rippleLayer addAnimation:scaleAnimation forKey:@"transform.scale"];
  [rippleLayer addAnimation:opacityAnimation forKey:@"opacity"];

  dispatch_after(
    dispatch_time(DISPATCH_TIME_NOW, (int64_t)((duration + 0.08) * NSEC_PER_SEC)),
    dispatch_get_main_queue(),
    ^{
      [rippleLayer removeFromSuperlayer];
    }
  );
}

- (void)removeClickRipples {
  NSArray<CALayer *> *sublayers = [self.rootLayer.sublayers copy];
  for (CALayer *layer in sublayers) {
    if ([layer.name isEqualToString:kOwltoClickRippleLayerName]) {
      [layer removeFromSuperlayer];
    }
  }
}

- (void)animateCursorPulse {
  [self ensureWindowIfNeeded];
  CAKeyframeAnimation *pulse = [CAKeyframeAnimation animationWithKeyPath:@"transform.scale"];
  pulse.values = @[ @1.0, @0.8, @1.0 ];
  pulse.keyTimes = @[ @0.0, @0.35, @1.0 ];
  pulse.duration = 0.24;
  pulse.removedOnCompletion = YES;
  [self.cursorLayer addAnimation:pulse forKey:@"press"];
}

- (BOOL)flashClickAt:(CGPoint)point {
  [self jumpCursorTo:point];
  [self animateCursorPulse];
  [self spawnRippleAt:point scale:4.0 duration:0.70 opacity:0.95 lineWidth:2.0];
  [self spawnRippleAt:point scale:1.6 duration:0.42 opacity:0.95 lineWidth:1.5];
  return YES;
}

- (BOOL)setCursorVisibleValue:(BOOL)visible {
  [self ensureWindowIfNeeded];
  self.cursorVisible = visible;
  OwltoApplyDisabledActions(^{
    self.cursorLayer.opacity = visible ? 1.0 : 0.0;
  });
  return YES;
}

- (BOOL)setCursorPressedValue:(BOOL)pressed {
  [self ensureWindowIfNeeded];
  if (pressed) {
    [self animateCursorPulse];
    return YES;
  }
  [self.cursorLayer removeAnimationForKey:@"press"];
  OwltoApplyDisabledActions(^{
    self.cursorLayer.transform = CATransform3DMakeRotation(
      self.cursorHeading - kOwltoCursorForwardAngle,
      0.0,
      0.0,
      1.0
    );
  });
  return YES;
}

- (BOOL)setDebugBackdropVisible:(BOOL)visible label:(NSString *)label {
  [self ensureWindowIfNeeded];
  self.debugBackdropVisible = visible;
  if (label.length > 0) {
    self.debugTextLayer.string = label;
  }
  [CATransaction begin];
  [CATransaction setAnimationDuration:0.12];
  self.debugBackdropLayer.opacity = visible ? 1.0 : 0.0;
  self.debugTextLayer.opacity = visible ? 1.0 : 0.0;
  [CATransaction commit];
  return YES;
}

- (OwltoOverlayState)overlayState {
  OwltoOverlayState state;
  state.has_window = self.window != nil;
  state.window_visible = self.window != nil ? self.window.visible : false;
  state.cursor_visible = self.cursorVisible;
  state.debug_backdrop_visible = self.debugBackdropVisible;
  state.level = (int) self.level;
  state.bounds = (OwltoRect){ self.bounds.origin.x, self.bounds.origin.y, self.bounds.size.width, self.bounds.size.height };
  state.cursor_position = (OwltoPoint){ self.cursorPosition.x, self.cursorPosition.y };
  return state;
}

- (BOOL)disposeOverlay {
  if (self.window != nil) {
    [self.window orderOut:nil];
    [self.window close];
  }
  self.window = nil;
  self.view = nil;
  self.rootLayer = nil;
  self.debugBackdropLayer = nil;
  self.debugTextLayer = nil;
  self.cursorLayer = nil;
  self.cursorPosition = CGPointMake(-200.0, -200.0);
  self.cursorHeading = kOwltoCursorForwardAngle;
  self.cursorVisible = NO;
  self.debugBackdropVisible = NO;
  return YES;
}

@end

bool owlto_cursor_overlay_show(OwltoRect bounds, int level) {
  __block BOOL success = YES;
  OwltoRunOnMainThreadSync(^{
    success = [[OwltoCursorOverlayManager sharedManager]
      showWithBounds:CGRectMake(bounds.x, bounds.y, bounds.width, bounds.height)
              level:level];
  });
  return success;
}

bool owlto_cursor_overlay_hide(void) {
  __block BOOL success = YES;
  OwltoRunOnMainThreadSync(^{
    success = [[OwltoCursorOverlayManager sharedManager] hideOverlay];
  });
  return success;
}

bool owlto_cursor_overlay_set_bounds(OwltoRect bounds) {
  __block BOOL success = YES;
  OwltoRunOnMainThreadSync(^{
    success = [[OwltoCursorOverlayManager sharedManager]
      setBoundsRect:CGRectMake(bounds.x, bounds.y, bounds.width, bounds.height)];
  });
  return success;
}

bool owlto_cursor_overlay_set_level(int level) {
  __block BOOL success = YES;
  OwltoRunOnMainThreadSync(^{
    success = [[OwltoCursorOverlayManager sharedManager] setWindowLevel:level];
  });
  return success;
}

bool owlto_cursor_overlay_set_attached_window_id(uint32_t window_id) {
  __block BOOL success = YES;
  OwltoRunOnMainThreadSync(^{
    success = [[OwltoCursorOverlayManager sharedManager] setAttachedWindowIdValue:(NSInteger) window_id];
  });
  return success;
}

bool owlto_cursor_overlay_jump_cursor(OwltoPoint point) {
  __block BOOL success = YES;
  OwltoRunOnMainThreadSync(^{
    success = [[OwltoCursorOverlayManager sharedManager] jumpCursorTo:CGPointMake(point.x, point.y)];
  });
  return success;
}

bool owlto_cursor_overlay_flash_click(OwltoPoint point) {
  __block BOOL success = YES;
  OwltoRunOnMainThreadSync(^{
    success = [[OwltoCursorOverlayManager sharedManager] flashClickAt:CGPointMake(point.x, point.y)];
  });
  return success;
}

bool owlto_cursor_overlay_set_cursor_visible(bool visible) {
  __block BOOL success = YES;
  OwltoRunOnMainThreadSync(^{
    success = [[OwltoCursorOverlayManager sharedManager] setCursorVisibleValue:visible];
  });
  return success;
}

bool owlto_cursor_overlay_set_cursor_pressed(bool pressed) {
  __block BOOL success = YES;
  OwltoRunOnMainThreadSync(^{
    success = [[OwltoCursorOverlayManager sharedManager] setCursorPressedValue:pressed];
  });
  return success;
}

bool owlto_cursor_overlay_set_debug_backdrop(bool visible, const char *label) {
  __block BOOL success = YES;
  OwltoRunOnMainThreadSync(^{
    NSString *message = label != NULL ? [NSString stringWithUTF8String:label] : nil;
    success = [[OwltoCursorOverlayManager sharedManager] setDebugBackdropVisible:visible label:message];
  });
  return success;
}

OwltoOverlayState owlto_cursor_overlay_get_state(void) {
  __block OwltoOverlayState state = { 0 };
  OwltoRunOnMainThreadSync(^{
    state = [[OwltoCursorOverlayManager sharedManager] overlayState];
  });
  return state;
}

bool owlto_cursor_overlay_dispose(void) {
  __block BOOL success = YES;
  OwltoRunOnMainThreadSync(^{
    success = [[OwltoCursorOverlayManager sharedManager] disposeOverlay];
  });
  return success;
}
