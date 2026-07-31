#import <UIKit/UIKit.h>
#import <objc/runtime.h>
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

static void SCDumpButtonMethods(void) {
    NSMutableString *dump = [NSMutableString string];
    int classCount = objc_getClassList(NULL, 0);
    Class *classes = (__unsafe_unretained Class *)calloc(classCount, sizeof(Class));
    classCount = objc_getClassList(classes, classCount);
    for (int index = 0; index < classCount; index++) {
        NSString *name = NSStringFromClass(classes[index]);
        if ([name rangeOfString:@"HardwareButton" options:NSCaseInsensitiveSearch].location == NSNotFound &&
            [name rangeOfString:@"Volume" options:NSCaseInsensitiveSearch].location == NSNotFound) {
            continue;
        }
        [dump appendFormat:@"\n[%@]\n", name];
        unsigned int methodCount = 0;
        Method *methods = class_copyMethodList(classes[index], &methodCount);
        for (unsigned int methodIndex = 0; methodIndex < methodCount; methodIndex++) {
            [dump appendFormat:@"%@\n", NSStringFromSelector(method_getName(methods[methodIndex]))];
        }
        free(methods);
    }
    free(classes);
    [dump writeToFile:@"/var/mobile/ScreenCloneButtonMethods.txt"
           atomically:YES
             encoding:NSUTF8StringEncoding
                error:nil];
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

%ctor {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC),
                   dispatch_get_main_queue(), ^{
        SCDumpButtonMethods();
    });
}

%hook SBVolumeControl

- (void)decreaseVolume {
    scLastVolumeDown = CFAbsoluteTimeGetCurrent();
    if (scLastPowerPress > 0 &&
        scLastVolumeDown - scLastPowerPress < 0.65) {
        SCActivateIfNeeded();
    }
    %orig;
}

%end

%hook SBLockHardwareButton

- (void)singlePress:(id)press {
    scLastPowerPress = CFAbsoluteTimeGetCurrent();
    if (scLastVolumeDown > 0 &&
        scLastPowerPress - scLastVolumeDown < 0.65) {
        SCActivateIfNeeded();
        return;
    }
    %orig;
}

- (void)singlePressUp:(id)press {
    if (scChordActive) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 350 * NSEC_PER_MSEC),
                       dispatch_get_main_queue(), ^{
            scChordActive = NO;
            scLastPowerPress = 0;
            scLastVolumeDown = 0;
        });
        return;
    }
    %orig;
}

%end
