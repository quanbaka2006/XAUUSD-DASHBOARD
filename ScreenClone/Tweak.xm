#import <UIKit/UIKit.h>
#import "SCOverlayManager.h"

static BOOL scPowerPressed = NO;
static BOOL scVolumeDownPressed = NO;
static BOOL scChordActive = NO;

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
        scChordActive = YES;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_MSEC),
                       dispatch_get_main_queue(), ^{
            [[SCOverlayManager sharedManager] activateCapture];
        });
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
