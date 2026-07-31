#import <UIKit/UIKit.h>
#import "SCOverlayManager.h"

static BOOL scPowerPressed = NO;
static BOOL scVolumeDownPressed = NO;
static BOOL scChordActive = NO;
static CFAbsoluteTime scLastPowerPress = 0;
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

- (BOOL)_handlePhysicalButtonEvent:(UIPressesEvent *)event {
    UIPress *press = event.allPresses.anyObject;
    NSInteger type = press.type;
    BOOL pressed = press.force > 0;

    if (type == 104) scPowerPressed = pressed;
    if (type == 103) scVolumeDownPressed = pressed;

    if (pressed && scPowerPressed && scVolumeDownPressed && !scChordActive) {
        SCActivateIfNeeded();
        return YES;
    }

    if (!scPowerPressed && !scVolumeDownPressed) {
        scChordActive = NO;
    }

    if (scChordActive && (type == 103 || type == 104)) {
        return YES;
    }
    return %orig;
}

%end

%hook SBLockHardwareButton

- (void)buttonDown:(id)gesture {
    scPowerPressed = YES;
    scLastPowerPress = CFAbsoluteTimeGetCurrent();
    if (scVolumeDownPressed ||
        (scLastVolumeDown > 0 && scLastPowerPress - scLastVolumeDown < 0.65)) {
        SCActivateIfNeeded();
    }
    %orig;
}

- (void)singlePress:(id)press {
    if (scChordActive) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 350 * NSEC_PER_MSEC),
                       dispatch_get_main_queue(), ^{
            scChordActive = NO;
            scPowerPressed = NO;
            scVolumeDownPressed = NO;
            scLastPowerPress = 0;
            scLastVolumeDown = 0;
        });
        return;
    }
    scPowerPressed = NO;
    %orig;
}

%end

%hook SBVolumeHardwareButton

- (void)volumeDecreasePress:(id)gesture {
    scVolumeDownPressed = YES;
    scLastVolumeDown = CFAbsoluteTimeGetCurrent();
    if (scPowerPressed ||
        (scLastPowerPress > 0 && scLastVolumeDown - scLastPowerPress < 0.65)) {
        SCActivateIfNeeded();
        return;
    }
    scVolumeDownPressed = NO;
    %orig;
}

%end
