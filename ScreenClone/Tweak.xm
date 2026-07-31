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
