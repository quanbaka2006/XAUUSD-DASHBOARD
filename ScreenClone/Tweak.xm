#import <UIKit/UIKit.h>
#import <objc/message.h>
#import "SCOverlayManager.h"

static BOOL scHomePressed = NO;
static BOOL scVolumeDownPressed = NO;
static BOOL scChordActive = NO;
static CFAbsoluteTime scLastHomePress = 0;
static CFAbsoluteTime scLastVolumeDown = 0;
static CFAbsoluteTime scLastVolumeUp = 0;

static BOOL SCUsesHomeGestureDevice(void) {
    for (UIWindow *window in UIApplication.sharedApplication.windows) {
        if (window.safeAreaInsets.bottom > 0) return YES;
    }
    return NO;
}

static void SCResetChordState(void) {
    scChordActive = NO;
    scHomePressed = NO;
    scVolumeDownPressed = NO;
    scLastHomePress = 0;
    scLastVolumeDown = 0;
    scLastVolumeUp = 0;
}

static void SCHideVolumeHUD(void) {
    id springBoard = UIApplication.sharedApplication;
    SEL volumeControlSelector = NSSelectorFromString(@"volumeControl");
    if (![springBoard respondsToSelector:volumeControlSelector]) return;
    id volumeControl = ((id (*)(id, SEL))objc_msgSend)(springBoard, volumeControlSelector);
    SEL hideSelector = NSSelectorFromString(@"hideVolumeHUDIfVisible");
    if ([volumeControl respondsToSelector:hideSelector]) {
        ((void (*)(id, SEL))objc_msgSend)(volumeControl, hideSelector);
    }
}

static void SCActivateIfNeeded(void) {
    if (scChordActive) return;
    scChordActive = YES;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
        [[SCOverlayManager sharedManager] activateCapture];
    });
}

static void SCObserveMetaTraderTabTap(UIEvent *event) {
    NSString *bundleID = NSBundle.mainBundle.bundleIdentifier.lowercaseString;
    if (![bundleID containsString:@"metaquotes"] ||
        ![bundleID containsString:@"metatrader5"] ||
        event.type != UIEventTypeTouches) {
        return;
    }

    static CFAbsoluteTime lastNotificationTime = 0;
    for (UITouch *touch in event.allTouches) {
        if (touch.phase != UITouchPhaseEnded || !touch.window) continue;
        CGPoint point = [touch locationInView:touch.window];
        CGRect bounds = touch.window.bounds;
        if (point.y < CGRectGetHeight(bounds) - 110) continue;

        CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
        if (now - lastNotificationTime < 0.15) return;
        lastNotificationTime = now;

        CGFloat tabWidth = CGRectGetWidth(bounds) / 5.0;
        NSInteger tabIndex = MIN(4, MAX(0, (NSInteger)(point.x / tabWidth)));
        CFStringRef notificationName = tabIndex == 2
            ? CFSTR("com.quanhandsome.screenclone.zone.show")
            : CFSTR("com.quanhandsome.screenclone.zone.hide");
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            notificationName,
            NULL,
            NULL,
            YES);
        return;
    }
}

%hook UIApplication

- (void)sendEvent:(UIEvent *)event {
    %orig;
    SCObserveMetaTraderTabTap(event);
}

%end

%hook SpringBoard

- (void)applicationDidFinishLaunching:(id)application {
    %orig;
    dispatch_async(dispatch_get_main_queue(), ^{
        [[SCOverlayManager sharedManager] start];
    });
}

%end

%hook SBHomeHardwareButton

- (void)initialButtonDown:(id)gesture {
    scHomePressed = YES;
    scLastHomePress = CFAbsoluteTimeGetCurrent();
    if (scVolumeDownPressed ||
        (scLastVolumeDown > 0 && scLastHomePress - scLastVolumeDown < 0.65)) {
        SCActivateIfNeeded();
    }
    %orig;
}

- (void)singlePressUp:(id)press {
    scHomePressed = NO;
    if (scChordActive) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 350 * NSEC_PER_MSEC),
                       dispatch_get_main_queue(), ^{
            SCResetChordState();
        });
        return;
    }
    %orig;
}

%end

%hook SBHomeHardwareButtonActions

- (void)performSinglePressUpActions {
    if (scChordActive) return;
    %orig;
}

%end

%hook SBVolumeHardwareButton

- (void)volumeIncreasePress:(id)gesture {
    if (SCUsesHomeGestureDevice()) {
        scLastVolumeUp = CFAbsoluteTimeGetCurrent();
    }
    %orig;
}

- (void)volumeDecreasePress:(id)gesture {
    scVolumeDownPressed = YES;
    scLastVolumeDown = CFAbsoluteTimeGetCurrent();

    if (SCUsesHomeGestureDevice() && scLastVolumeUp > 0 &&
        scLastVolumeDown - scLastVolumeUp < 0.8) {
        %orig;
        SCActivateIfNeeded();
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC),
                       dispatch_get_main_queue(), ^{
            SCHideVolumeHUD();
        });
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 1200 * NSEC_PER_MSEC),
                       dispatch_get_main_queue(), ^{
            SCResetChordState();
        });
        return;
    }

    if (scHomePressed ||
        (scLastHomePress > 0 && scLastVolumeDown - scLastHomePress < 0.65)) {
        SCActivateIfNeeded();
        return;
    }
    scVolumeDownPressed = NO;
    %orig;
}

%end
