#import <UIKit/UIKit.h>
#import "SCOverlayManager.h"

static BOOL scHomePressed = NO;
static BOOL scVolumeDownPressed = NO;
static BOOL scChordActive = NO;
static CFAbsoluteTime scLastHomePress = 0;
static CFAbsoluteTime scLastVolumeDown = 0;

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
            scChordActive = NO;
            scHomePressed = NO;
            scVolumeDownPressed = NO;
            scLastHomePress = 0;
            scLastVolumeDown = 0;
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

- (void)volumeDecreasePress:(id)gesture {
    scVolumeDownPressed = YES;
    scLastVolumeDown = CFAbsoluteTimeGetCurrent();
    if (scHomePressed ||
        (scLastHomePress > 0 && scLastVolumeDown - scLastHomePress < 0.65)) {
        SCActivateIfNeeded();
        return;
    }
    scVolumeDownPressed = NO;
    %orig;
}

%end
